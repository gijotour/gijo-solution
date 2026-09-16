const fs = require('fs');
const path = require('path');
const os = require('os');

const desktop = path.join(os.homedir(), 'Desktop');
const distDir = path.join(__dirname, 'dist');

console.log('Deploying to desktop:', desktop);

// 1. Installer
const installerSrc = path.join(distDir, 'GIJO-AS-Lite-Setup-v5.2.0.exe');
if (fs.existsSync(installerSrc)) {
  fs.copyFileSync(installerSrc, path.join(desktop, 'GIJO_AS_Lite_v5.2.0_설치파일.exe'));
  console.log('✅ Installer copied to desktop: GIJO_AS_Lite_v5.2.0_설치파일.exe');
} else {
  console.log('⚠️ Installer not found in dist');
}

// 2. Immediate HTML runner
const htmlSrc = path.join(__dirname, 'GIJO_Security_ERP_Suite.html');
if (fs.existsSync(htmlSrc)) {
  fs.copyFileSync(htmlSrc, path.join(desktop, 'GIJO_AS_Lite_실행.html'));
  console.log('✅ Web App HTML copied to desktop: GIJO_AS_Lite_실행.html');
}
