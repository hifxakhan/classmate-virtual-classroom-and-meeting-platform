# ClassMate Deployment Guide

Complete step-by-step guide for deploying ClassMate full-stack application to production using Railway (backend) and Vercel (frontend) with Neon PostgreSQL.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Step 1: Set Up Neon PostgreSQL](#step-1-set-up-neon-postgresql)
4. [Step 2: Deploy Backend to Railway](#step-2-deploy-backend-to-railway)
5. [Step 3: Deploy Frontend to Vercel](#step-3-deploy-frontend-to-vercel)
6. [Step 4: Configure LiveKit](#step-4-configure-livekit)
7. [Step 5: Connect Everything](#step-5-connect-everything)
8. [Monitoring & Troubleshooting](#monitoring--troubleshooting)
9. [Environment Variables Reference](#environment-variables-reference)

---

## Prerequisites

### Required Accounts & Tools

- **Neon PostgreSQL Account** - [Create free account](https://neon.tech)
  - Will host your production database
  - Includes free tier: 3 branches, 2GB storage

- **Railway Account** - [Create free/paid account](https://railway.app)
  - Hosts Python Flask backend
  - Free tier available for testing

- **Vercel Account** - [Create free account](https://vercel.com)
  - Hosts React frontend
  - Free tier for open-source projects

- **LiveKit Cloud Account** - [Create account](https://cloud.livekit.io)
  - Hosts video conferencing infrastructure
  - Free tier: 25 concurrent participants

- **Git/GitHub** - [Create account](https://github.com)
  - For version control
  - Automatic deployments from GitHub

### Required Local Tools

```powershell
# Install Node.js (includes npm)
# Download from: https://nodejs.org/ (LTS version recommended)
node --version  # Should be v18+

# Install PostgreSQL client tools
# Download from: https://www.postgresql.org/download/

# Install CLI tools
npm install -g vercel        # Vercel CLI
npm install -g @railway/cli  # Railway CLI

# Verify installations
vercel --version
railway --version
psql --version
git --version
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    USER BROWSER (Client)                     │
└────────────────┬──────────────────────────────┬──────────────┘
                 │                              │
        ┌────────▼────────┐          ┌──────────▼─────────┐
        │  Vercel         │          │   LiveKit Cloud     │
        │  (Frontend)     │          │   (Video)           │
        │  React + Vite   │          │   WebRTC            │
        └────────┬────────┘          └─────────────────────┘
                 │
                 │ HTTPS API Calls
                 │ WebSocket (Socket.IO)
                 │
        ┌────────▼──────────┐
        │  Railway          │
        │  (Backend)        │
        │  Flask + Python   │
        │  Gunicorn         │
        └────────┬──────────┘
                 │
                 │ JDBC connection (SSL)
                 │
        ┌────────▼──────────┐
        │  Neon PostgreSQL  │
        │  (Database)       │
        └───────────────────┘
```

---

## Step 1: Set Up Neon PostgreSQL

### 1.1 Create Neon Database

1. Go to [https://neon.tech](https://neon.tech) and sign up
2. Create a new project:
   - Project name: `classmate-prod`
   - Database name: `postgres` (default)
   - Region: Select closest to your users
3. Get your connection string:
   - Go to Connection Details
   - Copy the PostgreSQL connection string
   - Format: `postgresql://[user]:[password]@[host]/[database]?sslmode=require`

### 1.2 Initialize Database Schema

Open PowerShell and run:

```powershell
# Navigate to project root
cd "D:\university\sem 7\FYP (Design Project Part I)\ClassMate\code\my-react-app"

# Run database setup script
$DatabaseUrl = "postgresql://neondb_owner:xxxxx@ep-xxx.neon.tech/neondb?sslmode=require"
.\setup-db.ps1 -DatabaseUrl $DatabaseUrl -SqlFile classmate_backup.sql
```

This will:
- Connect to Neon
- Backup existing data (if any)
- Restore schema from `classmate_backup.sql`
- Display created tables for verification

### 1.3 Verify Database Setup

```powershell
# Connect directly to Neon (if psql installed)
psql "postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"

# List tables
\dt

# Exit
\q
```

---

## Step 2: Deploy Backend to Railway

### 2.1 Create Railway Account & Login

```powershell
# Install Railway CLI (if not already installed)
npm install -g @railway/cli

# Login to Railway
railway login

# Verify login
railway whoami
```

### 2.2 Deploy Using Script

```powershell
# Navigate to project root
cd "D:\university\sem 7\FYP (Design Project Part I)\ClassMate\code\my-react-app"

# Run deployment script
.\deploy-backend.ps1 -Environment production
```

**What the script does:**
1. Checks Railway CLI installation
2. Links/creates Railway project
3. Prompts for environment variable configuration
4. Deploys backend
5. Shows deployment status

### 2.3 Manual Deployment (Alternative)

If script doesn't work:

```powershell
cd src/ClassMate-Backend

# Initialize Railway project
railway init

# Link to Railway
railway service create --name classmate-backend

# Deploy
railway up

# View deployment status
railway logs

# Open Railway dashboard
railway open
```

### 2.4 Configure Environment Variables in Railway

1. Go to Railway Dashboard
2. Select your project (classmate-backend)
3. Go to **Variables** tab
4. Add these variables:

```
DATABASE_URL = postgresql://neondb_owner:password@ep-xxx.neon.tech/neondb?sslmode=require
ENVIRONMENT = production
LIVEKIT_API_KEY = [from LiveKit]
LIVEKIT_API_SECRET = [from LiveKit]
LIVEKIT_URL = wss://your-livekit-instance.livekit.cloud
FRONTEND_URL = https://your-frontend.vercel.app
```

### 2.5 Verify Backend Deployment

```powershell
# Get Railway app URL (after deployment)
railway open

# Test health endpoint in browser or PowerShell:
Invoke-WebRequest -Uri "https://your-backend.railway.app/health" -AllowInsecureRedirect

# Should return: {"status": "healthy", "database": "connected"}
```

---

## Step 3: Deploy Frontend to Vercel

### 3.1 Create Vercel Account & Link GitHub

1. Go to [https://vercel.com](https://vercel.com)
2. Sign in with GitHub
3. Import your ClassMate repository

### 3.2 Deploy Using Script

```powershell
# Navigate to project root
cd "D:\university\sem 7\FYP (Design Project Part I)\ClassMate\code\my-react-app"

# Login to Vercel
vercel login

# Run deployment script
.\deploy-frontend.ps1 -Environment production

# When prompted, enter your Railway backend URL:
# https://your-backend.railway.app
```

### 3.3 Manual Deployment (Alternative)

```powershell
# Build and deploy to production
vercel --prod

# Or deploy preview
vercel

# Open in browser
vercel open
```

### 3.4 Configure Environment Variables in Vercel

1. Go to Vercel Dashboard
2. Select your project
3. Go to **Settings → Environment Variables**
4. Add variables:

```
VITE_API_URL = https://your-backend.railway.app
VITE_ENVIRONMENT = production
NODE_ENV = production
```

### 3.5 Verify Frontend Deployment

1. Visit your Vercel deployment URL
2. Check browser console for errors (F12 → Console)
3. Test API connectivity
4. Verify video features work

---

## Step 4: Configure LiveKit

### 4.1 Create LiveKit Cloud Account

1. Go to [https://cloud.livekit.io](https://cloud.livekit.io)
2. Sign up and create a new project
3. Get your credentials:
   - **API Key**: Project Settings → API Keys
   - **API Secret**: Project Settings → API Keys
   - **WebSocket URL**: Copy from dashboard

### 4.2 Add LiveKit Variables to Railway

Add to Railway Environment Variables:

```
LIVEKIT_URL = wss://your-livek-instance.livekit.cloud
LIVEKIT_API_KEY = devxxxxx
LIVEKIT_API_SECRET = your-secret-xxxxx
```

### 4.3 Test LiveKit Connectivity

```powershell
# Test from backend
$backendUrl = "https://your-backend.railway.app/api/livekit/token"
$body = @{
    roomName = "test-room"
    participantName = "test-user"
} | ConvertTo-Json

Invoke-WebRequest -Uri $backendUrl -Method POST -ContentType "application/json" -Body $body
```

Should return: `{"token": "eyJkb..."}`

---

## Step 5: Connect Everything

### 5.1 Verify Database Connection

1. Open Railway dashboard
2. Check logs for database connection messages
3. Look for: `✅ Database connection established successfully`

If error:
- Verify DATABASE_URL includes `?sslmode=require`
- Check Neon connection limits aren't exceeded
- Try reconnecting to Neon

### 5.2 Verify API Connectivity

From your Vercel frontend, test:

```javascript
// In browser console
fetch('https://your-backend.railway.app/health')
  .then(r => r.json())
  .then(d => console.log('Backend OK:', d))
  .catch(e => console.error('Backend Error:', e))
```

### 5.3 Verify Video Features

1. Create a test course
2. Start a live session
3. Try joining a video call

### 5.4 Full Integration Test

```powershell
# Test full flow
$backend = "https://your-backend.railway.app"

# 1. Health check
Write-Host "Testing health..." -ForegroundColor Cyan
Invoke-WebRequest "$backend/health"

# 2. Database connectivity
Write-Host "Testing database..." -ForegroundColor Cyan
Invoke-WebRequest "$backend/api/debug/all-sessions" | Select-Object StatusCode

# 3. Get LiveKit token
Write-Host "Testing LiveKit..." -ForegroundColor Cyan
$tokenResponse = Invoke-WebRequest `
  -Uri "$backend/api/livekit/token" `
  -Method POST `
  -ContentType "application/json" `
  -Body (@{roomName="test"; participantName="admin"} | ConvertTo-Json)
$tokenResponse.Content | ConvertFrom-Json | Select-Object token | Format-Table
```

---

## Monitoring & Troubleshooting

### Common Issues

#### Issue: Backend Can't Connect to Database

**Symptoms:** "Database connection failed", "sslmode=require error"

**Solutions:**
```powershell
# 1. Verify DATABASE_URL is correct
railway variables get DATABASE_URL

# 2. Check if URL includes SSL mode
# Should end with: ?sslmode=require

# 3. Test connection locally
$env:DATABASE_URL = "postgresql://..."
psql $env:DATABASE_URL -c "SELECT 1;"

# 4. Neon connection pool issue?
# Add ?serverVersion=15 to URL
```

#### Issue: Frontend Can't Reach Backend

**Symptoms:** CORS errors, "Failed to fetch", network timeout

**Solutions:**
```powershell
# 1. Check FRONTEND_URL in Railway matches your Vercel URL
railway env list | grep FRONTEND_URL

# 2. Verify backend CORS configuration
# In db.py: Check if ALLOWED_ORIGINS includes your Vercel domain

# 3. Test directly in browser
Ctrl+F12 → Network tab → Try API call
# Check response headers for "Access-Control-Allow-Origin"

# 4. Check RailWay logs
railway logs --follow
```

#### Issue: Video Calls Not Working

**Symptoms:** Can't connect to room, "Room creation failed"

**Solutions:**
```powershell
# 1. Verify LiveKit credentials in Railway
railway env list | grep LIVEKIT

# 2. Test LiveKit token generation
$token = (Invoke-WebRequest `
  -Uri "https://backend.railway.app/api/livekit/token" `
  -Method POST `
  -Body (@{roomName="test"; participantName="test"} | ConvertTo-Json)
).Content | ConvertFrom-Json
$token

# 3. Check LiveKit dashboard for room activity
# https://cloud.livekit.io → Rooms

# 4. Verify browser WebRTC support
# Chrome 90+, Firefox 76+, Safari 15+
```

### View Logs

**Railway Backend Logs:**
```powershell
railway logs --follow     # Live logs
railway logs --limit 100  # Last 100 lines
railroad logs --error     # Errors only
```

**Vercel Frontend Logs:**
```powershell
vercel logs                # See dashboard for live logs
# Or go to Vercel Dashboard → Project → Logs
```

### Performance Monitoring

**Railway Dashboard:**
- Memory usage
- CPU usage
- Network I/O
- Database connections

**Recommended limits:**
- Memory: 512MB+
- CPU: Standard instance sufficient
- Database: Connection pool max 10

### Database Backup & Restore

```powershell
# Backup Neon database
$url = "postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"
pg_dump $url -F c -f backup.dump

# Restore Neon database
pg_restore -d $url backup.dump
```

---

## Environment Variables Reference

### Backend (Railway) - Required

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | PostgreSQL connection | `postgresql://user:pass@host/db?sslmode=require` |
| `LIVEKIT_API_KEY` | LiveKit authentication | `devxxxxx` |
| `LIVEKIT_API_SECRET` | LiveKit signing key | `secret-xxxxx` |
| `LIVEKIT_URL` | LiveKit WebSocket URL | `wss://xxx.livekit.cloud` |
| `ENVIRONMENT` | Deployment environment | `production` |

### Backend (Railway) - Optional

| Variable | Purpose | Default |
|----------|---------|---------|
| `FRONTEND_URL` | CORS origin | `http://localhost:5173` |
| `PORT` | Server port | `8000` |
| `LOG_LEVEL` | Logging level | `INFO` |
| `MAX_CONTENT_LENGTH` | Max upload size | `16777216` |

### Frontend (Vercel) - Required

| Variable | Purpose | Example |
|----------|---------|---------|
| `VITE_API_URL` | Backend API URL | `https://backend.railway.app` |

### Frontend (Vercel) - Optional

| Variable | Purpose | Default |
|----------|---------|---------|
| `VITE_ENVIRONMENT` | Env indicator | `production` |
| `VITE_APP_NAME` | App branding | `ClassMate` |
| `VITE_LIVEKIT_URL` | LiveKit WebSocket | From backend |

---

## Local Development Testing Before Production

### 1. Test Backend Locally

```powershell
cd src/ClassMate-Backend

# Install dependencies
pip install -r requirements.txt

# Set environment variables
$env:DATABASE_URL = "postgresql://localhost/classmate_dev"
$env:LIVEKIT_API_KEY = "dev..."
$env:LIVEKIT_API_SECRET = "..."

# Run Flask app
python app.py

# Should see: 🚀 Starting ClassMate Backend
#            Port: 5000
```

### 2. Test Frontend Locally

```powershell
# Install dependencies
npm install

# Set environment variables
$env:VITE_API_URL = "http://localhost:5000"

# Run development server
npm run dev

# Open http://localhost:5173
```

### 3. Integration Testing

```javascript
// Test CORS from frontend
fetch('http://localhost:5000/health')
  .then(r => r.json())
  .then(console.log)

// Test WebSocket
io('http://localhost:5000', {
  reconnection: true,
  reconnectionDelay: 1000
}).on('connect', () => console.log('Connected'))
```

---

## Rollback & Updates

### Deploy Updated Backend

```powershell
cd src/ClassMate-Backend
git add -A
git commit -m "Update backend"
git push origin main

# Wait for Railway automatic deployment
# Or manually trigger:
railway up
```

### Deploy Updated Frontend

```powershell
npm run build
vercel --prod

# Or automatic via GitHub:
git add -A
git commit -m "Update frontend"
git push origin main
# Vercel automatically deploys on main branch
```

### Rollback on Error

**Railway:**
```powershell
railway status
# Go to Dashboard → Deployments → Select previous version → Restore
```

**Vercel:**
```powershell
vercel rollback
# Or go to Dashboard → Deployments → Select previous → Promote to Production
```

---

## Security Checklist

- [ ] Never commit `.env` files (use `.env.example` for template)
- [ ] Rotate JWT secrets regularly
- [ ] Use strong DatabaseURL passwords
- [ ] Enable HTTPS everywhere (Railway/Vercel do this automatically)
- [ ] Restrict CORS origins to your domain only
- [ ] Update dependencies regularly: `npm audit fix`, `pip check`
- [ ] Monitor Railway logs for errors
- [ ] Set up SSL/TLS certificates (Vercel handles automatically)
- [ ] Enable database backups in Neon
- [ ] Restrict database access by IP (Neon allows via firewall)

---

## Support & Resources

- **ClassMate Repo Issues:** GitHub Issues tab
- **Railway Docs:** https://docs.railway.app
- **Vercel Docs:** https://vercel.com/docs
- **Neon Docs:** https://neon.tech/docs
- **LiveKit Docs:** https://docs.livekit.io
- **Flask Docs:** https://flask.palletsprojects.com

---

## Quick Reference Commands

```powershell
# Deployment
.\deploy-backend.ps1 -Environment production
.\deploy-frontend.ps1 -Environment production
.\setup-db.ps1 -DatabaseUrl "postgresql://..."

# Monitoring
railway logs --follow
vercel logs
psql "postgresql://user:pass@host/db" -c "\dt"

# Testing
Invoke-WebRequest https://backend.railway.app/health
Invoke-WebRequest https://frontend.vercel.app

# Git deployment
git add -A
git commit -m "Deploy to production"
git push origin main
```

---

Last Updated: April 2024
Created for: ClassMate Virtual Classroom Platform
