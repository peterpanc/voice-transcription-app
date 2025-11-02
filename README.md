# 🎙️ Voice Transcription App

A **production-ready voice transcription application** with advanced features including real-time cancellation, multi-user support, and mobile compatibility.

## ✨ **Key Features**

### 🔐 **Authentication & User Management**
- User registration and secure login system
- Admin panel for user management and analytics
- Usage tracking with subscription limits
- Personal workspaces with isolated data

### 🎤 **Advanced Transcription**
- **Real-time audio recording** in browser
- **File upload support** (MP3, WAV, M4A, MP4, WebM up to 100MB)
- **OpenAI Whisper integration** for accurate transcription
- **Smart file splitting** for large audio files
- **Progress tracking** with WebSocket real-time updates

### ⏹️ **Transcription Cancellation** (NEW!)
- **Stop button** to cancel ongoing transcriptions instantly
- **Real-time cancellation** with immediate UI feedback
- **Automatic file cleanup** when cancelled
- **Mobile-optimized** cancellation controls

### 🤖 **AI-Powered Features**
- **Intelligent summarization** with structured output
- **Multi-language support** (English, Thai)
- **Email delivery** of transcription results
- **Automatic retry logic** for failed requests

### 📱 **Mobile & Network Compatibility**
- **Mobile-first design** with touch-optimized controls
- **WebSocket with HTTP polling fallback** for unstable connections
- **Network status monitoring** with automatic reconnection
- **Cross-platform compatibility** (iOS, Android, Desktop)

## 🚀 **Quick Deploy to Railway**

### **1. Fork & Upload to GitHub**
```bash
# Clone or download this repository
git init
git add .
git commit -m "Initial commit: Voice Transcription App"
git branch -M main
git remote add origin https://github.com/yourusername/voice-transcription-app.git
git push -u origin main
```

### **2. Deploy on Railway**
1. Go to https://railway.app/dashboard
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. Add environment variables (see below)
5. Deploy!

## ⚙️ **Environment Variables**

Add these in your Railway project dashboard:

### **Required**
```env
NODE_ENV=production
OPENAI_API_KEY=sk-proj-your-openai-key-here
RESEND_API_KEY=re_your-resend-key-here
RESEND_FROM_EMAIL=noreply@yourdomain.com
SESSION_SECRET=your-secure-32-character-secret
ADMIN_PASSWORD=your-secure-admin-password
```

## 🔑 **Default Admin Access**

After deployment:
- **Email:** `admin@voiceapp.com`
- **Password:** [Your ADMIN_PASSWORD from env vars]

**⚠️ Change the password immediately after first login!**

## 🏗️ **Tech Stack**

- **Frontend:** React.js, Socket.IO Client, Axios
- **Backend:** Node.js, Express.js, Socket.IO
- **Database:** SQLite with user management
- **AI:** OpenAI Whisper API
- **Email:** Resend API (Railway-compatible)
- **Deployment:** Railway with auto-scaling

## 🔧 **Local Development**

```bash
# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env with your API keys

# Start development servers
cd backend && npm run dev
# In another terminal:
cd frontend && npm start
```

## 📊 **New Cancellation Features**

### **User Experience**
- **Red stop button (⏹️)** appears next to progress bar during transcription
- **Immediate cancellation** with visual feedback (⏳ icon)
- **"Transcription Cancelled"** success message
- **Progress bar disappears** within 2 seconds
- **Upload form resets** automatically for new uploads

### **Technical Implementation**
- **WebSocket-based cancellation** for real-time communication
- **AbortController integration** to stop OpenAI API requests
- **Comprehensive file cleanup** (original, converted, chunks)
- **User authorization** prevents unauthorized cancellations
- **Mobile-optimized** with HTTP polling fallback

## 📱 **Mobile Compatibility**

### **Connection Status Indicators**
- 🟢 **Connected** (WebSocket active)
- 🟡 **Connecting** (attempting connection)
- 🔴 **Connection issues** (with refresh option)
- 📱 **Mobile mode** (HTTP polling active)

## 🛡️ **Security Features**

- **bcrypt password hashing** with salt rounds
- **Session-based authentication** with secure cookies
- **CORS protection** with domain whitelisting
- **Input validation** and sanitization
- **Rate limiting** on API endpoints
- **File type validation** for uploads
- **User authorization** for all operations

## 📄 **License**

MIT License - Ready for commercial use.

## 🎯 **Perfect For**

- **Content Creators**: Podcast and video transcription
- **Businesses**: Meeting and interview transcription
- **Students**: Lecture and study material transcription
- **Journalists**: Interview and research transcription
- **Researchers**: Audio data analysis and processing

---

## 🎉 **Ready for Production!**

This voice transcription app is **production-ready** with:
- ✅ **Professional-grade cancellation system**
- ✅ **Mobile-optimized real-time communication**
- ✅ **Comprehensive error handling**
- ✅ **Scalable architecture**
- ✅ **Security best practices**
- ✅ **Railway deployment ready**

**Perfect for businesses, content creators, and developers who need reliable voice transcription with advanced control features!**