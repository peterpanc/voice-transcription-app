# 🎙️ Voice Transcription App

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/peterpanc/voice-transcription-app)

A **production-ready voice transcription application** with user management, real-time processing, and admin panel.

## ✨ Features

### 🎯 User Features
- **User Registration & Login** - Secure account system
- **Audio Upload** - Support for MP3, WAV, M4A, MP4, WebM (up to 100MB)
- **Real-Time Recording** - Record directly in browser
- **Live Progress Tracking** - WebSocket-based real-time updates
- **Refresh-Resistant Processing** - Continue processing after page refresh
- **Personal History** - View and manage your transcriptions
- **Email Delivery** - Get results sent to your email
- **Usage Tracking** - Monitor your transcription limits

### 👑 Admin Features
- **User Management Dashboard** - View and manage all users
- **Password Reset** - Reset any user's password
- **Subscription Management** - Change user plans and limits
- **Usage Controls** - Reset usage counts and limits
- **System Statistics** - Monitor platform usage
- **Account Management** - Activate/deactivate users

### 🔧 Technical Features
- **WebSocket Real-Time Updates** - Live progress without polling
- **Multi-User Concurrent Processing** - Handle multiple users simultaneously
- **AI-Powered Transcription** - OpenAI Whisper integration
- **Responsive Design** - Works on desktop and mobile
- **Production-Ready Security** - Authentication, authorization, input validation
- **Database-Backed** - SQLite with user isolation

## 🚀 Quick Deploy to Railway

### Option 1: One-Click Deploy
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/peterpanc/voice-transcription-app)

### Option 2: Manual Deploy
1. **Fork this repository**
2. **Go to Railway:** https://railway.app
3. **New Project** → **Deploy from GitHub repo**
4. **Select:** `peterpanc/voice-transcription-app`
5. **Add environment variables** (see below)
6. **Deploy!**

## ⚙️ Environment Variables

Add these in your Railway project dashboard:

### Required
```env
NODE_ENV=production
OPENAI_API_KEY=sk-proj-your-openai-key-here
RESEND_API_KEY=re_your-resend-key-here
RESEND_FROM_EMAIL=noreply@yourdomain.com
```

### Optional
```env
SESSION_SECRET=your-secure-session-secret
MAX_FILE_SIZE=104857600
RATE_LIMIT_MAX_REQUESTS=100
```

## 🔑 Default Admin Access

After deployment:
- **URL:** Your Railway app URL
- **Email:** `admin@voiceapp.com`
- **Password:** `123456@Abcdef`

**⚠️ Change the password immediately after first login!**

## 🏗️ Architecture

- **Frontend:** React.js with Socket.IO client
- **Backend:** Node.js/Express with Socket.IO server
- **Database:** SQLite (Railway persistent storage)
- **AI:** OpenAI Whisper API
- **Email:** Resend service
- **Real-time:** WebSocket connections

## 📊 Screenshots

### User Interface
- Clean, modern design
- Drag & drop file upload
- Real-time progress bars
- Personal transcription history

### Admin Panel
- User management dashboard
- System statistics
- Subscription controls
- Usage monitoring

## 🔒 Security Features

- ✅ **Password Hashing** - bcrypt with salt rounds
- ✅ **Session Management** - Secure HTTP-only cookies
- ✅ **CORS Protection** - Configured for production
- ✅ **Input Validation** - All user inputs sanitized
- ✅ **Rate Limiting** - API request throttling
- ✅ **Admin Authorization** - Role-based access control

## 📈 Usage Limits

- **Free Users:** 5 transcriptions per month
- **Premium Users:** 1000 transcriptions per month
- **Admin Users:** Unlimited access
- **File Size Limit:** 100MB per file

## 🔧 Local Development

```bash
# Clone repository
git clone https://github.com/peterpanc/voice-transcription-app.git
cd voice-transcription-app

# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env with your API keys

# Start development servers
cd backend && npm run dev
cd ../frontend && npm start
```

## 📖 Documentation

- **[Railway Deployment Guide](RAILWAY_DEPLOYMENT_GUIDE.md)** - Complete Railway setup
- **[Production Deployment](PRODUCTION_DEPLOYMENT.md)** - General production guide
- **[Security Updates](SECURITY_UPDATE_DEPLOYMENT.md)** - Security considerations

## 🛠️ Tech Stack

- **Frontend:** React 18, Socket.IO Client, Axios, React Dropzone
- **Backend:** Node.js, Express, Socket.IO, Multer, OpenAI
- **Database:** SQLite (production-ready)
- **Authentication:** bcrypt, express-session
- **Email:** Resend API
- **File Processing:** FFmpeg
- **Deployment:** Railway, Docker

## 📞 Support

- **Health Check:** `/api/health`
- **Admin Panel:** Available after login
- **Logs:** Check Railway dashboard
- **Issues:** GitHub Issues

## 📄 License

MIT License - Ready for commercial use.

## 🎯 Perfect For

- **Podcasters** - Transcribe episodes automatically
- **Content Creators** - Convert videos to text
- **Students** - Transcribe lectures and notes
- **Businesses** - Meeting transcriptions
- **Journalists** - Interview transcriptions
- **Researchers** - Audio data analysis

## 🚀 Deploy Now

Ready to deploy your own voice transcription service?

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/peterpanc/voice-transcription-app)

---

**Built with ❤️ for the community**