const cp = require('child_process');
const npmCli = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';

try {
    console.log('Installing dependencies...');
    cp.execFileSync('node', [npmCli, 'install', 'string-similarity'], { stdio: 'inherit' });
    console.log('Installation complete.');
} catch (e) {
    console.error('Installation failed:', e);
}
