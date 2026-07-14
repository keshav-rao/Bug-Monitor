const fs = require('fs');
const path = require('path');

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

function capture() {
  try {
    const screenshot = require('screenshot-desktop');
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
    const filename = `sap_error_${Date.now()}.png`;
    const filepath = path.join(SCREENSHOT_DIR, filename);
    return screenshot({ filename: filepath }).then(() => ({
      path: filepath,
      filename,
      size: fs.statSync(filepath).size,
    }));
  } catch (err) {
    console.error('[SAP Desktop Screenshot] Capture failed:', err.message);
    return Promise.resolve(null);
  }
}

function getCapturedScreenshots() {
  if (!fs.existsSync(SCREENSHOT_DIR)) return [];
  return fs.readdirSync(SCREENSHOT_DIR)
    .filter(f => f.endsWith('.png'))
    .sort()
    .map(f => ({
      filename: f,
      path: path.join(SCREENSHOT_DIR, f),
      ts: fs.statSync(path.join(SCREENSHOT_DIR, f)).mtimeMs,
    }));
}

function cleanup(maxAgeMs = 86400000) {
  if (!fs.existsSync(SCREENSHOT_DIR)) return;
  const now = Date.now();
  for (const f of fs.readdirSync(SCREENSHOT_DIR)) {
    const fp = path.join(SCREENSHOT_DIR, f);
    try {
      if (now - fs.statSync(fp).mtimeMs > maxAgeMs) fs.unlinkSync(fp);
    } catch (e) {}
  }
}

module.exports = { capture, getCapturedScreenshots, cleanup };
