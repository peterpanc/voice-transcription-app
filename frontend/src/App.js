import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useDropzone } from 'react-dropzone';
import { io } from 'socket.io-client';
import Login from './Login';

// Configure axios to include credentials
axios.defaults.withCredentials = true;

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [user, setUser] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [transcriptionHistory, setTranscriptionHistory] = useState([]);
  const [language, setLanguage] = useState('en');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [transcription, setTranscription] = useState('');
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingStage, setProcessingStage] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [filename, setFilename] = useState('');
  const [activeJobs, setActiveJobs] = useState(new Map());
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminUsers, setAdminUsers] = useState([]);
  const [systemStats, setSystemStats] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [pollingFallback, setPollingFallback] = useState(false);
  
  // Detect mobile device
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  const mediaRecorderRef = useRef(null);
  const socketRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  // Check authentication status on app load
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const response = await axios.get('/api/auth-status', {
        withCredentials: true
      });
      setIsAuthenticated(response.data.authenticated);
      if (response.data.authenticated && response.data.user) {
        setUser(response.data.user);
      }
    } catch (err) {
      setIsAuthenticated(false);
      setUser(null);
    } finally {
      setCheckingAuth(false);
    }
  };

  const handleLogin = async (userData = null) => {
    if (userData) {
      // Use user data from login response
      setIsAuthenticated(true);
      setUser(userData);
      console.log('User logged in with data:', userData);
    } else {
      // Fallback: Re-check authentication status after login to get user data
      // Add small delay to ensure backend session is set
      await new Promise(resolve => setTimeout(resolve, 100));
      
      try {
        const response = await axios.get('/api/auth-status', {
          withCredentials: true
        });
        
        if (response.data.authenticated && response.data.user) {
          setIsAuthenticated(true);
          setUser(response.data.user);
          console.log('User logged in via auth check:', response.data.user);
        } else {
          console.error('Authentication check failed after login');
          // Force re-check after another delay
          setTimeout(async () => {
            try {
              const retryResponse = await axios.get('/api/auth-status', {
                withCredentials: true
              });
              if (retryResponse.data.authenticated && retryResponse.data.user) {
                setUser(retryResponse.data.user);
              }
            } catch (retryErr) {
              console.error('Retry auth check failed:', retryErr);
            }
          }, 500);
        }
      } catch (err) {
        console.error('Failed to check auth status after login:', err);
        // Still set authenticated to true since login was successful
        setIsAuthenticated(true);
      }
    }
  };

  const handleLogout = async () => {
    try {
      await axios.post('/api/logout', {}, {
        withCredentials: true
      });
    } catch (err) {
      console.error('Logout error:', err);
    }
    setIsAuthenticated(false);
    setUser(null);
    setShowProfile(false);
    setShowHistory(false);
  };

  // Socket connection management
  useEffect(() => {
    if (isAuthenticated && user) {
      // Initialize socket connection with mobile-friendly configuration
      const socketUrl = process.env.NODE_ENV === 'production' 
        ? window.location.origin 
        : `${window.location.protocol}//${window.location.hostname}:3001`;
      
      if (process.env.NODE_ENV === 'development') {
        console.log('Connecting to WebSocket:', socketUrl);
      }
      
      socketRef.current = io(socketUrl, {
        withCredentials: true,
        transports: isMobile ? ['polling', 'websocket'] : ['websocket', 'polling'], // Prefer polling on mobile
        timeout: isMobile ? 30000 : 20000, // Longer timeout for mobile networks
        forceNew: true, // Force new connection
        reconnection: true,
        reconnectionDelay: isMobile ? 2000 : 1000, // Longer delay on mobile
        reconnectionAttempts: isMobile ? 3 : 5, // Fewer attempts on mobile to switch to polling faster
        maxReconnectionAttempts: isMobile ? 3 : 5,
        upgrade: !isMobile, // Disable transport upgrade on mobile for stability
        rememberUpgrade: false // Don't remember transport upgrade
      });

      // Add connection event listeners for debugging
      socketRef.current.on('connect', () => {
        if (process.env.NODE_ENV === 'development') {
          console.log('WebSocket connected successfully');
        }
        setConnectionStatus('connected');
        setPollingFallback(false);
        // Join user-specific room after connection
        socketRef.current.emit('join-user-room', user.id);
      });

      socketRef.current.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        setConnectionStatus('error');
        
        // Enable polling fallback after multiple connection failures
        setTimeout(() => {
          setPollingFallback(true);
          console.log('Enabling HTTP polling fallback for mobile compatibility');
        }, 5000);
        
        setError('Connection issues detected. Switching to mobile-compatible mode...');
      });

      socketRef.current.on('reconnect', (attemptNumber) => {
        console.log('WebSocket reconnected after', attemptNumber, 'attempts');
        // Rejoin room after reconnection
        socketRef.current.emit('join-user-room', user.id);
        setError(''); // Clear any connection errors
      });

      socketRef.current.on('reconnect_error', (error) => {
        console.error('WebSocket reconnection failed:', error);
        setConnectionStatus('error');
        setError('Connection lost. Switching to mobile-compatible mode...');
        
        // Enable polling fallback after reconnection failures
        setPollingFallback(true);
      });

      socketRef.current.on('disconnect', (reason) => {
        console.log('WebSocket disconnected:', reason);
        setConnectionStatus('connecting');
        
        if (reason === 'io server disconnect') {
          // Server disconnected, try to reconnect
          socketRef.current.connect();
        }
      });

      // Listen for processing status updates
      socketRef.current.on('processing-status', (data) => {
        setActiveJobs(prev => {
          const newJobs = new Map(prev);
          // Preserve any local cancelling state if not provided by server
          const existingJob = newJobs.get(data.jobId);
          const jobData = {
            ...data,
            cancelling: data.cancelling || (existingJob && existingJob.cancelling) || false
          };
          newJobs.set(data.jobId, jobData);
          return newJobs;
        });
        
        // Update UI state only if not cancelling
        if (!data.cancelling && data.status !== 'cancelling') {
          setLoading(true);
          setUploadProgress(data.progress);
          setProcessingStage(data.stage);
          setFilename(data.filename);
        }
      });

      // Listen for processing completion
      socketRef.current.on('processing-complete', (data) => {
        setActiveJobs(prev => {
          const newJobs = new Map(prev);
          newJobs.delete(data.jobId);
          return newJobs;
        });
        
        // Update UI with results only if not cancelled
        if (data.result && !data.result.cancelled) {
          setLoading(false);
          setUploadProgress(0);
          setProcessingStage('');
          setTranscription(data.result.transcription);
          setFilename(data.result.filename);
          
          // Auto-generate summary
          if (data.result.transcription) {
            generateSummary(data.result.transcription);
          }
        }
      });

      // Listen for processing errors
      socketRef.current.on('processing-error', (data) => {
        setActiveJobs(prev => {
          const newJobs = new Map(prev);
          newJobs.delete(data.jobId);
          return newJobs;
        });
        
        // Update UI with error
        setLoading(false);
        setUploadProgress(0);
        setProcessingStage('');
        setError(data.error + (data.details ? ': ' + data.details : ''));
      });

      // Listen for job cancellation confirmations
      socketRef.current.on('job-cancelled', (data) => {
        console.log('Job cancelled:', data.jobId);
        
        // Show cancellation message immediately
        setSuccess('Transcription cancelled successfully');
        
        // Hide progress bar within 2 seconds as required
        setTimeout(() => {
          setActiveJobs(prev => {
            const newJobs = new Map(prev);
            newJobs.delete(data.jobId);
            return newJobs;
          });
        }, 2000);
        
        // Clear success message after 5 seconds
        setTimeout(() => {
          setSuccess('');
        }, 5000);
        
        // Reset loading states and upload form to allow new uploads
        setLoading(false);
        setUploadProgress(0);
        setProcessingStage('');
        setError(''); // Clear any previous errors
        setTranscription(''); // Clear previous transcription
        setSummary(''); // Clear previous summary
        setFilename(''); // Clear filename
      });

      // Listen for cancellation errors
      socketRef.current.on('cancellation-error', (data) => {
        console.log('Cancellation error:', data);
        
        // Reset the job's cancelling state
        setActiveJobs(prev => {
          const newJobs = new Map(prev);
          const job = newJobs.get(data.jobId);
          if (job) {
            job.cancelling = false;
            job.status = 'processing';
            job.stage = 'Cancellation failed, processing continues';
            newJobs.set(data.jobId, job);
          }
          return newJobs;
        });
        
        // Show user-friendly error message
        const errorMessage = data.error || 'Failed to cancel transcription';
        setError(`Cancellation failed: ${errorMessage}. The transcription will continue processing.`);
        
        // Clear error after 10 seconds
        setTimeout(() => {
          setError(prev => {
            if (prev && prev.includes('Cancellation failed')) {
              return '';
            }
            return prev;
          });
        }, 10000);
      });

      // Handle WebSocket disconnection
      socketRef.current.on('disconnect', () => {
        console.log('WebSocket disconnected');
        
        // Mark all active jobs as potentially problematic
        setActiveJobs(prev => {
          const newJobs = new Map(prev);
          for (const [jobId, job] of newJobs.entries()) {
            if (job.cancelling) {
              // If job was being cancelled, assume it failed
              job.cancelling = false;
              job.status = 'processing';
              job.stage = 'Connection lost during cancellation';
              newJobs.set(jobId, job);
            }
          }
          return newJobs;
        });
      });

      // Handle WebSocket reconnection
      socketRef.current.on('connect', () => {
        console.log('WebSocket reconnected');
        
        // Rejoin user room
        if (user?.id) {
          socketRef.current.emit('join-user-room', user.id);
        }
        
        // Clear any connection-related errors
        setError(prev => {
          if (prev && prev.includes('Connection lost')) {
            return '';
          }
          return prev;
        });
      });

      // Handle page visibility changes (mobile app switching)
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && socketRef.current) {
          // Page became visible, ensure connection is active
          if (!socketRef.current.connected) {
            console.log('Page visible, reconnecting WebSocket...');
            socketRef.current.connect();
          } else {
            // Rejoin room to ensure we get updates
            socketRef.current.emit('join-user-room', user.id);
          }
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);

      // Handle network online/offline events
      const handleOnline = () => {
        console.log('Network back online, reconnecting...');
        if (socketRef.current && !socketRef.current.connected) {
          socketRef.current.connect();
        }
        setError(''); // Clear network errors
      };

      const handleOffline = () => {
        console.log('Network went offline');
        setError('Network connection lost. Please check your internet connection.');
      };

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        
        if (socketRef.current) {
          socketRef.current.disconnect();
        }
      };
    }
  }, [isAuthenticated, user]);

  // Timer effect for recording
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }

    return () => clearInterval(timerRef.current);
  }, [isRecording]);



  const loadTranscriptionHistory = async () => {
    try {
      const response = await axios.get('/api/history', {
        withCredentials: true
      });
      setTranscriptionHistory(response.data.transcriptions);
    } catch (err) {
      console.error('Failed to load history:', err);
      setError('Failed to load transcription history');
    }
  };

  const deleteTranscription = async (id) => {
    if (!window.confirm('Are you sure you want to delete this transcription?')) {
      return;
    }

    try {
      await axios.delete(`/api/transcription/${id}`, {
        withCredentials: true
      });
      setTranscriptionHistory(prev => prev.filter(t => t.id !== id));
      setSuccess('Transcription deleted successfully');
    } catch (err) {
      setError('Failed to delete transcription');
    }
  };

  // Admin functions
  const loadAdminUsers = async () => {
    try {
      const response = await axios.get('/api/admin/users', {
        withCredentials: true
      });
      setAdminUsers(response.data.users);
      setSystemStats(response.data.systemStats);
    } catch (err) {
      console.error('Failed to load admin users:', err);
      setError('Failed to load user list');
    }
  };

  const resetUserPassword = async (userId, newPassword) => {
    try {
      await axios.post(`/api/admin/users/${userId}/reset-password`, {
        newPassword
      }, {
        withCredentials: true
      });
      setSuccess('Password reset successfully');
      setSelectedUser(null);
    } catch (err) {
      setError('Failed to reset password');
    }
  };

  const updateUserSubscription = async (userId, subscriptionTier, usageLimit) => {
    try {
      await axios.put(`/api/admin/users/${userId}/subscription`, {
        subscriptionTier,
        usageLimit
      }, {
        withCredentials: true
      });
      setSuccess('Subscription updated successfully');
      loadAdminUsers(); // Refresh the list
    } catch (err) {
      setError('Failed to update subscription');
    }
  };

  const resetUserUsage = async (userId) => {
    try {
      await axios.post(`/api/admin/users/${userId}/reset-usage`, {}, {
        withCredentials: true
      });
      setSuccess('Usage count reset successfully');
      loadAdminUsers(); // Refresh the list
    } catch (err) {
      setError('Failed to reset usage count');
    }
  };

  const toggleUserStatus = async (userId, isActive) => {
    try {
      await axios.put(`/api/admin/users/${userId}/status`, {
        isActive
      }, {
        withCredentials: true
      });
      setSuccess(`User ${isActive ? 'activated' : 'deactivated'} successfully`);
      loadAdminUsers(); // Refresh the list
    } catch (err) {
      setError('Failed to update user status');
    }
  };

  const deleteUser = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user? This will also delete all their transcriptions.')) {
      return;
    }

    try {
      await axios.delete(`/api/admin/users/${userId}`, {
        withCredentials: true
      });
      setSuccess('User deleted successfully');
      loadAdminUsers(); // Refresh the list
    } catch (err) {
      setError('Failed to delete user');
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        handleAudioUpload(audioBlob, 'recording.wav');
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setRecordingTime(0);
      setError('');
    } catch (err) {
      setError('Failed to access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleAudioUpload = async (file, fileName = null) => {
    // Clear previous results
    setError('');
    setTranscription('');
    setSummary('');
    setSuccess('');

    try {
      const formData = new FormData();
      formData.append('audio', file);
      formData.append('language', language);

      // Show initial upload progress
      setLoading(true);
      setUploadProgress(0);
      setProcessingStage('Uploading file...');
      setFilename(fileName || file.name);

      const response = await axios.post('/api/transcribe', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 5 * 60 * 1000, // 5 minutes timeout for upload
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percentCompleted);
        },
      });

      // File uploaded successfully, now WebSocket will handle progress updates
      if (response.data.jobId) {
        setProcessingStage('File uploaded, processing started...');
        console.log('Processing job started:', response.data.jobId);
        
        // Start HTTP polling fallback if WebSocket is not connected
        if (pollingFallback || connectionStatus !== 'connected') {
          console.log('Starting HTTP polling for job:', response.data.jobId);
          setTimeout(() => pollJobStatus(response.data.jobId), 2000);
        }
      }
      
    } catch (err) {
      setLoading(false);
      setUploadProgress(0);
      setProcessingStage('');
      
      if (err.response?.status === 429) {
        setError('Usage limit exceeded. Please upgrade your plan to continue.');
      } else {
        setError(err.response?.data?.error || 'Upload failed');
      }
    }
  };

  // HTTP polling fallback for mobile devices
  const pollJobStatus = async (jobId) => {
    if (!pollingFallback) return;
    
    try {
      const response = await axios.get(`/api/job-status/${jobId}`, {
        withCredentials: true
      });
      
      const jobData = response.data;
      
      if (jobData.status === 'completed') {
        // Handle completion
        setActiveJobs(prev => {
          const newJobs = new Map(prev);
          newJobs.delete(jobId);
          return newJobs;
        });
        
        setLoading(false);
        setUploadProgress(0);
        setProcessingStage('');
        setTranscription(jobData.result.transcription);
        setFilename(jobData.result.filename);
        
        if (jobData.result.transcription) {
          generateSummary(jobData.result.transcription);
        }
      } else if (jobData.status === 'processing') {
        // Update progress
        setActiveJobs(prev => {
          const newJobs = new Map(prev);
          newJobs.set(jobId, jobData);
          return newJobs;
        });
        
        setUploadProgress(jobData.progress);
        setProcessingStage(jobData.stage);
        
        // Continue polling
        setTimeout(() => pollJobStatus(jobId), 2000);
      } else if (jobData.status === 'error') {
        setActiveJobs(prev => {
          const newJobs = new Map(prev);
          newJobs.delete(jobId);
          return newJobs;
        });
        
        setLoading(false);
        setError(jobData.error);
      }
    } catch (err) {
      console.error('Polling failed:', err);
      // Stop polling on error
    }
  };

  const generateSummary = useCallback(async (text) => {
    try {
      const response = await axios.post('/api/summarize', {
        text,
        language
      });
      setProcessingStage('Summary complete!');
      setSummary(response.data.summary);
    } catch (err) {
      console.error('Summary generation failed:', err);
      // Don't show error for summary failure, transcription is more important
    }
  }, [language]);

  const sendEmail = async () => {
    if (!email || !transcription) {
      setError('Email and transcription are required');
      return;
    }

    setLoading(true);
    setProcessingStage('Sending email...');
    setError('');
    setSuccess('');

    try {
      await axios.post('/api/send-email', {
        email,
        subject: subject || 'Voice Meeting Transcription & Summary',
        transcription,
        summary,
        filename
      });

      setProcessingStage('Email sent successfully!');
      setSuccess('Email sent successfully!');
      setEmail('');
      setSubject('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send email');
    } finally {
      setLoading(false);
      setProcessingStage('');
    }
  };

  const cancelJob = (jobId) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('Cancelling job:', jobId);
    }
    
    // Check if job exists and is not already being cancelled
    const currentJob = activeJobs.get(jobId);
    if (!currentJob || currentJob.cancelling || currentJob.status === 'cancelling') {
      console.log('Job already being cancelled or not found');
      return;
    }
    
    // Update local state immediately for UI feedback
    setActiveJobs(prev => {
      const newJobs = new Map(prev);
      const job = newJobs.get(jobId);
      if (job) {
        job.cancelling = true;
        job.status = 'cancelling';
        job.stage = 'Cancelling...';
        newJobs.set(jobId, job);
      }
      return newJobs;
    });
    
    // Send cancellation request via WebSocket
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('cancel-job', jobId);
    } else {
      console.error('WebSocket not connected, cannot cancel job');
      // Reset cancelling state if WebSocket is not available
      setActiveJobs(prev => {
        const newJobs = new Map(prev);
        const job = newJobs.get(jobId);
        if (job) {
          job.cancelling = false;
          job.status = 'processing';
          newJobs.set(jobId, job);
        }
        return newJobs;
      });
      setError('Cannot cancel job: Connection lost. Please refresh the page.');
    }
  };

  const onDrop = (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (file) {
      handleAudioUpload(file);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/*': ['.mp3', '.wav', '.m4a', '.mp4', '.webm']
    },
    multiple: false
  });

  if (checkingAuth) {
    return (
      <div className="loading-screen">
        <div className="loading">Checking authentication...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="container">
      <div className="header">
        <div className="header-content">
          <div className="header-left">
            <h1>🎙️ Voice Transcription App</h1>
            <p>Record meetings or upload audio files for transcription and summarization</p>
          </div>
          <div className="header-right">
            <div className="user-info">
              <span className="user-name">👋 {user?.fullName}</span>
              <div className="usage-info">
                <span className="usage-count">
                  {user?.usageCount || 0}/{user?.usageLimit || 5} transcriptions
                </span>
                <div className="usage-bar">
                  <div 
                    className="usage-fill" 
                    style={{ 
                      width: `${((user?.usageCount || 0) / (user?.usageLimit || 5)) * 100}%`,
                      backgroundColor: (user?.usageCount || 0) >= (user?.usageLimit || 5) ? '#ff4444' : '#4CAF50'
                    }}
                  ></div>
                </div>
              </div>
            </div>
            <div className="header-buttons">
              {/* Connection status indicator */}
              <div className={`connection-status ${connectionStatus}`} title={
                connectionStatus === 'connected' ? 'Connected' :
                connectionStatus === 'connecting' ? 'Connecting...' :
                connectionStatus === 'error' ? 'Connection issues' :
                'Unknown status'
              }>
                {connectionStatus === 'connected' && '🟢'}
                {connectionStatus === 'connecting' && '🟡'}
                {connectionStatus === 'error' && '🔴'}
                {pollingFallback && '📱'}
                {(connectionStatus === 'error' || pollingFallback) && (
                  <button 
                    className="refresh-connection-btn"
                    onClick={() => window.location.reload()}
                    title="Refresh page to reconnect"
                  >
                    🔄
                  </button>
                )}
              </div>
              
              <button 
                className={`nav-button ${showProfile ? 'active' : ''}`}
                onClick={() => {
                  setShowProfile(!showProfile);
                  setShowHistory(false);
                  setShowAdmin(false);
                }}
              >
                👤 Profile
              </button>
              <button 
                className={`nav-button ${showHistory ? 'active' : ''}`}
                onClick={() => {
                  setShowHistory(!showHistory);
                  setShowProfile(false);
                  setShowAdmin(false);
                  if (!showHistory) {
                    loadTranscriptionHistory();
                  }
                }}
              >
                📚 History
              </button>
              {(user?.subscriptionTier === 'premium' || user?.email === 'admin@voiceapp.com') && (
                <button 
                  className={`nav-button ${showAdmin ? 'active' : ''}`}
                  onClick={() => {
                    setShowAdmin(!showAdmin);
                    setShowProfile(false);
                    setShowHistory(false);
                    if (!showAdmin) {
                      loadAdminUsers();
                    }
                  }}
                >
                  ⚙️ Admin
                </button>
              )}
              <button className="logout-button" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>

      {showProfile && (
        <div className="profile-section">
          <div className="card">
            <h2>👤 User Profile</h2>
            <div className="profile-info">
              <div className="profile-item">
                <label>Name:</label>
                <span>{user?.fullName}</span>
              </div>
              <div className="profile-item">
                <label>Email:</label>
                <span>{user?.email}</span>
              </div>
              <div className="profile-item">
                <label>Plan:</label>
                <span className="plan-badge">{user?.subscriptionTier || 'Free'}</span>
              </div>
              <div className="profile-item">
                <label>Member Since:</label>
                <span>{user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</span>
              </div>
              <div className="profile-item">
                <label>Last Login:</label>
                <span>{user?.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'N/A'}</span>
              </div>
            </div>
            
            <div className="usage-stats">
              <h3>📊 Usage Statistics</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-number">{user?.usageCount || 0}</div>
                  <div className="stat-label">Transcriptions Used</div>
                </div>
                <div className="stat-item">
                  <div className="stat-number">{user?.usageLimit || 5}</div>
                  <div className="stat-label">Monthly Limit</div>
                </div>
                <div className="stat-item">
                  <div className="stat-number">{user?.stats?.totalTranscriptions || 0}</div>
                  <div className="stat-label">Total Transcriptions</div>
                </div>
                <div className="stat-item">
                  <div className="stat-number">
                    {user?.stats?.totalFileSize ? `${(user.stats.totalFileSize / (1024 * 1024)).toFixed(1)}MB` : '0MB'}
                  </div>
                  <div className="stat-label">Total File Size</div>
                </div>
              </div>
            </div>

            {(user?.usageCount || 0) >= (user?.usageLimit || 5) && (
              <div className="upgrade-notice">
                <h4>🚀 Upgrade Your Plan</h4>
                <p>You've reached your monthly limit. Upgrade to continue transcribing!</p>
                <button className="btn btn-primary">Upgrade Plan</button>
              </div>
            )}
          </div>
        </div>
      )}

      {showHistory && (
        <div className="history-section">
          <div className="card">
            <h2>📚 Transcription History</h2>
            {transcriptionHistory.length === 0 ? (
              <div className="empty-history">
                <p>No transcriptions yet. Upload an audio file to get started!</p>
              </div>
            ) : (
              <div className="history-list">
                {transcriptionHistory.map((item) => (
                  <div key={item.id} className="history-item">
                    <div className="history-header">
                      <div className="history-info">
                        <h4>{item.original_filename}</h4>
                        <div className="history-meta">
                          <span className="history-date">
                            {new Date(item.created_at).toLocaleDateString()}
                          </span>
                          <span className="history-size">
                            {(item.file_size / (1024 * 1024)).toFixed(1)}MB
                          </span>
                          <span className="history-language">
                            {item.language === 'en' ? 'English' : 'Thai'}
                          </span>
                        </div>
                      </div>
                      <button 
                        className="delete-button"
                        onClick={() => deleteTranscription(item.id)}
                        title="Delete transcription"
                      >
                        🗑️
                      </button>
                    </div>
                    <div className="history-content">
                      <div className="transcription-preview">
                        {item.transcription.length > 200 
                          ? `${item.transcription.substring(0, 200)}...` 
                          : item.transcription
                        }
                      </div>
                      {item.summary && (
                        <div className="summary-preview">
                          <strong>Summary:</strong> {item.summary.length > 150 
                            ? `${item.summary.substring(0, 150)}...` 
                            : item.summary
                          }
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showAdmin && (
        <div className="admin-section">
          <div className="card">
            <h2>⚙️ Admin Panel</h2>
            
            {systemStats && (
              <div className="system-stats">
                <h3>📊 System Statistics</h3>
                <div className="stats-grid">
                  <div className="stat-item">
                    <div className="stat-number">{systemStats.total_users}</div>
                    <div className="stat-label">Total Users</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-number">{systemStats.active_users}</div>
                    <div className="stat-label">Active Users</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-number">{systemStats.premium_users}</div>
                    <div className="stat-label">Premium Users</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-number">{systemStats.total_transcriptions}</div>
                    <div className="stat-label">Total Transcriptions</div>
                  </div>
                </div>
              </div>
            )}

            <div className="users-management">
              <h3>👥 User Management</h3>
              {adminUsers.length === 0 ? (
                <div className="empty-users">
                  <p>No users found.</p>
                </div>
              ) : (
                <div className="users-list">
                  {adminUsers.map((user) => (
                    <div key={user.id} className="user-item">
                      <div className="user-header">
                        <div className="user-info">
                          <h4>{user.full_name}</h4>
                          <div className="user-meta">
                            <span className="user-email">{user.email}</span>
                            <span className={`user-status ${user.is_active ? 'active' : 'inactive'}`}>
                              {user.is_active ? '✅ Active' : '❌ Inactive'}
                            </span>
                            <span className="user-tier">{user.subscription_tier}</span>
                            <span className="user-usage">
                              {user.usage_count}/{user.usage_limit} used
                            </span>
                          </div>
                        </div>
                        <div className="user-actions">
                          <button 
                            className="btn btn-small btn-primary"
                            onClick={() => setSelectedUser(user)}
                          >
                            Manage
                          </button>
                        </div>
                      </div>
                      <div className="user-stats">
                        <span>Joined: {new Date(user.created_at).toLocaleDateString()}</span>
                        <span>Transcriptions: {user.total_transcriptions}</span>
                        <span>Data: {(user.total_file_size / (1024 * 1024)).toFixed(1)}MB</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedUser && (
        <div className="modal-overlay" onClick={() => setSelectedUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Manage User: {selectedUser.full_name}</h3>
              <button className="modal-close" onClick={() => setSelectedUser(null)}>×</button>
            </div>
            <div className="modal-content">
              <div className="user-details">
                <p><strong>Email:</strong> {selectedUser.email}</p>
                <p><strong>Status:</strong> {selectedUser.is_active ? 'Active' : 'Inactive'}</p>
                <p><strong>Subscription:</strong> {selectedUser.subscription_tier}</p>
                <p><strong>Usage:</strong> {selectedUser.usage_count}/{selectedUser.usage_limit}</p>
              </div>
              
              <div className="admin-actions">
                <div className="action-group">
                  <h4>Password Management</h4>
                  <button 
                    className="btn btn-warning"
                    onClick={() => {
                      const newPassword = prompt('Enter new password (min 6 characters):');
                      if (newPassword && newPassword.length >= 6) {
                        resetUserPassword(selectedUser.id, newPassword);
                      } else if (newPassword) {
                        alert('Password must be at least 6 characters long');
                      }
                    }}
                  >
                    Reset Password
                  </button>
                </div>

                <div className="action-group">
                  <h4>Subscription Management</h4>
                  <div className="subscription-controls">
                    <select 
                      value={selectedUser.subscription_tier}
                      onChange={(e) => {
                        const tier = e.target.value;
                        const limit = tier === 'premium' ? 1000 : 5;
                        updateUserSubscription(selectedUser.id, tier, limit);
                      }}
                    >
                      <option value="free">Free (5 transcriptions)</option>
                      <option value="premium">Premium (1000 transcriptions)</option>
                    </select>
                  </div>
                </div>

                <div className="action-group">
                  <h4>Usage Management</h4>
                  <button 
                    className="btn btn-info"
                    onClick={() => resetUserUsage(selectedUser.id)}
                  >
                    Reset Usage Count
                  </button>
                </div>

                <div className="action-group">
                  <h4>Account Status</h4>
                  <button 
                    className={`btn ${selectedUser.is_active ? 'btn-warning' : 'btn-success'}`}
                    onClick={() => toggleUserStatus(selectedUser.id, !selectedUser.is_active)}
                  >
                    {selectedUser.is_active ? 'Deactivate User' : 'Activate User'}
                  </button>
                </div>

                <div className="action-group danger-zone">
                  <h4>Danger Zone</h4>
                  <button 
                    className="btn btn-danger"
                    onClick={() => deleteUser(selectedUser.id)}
                  >
                    Delete User & All Data
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="language-selector">
        <label htmlFor="language">Select Language:</label>
        <select 
          id="language"
          value={language} 
          onChange={(e) => setLanguage(e.target.value)}
        >
          <option value="en">English</option>
          <option value="th">Thai (ไทย)</option>
        </select>
      </div>

      <div className="main-content">
        <div className="card">
          <h2>📁 Upload Audio File</h2>
          <div 
            {...getRootProps()} 
            className={`upload-area ${isDragActive ? 'active' : ''}`}
          >
            <input {...getInputProps()} />
            <div className="upload-icon">🎵</div>
            <div className="upload-text">
              {isDragActive ? 'Drop the audio file here' : 'Drag & drop an audio file here'}
            </div>
            <div className="upload-hint">
              or click to select (MP3, WAV, M4A, MP4, WebM)<br/>
              <small>Maximum file size: 100MB (large files auto-split)</small>
            </div>
          </div>
        </div>

        <div className="card">
          <h2>🎤 Record Audio</h2>
          <div className="recorder-section">
            <button
              className={`record-button ${isRecording ? 'recording' : 'idle'}`}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={loading}
            >
              {isRecording ? '⏹️' : '🎤'}
            </button>
            <div className="record-status">
              {isRecording ? 'Recording...' : 'Click to start recording'}
            </div>
            {isRecording && (
              <div className="timer">{formatTime(recordingTime)}</div>
            )}
          </div>
        </div>
      </div>

      {(loading || activeJobs.size > 0) && (
        <div className="loading">
          {/* Show current upload progress */}
          {loading && (
            <div className="progress-container">
              <div className="progress-info">
                <p>{processingStage || 'Processing audio...'}</p>
                {uploadProgress > 0 && uploadProgress < 100 && (
                  <span className="progress-percentage">{uploadProgress}%</span>
                )}
              </div>
              <div className="progress-bar">
                <div 
                  className="progress-fill" 
                  style={{ 
                    width: uploadProgress > 0 ? `${uploadProgress}%` : '0%',
                    transition: 'width 0.3s ease'
                  }}
                ></div>
              </div>
            </div>
          )}

          {/* Show active processing jobs */}
          {Array.from(activeJobs.values()).map((job) => (
            <div key={job.jobId} className="progress-container">
              <div className="progress-info">
                <p>
                  <strong>{job.filename}</strong> - {job.stage}
                </p>
                <span className="progress-percentage">{job.progress}%</span>
              </div>
              <div className="progress-controls">
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ 
                      width: `${job.progress}%`,
                      transition: 'width 0.3s ease'
                    }}
                  ></div>
                </div>
                <button 
                  className="stop-button" 
                  onClick={() => cancelJob(job.jobId)}
                  disabled={job.cancelling || job.status === 'cancelling'}
                  title="Cancel Transcription"
                >
                  {job.cancelling || job.status === 'cancelling' ? '⏳' : '⏹️'}
                </button>
              </div>
              <div className="processing-details">
                <div className="processing-spinner">⏳</div>
                <div className="processing-tips">
                  <small>
                    <strong>Real-time processing:</strong> You can refresh this page and the processing will continue. 
                    Progress is tracked server-side and will resume automatically.
                  </small>
                  {job.stage.includes('chunk') && (
                    <small>Large files are split into smaller chunks for processing</small>
                  )}
                  {job.stage.includes('splitting') && (
                    <small>
                      <strong>Large file processing:</strong> This may take 10-20 minutes. 
                      Each chunk takes ~3 minutes to transcribe.
                    </small>
                  )}
                  {(job.cancelling || job.status === 'cancelling') && (
                    <small>
                      <strong>Cancelling:</strong> Stopping transcription and cleaning up files...
                    </small>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      {success && (
        <div className="success">
          {success}
        </div>
      )}

      {(transcription || summary) && (
        <div className="results-section">
          {summary && (
            <div className="result-card">
              <h3>📝 Summary</h3>
              <div className="summary-text">{summary}</div>
            </div>
          )}

          {transcription && (
            <div className="result-card">
              <h3>📄 Full Transcription</h3>
              <div className="transcription-text">{transcription}</div>
              
              <div className="email-section">
                <h4>📧 Send via Email</h4>
                <div className="email-form">
                  <div className="form-group">
                    <label htmlFor="email">Email Address:</label>
                    <input
                      type="email"
                      id="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="subject">Subject (optional):</label>
                    <input
                      type="text"
                      id="subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Meeting transcription"
                    />
                  </div>
                </div>
                <button 
                  className="btn btn-success"
                  onClick={sendEmail}
                  disabled={loading || !email}
                >
                  Send Email
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <p>&copy; 2024 Voice Transcription App. All rights reserved.</p>
          <p>
            For support or inquiries, contact: 
            <a href="mailto:ponrawat@neuralnet.co.th"> ponrawat@neuralnet.co.th</a>
          </p>
          <div className="footer-links">
            <span>Privacy Policy</span> | <span>Terms of Service</span> | <span>Data Protection</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;