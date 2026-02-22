const fs = require('fs');
const path = require('path');

let loaded = false;

function parseEnvLine(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return null;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) return null;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if (!key) return null;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
    }
    return { key, value };
}

function loadEnv() {
    if (loaded) return;
    loaded = true;

    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;

    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/g)) {
        const parsed = parseEnvLine(line);
        if (!parsed) continue;
        if (typeof process.env[parsed.key] === 'undefined') {
            process.env[parsed.key] = parsed.value;
        }
    }
}

loadEnv();

