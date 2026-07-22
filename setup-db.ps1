#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Initialize Neon PostgreSQL database for ClassMate
.DESCRIPTION
    Restores database schema from SQL file and runs migrations
.EXAMPLE
    .\setup-db.ps1 -DatabaseUrl "postgresql://user:pass@host/db" -SqlFile classmate_backup.sql
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$DatabaseUrl,
    
    [Parameter(Mandatory=$false)]
    [string]$SqlFile = "classmate_backup.sql",
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipBackup
)

$ErrorActionPreference = "Stop"

Write-Host "🗄️  ClassMate Database Setup" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check if psql is installed
try {
    $psqlVersion = psql --version
    Write-Host "✅ PostgreSQL CLI found: $psqlVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ PostgreSQL client (psql) not found" -ForegroundColor Red
    Write-Host "   Install PostgreSQL from: https://www.postgresql.org/download/" -ForegroundColor Yellow
    Write-Host "   Or via WSL on Windows" -ForegroundColor Yellow
    exit 1
}

# Check if SQL file exists
if (-not (Test-Path $SqlFile)) {
    Write-Host "❌ SQL file not found: $SqlFile" -ForegroundColor Red
    exit 1
}

Write-Host "📁 Using SQL file: $SqlFile" -ForegroundColor Green
Write-Host ""

try {
    # 1. Test connection
    Write-Host "1️⃣  Testing database connection..." -ForegroundColor Cyan
    
    $env:PGPASSWORD = ""
    # Parse connection string to test
    psql "$DatabaseUrl" -c "SELECT 1;" | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Successfully connected to database" -ForegroundColor Green
    } else {
        throw "Failed to connect to database"
    }

    # 2. Optional: Create backup
    if (-not $SkipBackup) {
        Write-Host ""
        Write-Host "2️⃣  Creating backup of current database (if any)..." -ForegroundColor Cyan
        
        $backupFile = "backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"
        try {
            pg_dump "$DatabaseUrl" -f $backupFile 2>$null
            Write-Host "✅ Backup created: $backupFile" -ForegroundColor Green
        } catch {
            Write-Host "⚠️  Could not create backup (database might be empty)" -ForegroundColor Yellow
        }
    } else {
        Write-Host ""
        Write-Host "⏭️  Skipping backup (--SkipBackup flag used)" -ForegroundColor Yellow
    }

    # 3. Restore schema
    Write-Host ""
    Write-Host "3️⃣  Restoring database schema..." -ForegroundColor Cyan
    
    $sqlContent = Get-Content $SqlFile -Encoding UTF8 -Raw
    $sqlContent | psql "$DatabaseUrl" | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Schema restored successfully" -ForegroundColor Green
    } else {
        throw "Failed to restore schema"
    }

    # 4. Verify tables
    Write-Host ""
    Write-Host "4️⃣  Verifying tables created..." -ForegroundColor Cyan
    
    $tableCount = psql "$DatabaseUrl" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"
    Write-Host "✅ Created tables: $tableCount" -ForegroundColor Green

    # 5. Display table list
    Write-Host ""
    Write-Host "5️⃣  Database tables:" -ForegroundColor Cyan
    psql "$DatabaseUrl" -l -t

    Write-Host ""
    Write-Host "✅ Database setup completed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 Next steps:" -ForegroundColor Cyan
    Write-Host "   1. Update DATABASE_URL in Railway variables" -ForegroundColor Cyan
    Write-Host "   2. Test backend connection: GET /health" -ForegroundColor Cyan
    Write-Host "   3. Verify data integrity with backend queries" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "📚 Useful commands:" -ForegroundColor Cyan
    Write-Host "   Connect to database:" -ForegroundColor Cyan
    Write-Host "   psql '$DatabaseUrl'" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "   List tables:" -ForegroundColor Cyan
    Write-Host "   psql '$DatabaseUrl' -c '\dt'" -ForegroundColor Cyan
    
} catch {
    Write-Host ""
    Write-Host "❌ Database setup failed: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "  • Check DATABASE_URL format" -ForegroundColor Yellow
    Write-Host "  • Verify psql is in PATH: where psql" -ForegroundColor Yellow
    Write-Host "  • Check SQL file syntax" -ForegroundColor Yellow
    Write-Host "  • For Neon: Connection string should include ?sslmode=require" -ForegroundColor Yellow
    exit 1
}
