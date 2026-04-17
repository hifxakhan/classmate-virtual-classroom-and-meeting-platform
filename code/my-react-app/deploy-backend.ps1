#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Deploy ClassMate backend to Railway
.DESCRIPTION
    Automated deployment script for ClassMate backend to Railway platform
.EXAMPLE
    .\deploy-backend.ps1 -Environment production
#>

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet("development", "staging", "production")]
    [string]$Environment = "production",
    
    [Parameter(Mandatory=$false)]
    [string]$ProjectName = "classmate-backend"
)

$ErrorActionPreference = "Stop"

Write-Host "🚀 ClassMate Backend Deployment to Railway" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Environment: $Environment"
Write-Host "Project: $ProjectName"
Write-Host ""

# Check if .env.local exists with Railway token
if (-not (Test-Path .env.local)) {
    Write-Host "⚠️  .env.local not found" -ForegroundColor Yellow
    Write-Host "   Make sure to add RAILWAY_TOKEN to .env.local"
    Write-Host ""
}

# Check if railway CLI is installed
try {
    $railwayVersion = railway --version 2>&1
    Write-Host "✅ Railway CLI found: $railwayVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Railway CLI not found" -ForegroundColor Red
    Write-Host "   Install from: https://docs.railway.app/develop/cli" -ForegroundColor Yellow
    Write-Host "   Or run: npm install -g @railway/cli" -ForegroundColor Yellow
    exit 1
}

# Navigate to backend directory
$backendPath = "./src/ClassMate-Backend"
if (-not (Test-Path $backendPath)) {
    Write-Host "❌ Backend directory not found at $backendPath" -ForegroundColor Red
    exit 1
}

Push-Location $backendPath
Write-Host "📁 Working in: $(Get-Location)" -ForegroundColor Cyan

try {
    # 1. Install/upgrade Railway CLI if needed
    Write-Host ""
    Write-Host "1️⃣  Setting up Railway CLI..." -ForegroundColor Cyan
    railway login --browserauth

    # 2. Initialize project or link existing
    Write-Host ""
    Write-Host "2️⃣  Linking Railway project..." -ForegroundColor Cyan
    
    # Try to link to existing project
    if (Test-Path .railway) {
        Write-Host "   Existing Railway project found (.railway directory)" -ForegroundColor Green
        railway service select
    } else {
        Write-Host "   Creating new Railway project..." -ForegroundColor Yellow
        railway init
    }

    # 3. Set environment variables
    Write-Host ""
    Write-Host "3️⃣  Configuring environment variables..." -ForegroundColor Cyan
    
    Write-Host "   You need to set these Railway variables:" -ForegroundColor Yellow
    Write-Host "   - DATABASE_URL (from Neon PostgreSQL)" -ForegroundColor Yellow
    Write-Host "   - LIVEKIT_API_KEY" -ForegroundColor Yellow
    Write-Host "   - LIVEKIT_API_SECRET" -ForegroundColor Yellow
    Write-Host "   - LIVEKIT_URL" -ForegroundColor Yellow
    Write-Host "   - FRONTEND_URL (your Vercel deployment)" -ForegroundColor Yellow
    Write-Host ""
    
    $setupVars = Read-Host "Configure variables now? (y/n)"
    if ($setupVars -eq 'y' -or $setupVars -eq 'Y') {
        Write-Host ""
        Write-Host "   Railway CLI will open. Add variables via Dashboard:" -ForegroundColor Cyan
        Write-Host "   1. Go to Environment tab" -ForegroundColor Cyan
        Write-Host "   2. Add new variable for each key above" -ForegroundColor Cyan
        railway open
    }

    # 4. Trigger deployment
    Write-Host ""
    Write-Host "4️⃣  Deploying to Railway..." -ForegroundColor Cyan
    Write-Host "   Railway will automatically detect Python and install dependencies" -ForegroundColor Green
    
    railway up

    # 5. Wait and verify
    Write-Host ""
    Write-Host "5️⃣  Checking deployment status..." -ForegroundColor Cyan
    Start-Sleep -Seconds 5
    
    railway open
    
    Write-Host ""
    Write-Host "✅ Deployment initiated!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 Next steps:" -ForegroundColor Cyan
    Write-Host "   1. Monitor deployment in Railway dashboard" -ForegroundColor Cyan
    Write-Host "   2. Test health endpoint: GET /health" -ForegroundColor Cyan
    Write-Host "   3. Update frontend VITE_API_URL variable" -ForegroundColor Cyan
    Write-Host "   4. Verify database connection" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "📚 Documentation:" -ForegroundColor Cyan
    Write-Host "   Railway Docs: https://docs.railway.app/" -ForegroundColor Cyan
    Write-Host "   This Project: See docs/README_DEPLOY.md" -ForegroundColor Cyan
    
} catch {
    Write-Host ""
    Write-Host "❌ Deployment failed: $_" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
