# Bug Monitor Extension — Load Instructions

## 1. Copy icons (one-time setup)
Run `setup-icons.bat` (double-click it) to copy the icon files.

## 2. Load the extension in Chrome
1. Open Chrome → go to `chrome://extensions/`
2. Enable **Developer Mode** (top-right toggle)
3. Click **"Load unpacked"**
4. Select the folder: `C:\Users\Keshav\Bug Monitor\extension`
5. The extension will appear in your toolbar

## 3. Configure a site to monitor
1. Click the **Bug Monitor** icon in your toolbar
2. Go to the **Config** tab
3. Enter your site URL in **Monitored Origins** (e.g. `https://app.yoursite.com`)
4. Click **Save Config**

## 4. Visit your site
Open the monitored site — the extension will immediately start capturing:
- Console logs (log, warn, error, debug, info, trace)
- Network requests (fetch, XHR, WebSocket)
- JavaScript errors & unhandled promise rejections
- User interactions (clicks, inputs, form submits, scrolls)
- Performance metrics (LCP, FID, CLS, TTFB, resources)
- Memory usage
- localStorage / sessionStorage changes
- Dynamic script/resource injection
- SPA navigation events (pushState, replaceState, popstate)
- DOM mutations

## 5. View live telemetry
Click the Bug Monitor icon → **Live Feed** tab to see events in real time.

## 6. Business Events SDK (optional)
In your web app, call:
```js
window.__BugMonitor.track('invoice_saved', { invoiceId: '123' }, { severity: 'info' });
window.__BugMonitor.startWorkflow('wf_1', 'Checkout');
window.__BugMonitor.stepWorkflow('wf_1', 'payment_submitted');
window.__BugMonitor.completeWorkflow('wf_1', { orderId: 'ord_456' });
```

## Extension File Structure
```
extension/
├── manifest.json               ← MV3 manifest
├── background/
│   └── service-worker.js       ← Event buffering, upload scheduler, anomaly detection
├── content/
│   ├── main-collector.js       ← MAIN world: intercepts console/fetch/XHR/errors/etc.
│   └── bridge.js               ← ISOLATED world: relays events to service worker
├── storage/
│   └── idb.js                  ← IndexedDB wrapper (7-day retention)
├── popup/
│   ├── popup.html              ← Extension popup UI
│   ├── popup.css               ← Dark theme styles
│   └── popup.js                ← Live feed, sessions, config controller
├── sdk/
│   └── business-events.js      ← Business events SDK for monitored apps
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```
