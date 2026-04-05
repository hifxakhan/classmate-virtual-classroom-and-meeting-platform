Write-Host "=========================================" -ForegroundColor Green
Write-Host "FIXING ALL DATABASE CONNECTIONS" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green

$filesChanged = 0
$filesProcessed = 0

Get-ChildItem -Path "*.py" -Exclude "db.py", "fix_all_files.ps1" | ForEach-Object {
    $filename = $_.Name
    $filesProcessed++
    
    Write-Host "Processing: $filename" -ForegroundColor Yellow
    
    $content = Get-Content $_.FullName -Raw
    
    if ($content -match "getDbConnection") {
        # Remove psycopg2 imports
        $newContent = $content -replace "import psycopg2.*`r?`n", ""
        $newContent = $newContent -replace "from psycopg2.*`r?`n", ""
        
        # Remove getDbConnection function
        $newContent = $newContent -replace "(?s)def getDbConnection.*?return None\s*", ""
        
        # Add import at the top
        $newContent = "from db import getDbConnection, get_db_connection_dict`r`n" + $newContent
        
        # Replace function calls
        $newContent = $newContent -replace "getDbConnection\(\)", "getDbConnection()"
        
        # Save file
        $newContent | Set-Content $_.FullName
        Write-Host "  FIXED: $filename" -ForegroundColor Green
        $filesChanged++
    }
    elseif ($content -match "psycopg2") {
        # Add import at the top
        $newContent = "from db import getDbConnection, get_db_connection_dict`r`n" + $content
        $newContent | Set-Content $_.FullName
        Write-Host "  ADDED IMPORT: $filename" -ForegroundColor Green
        $filesChanged++
    }
    else {
        Write-Host "  SKIPPED: $filename" -ForegroundColor Gray
    }
}

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "SUMMARY: $filesChanged files fixed out of $filesProcessed" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "1. git add ." -ForegroundColor Yellow
Write-Host "2. git commit -m 'Add central db.py and fix database connections'" -ForegroundColor Yellow
Write-Host "3. git push" -ForegroundColor Yellow