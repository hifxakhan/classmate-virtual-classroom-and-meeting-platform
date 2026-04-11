# 🚀 ClassMate Backend Deployment on Railway

This guide explains how to deploy the ClassMate Flask backend to Railway using Docker.

## 📋 Prerequisites

- GitHub account with your repository
- Railway account (https://railway.app)
- Neon PostgreSQL database (https://neon.tech)
- LiveKit credentials (optional, for video calls)

---

## 🏗️ Project Structure

```
repository-root/
├── Dockerfile                    ← Railway uses this for deployment
├── .dockerignore               ← Excludes unnecessary files from Docker build
└── code/
    └── my-react-app/
        └── src/
            └── ClassMate-Backend/
                ├── app.py
                ├── requirements.txt
                ├── db.py
                ├── models.py
                └── ... (route files)
```

**Important:** The `Dockerfile` must be in the repository **ROOT**, not in the code folder.

---

## 📖 Step 1: Connect Repository to Railway

1. Go to **https://railway.app** and sign in with GitHub
2. Click **+ New Project** → **Deploy from GitHub repo**
3. Select your **ClassMate** repository
4. Railway will auto-detect the **Dockerfile** in the root
5. Click **Deploy**

---

## 🔐 Step 2: Set Environment Variables on Railway

Railway will start building. While it builds, set up environment variables:

### Open Railway Console:
1. Go to your Railway project dashboard
2. Select the deployed service
3. Click **Variables** tab

### Add These Variables:

```
DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/database_name?sslmode=require
ENVIRONMENT=production
FRONTEND_URL=https://your-frontend.vercel.app
JWT_SECRET=use-openssl-rand-hex-32
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret
LIVEKIT_URL=wss://your-instance.livekit.cloud
WHISPER_MODEL_SIZE=tiny
PORT=8000
```

---

## 🐘 Step 3: Connect Neon PostgreSQL

### Create Neon Database:
1. Go to **https://neon.tech** → Sign up
2. Create a new project
3. Copy the **Database URL** (postgres://...)
4. Add `?sslmode=require` at the end if not present

### In Railway Console:
1. Paste the full URL into `DATABASE_URL`
2. Click **Save** (or just confirm)

### Format:
```
DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require
```

---

## 🌍 Step 4: Set Region to Singapore (Optional)

### To reduce latency for Asia-Pacific users:

1. In Railway dashboard, go to **Settings**
2. Find **Region** setting
3. Change to **Singapore** (asia-southeast-1) if available
4. Click **Update** and redeploy

---

## ✅ Step 5: Verify Deployment

### Check Logs:
1. Go to **Deployments** tab in Railway
2. Click the latest deployment
3. Scroll to **Logs** section
4. Look for: `Starting gunicorn` or `Uvicorn running on`

### Test Health Endpoint:
```bash
# Replace with your Railway URL
curl https://your-railway-url.railway.app/health

# Expected response:
# {"status":"running","endpoints":["/api/*","/health","/socket.io"]}
```

### Test API:
```bash
# Example API call
curl https://your-railway-url.railway.app/api/your-endpoint
```

---

## 🛠️ Troubleshooting

### **Problem: Build fails with "pip: command not found"**

**Solution:** You have `railway.json` configured with Nixpacks instead of Dockerfile.

- Delete `railway.json` from repository root
- Ensure `Dockerfile` exists in repository root
- Commit and push to GitHub
- Railway will auto-detect and use Dockerfile

### **Problem: "ModuleNotFoundError" or missing dependencies**

**Solution:** 

1. Check `requirements.txt` is in `code/my-react-app/src/ClassMate-Backend/`
2. Verify the Dockerfile `COPY` path is correct: `code/my-react-app/src/ClassMate-Backend/requirements.txt`
3. In Railway, click **Redeploy** to rebuild

### **Problem: Database connection fails**

**Solution:**

1. Verify `DATABASE_URL` format: `postgresql://user:pass@host:port/dbname?sslmode=require`
2. Check Neon database is active (not paused)
3. Verify credentials in Neon dashboard
4. Add `?sslmode=require` to the end of URL (required for Neon)

### **Problem: CORS errors on frontend**

**Solution:**

1. In Railway Variables, set: `FRONTEND_URL=https://your-vercel-url.vercel.app`
2. Or update in `app.py` CORS configuration
3. Redeploy

### **Problem: WebSocket connection fails**

**Solution:**

1. Ensure `flask-socketio==5.3.4` and `eventlet==0.33.3` in requirements.txt
2. Gunicorn command includes: `--worker-class eventlet`
3. Check that it's already in the Dockerfile ✓

### **Problem: "502 Bad Gateway" error**

**Solution:**

1. Check deployment logs in Railway console
2. Verify app starts with: `gunicorn --worker-class eventlet ...`
3. Ensure `/health` endpoint returns `200 OK`
4. Check memory limits (might need upgrade)
5. Redeploy

---

## 📊 Monitoring & Logs

### View Real-time Logs:
1. Railway dashboard → Your service
2. **Logs** tab
3. Select **Deployment logs** or **Runtime logs**

### Check Failed Deployments:
1. Go to **Deployments** tab
2. Find the failed build
3. Click to see error details

### Common Log Messages:
```
✓ "Starting gunicorn" - Server is starting ✅
✓ "Starting ClassMate Backend" - App initialized ✅
✓ "Connected to database" - DB connection successful ✅
✗ "pip: command not found" - Using Nixpacks instead of Dockerfile ❌
```

---

## 🔄 Redeploying After Code Changes

1. Make changes locally and test: `git add . && git commit -m "Update message"`
2. Push to GitHub: `git push origin main`
3. Railway will auto-detect and redeploy
4. Or manually click **Redeploy** in Railway console

---

## 🚀 Production Checklist

Before going live:

- [ ] Database URL is set correctly with SSL
- [ ] FRONTEND_URL is set to your production frontend domain
- [ ] JWT_SECRET is set to a strong random value
- [ ] ENVIRONMENT=production
- [ ] All required variables are set (no missing environment vars)
- [ ] Health endpoint `/health` returns 200 OK
- [ ] API endpoints respond correctly
- [ ] WebSocket connections work (if using socket.io)
- [ ] Logs show no errors on startup
- [ ] Region is set to preference (Singapore/closest to users)

---

## 📞 Support & Documentation

- **Railway Docs:** https://docs.railway.app
- **Flask Deployment Guide:** https://flask.palletsprojects.com/deployment/
- **Gunicorn Documentation:** https://docs.gunicorn.org/
- **Neon PostgreSQL Docs:** https://neon.tech/docs

---

## 🔐 Security Notes

- Never commit `.env` to GitHub
- Always use strong JWT_SECRET (generate with `openssl rand -hex 32`)
- Use SSL connections to database (`sslmode=require`)
- In production, set `ENVIRONMENT=production` to disable Flask debug
- Store sensitive credentials only in Railway Variables, not in code

---

**Happy deploying! 🎉**
