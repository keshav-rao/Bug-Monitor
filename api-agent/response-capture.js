const CONFIG = {
  maxBodySize: 10240,
  captureContentTypes: ['application/json', 'application/xml', 'text/html', 'text/plain', 'application/x-www-form-urlencoded'],
  captureErrorBodies: true,
};

function shouldCapture(method, status, contentType) {
  if (status >= 400 && CONFIG.captureErrorBodies) return true;
  if (!contentType) return true;
  return CONFIG.captureContentTypes.some(ct => contentType.toLowerCase().startsWith(ct));
}

function truncate(body) {
  if (!body) return null;
  if (typeof body !== 'string') return String(body);
  return body.length > CONFIG.maxBodySize
    ? body.slice(0, CONFIG.maxBodySize) + '...'
    : body;
}

function annotateStatus(status) {
  if (status >= 500) return { severity: 'error', label: 'SERVER_ERROR' };
  if (status >= 400) return { severity: 'warn', label: 'CLIENT_ERROR' };
  if (status >= 300) return { severity: 'info', label: 'REDIRECT' };
  if (status >= 200) return { severity: 'info', label: 'SUCCESS' };
  return { severity: 'info', label: 'UNKNOWN' };
}

function capture(method, url, status, headers, body) {
  const contentType = headers?.['content-type'] || headers?.['Content-Type'] || '';
  const statusInfo = annotateStatus(status);

  const result = {
    statusCode: status,
    statusLabel: statusInfo.label,
    severity: statusInfo.severity,
    truncated: false,
  };

  if (shouldCapture(method, status, contentType)) {
    const captured = truncate(body);
    if (captured !== null) {
      result.body = captured;
      result.truncated = captured.endsWith('...');
    }
  }

  if (status >= 400) {
    try {
      if (body && typeof body === 'string') {
        const parsed = JSON.parse(body);
        result.errorMessage = parsed.error || parsed.message || parsed.errorMessage || null;
        result.errorCode = parsed.code || parsed.status || null;
      }
    } catch (e) {}
  }

  result.contentType = contentType;
  return result;
}

module.exports = { capture, shouldCapture, truncate, annotateStatus };
