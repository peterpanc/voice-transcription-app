const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

// Database file path
const dbPath = path.join(__dirname, 'voice_app.db');

// Initialize database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
    initializeTables();
  }
});

// Create tables if they don't exist
function initializeTables() {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME,
      is_active BOOLEAN DEFAULT 1,
      subscription_tier TEXT DEFAULT 'free',
      usage_count INTEGER DEFAULT 0,
      usage_limit INTEGER DEFAULT 5
    )
  `);

  // Transcriptions table
  db.run(`
    CREATE TABLE IF NOT EXISTS transcriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      language TEXT NOT NULL,
      transcription TEXT NOT NULL,
      summary TEXT,
      processing_details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);

  // Sessions table (optional - for better session management)
  db.run(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);

  console.log('Database tables initialized');
}

// User management functions
const UserDB = {
  // Create new user
  async createUser(email, password, fullName) {
    return new Promise((resolve, reject) => {
      bcrypt.hash(password, 10, (err, hash) => {
        if (err) return reject(err);
        
        db.run(
          'INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)',
          [email, hash, fullName],
          function(err) {
            if (err) return reject(err);
            resolve({ id: this.lastID, email, fullName });
          }
        );
      });
    });
  },

  // Find user by email
  async findUserByEmail(email) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM users WHERE email = ? AND is_active = 1',
        [email],
        (err, row) => {
          if (err) return reject(err);
          resolve(row);
        }
      );
    });
  },

  // Find user by ID
  async findUserById(id) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT id, email, full_name, created_at, last_login, subscription_tier, usage_count, usage_limit FROM users WHERE id = ? AND is_active = 1',
        [id],
        (err, row) => {
          if (err) return reject(err);
          resolve(row);
        }
      );
    });
  },

  // Verify password
  async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  },

  // Update last login
  async updateLastLogin(userId) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
        [userId],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  },

  // Increment usage count
  async incrementUsage(userId) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET usage_count = usage_count + 1 WHERE id = ?',
        [userId],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  },

  // Get user stats
  async getUserStats(userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT 
          COUNT(*) as total_transcriptions,
          SUM(file_size) as total_file_size,
          MAX(created_at) as last_transcription
        FROM transcriptions 
        WHERE user_id = ?`,
        [userId],
        (err, row) => {
          if (err) return reject(err);
          resolve(row);
        }
      );
    });
  },

  // Admin functions
  // Get all users with stats
  async getAllUsers(limit = 50, offset = 0) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT 
          u.id, u.email, u.full_name, u.created_at, u.last_login, 
          u.subscription_tier, u.usage_count, u.usage_limit, u.is_active,
          COUNT(t.id) as total_transcriptions,
          COALESCE(SUM(t.file_size), 0) as total_file_size
        FROM users u
        LEFT JOIN transcriptions t ON u.id = t.user_id
        GROUP BY u.id
        ORDER BY u.created_at DESC
        LIMIT ? OFFSET ?`,
        [limit, offset],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  },

  // Reset user password
  async resetUserPassword(userId, newPassword) {
    return new Promise((resolve, reject) => {
      const bcrypt = require('bcrypt');
      bcrypt.hash(newPassword, 10, (err, hash) => {
        if (err) return reject(err);
        
        db.run(
          'UPDATE users SET password_hash = ? WHERE id = ?',
          [hash, userId],
          function(err) {
            if (err) return reject(err);
            resolve({ updated: this.changes > 0 });
          }
        );
      });
    });
  },

  // Update user subscription and limits
  async updateUserSubscription(userId, subscriptionTier, usageLimit) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET subscription_tier = ?, usage_limit = ? WHERE id = ?',
        [subscriptionTier, usageLimit, userId],
        function(err) {
          if (err) return reject(err);
          resolve({ updated: this.changes > 0 });
        }
      );
    });
  },

  // Reset user usage count
  async resetUserUsage(userId) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET usage_count = 0 WHERE id = ?',
        [userId],
        function(err) {
          if (err) return reject(err);
          resolve({ updated: this.changes > 0 });
        }
      );
    });
  },

  // Toggle user active status
  async toggleUserStatus(userId, isActive) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET is_active = ? WHERE id = ?',
        [isActive ? 1 : 0, userId],
        function(err) {
          if (err) return reject(err);
          resolve({ updated: this.changes > 0 });
        }
      );
    });
  },

  // Delete user and all their data
  async deleteUser(userId) {
    return new Promise((resolve, reject) => {
      // Start transaction
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        // Delete user's transcriptions first
        db.run('DELETE FROM transcriptions WHERE user_id = ?', [userId], (err) => {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
          
          // Delete user
          db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
            if (err) {
              db.run('ROLLBACK');
              return reject(err);
            }
            
            db.run('COMMIT');
            resolve({ deleted: this.changes > 0 });
          });
        });
      });
    });
  },

  // Get user count and stats
  async getSystemStats() {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT 
          COUNT(DISTINCT u.id) as total_users,
          COUNT(DISTINCT CASE WHEN u.is_active = 1 THEN u.id END) as active_users,
          COUNT(DISTINCT CASE WHEN u.subscription_tier = 'premium' THEN u.id END) as premium_users,
          COUNT(t.id) as total_transcriptions,
          COALESCE(SUM(t.file_size), 0) as total_file_size
        FROM users u
        LEFT JOIN transcriptions t ON u.id = t.user_id`,
        (err, row) => {
          if (err) return reject(err);
          resolve(row);
        }
      );
    });
  }
};

// Transcription management functions
const TranscriptionDB = {
  // Save transcription
  async saveTranscription(userId, data) {
    return new Promise((resolve, reject) => {
      const { filename, originalFilename, fileSize, language, transcription, summary, processingDetails } = data;
      
      db.run(
        `INSERT INTO transcriptions 
         (user_id, filename, original_filename, file_size, language, transcription, summary, processing_details) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, filename, originalFilename, fileSize, language, transcription, summary, JSON.stringify(processingDetails)],
        function(err) {
          if (err) return reject(err);
          resolve({ id: this.lastID });
        }
      );
    });
  },

  // Get user's transcriptions
  async getUserTranscriptions(userId, limit = 50, offset = 0) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT id, filename, original_filename, file_size, language, 
                transcription, summary, created_at 
         FROM transcriptions 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT ? OFFSET ?`,
        [userId, limit, offset],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  },

  // Get specific transcription
  async getTranscription(id, userId) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM transcriptions WHERE id = ? AND user_id = ?',
        [id, userId],
        (err, row) => {
          if (err) return reject(err);
          resolve(row);
        }
      );
    });
  },

  // Delete transcription
  async deleteTranscription(id, userId) {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM transcriptions WHERE id = ? AND user_id = ?',
        [id, userId],
        function(err) {
          if (err) return reject(err);
          resolve({ deleted: this.changes > 0 });
        }
      );
    });
  }
};

module.exports = {
  db,
  UserDB,
  TranscriptionDB
};