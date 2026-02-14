const cp = require('child_process');
const npmCli = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';

try {
    // Install core deps first
    const args1 = ['install', 'express', 'ejs', 'mysql2', 'body-parser', 'express-session', 'bcryptjs', 'moment-jalaali'];
    console.log('Installing core dependencies...');
    cp.execFileSync('node', [npmCli, ...args1], { stdio: 'inherit' });

    // Install puppeteer with skip download
    console.log('Installing puppeteer...');
    cp.execFileSync('node', [npmCli, 'install', 'puppeteer'], { 
        stdio: 'inherit',
        env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: 'true' }
    });
    
    console.log('Installation complete.');
} catch (e) {
    console.error('Installation failed:', e);
}
