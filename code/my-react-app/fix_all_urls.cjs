const fs = require('fs');
const path = require('path');

const targetStr = 'https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app';
const apiBaseImport = "import { getApiBase } from './apiBase';\n";

function getDepth(filePath) {
    const relativePath = path.relative('./src', filePath);
    const depth = relativePath.split(path.sep).length - 1;
    return depth;
}

function processDirectory(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            processDirectory(fullPath);
        } else if (fullPath.endsWith('.jsx') || fullPath.endsWith('.js') || fullPath.endsWith('.py')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes(targetStr)) {
                console.log('Fixing', fullPath);
                
                // If it's a python file (e.g. backend), don't touch it or just replace with localhost?
                // Actually, python files shouldn't have the railway URL hardcoded for API calls, they are the API.
                // If they do (maybe calling external?), let's just skip python files for the API_BASE import.
                if (fullPath.endsWith('.py')) {
                     // do nothing for now
                     continue;
                }

                // Replace backtick string first
                content = content.replace(new RegExp(`\\\`${targetStr}(.*?)\\\``, 'g'), '`${API_BASE}$1`');
                
                // Replace single/double quote string
                content = content.replace(new RegExp(`'${targetStr}(.*?)'`, 'g'), '`${API_BASE}$1`');
                content = content.replace(new RegExp(`"${targetStr}(.*?)"`, 'g'), '`${API_BASE}$1`');

                // Add import if not present and if API_BASE is used
                if (content.includes('API_BASE') && !content.includes('getApiBase')) {
                    const depth = getDepth(fullPath);
                    let importPath = './apiBase';
                    if (depth > 0) {
                        importPath = '../'.repeat(depth) + 'apiBase';
                    }
                    
                    const newImport = `import { getApiBase } from '${importPath}';\nconst API_BASE = getApiBase();\n`;
                    
                    // Find the last import statement to insert after
                    const lastImportIndex = content.lastIndexOf('import ');
                    if (lastImportIndex !== -1) {
                        const endOfLine = content.indexOf('\n', lastImportIndex);
                        content = content.slice(0, endOfLine + 1) + newImport + content.slice(endOfLine + 1);
                    } else {
                        content = newImport + '\n' + content;
                    }
                }

                fs.writeFileSync(fullPath, content);
            }
        }
    }
}

processDirectory('./src');
