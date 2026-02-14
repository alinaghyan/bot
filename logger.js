const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, 'logs');
const logFile = path.join(logDir, 'app.log');

let entries = [];

function ensureLogDir() {
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  } catch {}
}

function toSerializableError(err) {
  if (!err) return null;
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

function writeLine(line) {
  try {
    ensureLogDir();
    fs.appendFileSync(logFile, line + '\n', 'utf8');
  } catch {}
}

function addEntry(level, message, meta) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message: String(message || ''),
    meta: meta || null
  };

  entries.push(entry);
  if (entries.length > 1000) entries = entries.slice(-1000);

  writeLine(JSON.stringify(entry));
  return entry;
}

function info(message, meta) {
  return addEntry('info', message, meta);
}

function warn(message, meta) {
  return addEntry('warn', message, meta);
}

function error(message, err, meta) {
  const payload = { ...(meta || {}), error: toSerializableError(err) };
  return addEntry('error', message, payload);
}

function getEntries(limit = 300) {
  const n = Number(limit);
  const safe = Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 300;
  return entries.slice(-safe).reverse();
}

function clear() {
  entries = [];
  try {
    ensureLogDir();
    fs.writeFileSync(logFile, '', 'utf8');
  } catch {}
}

module.exports = { info, warn, error, getEntries, clear, logFile };

