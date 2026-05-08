# ClassMate Deployment Configuration - Quick Setup Guide

## ✅ What Was Created/Updated

### Backend Configuration
- ✅ **requirements.txt** - Updated with all production dependencies
- ✅ **db.py** - Refactored for environment variables and SSL support
- ✅ **app.py** - Added production config, CORS flexibility, health endpoint
- ✅ **Procfile** - Gunicorn configuration for Railway
- ✅ **railway.json** - Railway deployment config with health checks
- ✅ **Dockerfile** - Production-ready containerization
- ✅ **.env.example** - Backend environment variables template
- ✅ **.railwayignore** - Deploy optimization (excludes unnecessary files)

### Frontend Configuration
- ✅ **vercel.json** - Updated with dynamic backend URL support
- ✅ **vite.config.js** - Uses VITE_API_URL environment variable
- ✅ **.env.example** - Frontend environment variables template
- ✅ **.vercelignore** - Deployment optimization

### Deployment Scripts (PowerShell)
- ✅ **deploy-backend.ps1** - Automated Railway deployment
- ✅ **deploy-frontend.ps1** - Automated Vercel deployment  
- ✅ **setup-db.ps1** - Database initialization script

### Documentation
- ✅ **README_DEPLOY.md** - Complete deployment guide (15+ sections)
- ✅ **.gitignore** - Enhanced to prevent committing secrets

---

## 🚀 Next Steps (In Order)

### Step 1: Set Up Neon PostgreSQL (5 minutes)
```powershell
# 1. Create account at https://neon.tech
# 2. Create new project
# 3. Copy connection string (looks like: postgresql://user:pass@ep-xxx.neon.tech/db)
# 4. Run setup script:
.\setup-db.ps1 -DatabaseUrl "YOUR_DATABASE_URL" -SqlFile classmate_backup.sql
```

### Step 2: Deploy Backend to Railway (10 minutes)
```powershell
# 1. Create account at https://railway.app
# 2. Install Railway CLI: npm install -g @railway/cli
# 3. Run deployment script:
.\deploy-backend.ps1 -Environment production

# 4. In Railway Dashboard, add environment variables:
#    - DATABASE_URL (from Neon)
#    - LIVEKIT_API_KEY (get from https://cloud.livekit.io)
#    - LIVEKIT_API_SECRET
#    - LIVEKIT_URL
#    - FRONTEND_URL (you'll know this after step 3)

# 5. Test health endpoint
Invoke-WebRequest "https://YOUR-RAILWAY-APP.railway.app/health"
```

### Step 3: Deploy Frontend to Vercel (5 minutes)
```powershell
# 1. Create account at https://vercel.com
# 2. Install Vercel CLI: npm install -g vercel
# 3. Run deployment script:
.\deploy-frontend.ps1 -Environment production

# When prompted, enter your Railway backend URL from Step 2
# (looks like: https://classmate-backend-xxxx.railway.app)

# 4. Your frontend URL will be: https://yourproject.vercel.app
```

### Step 4: Connect Everything (3 minutes)
```powershell
# 1. Go back to Railway Dashboard
# 2. Add FRONTEND_URL = "https://yourproject.vercel.app" to variables
# 3. Test health endpoint again
# 4. Visit your Vercel frontend and test features
```

---

## 📋 Troubleshooting Quick Links

| Problem | Solution |
|---------|----------|
| Database connection fails | Check DATABASE_URL includes `?sslmode=require` |
| CORS errors from frontend | Verify FRONTEND_URL in Railway matches Vercel URL |
| Backend can't find dependencies | Ensure requirements.txt is in src/ClassMate-Backend/ |
| Video calls don't work | Verify LiveKit credentials in Railway variables |
| Builds fail on Railway | Check `.railwayignore` isn't excluding critical files |

See **README_DEPLOY.md** for detailed troubleshooting section.

---

## 🔐 Security Reminders

**NEVER commit these files:**
- `.env` (actual values)
- Database credentials
- API keys/secrets

**DO commit:**
- `.env.example` (template only)
- `requirements.txt`
- Configuration files (vercel.json, railway.json)

---

## 📁 File Structure After Setup

```
my-react-app/
├── src/
│   └── ClassMate-Backend/
│       ├── app.py ✏️ (updated)
│       ├── db.py ✏️ (updated)
│       ├── requirements.txt ✏️ (updated)
│       ├── Procfile ✨ (new)
│       ├── railway.json ✨ (new)
│       ├── Dockerfile ✏️ (updated)
│       ├── .env.example ✨ (new)
│       └── .railwayignore ✨ (new)
├── vite.config.js ✏️ (updated)
├── vercel.json ✏️ (updated)
├── .env.example ✨ (new)
├── .vercelignore ✨ (new)
├── .gitignore ✏️ (updated)
├── deploy-backend.ps1 ✨ (new)
├── deploy-frontend.ps1 ✨ (new)
├── setup-db.ps1 ✨ (new)
├── README_DEPLOY.md ✨ (new)
└── DEPLOYMENT_QUICK_SETUP.md (this file)

✨ = New file created
✏️ = Existing file updated
```

---

## 🔗 Key Accounts & Links

| Service | Link | Purpose |
|---------|------|---------|
| Neon | https://console.neon.tech | PostgreSQL database |
| Railway | https://railway.app | Python Flask backend |
| Vercel | https://vercel.com | React frontend |
| LiveKit | https://cloud.livekit.io | Video conferencing |
| GitHub | https://github.com | Code repository |

---

## ⏱️ Expected Timeline

- **Neon Setup**: 5 minutes
- **Railway Deployment**: 10-15 minutes (includes npm install & pip install)
- **Vercel Deployment**: 5-10 minutes (includes npm build)
- **First Deployment Total**: ~30 minutes

---

## 🆘 Still Need Help?

1. **Check README_DEPLOY.md** - 16 detailed sections covering everything
2. **Check Railway Logs** - `railway logs --follow`
3. **Check Vercel Logs** - Vercel Dashboard → Logs tab
4. **Test Endpoints** - Use commands in "Testing" section of README_DEPLOY.md

---

## 🎯 Success Indicators

✅ You'll know it's working when:
- Health endpoint returns: `{"status": "healthy", "database": "connected"}`
- Frontend loads without CORS errors
- Can create courses and materials
- Video calls establish connections

---

**Created**: April 2024 | **For**: ClassMate Deployment to Production

Next: Read `README_DEPLOY.md` and run `.\setup-db.ps1` to start! 🚀
