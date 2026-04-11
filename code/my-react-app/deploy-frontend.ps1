#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Deploy ClassMate frontend to Vercel
.DESCRIPTION
    Automated deployment script for ClassMate frontend to Vercel platform
.EXAMPLE
    .\deploy-frontend.ps1 -Environment production
#>

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet("development", "staging", "production")]
    [string]$Environment = "production",
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

Write-Host "🚀 ClassMate Frontend Deployment to Vercel" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Environment: $Environment"
Write-Host ""

# Check if vercel CLI is installed
try {
    $vercelVersion = vercel --version 2>&1
    Write-Host "✅ Vercel CLI found: $vercelVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Vercel CLI not found" -ForegroundColor Red
    Write-Host "   Install from: https://vercel.com/docs/cli" -ForegroundColor Yellow
    Write-Host "   Or run: npm install -g vercel" -ForegroundColor Yellow
    exit 1
}

# Check if Node.js and npm are available
try {
    $nodeVersion = node --version
    $npmVersion = npm --version
    Write-Host "✅ Node.js $nodeVersion with npm $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js or npm not found" -ForegroundColor Red
    exit 1
}

try {
    # 1. Install dependencies
    Write-Host ""
    Write-Host "1️⃣  Installing dependencies..." -ForegroundColor Cyan
    npm install
    
    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed"
    }

    # 2. Build (unless skipped)
    if (-not $SkipBuild) {
        Write-Host ""
        Write-Host "2️⃣  Building React application..." -ForegroundColor Cyan
        npm run build
        
        if ($LASTEXITCODE -ne 0) {
            throw "npm build failed"
        }
        
        Write-Host "✅ Build completed successfully" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "⏭️  Skipping build (--SkipBuild flag used)" -ForegroundColor Yellow
    }

    # 3. Set environment variables
    Write-Host ""
    Write-Host "3️⃣  Configuring environment variables..." -ForegroundColor Cyan
    
    Write-Host "   Setting VITE_API_URL..." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "   Enter your Railway backend URL:" -ForegroundColor Cyan
    Write-Host "   (e.g., https://classmate-backend-xxxx.railway.app)" -ForegroundColor Gray
    $apiUrl = Read-Host "   Backend URL"
    
    if (-not $apiUrl) {
        Write-Host "⚠️  No backend URL provided - you can set it in Vercel dashboard later" -ForegroundColor Yellow
    }

    # 4. Deploy to Vercel
    Write-Host ""
    Write-Host "4️⃣  Deploying to Vercel..." -ForegroundColor Cyan
    
    $vercelArgs = @("--prod", "--confirm")
    
    if ($apiUrl) {
        $vercelArgs += "--env"
        $vercelArgs += "VITE_API_URL=$apiUrl"
    }
    
    if ($Environment -ne "production") {
        $vercelArgs = @("--confirm")  # Preview deployment for non-prod
        Write-Host "   Creating preview deployment..." -ForegroundColor Yellow
    }
    
    vercel @vercelArgs
    
    if ($LASTEXITCODE -ne 0) {
        throw "Vercel deployment failed"
    }

    # 5. Summary and next steps
    Write-Host ""
    Write-Host "✅ Deployment successful!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 Next steps:" -ForegroundColor Cyan
    Write-Host "   1. Verify deployment in Vercel dashboard" -ForegroundColor Cyan
    Write-Host "   2. Test the application at your Vercel URL" -ForegroundColor Cyan
    Write-Host "   3. Check backend connectivity (if issues, verify VITE_API_URL)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "🔧 If you need to update environment variables:" -ForegroundColor Cyan
    Write-Host "   vercel env set VITE_API_URL $apiUrl" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "📚 Documentation:" -ForegroundColor Cyan
    Write-Host "   Vercel Docs: https://vercel.com/docs" -ForegroundColor Cyan
    Write-Host "   This Project: See README_DEPLOY.md" -ForegroundColor Cyan
    
} catch {
    Write-Host ""
    Write-Host "❌ Deployment failed: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "  • Make sure you're logged in: vercel login" -ForegroundColor Yellow
    Write-Host "  • Check Node.js version: node --version" -ForegroundColor Yellow
    Write-Host "  • Try clearing cache: npm cache clean --force" -ForegroundColor Yellow
    exit 1
}
