const fs = require('fs');
const path = require('path');
const os = require('os');

const desktop = path.join(os.homedir(), 'Desktop');
const distDir = path.join(__dirname, 'gijo-security-erp-app', 'dist');

console.log('Deploying to desktop:', desktop);

// 1. Installer
const possibleInstallers = [
  path.join(distDir, 'GIJO-AS-Lite-Setup-v5.2.0.exe'),
  path.join(distDir, 'GIJO-WIKI-Setup-v5.2.0.exe')
];

let foundInstaller = possibleInstallers.find(p => fs.existsSync(p));
if (foundInstaller) {
  fs.copyFileSync(foundInstaller, path.join(desktop, 'GIJO_AS_Lite_v5.2.0_설치파일.exe'));
  fs.copyFileSync(foundInstaller, path.join(desktop, 'GIJO_WIKI_설치파일_v5.2.0.exe'));
  console.log('✅ Installer copied to desktop as GIJO_AS_Lite & GIJO_WIKI v5.2.0');
} else {
  console.log('⚠️ Installer not found in dist');
}

// 2. HTML and BAT
const htmlSrc = path.join(__dirname, 'GIJO_Security_ERP_Suite.html');
const batSrc = path.join(__dirname, 'Launch_GIJO_WIKI.bat');

if (fs.existsSync(htmlSrc)) {
  fs.copyFileSync(htmlSrc, path.join(desktop, 'GIJO_AS_Lite_실행.html'));
  fs.copyFileSync(htmlSrc, path.join(desktop, 'GIJO_WIKI_실행.html'));
  console.log('✅ Web App HTML copied to desktop (Lite & WIKI)');
}

if (fs.existsSync(batSrc)) {
  fs.copyFileSync(batSrc, path.join(desktop, 'GIJO_AS_Lite_실행.bat'));
  fs.copyFileSync(batSrc, path.join(desktop, 'GIJO_WIKI_실행.bat'));
  console.log('✅ Launcher BAT copied to desktop (Lite & WIKI)');
}
