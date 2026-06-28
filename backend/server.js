const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const session = require('express-session');
const bcrypt = require('bcrypt');
const OpenAI = require('openai');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

// Use axios for HTTP requests (more reliable than fetch polyfill)
const axios = require('axios');

// Import database functions
const { UserDB, TranscriptionDB } = require('./database');

const execAsync = promisify(exec);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? true : [
      'http://localhost:3000',
      'http://192.168.1.116:3000', // Allow access from your IP
      /^http:\/\/192\.168\.1\.\d+:3000$/ // Allow any device on your local network
    ],
    credentials: true
  }
});

const PORT = process.env.PORT || 3001;

// Store active processing jobs
const activeJobs = new Map();

// Serve static files from React build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/build')));
}

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? true : [
    'http://localhost:3000',
    'http://192.168.1.116:3000', // Allow access from your IP
    /^http:\/\/192\.168\.1\.\d+:3000$/ // Allow any device on your local network
  ],
  credentials: true
}));
app.use(express.json());

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'voice-transcription-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Authentication credentials from environment variables
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'VoiceApp2024!Secure';

// Authentication middleware
// Middleware to check authentication
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated && req.session.userId) {
    return next();
  } else {
    return res.status(401).json({ error: 'Authentication required' });
  }
}

// Middleware to check usage limits
async function checkUsageLimit(req, res, next) {
  try {
    const user = await UserDB.findUserById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    if (user.usage_count >= user.usage_limit) {
      return res.status(429).json({ 
        error: 'Usage limit exceeded', 
        details: `You have reached your limit of ${user.usage_limit} transcriptions. Please upgrade your plan.`,
        usageCount: user.usage_count,
        usageLimit: user.usage_limit
      });
    }
    
    req.user = user;
    return next();
  } catch (error) {
    console.error('Usage check error:', error);
    return res.status(500).json({ error: 'Usage check failed' });
  }
}

// Middleware to check admin privileges
async function requireAdmin(req, res, next) {
  try {
    if (!req.session || !req.session.authenticated || !req.session.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await UserDB.findUserById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Check if user is admin (premium subscription tier or specific admin email)
    const isAdmin = user.subscription_tier === 'premium' || user.email === 'admin@voiceapp.com';
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    req.user = user;
    return next();
  } catch (error) {
    console.error('Admin check error:', error);
    return res.status(500).json({ error: 'Admin check failed' });
  }
}

// Serve static files from React build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
}

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
fs.ensureDirSync(uploadsDir);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}${ext}`);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
      'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/webm', 'audio/ogg',
      'video/mp4', 'video/webm' // Some browsers send video MIME for audio files
    ];
    const allowedExtensions = ['.mp3', '.wav', '.m4a', '.mp4', '.webm', '.ogg'];
    
    const hasValidMimeType = allowedTypes.includes(file.mimetype);
    const hasValidExtension = allowedExtensions.some(ext => 
      file.originalname.toLowerCase().endsWith(ext)
    );
    
    if (hasValidMimeType || hasValidExtension) {
      cb(null, true);
    } else {
      console.log(`Rejected file: ${file.originalname}, MIME: ${file.mimetype}`);
      cb(new Error('Invalid file type. Please upload audio files only.'));
    }
  },
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024 // 2GB limit (video files can be large, audio gets compressed before processing)
  }
});

// Handle multer errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        details: 'Maximum file size is 100MB. Files larger than 25MB will be automatically split into smaller chunks for processing.'
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: 'Invalid file upload',
        details: 'Please upload only one audio file at a time.'
      });
    }
  }
  next(error);
});

// Initialize OpenAI with extended timeout for large files
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 10 * 60 * 1000, // 10 minutes timeout for large file transcriptions
  maxRetries: 3 // Retry failed requests up to 3 times
});

// Configure email service (production-ready services only)
let transporter;

if (process.env.RESEND_API_KEY) {
  // Resend - Using HTTPS API (no SMTP)
  console.log('Email service: Resend HTTPS API (Railway compatible)');
} else if (process.env.SENDGRID_API_KEY) {
  // SendGrid - Alternative production email service
  transporter = nodemailer.createTransport({
    service: 'SendGrid',
    auth: {
      user: 'apikey',
      pass: process.env.SENDGRID_API_KEY
    }
  });
  console.log('Email service: SendGrid (Production)');
} else {
  console.warn('No production email service configured. Email functionality disabled.');
}

// Helper function to convert audio/video files to compressed MP3 (optimized for Whisper)
async function convertToCompressedAudio(inputPath, outputPath) {
  try {
    // Check if FFmpeg is available
    await execAsync('which ffmpeg');
    
    // Convert to mono MP3 at 96kbps, 16kHz - optimal for Whisper API
    // Whisper internally resamples to 16kHz mono anyway, so this loses no quality
    // 96kbps gives extra headroom for tonal languages (Thai, Chinese, etc.)
    const command = `ffmpeg -i "${inputPath}" -vn -ar 16000 -ac 1 -b:a 96k -f mp3 "${outputPath}" -y`;
    await execAsync(command, { timeout: 300000 }); // 5 min timeout for large files
    return true;
  } catch (error) {
    console.error('FFmpeg conversion error:', error.message);
    if (error.message.includes('not found')) {
      console.log('FFmpeg not available on this platform, skipping conversion');
    }
    return false;
  }
}

// Helper function to get audio duration
async function getAudioDuration(inputPath) {
  try {
    // Check if ffprobe is available
    await execAsync('which ffprobe');
    
    const command = `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${inputPath}"`;
    const { stdout } = await execAsync(command);
    return parseFloat(stdout.trim());
  } catch (error) {
    console.error('FFprobe duration error:', error);
    if (error.message.includes('not found')) {
      console.log('FFprobe not available on this platform, cannot determine audio duration');
    }
    return null;
  }
}



// Helper function to split audio file into chunks
async function splitAudioFile(inputPath, maxSizeMB = 20, forcedMaxDuration = null) {
  try {
    const duration = await getAudioDuration(inputPath);
    if (!duration) {
      throw new Error('Could not determine audio duration');
    }

    // Use forced max duration if provided, otherwise calculate from file size
    let chunkDuration;
    
    if (forcedMaxDuration) {
      chunkDuration = forcedMaxDuration;
    } else {
      // Estimate file size per second
      const stats = await fs.stat(inputPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      const sizePerSecond = fileSizeMB / duration;
      
      // Calculate chunk duration to stay under maxSizeMB
      const maxChunkDuration = Math.min(600, duration / 2);
      chunkDuration = Math.floor((maxSizeMB * 0.8) / sizePerSecond);
      chunkDuration = Math.min(chunkDuration, maxChunkDuration);
    }
    
    // Ensure minimum chunk duration of 30 seconds
    chunkDuration = Math.max(chunkDuration, 30);
    
    if (chunkDuration >= duration) {
      // File is small enough, no need to split
      return [inputPath];
    }

    const stats = await fs.stat(inputPath);
    const fileSizeMB = stats.size / (1024 * 1024);
    console.log(`Splitting ${fileSizeMB.toFixed(1)}MB file (${Math.round(duration/60)} min) into chunks of ~${Math.floor(chunkDuration/60)}min each`);

    const chunks = [];
    const baseDir = path.dirname(inputPath);
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const ext = path.extname(inputPath);

    let startTime = 0;
    let chunkIndex = 0;

    while (startTime < duration) {
      const remainingDuration = duration - startTime;
      // Add 2 seconds overlap to avoid losing audio at boundaries
      const actualChunkDuration = Math.min(chunkDuration + 2, remainingDuration);
      
      const chunkPath = path.join(baseDir, `${baseName}_chunk_${chunkIndex}${ext}`);
      // Re-encode chunks for precise cutting (stream copy can lose seconds at boundaries)
      const command = `ffmpeg -i "${inputPath}" -ss ${startTime} -t ${actualChunkDuration} -ar 16000 -ac 1 -b:a 96k "${chunkPath}" -y`;
      
      await execAsync(command, { timeout: 120000 });
      chunks.push(chunkPath);
      
      startTime += chunkDuration; // Advance by chunkDuration (not actualChunkDuration) to create overlap
      chunkIndex++;
    }

    console.log(`Created ${chunks.length} chunks`);
    return chunks;
  } catch (error) {
    console.error('Audio splitting error:', error);
    throw error;
  }
}

// User Registration
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    
    // Validation
    if (!email || !password || !fullName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email, password, and full name are required' 
      });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        error: 'Password must be at least 6 characters long' 
      });
    }
    
    // Check if user already exists
    const existingUser = await UserDB.findUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        error: 'User with this email already exists' 
      });
    }
    
    // Create new user
    const user = await UserDB.createUser(email, password, fullName);
    
    res.json({ 
      success: true, 
      message: 'Registration successful',
      user: { id: user.id, email: user.email, fullName: user.fullName }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Registration failed', 
      details: error.message 
    });
  }
});

// User Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email and password are required' 
      });
    }
    
    // Find user by email
    const user = await UserDB.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid email or password' 
      });
    }
    
    // Verify password
    const isValidPassword = await UserDB.verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid email or password' 
      });
    }
    
    // Update last login
    await UserDB.updateLastLogin(user.id);
    
    // Set session
    req.session.authenticated = true;
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    
    res.json({ 
      success: true, 
      message: 'Login successful',
      user: { 
        id: user.id, 
        email: user.email, 
        fullName: user.full_name,
        subscriptionTier: user.subscription_tier,
        usageCount: user.usage_count,
        usageLimit: user.usage_limit
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Login failed', 
      details: error.message 
    });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true, message: 'Logout successful' });
  });
});

app.get('/api/auth-status', async (req, res) => {
  if (req.session && req.session.authenticated && req.session.userId) {
    try {
      const user = await UserDB.findUserById(req.session.userId);
      if (user) {
        const stats = await UserDB.getUserStats(req.session.userId);
        res.json({ 
          authenticated: true,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.full_name,
            subscriptionTier: user.subscription_tier,
            usageCount: user.usage_count,
            usageLimit: user.usage_limit,
            createdAt: user.created_at,
            lastLogin: user.last_login,
            stats: {
              totalTranscriptions: stats.total_transcriptions || 0,
              totalFileSize: stats.total_file_size || 0,
              lastTranscription: stats.last_transcription
            }
          }
        });
      } else {
        res.json({ authenticated: false });
      }
    } catch (error) {
      console.error('Auth status error:', error);
      res.json({ authenticated: false });
    }
  } else {
    res.json({ authenticated: false });
  }
});

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Voice Transcription API is running' });
});

app.get('/api/test-email', async (req, res) => {
  try {
    if (!transporter) {
      return res.status(500).json({ error: 'Email not configured' });
    }
    
    // Test the connection
    await transporter.verify();
    res.json({ message: 'Email configuration is working' });
  } catch (error) {
    console.error('Email test error:', error);
    res.status(500).json({ 
      error: 'Email configuration failed', 
      details: error.message 
    });
  }
});

// User Profile endpoint
app.get('/api/profile', requireAuth, async (req, res) => {
  try {
    const user = await UserDB.findUserById(req.session.userId);
    const stats = await UserDB.getUserStats(req.session.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        subscriptionTier: user.subscription_tier,
        usageCount: user.usage_count,
        usageLimit: user.usage_limit,
        createdAt: user.created_at,
        lastLogin: user.last_login
      },
      stats: {
        totalTranscriptions: stats.total_transcriptions || 0,
        totalFileSize: stats.total_file_size || 0,
        lastTranscription: stats.last_transcription
      }
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// Transcription History endpoint
app.get('/api/history', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const transcriptions = await TranscriptionDB.getUserTranscriptions(req.session.userId, limit, offset);
    
    res.json({
      transcriptions,
      pagination: {
        page,
        limit,
        hasMore: transcriptions.length === limit
      }
    });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

// Get specific transcription
app.get('/api/transcription/:id', requireAuth, async (req, res) => {
  try {
    const transcription = await TranscriptionDB.getTranscription(req.params.id, req.session.userId);
    
    if (!transcription) {
      return res.status(404).json({ error: 'Transcription not found' });
    }
    
    res.json({ transcription });
  } catch (error) {
    console.error('Get transcription error:', error);
    res.status(500).json({ error: 'Failed to load transcription' });
  }
});

// Delete transcription
app.delete('/api/transcription/:id', requireAuth, async (req, res) => {
  try {
    const result = await TranscriptionDB.deleteTranscription(req.params.id, req.session.userId);
    
    if (!result.deleted) {
      return res.status(404).json({ error: 'Transcription not found' });
    }
    
    res.json({ message: 'Transcription deleted successfully' });
  } catch (error) {
    console.error('Delete transcription error:', error);
    res.status(500).json({ error: 'Failed to delete transcription' });
  }
});

// Admin endpoints
// Get all users (admin only)
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const users = await UserDB.getAllUsers(limit, offset);
    const systemStats = await UserDB.getSystemStats();
    
    res.json({
      users,
      systemStats,
      pagination: {
        page,
        limit,
        hasMore: users.length === limit
      }
    });
  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// Reset user password (admin only)
app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;
    const userId = req.params.id;
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }
    
    const result = await UserDB.resetUserPassword(userId, newPassword);
    
    if (!result.updated) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Update user subscription (admin only)
app.put('/api/admin/users/:id/subscription', requireAdmin, async (req, res) => {
  try {
    const { subscriptionTier, usageLimit } = req.body;
    const userId = req.params.id;
    
    if (!subscriptionTier || !usageLimit) {
      return res.status(400).json({ error: 'Subscription tier and usage limit are required' });
    }
    
    const result = await UserDB.updateUserSubscription(userId, subscriptionTier, parseInt(usageLimit));
    
    if (!result.updated) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'Subscription updated successfully' });
  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

// Reset user usage count (admin only)
app.post('/api/admin/users/:id/reset-usage', requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const result = await UserDB.resetUserUsage(userId);
    
    if (!result.updated) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'Usage count reset successfully' });
  } catch (error) {
    console.error('Reset usage error:', error);
    res.status(500).json({ error: 'Failed to reset usage count' });
  }
});

// Toggle user active status (admin only)
app.put('/api/admin/users/:id/status', requireAdmin, async (req, res) => {
  try {
    const { isActive } = req.body;
    const userId = req.params.id;
    
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }
    
    const result = await UserDB.toggleUserStatus(userId, isActive);
    
    if (!result.updated) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: `User ${isActive ? 'activated' : 'deactivated'} successfully` });
  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

// Delete user (admin only)
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Prevent admin from deleting themselves
    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    const result = await UserDB.deleteUser(userId);
    
    if (!result.deleted) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Get system statistics (admin only)
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const stats = await UserDB.getSystemStats();
    res.json({ stats });
  } catch (error) {
    console.error('System stats error:', error);
    res.status(500).json({ error: 'Failed to load system statistics' });
  }
});

// Job status endpoint for HTTP polling fallback (mobile compatibility)
app.get('/api/job-status/:jobId', requireAuth, async (req, res) => {
  try {
    const jobId = req.params.jobId;
    const job = activeJobs.get(jobId);
    
    if (!job) {
      return res.status(404).json({ 
        status: 'not_found',
        error: 'Job not found or completed' 
      });
    }
    
    // Check if user owns this job
    if (job.userId !== req.session.userId) {
      return res.status(403).json({ 
        status: 'unauthorized',
        error: 'Unauthorized access to job' 
      });
    }
    
    // Return job status
    res.json({
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      filename: job.filename,
      cancelling: job.cancelling || false,
      result: job.result || null
    });
    
  } catch (error) {
    console.error('Job status error:', error);
    res.status(500).json({ 
      status: 'error',
      error: 'Failed to get job status' 
    });
  }
});

// File cleanup utility function for job cancellation
async function cleanupJobFiles(job) {
  const filesToClean = [
    job.originalFile,
    job.convertedFile,
    ...job.tempFiles
  ].filter(Boolean);
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`Cleaning up ${filesToClean.length} files for job ${job.id}`);
  }
  
  await Promise.all(
    filesToClean.map(file => 
      fs.remove(file).catch(err => 
        console.error(`Failed to remove file ${file}:`, err.message)
      )
    )
  );
}

// Job cancellation function
async function cancelTranscriptionJob(jobId, userId) {
  const job = activeJobs.get(jobId);
  if (!job || job.userId !== userId) {
    console.log(`Job ${jobId} not found or unauthorized for user ${userId}`);
    return false;
  }
  
  console.log(`Cancelling job ${jobId} for user ${userId}`);
  
  // Mark job as cancelling
  job.status = 'cancelling';
  job.stage = 'Cancelling transcription...';
  job.cancelling = true;
  
  // Notify frontend immediately
  io.to(`user-${job.userId}`).emit('processing-status', {
    jobId,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    filename: job.filename,
    cancelling: job.cancelling
  });
  
  // Cancel any ongoing HTTP requests
  if (job.abortController) {
    job.abortController.abort();
  }
  
  // Clean up temporary files
  await cleanupJobFiles(job);
  
  // Remove from active jobs
  activeJobs.delete(jobId);
  
  // Notify completion
  io.to(`user-${job.userId}`).emit('job-cancelled', {
    jobId,
    message: 'Transcription cancelled successfully'
  });
  
  return true;
}

app.post('/api/transcribe', requireAuth, checkUsageLimit, upload.single('audio'), async (req, res) => {
  let convertedPath = null; // Define at function scope
  const jobId = uuidv4();
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    // Fix Thai/Unicode filename encoding from multer
    // Multer stores originalname in Latin1; decode it back to UTF-8
    let originalFilename = req.file.originalname;
    try {
      originalFilename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    } catch (e) {
      // If decoding fails, use as-is
    }

    // Create job tracking with cancellation support
    const job = {
      id: jobId,
      userId: req.session.userId,
      filename: originalFilename,
      status: 'processing',
      progress: 0,
      stage: 'Preparing upload...',
      startTime: Date.now(),
      abortController: new AbortController(),
      tempFiles: [], // Track temporary files for cleanup
      cancelling: false
    };
    
    activeJobs.set(jobId, job);
    
    // Send initial status to user
    io.to(`user-${req.session.userId}`).emit('processing-status', {
      jobId,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      filename: job.filename
    });

    // Return job ID immediately so frontend can track progress
    res.json({ 
      jobId,
      message: 'Processing started',
      filename: originalFilename
    });

    // Helper function to update job progress
    const updateProgress = (progress, stage) => {
      // Check if job was cancelled
      if (job.status === 'cancelling' || job.cancelling) {
        console.log(`Job ${jobId} was cancelled, skipping progress update`);
        return;
      }
      
      job.progress = progress;
      job.stage = stage;
      io.to(`user-${req.session.userId}`).emit('processing-status', {
        jobId,
        status: job.status,
        progress: job.progress,
        stage: job.stage,
        filename: job.filename,
        cancelling: job.cancelling || false
      });
    };

    // Check file size and handle large files
    const fileSizeMB = req.file.size / (1024 * 1024);
    console.log(`Processing file: ${req.file.filename} (${fileSizeMB.toFixed(1)}MB)`);
    
    // OpenAI Whisper has 25MB limit, so we need to split larger files
    let shouldSplit = fileSizeMB > 25;
    
    // Set reasonable upper limit
    if (fileSizeMB > 2048) {
      // Notify via WebSocket since we already sent the response
      io.to(`user-${req.session.userId}`).emit('processing-error', {
        jobId,
        error: 'File too large',
        details: `File size is ${fileSizeMB.toFixed(1)}MB. Maximum allowed is 2GB. Please use a smaller file.`
      });
      activeJobs.delete(jobId);
      await fs.remove(req.file.path).catch(console.error);
      return;
    }

    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
      return res.status(500).json({ 
        error: 'OpenAI API key not configured', 
        details: 'Please add your OpenAI API key to backend/.env file' 
      });
    }

    const { language = 'en' } = req.body;
    let audioPath = req.file.path;
    let audioChunks = [];
    
    // Track original file for cleanup
    job.originalFile = req.file.path;
    job.tempFiles.push(req.file.path);

    updateProgress(10, `Processing ${fileSizeMB.toFixed(1)}MB file...`);

    console.log(`Transcribing file: ${req.file.filename} (${req.file.mimetype}), Language: ${language}`);
    console.log(`File path: ${audioPath}`);

    // Always convert to compressed MP3 for optimal Whisper API performance
    // This extracts audio only (strips video), converts to mono 16kHz 96kbps MP3
    // Dramatically reduces file size: 243MB video → ~8MB MP3
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    
    updateProgress(20, 'Extracting and compressing audio for transcription...');
    console.log('Converting to compressed MP3 (mono, 16kHz, 96kbps)...');
    convertedPath = audioPath.replace(path.extname(audioPath), '_compressed.mp3');
    
    const conversionSuccess = await convertToCompressedAudio(audioPath, convertedPath);
    if (conversionSuccess) {
      const compressedSize = (await fs.stat(convertedPath)).size / (1024 * 1024);
      audioPath = convertedPath;
      job.convertedFile = convertedPath;
      job.tempFiles.push(convertedPath);
      console.log(`Compression successful: ${fileSizeMB.toFixed(1)}MB → ${compressedSize.toFixed(1)}MB`);
      updateProgress(30, `Audio compressed: ${fileSizeMB.toFixed(1)}MB → ${compressedSize.toFixed(1)}MB`);
      
      // Re-evaluate if splitting is needed based on compressed size
      shouldSplit = compressedSize > 25;
    } else {
      console.log('Compression failed, trying original file');
      updateProgress(30, 'Compression failed, using original file');
    }

    // Handle splitting - gpt-4o-transcribe has ~2000 output token limit
    // Thai text uses more tokens per character, so use shorter chunks (3 min)
    const audioDuration = await getAudioDuration(audioPath);
    const maxChunkDuration = 180; // 3 minutes max per chunk - prevents output truncation for Thai
    
    if (audioDuration && audioDuration > maxChunkDuration) {
      shouldSplit = true;
      updateProgress(35, `Audio is ${Math.round(audioDuration / 60)} minutes, splitting into ~3min chunks...`);
      console.log(`Audio duration: ${Math.round(audioDuration / 60)} minutes, splitting into 3-min chunks...`);
      try {
        audioChunks = await splitAudioFile(audioPath, 25, maxChunkDuration);
        job.tempFiles.push(...audioChunks);
        console.log(`Split into ${audioChunks.length} chunks`);
      } catch (splitError) {
        console.log('Audio splitting failed:', splitError.message);
        // Fall back to sending the full file
        audioChunks = [audioPath];
      }
    } else if (shouldSplit) {
      updateProgress(35, 'File is large, splitting into smaller chunks...');
      console.log('File is large, splitting into smaller chunks...');
      try {
        audioChunks = await splitAudioFile(audioPath);
        job.tempFiles.push(...audioChunks);
        console.log(`Split into ${audioChunks.length} chunks`);
      } catch (splitError) {
        console.log('Audio splitting failed:', splitError.message);
        audioChunks = [audioPath];
      }
    } else {
      audioChunks = [audioPath];
    }

    // Transcribe chunks in parallel for faster processing
    let allTranscriptions = new Array(audioChunks.length).fill(null);
    
    // Helper function to transcribe a single chunk with retry logic
    const transcribeChunk = async (chunkPath, chunkIndex) => {
      // Check if job was cancelled
      if (job.status === 'cancelling' || job.cancelling) {
        return null;
      }
      
      const chunkStats = await fs.stat(chunkPath);
      const chunkSizeMB = chunkStats.size / (1024 * 1024);
      console.log(`Chunk ${chunkIndex + 1} size: ${chunkSizeMB.toFixed(1)}MB`);
      
      if (chunkSizeMB > 25) {
        console.log(`Chunk ${chunkIndex + 1} is still too large (${chunkSizeMB.toFixed(1)}MB), skipping...`);
        return `[Chunk ${chunkIndex + 1} too large to process]`;
      }
      
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        attempts++;
        
        // Check cancellation before each attempt
        if (job.status === 'cancelling' || job.cancelling) {
          return null;
        }
        
        try {
          const fileStream = fs.createReadStream(chunkPath);
          
          const transcriptionOptions = {
            file: fileStream,
            model: 'gpt-4o-transcribe',
            response_format: 'text'
          };
          
          const requestOptions = {
            signal: job.abortController.signal
          };
          
          // Always add language for better accuracy
          if (language) {
            transcriptionOptions.language = language === 'th' ? 'th' : 'en';
          }
          
          const chunkTranscription = await openai.audio.transcriptions.create(transcriptionOptions, requestOptions);
          
          console.log(`✅ Chunk ${chunkIndex + 1}/${audioChunks.length} transcribed successfully (${chunkSizeMB.toFixed(1)}MB, attempt ${attempts}, ${typeof chunkTranscription === 'string' ? chunkTranscription.length : 0} chars)`);
          return chunkTranscription;
          
        } catch (chunkError) {
          if (chunkError.name === 'AbortError') {
            console.log(`Chunk ${chunkIndex + 1} transcription was cancelled`);
            return null;
          }
          
          // Handle quota exceeded - no point retrying
          if (chunkError.status === 429 || chunkError.code === 'insufficient_quota') {
            console.error(`❌ OpenAI quota exceeded. Please add credits to your account.`);
            throw new Error('OpenAI quota exceeded. Please check your billing at https://platform.openai.com/account/billing');
          }
          
          console.log(`❌ Chunk ${chunkIndex + 1}/${audioChunks.length} attempt ${attempts} failed:`, chunkError.message);
          
          if (attempts === maxAttempts) {
            console.error(`Failed to transcribe chunk ${chunkIndex + 1} after ${maxAttempts} attempts`);
            return `[Chunk ${chunkIndex + 1} transcription failed: ${chunkError.message}]`;
          } else {
            const waitTime = chunkError.message.includes('Connection') ? 5000 : 2000;
            console.log(`Waiting ${waitTime/1000} seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
      }
      return `[Chunk ${chunkIndex + 1} transcription failed]`;
    };

    // Process chunks with limited concurrency (max 2 at a time to stay within TPM limits)
    const MAX_CONCURRENT = 2;
    console.log(`Processing ${audioChunks.length} chunk(s) with concurrency of ${MAX_CONCURRENT}...`);
    updateProgress(40, `Transcribing ${audioChunks.length} chunk(s)...`);
    
    const results = new Array(audioChunks.length).fill(null);
    
    for (let i = 0; i < audioChunks.length; i += MAX_CONCURRENT) {
      // Check cancellation between batches
      if (job.status === 'cancelling' || job.cancelling) {
        console.log(`Job ${jobId} was cancelled, stopping`);
        return;
      }
      
      const batch = audioChunks.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.all(
        batch.map((chunkPath, batchIdx) => transcribeChunk(chunkPath, i + batchIdx))
      );
      
      // Store results in correct order
      batchResults.forEach((result, batchIdx) => {
        results[i + batchIdx] = result;
      });
      
      // Update progress
      const completedChunks = Math.min(i + MAX_CONCURRENT, audioChunks.length);
      const progress = 40 + (completedChunks / audioChunks.length) * 50;
      updateProgress(progress, `Transcribed ${completedChunks}/${audioChunks.length} chunks...`);
    }
    
    // Check if job was cancelled during processing
    if (job.status === 'cancelling' || job.cancelling) {
      console.log(`Job ${jobId} was cancelled, stopping`);
      return;
    }
    
    // Assemble results in order
    allTranscriptions = results.filter(r => r !== null);

    // Combine all transcriptions
    const transcription = allTranscriptions.join(' ');

    // Prepare processing details
    const compressedSizeMB = convertedPath ? (await fs.stat(convertedPath).catch(() => null))?.size / (1024 * 1024) : null;
    const processingDetails = {
      originalFileSize: `${fileSizeMB.toFixed(1)}MB`,
      compressedFileSize: compressedSizeMB ? `${compressedSizeMB.toFixed(1)}MB` : null,
      compressionRatio: compressedSizeMB ? `${((1 - compressedSizeMB / fileSizeMB) * 100).toFixed(0)}% smaller` : null,
      chunksProcessed: audioChunks.length,
      conversionUsed: !!convertedPath,
      splittingUsed: shouldSplit && audioChunks.length > 1,
      totalProcessingTime: `${((Date.now() - job.startTime) / 1000).toFixed(1)}s`
    };

    // Clean up uploaded files and chunks
    await fs.remove(req.file.path);
    if (convertedPath && convertedPath !== req.file.path) {
      await fs.remove(convertedPath).catch(console.error);
    }
    
    // Clean up audio chunks (but keep original if it wasn't split)
    if (shouldSplit && audioChunks.length > 1) {
      for (const chunkPath of audioChunks) {
        if (chunkPath !== audioPath) { // Don't delete the main converted file twice
          await fs.remove(chunkPath).catch(console.error);
        }
      }
    }

    // Final check if job was cancelled before saving
    if (job.status === 'cancelling' || job.cancelling) {
      console.log(`Job ${jobId} was cancelled, skipping database save`);
      return;
    }
    
    updateProgress(90, 'Transcription completed, saving to database...');
    console.log(`Transcription completed: ${processingDetails.originalFileSize} file, ${processingDetails.chunksProcessed} chunks processed`);

    // Save transcription to database
    try {
      const transcriptionData = {
        filename: req.file.filename,
        originalFilename: originalFilename,
        fileSize: req.file.size,
        language: language,
        transcription: typeof transcription === 'string' ? transcription : transcription.text,
        summary: null, // Will be updated when summary is generated
        processingDetails: processingDetails
      };
      
      const savedTranscription = await TranscriptionDB.saveTranscription(req.session.userId, transcriptionData);
      
      // Increment user usage count
      await UserDB.incrementUsage(req.session.userId);
      
      // Update job status to completed and send final result
      job.status = 'completed';
      job.progress = 100;
      job.stage = 'Transcription completed successfully!';
      job.result = {
        id: savedTranscription.id,
        transcription: transcriptionData.transcription,
        filename: originalFilename,
        processingDetails
      };
      
      io.to(`user-${req.session.userId}`).emit('processing-complete', {
        jobId,
        result: job.result
      });
      
    } catch (dbError) {
      console.error('Database save error:', dbError);
      
      // Update job status to completed with warning
      job.status = 'completed';
      job.progress = 100;
      job.stage = 'Transcription completed (not saved to history)';
      job.result = {
        transcription: typeof transcription === 'string' ? transcription : transcription.text,
        filename: originalFilename,
        processingDetails,
        warning: 'Transcription completed but not saved to history'
      };
      
      io.to(`user-${req.session.userId}`).emit('processing-complete', {
        jobId,
        result: job.result
      });
    }

    // Clean up job from active jobs after a delay
    setTimeout(() => {
      activeJobs.delete(jobId);
    }, 30000); // Keep for 30 seconds for any late connections

  } catch (error) {
    console.error('Transcription error:', error);
    
    // Check if this was a cancellation (not an error)
    const currentJob = activeJobs.get(jobId);
    if (error.name === 'AbortError' || (currentJob && currentJob.status === 'cancelling')) {
      console.log(`Job ${jobId} was cancelled, cleanup already handled`);
      return;
    }
    
    // Clean up files on error
    if (req.file) {
      await fs.remove(req.file.path).catch(console.error);
    }
    if (convertedPath) {
      await fs.remove(convertedPath).catch(console.error);
    }
    
    // Clean up any audio chunks via job tracking
    const failedJob = activeJobs.get(jobId);
    if (failedJob && failedJob.tempFiles) {
      for (const filePath of failedJob.tempFiles) {
        await fs.remove(filePath).catch(console.error);
      }
    }
    
    let errorMessage = 'Transcription failed';
    let errorDetails = error.message;
    
    if (error.message.includes('API key')) {
      errorMessage = 'Invalid OpenAI API key';
      errorDetails = 'Please check your OpenAI API key in backend/.env file';
    } else if (error.message.includes('quota')) {
      errorMessage = 'OpenAI quota exceeded';
      errorDetails = 'Please check your OpenAI account billing and usage limits';
    } else if (error.code === 'ECONNRESET' || error.message.includes('ECONNRESET')) {
      errorMessage = 'File too large or connection timeout';
      errorDetails = 'The audio file may be too large or complex. Try a smaller file (under 25MB) or shorter duration.';
    } else if (error.message.includes('file format') || error.message.includes('Invalid file format')) {
      errorMessage = 'Unsupported file format';
      errorDetails = 'Please try converting your file to WAV or MP3 format first.';
    }
    
    // Update job status to failed and send error via WebSocket
    if (activeJobs.has(jobId)) {
      const job = activeJobs.get(jobId);
      job.status = 'failed';
      job.error = errorMessage;
      job.errorDetails = errorDetails;
      
      io.to(`user-${req.session.userId}`).emit('processing-error', {
        jobId,
        error: errorMessage,
        details: errorDetails
      });
      
      // Clean up job after delay
      setTimeout(() => {
        activeJobs.delete(jobId);
      }, 30000);
    }
  }
});

app.post('/api/summarize', async (req, res) => {
  try {
    const { text, language = 'en' } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'No text provided for summarization' });
    }

    const prompt = language === 'th' 
      ? `กรุณาวิเคราะห์และสรุปการประชุมต่อไปนี้ในรูปแบบที่มีโครงสร้าง:

🎤 ผู้เข้าร่วม: รายชื่อและบทบาทของผู้เข้าร่วมประชุม
📋 วาระการประชุม: สรุปหัวข้อหลักที่พูดคุย
💡 ประเด็นสำคัญ: ข้อเท็จจริงสำคัญ การตัดสินใจ และเหตุผล
✅ สิ่งที่ต้องดำเนินการ: งานที่มอบหมาย ผู้รับผิดชอบ และกำหนดเวลา
🔑 งานที่ระบุ: การกระทำทั้งหมดที่กล่าวถึงในการประชุม
🎯 ผู้รับผิดชอบ: ใครเป็นผู้ดูแลแต่ละงาน
📅 กำหนดเวลา: วันครบกำหนดสำหรับแต่ละการกระทำ
🔄 การติดตาม: การประชุมครั้งต่อไปหรือจุดตรวจสอบที่กำหนดไว้
📝 ขั้นตอนต่อไป: การกระทำที่จะเกิดขึ้นจากการสนทนา

ข้อความการประชุม:\n\n${text}`
      : `Please analyze and summarize the following meeting/conversation in a structured format:

🎤 **Participants**: List of names and roles of participants mentioned
📋 **Agenda**: Summary of key topics discussed
💡 **Key Points**: Important facts, decisions made, and justifications
✅ **Actions to Take**: Assigned tasks, responsible individuals, and deadlines
🔑 **Identified Tasks**: All actions mentioned during the meeting
🎯 **Responsible Individuals**: Who is in charge of each task
📅 **Deadlines**: Due dates for each action (if mentioned)
🔄 **Follow-Up**: Next meetings or scheduled checkpoints
📝 **Next Steps**: Upcoming actions resulting from the conversation

Please provide a comprehensive analysis even if some sections have limited information. If certain details are not mentioned in the conversation, indicate "Not specified" or "To be determined."

Meeting/Conversation Content:\n\n${text}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Using GPT-4 for better structured analysis
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 1500, // Increased for detailed structured summary
      temperature: 0.2 // Lower temperature for more consistent structure
    });

    const summary = completion.choices[0].message.content;

    res.json({ summary });

  } catch (error) {
    console.error('Summarization error:', error);
    res.status(500).json({ 
      error: 'Summarization failed', 
      details: error.message 
    });
  }
});

app.post('/api/send-email', async (req, res) => {
  try {
    const { email, subject, transcription, summary, filename } = req.body;

    if (!email || !transcription) {
      return res.status(400).json({ error: 'Email and transcription are required' });
    }

    // Check if email service is configured
    if (!process.env.RESEND_API_KEY && !transporter) {
      return res.status(500).json({ 
        error: 'Email service not configured', 
        details: 'Please configure RESEND_API_KEY or SENDGRID_API_KEY in environment variables' 
      });
    }

    const emailContent = `
      <h2>Voice Meeting Transcription & Summary</h2>
      <p><strong>File:</strong> ${filename || 'Audio Recording'}</p>
      
      ${summary ? `
        <h3>Summary</h3>
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 10px 0;">
          ${summary.replace(/\n/g, '<br>')}
        </div>
      ` : ''}
      
      <h3>Full Transcription</h3>
      <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 10px 0;">
        ${transcription.replace(/\n/g, '<br>')}
      </div>
      
      <hr>
      <div style="margin-top: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 5px; font-size: 12px; color: #666;">
        <p><strong>Generated by Voice Transcription App</strong></p>
        <p>&copy; 2024 Voice Transcription App. All rights reserved.</p>
        <p>For support or inquiries: <a href="mailto:ponrawat@neuralnet.co.th">ponrawat@neuralnet.co.th</a></p>
        <p><em>This email contains AI-generated content. Please review for accuracy.</em></p>
      </div>
    `;

    const mailOptions = {
      from: process.env.RESEND_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_USER,
      to: email,
      subject: subject || 'Voice Meeting Transcription & Summary',
      html: emailContent
    };

    // Send email using appropriate service
    if (process.env.RESEND_API_KEY) {
      // Use Resend HTTPS API
      const resendResponse = await axios.post('https://api.resend.com/emails', {
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: email,
        subject: subject || 'Voice Meeting Transcription & Summary',
        html: emailContent
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
    } else if (transporter) {
      // Use nodemailer for other services
      await transporter.sendMail(mailOptions);
    } else {
      throw new Error('No email service configured');
    }

    res.json({ message: 'Email sent successfully' });

  } catch (error) {
    console.error('Email error:', error);
    
    let errorMessage = 'Failed to send email';
    let errorDetails = error.message;
    
    if (error.code === 'EAUTH') {
      errorMessage = 'Email authentication failed';
      errorDetails = 'Please check your email service API key and configuration';
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = 'Email service unavailable';
      errorDetails = 'Please check your internet connection and email service status';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: errorDetails 
    });
  }
});

// Serve React app for all non-API routes in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
  });
}

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Join user-specific room for processing updates
  socket.on('join-user-room', (userId) => {
    socket.join(`user-${userId}`);
    socket.userId = userId; // Store userId for authorization
    console.log(`User ${userId} joined room`);
    
    // Send any active jobs for this user
    for (const [jobId, job] of activeJobs.entries()) {
      if (job.userId === userId) {
        socket.emit('processing-status', {
          jobId,
          status: job.status,
          progress: job.progress,
          stage: job.stage,
          filename: job.filename,
          cancelling: job.cancelling || false
        });
      }
    }
  });
  
  // Handle job cancellation requests
  socket.on('cancel-job', async (jobId) => {
    console.log(`Cancellation requested for job ${jobId} by user ${socket.userId}`);
    
    if (!socket.userId) {
      console.log('Unauthorized cancellation attempt - no user ID');
      return;
    }
    
    const success = await cancelTranscriptionJob(jobId, socket.userId);
    if (!success) {
      socket.emit('cancellation-error', {
        jobId,
        error: 'Job not found or unauthorized'
      });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Production optimizations
  if (process.env.NODE_ENV === 'production') {
    console.log('Production mode: Memory usage optimization enabled');
    
    // Clean up old files periodically (every hour)
    setInterval(() => {
      const uploadsDir = path.join(__dirname, 'uploads');
      fs.readdir(uploadsDir, (err, files) => {
        if (err) return;
        
        const now = Date.now();
        files.forEach(file => {
          const filePath = path.join(uploadsDir, file);
          fs.stat(filePath, (err, stats) => {
            if (err) return;
            
            // Delete files older than 1 hour
            if (now - stats.mtime.getTime() > 60 * 60 * 1000) {
              fs.unlink(filePath, () => {});
            }
          });
        });
      });
      
      // Clean up orphaned jobs (jobs that have been active for more than 2 hours)
      const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
      for (const [jobId, job] of activeJobs.entries()) {
        if (job.startTime < twoHoursAgo) {
          console.log(`Cleaning up orphaned job ${jobId} (started ${new Date(job.startTime)})`);
          cleanupJobFiles(job).catch(console.error);
          activeJobs.delete(jobId);
          
          // Notify client if still connected
          io.to(`user-${job.userId}`).emit('processing-error', {
            jobId,
            error: 'Job timeout',
            details: 'The transcription job took too long and was automatically cancelled'
          });
        }
      }
    }, 60 * 60 * 1000); // Run every hour
  }
});