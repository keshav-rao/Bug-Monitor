const http = require('http');
const https = require('https');
const url = require('url');
const crypto = require('crypto');
const os = require('os');

const CONFIG = {
  proxyPort: 9090,
  uploadEndpoint: 'http://localhost:4000/v1/telemetry/upload',
  monitoringKey: null,
  captureResponseBodies: true,
  captureRequestBodies: false,
  maxBodySize: 10240,
  excludedHosts: ['localhost', '127.0.0.1', '::1'],
};

function loadConfig() {
  const fs = require('fs');
  const path = require('path');
  const configPath = path.join(__dirname, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      Object.assign(CONFIG, userConfig);
    }
  } catch (err) {
    console.error('[API Proxy] Failed to load config:', err.message);
  }
}

loadConfig();

const sender = require('./sender');
const responseCapture = require('./response-capture');

function ts() { return Date.now(); }

function shouldExclude(hostname) {
  return CONFIG.excludedHosts.some(ex => hostname === ex || hostname.endsWith('.' + ex));
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);
  const targetHost = parsedUrl.hostname || req.headers.host?.split(':')[0] || '';
  const targetPort = parseInt(parsedUrl.port, 10) || (req.url.startsWith('https') ? 443 : 80);

  if (shouldExclude(targetHost)) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Host excluded from monitoring' }));
    return;
  }

  const requestId = 'api_' + ts() + '_' + crypto.randomBytes(6).toString('hex');
  const startTime = Date.now();
  let requestBody = null;
  let chunks = [];

  if (CONFIG.captureRequestBodies) {
    req.on('data', chunk => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > CONFIG.maxBodySize) {
        chunks = [];
      }
    });
  }

  req.on('end', () => {
    if (CONFIG.captureRequestBodies) {
      requestBody = Buffer.concat(chunks).toString('utf8').slice(0, CONFIG.maxBodySize);
    }

    const method = req.method || 'GET';
    const headers = sanitizeHeaders(req.headers);

    const options = {
      hostname: targetHost,
      port: targetPort,
      path: parsedUrl.path,
      method: method,
      headers: headers,
    };

    delete options.headers['x-bug-monitor-auth'];

    const proxyReq = http.request(options, (proxyRes) => {
      let responseBody = '';
      const responseChunks = [];

      proxyRes.on('data', chunk => {
        responseChunks.push(chunk);
        if (Buffer.concat(responseChunks).length > CONFIG.maxBodySize) return;
      });

      proxyRes.on('end', () => {
        responseBody = Buffer.concat(responseChunks).toString('utf8').slice(0, CONFIG.maxBodySize);
        const duration = Date.now() - startTime;

        const event = {
          type: 'api_proxy',
          requestId,
          method,
          url: req.url,
          host: targetHost,
          status: proxyRes.statusCode,
          duration,
          requestHeaders: sanitizeHeaders(req.headers),
        };

        if (CONFIG.captureResponseBodies) {
          event.responseBody = responseCapture.capture(method, req.url, proxyRes.statusCode, proxyRes.headers, responseBody);
          event.contentType = proxyRes.headers['content-type'] || null;
          event.contentLength = parseInt(proxyRes.headers['content-length'] || '0', 10);
        }

        sender.send([event]);
      });

      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
      const duration = Date.now() - startTime;
      sender.send([{
        type: 'api_proxy',
        requestId,
        method,
        url: req.url,
        host: targetHost,
        status: 0,
        duration,
        error: err.message,
      }]);

      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy error: ' + err.message }));
    });

    req.pipe(proxyReq, { end: true });
  });
});

server.listen(CONFIG.proxyPort, () => {
  console.log(`[API Proxy] Listening on port ${CONFIG.proxyPort}`);
  console.log(`[API Proxy] Upload endpoint: ${CONFIG.uploadEndpoint}`);
  sender.send([{ type: 'api_proxy', action: 'start', port: CONFIG.proxyPort }]);
});

server.on('error', (err) => {
  console.error('[API Proxy] Server error:', err.message);
  sender.send([{ type: 'api_proxy', action: 'error', error: err.message }]);
});

function sanitizeHeaders(headers) {
  if (!headers) return {};
  const sensitive = /authorization|cookie|set-cookie|x-api-key|x-auth-token|api-key|secret/i;
  const safe = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key === 'x-bug-monitor-auth') continue;
    safe[key] = sensitive.test(key) ? '[REDACTED]' : value;
  }
  return safe;
}

process.on('SIGINT', () => {
  console.log('[API Proxy] Shutting down...');
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => process.exit(0));
