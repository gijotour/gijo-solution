const fs = require('fs');
const path = require('path');
const os = require('os');

const desktop = path.join(os.homedir(), 'Desktop');
const distDir = path.join(__dirname, 'gijo-security-erp-app', 'dist');

console.log('Deploying to desktop:', desktop);

// 1. Installer
const installerSrc = path.join(distDir, 'GIJO-WIKI-Setup-v5.0.0.exe');
if (fs.existsSync(installerSrc)) {
  fs.copyFileSync(installerSrc, path.join(desktop, 'GIJO_WIKI_설치파일_v5.0.0.exe'));
  fs.copyFileSync(installerSrc, path.join(desktop, 'GIJO-WIKI-Setup-v5.0.0.exe'));
  console.log('✅ Installer copied:', path.join(desktop, 'GIJO_WIKI_설치파일_v5.0.0.exe'));
} else {
  console.log('⚠️ Installer not found:', installerSrc);
}

// 2. HTML and BAT
const htmlSrc = path.join(__dirname, 'GIJO_Security_ERP_Suite.html');
const batSrc = path.join(__dirname, 'Launch_GIJO_WIKI.bat');

if (fs.existsSync(htmlSrc)) {
  fs.copyFileSync(htmlSrc, path.join(desktop, 'GIJO_WIKI_실행.html'));
  console.log('✅ Web App HTML copied to desktop');
}

if (fs.existsSync(batSrc)) {
  fs.copyFileSync(batSrc, path.join(desktop, 'GIJO_WIKI_실행.bat'));
  console.log('✅ Launcher BAT copied to desktop');
}
