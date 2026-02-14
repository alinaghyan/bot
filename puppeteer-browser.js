const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');

function getCandidateChromePaths() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

  return [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.CHROMIUM_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Chromium\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe'
  ].filter(Boolean);
}

function getCandidateFirefoxPaths() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

  return [
    process.env.FIREFOX_PATH,
    'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
    path.join(localAppData, 'Mozilla Firefox', 'firefox.exe')
  ].filter(Boolean);
}

function findChromeExecutablePath() {
  try {
    const bundled = typeof puppeteer.executablePath === 'function' ? puppeteer.executablePath() : null;
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {}

  for (const p of getCandidateChromePaths()) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

function findFirefoxExecutablePath() {
  for (const p of getCandidateFirefoxPaths()) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

async function launchBrowser(options = {}) {
  const preferred = String(process.env.BOT_BROWSER || options.browser || 'chrome').toLowerCase();
  const launchOptions = {
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized'],
    ...options
  };

  try {
    if (preferred === 'firefox') {
      const firefoxPath = findFirefoxExecutablePath();
      if (firefoxPath) {
        return await puppeteer.launch({
          ...launchOptions,
          browser: 'firefox',
          executablePath: firefoxPath
        });
      }

      return await puppeteer.launch({
        ...launchOptions,
        browser: 'firefox'
      });
    }

    return await puppeteer.launch({ ...launchOptions, channel: 'chrome' });
  } catch {}

  const executablePath = findChromeExecutablePath();
  if (executablePath) {
    return await puppeteer.launch({ ...launchOptions, executablePath });
  }

  throw new Error(
    'مرورگر برای Puppeteer پیدا نشد. Chrome/Firefox را نصب کنید یا مسیر را در CHROME_PATH / FIREFOX_PATH تنظیم کنید، یا دستور `npx puppeteer browsers install chrome` (یا firefox) را اجرا کنید.'
  );
}

module.exports = { launchBrowser };
