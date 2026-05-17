"use client";

import React from 'react';
import { useAuth } from '../layout';

export default function EventQueryLog() {
  const [events, setEvents] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState('');
  
  // Query Filters State
  const [type, setType] = React.useState('all');
  const [origin, setOrigin] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [since, setSince] = React.useState('');
  const [until, setUntil] = React.useState('');
  const [page, setPage] = React.useState(1);

  // Expandable events
  const [expandedRows, setExpandedRows] = React.useState({});
  const authContext = useAuth();

  React.useEffect(() => {
    async function fetchEvents() {
      const auth = authContext?.token || localStorage.getItem('bug_monitor_auth');
      const offset = (page - 1) * 50;
      let url = `http://localhost:4000/v1/events?limit=50&offset=${offset}`;

      const combinedOrigin = origin || authContext?.activeDomain;

      if (type !== 'all') url += `&type=${encodeURIComponent(type)}`;
      if (combinedOrigin) url += `&origin=${encodeURIComponent(combinedOrigin)}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      if (since) url += `&since=${new Date(since).getTime()}`;
      if (until) url += `&until=${new Date(until).getTime()}`;

      try {
        const res = await fetch(url, {
          headers: { 'x-bug-monitor-auth': auth }
        });
        if (res.ok) {
          const data = await res.json();
          setEvents(data.list || []);
          setTotal(data.total || 0);
        } else {
          setErrorMsg('Failed to query logs database. Check session token.');
        }
      } catch (err) {
        setErrorMsg('Unable to reach local API server at port 4000.');
      } finally {
        setLoading(false);
      }
    }

    const timer = setTimeout(fetchEvents, 300); // 300ms debounce
    return () => clearTimeout(timer);
  }, [type, origin, search, since, until, page]);

  const toggleRow = (id) => {
    setExpandedRows(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const getFriendlyMessage = (e) => {
    switch (e.type) {
      case 'console': {
        const args = Array.isArray(e.args) ? e.args.join(' ') : e.message || '';
        return `[${e.level || 'log'}] ${args}`.slice(0, 160);
      }
      case 'network': {
        const status = e.status ? `[${e.status}]` : '';
        const dur = e.duration ? `(${e.duration}ms)` : '';
        const method = e.method || 'GET';
        if (e.subtype?.includes('error') || e.error) {
          return `✗ ${method} ${e.url || e.name || ''} — ${e.error || 'Network Error'}`.slice(0, 160);
        }
        return `← ${method} ${status} ${e.url || e.name || ''} ${dur}`.slice(0, 160);
      }
      case 'error': {
        if (e.subtype === 'csp_violation') {
          return `CSP: '${e.blockedURI}' blocked via ${e.violatedDirective}`.slice(0, 160);
        }
        if (e.subtype === 'resource_load_error') {
          return `Failed to load <${e.tag || 'resource'}>: ${e.src || ''}`.slice(0, 160);
        }
        return `${e.message || e.subtype || 'Unhandled exception'}`.slice(0, 160);
      }
      case 'interaction':
        return `${e.action} on ${e.target?.tag || 'element'} ${e.target?.text ? `"${e.target.text.slice(0, 30)}"` : ''}`;
      case 'memory':
        return `Heap: ${(e.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB / ${(e.totalJSHeapSize / 1024 / 1024).toFixed(1)}MB (${e.usedPercent}%)`;
      case 'storage':
        return `${e.storageType}.${e.action}(${e.key || ''})`;
      case 'source':
        return `${e.action}: ${e.src || e.href || e.scriptURL || ''}`.slice(0, 160);
      case 'lifecycle':
        return `${e.action} → ${e.url || ''}`.slice(0, 160);
      case 'dom':
        return `${e.count} DOM mutations observed on element <${e.samples?.[0]?.target?.tag || 'div'}>`;
      default:
        return JSON.stringify(e).slice(0, 160);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Event Query Log</h1>
          <p className="page-subtitle">Granular semantic search across all captured events, actions, and runtime logs</p>
        </div>
      </div>

      {errorMsg && (
        <div className="error-banner" style={{ marginBottom: '24px' }}>
          <strong>Error:</strong> {errorMsg}
        </div>
      )}

      {/* Filter Matrix Card */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h3 className="card-title" style={{ fontSize: '0.9rem', marginBottom: '16px' }}>Filter Matrix</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Event Type</label>
            <select
              className="input-text"
              value={type}
              onChange={(e) => { setType(e.target.value); setPage(1); }}
              style={{ background: 'rgba(0,0,0,0.3)', color: '#fff', cursor: 'pointer' }}
            >
              <option value="all">All Telemetry Types</option>
              <option value="console">Console API Logs</option>
              <option value="network">Network (Fetch/XHR/WS)</option>
              <option value="error">Exceptions & CSP Blocks</option>
              <option value="interaction">Interactions (Clicks/Fills)</option>
              <option value="performance">Performance Observers</option>
              <option value="storage">Storage Mutations</option>
              <option value="lifecycle">SPA Lifecycles</option>
              <option value="dom">DOM Mutation Observers</option>
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Site Origin</label>
            <input
              type="text"
              className="input-text"
              placeholder="e.g. iswaran.com"
              value={origin}
              onChange={(e) => { setOrigin(e.target.value); setPage(1); }}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Since (Date/Time)</label>
            <input
              type="datetime-local"
              className="input-text"
              value={since}
              onChange={(e) => { setSince(e.target.value); setPage(1); }}
              style={{ colorScheme: 'dark' }}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Until (Date/Time)</label>
            <input
              type="datetime-local"
              className="input-text"
              value={until}
              onChange={(e) => { setUntil(e.target.value); setPage(1); }}
              style={{ colorScheme: 'dark' }}
            />
          </div>

        </div>

        <div style={{ position: 'relative', marginTop: '20px' }}>
          <input
            type="text"
            className="input-text"
            placeholder="Full-text query search inside JSON payload properties (e.g. 'status', variable values)..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={{ paddingLeft: '40px' }}
          />
          <div style={{ position: 'absolute', left: '14px', top: '12px', color: 'var(--text-muted)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </div>
        </div>
      </div>

      {/* Query Results Table */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Showing page <strong style={{ color: '#fff' }}>{page}</strong> · Matches found: <strong style={{ color: 'var(--primary)' }}>{total.toLocaleString()}</strong>
          </span>
        </div>

        {loading ? (
          <div style={{ padding: '32px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>Executing index scan query...</div>
        ) : events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📡</div>
            <div className="empty-text">No captured logs found matching selected constraints.</div>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Domain</th>
                  <th>Type</th>
                  <th>Semantic Log Summary</th>
                  <th style={{ textAlign: 'center' }}>Inspect Context</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const isExpanded = !!expandedRows[e.id];
                  const msg = getFriendlyMessage(e);
                  const isErr = e.type === 'error' || e.level === 'error' || e.ok === false;
                  
                  return (
                    <React.Fragment key={e.id}>
                      <tr onClick={() => toggleRow(e.id)}>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                          {new Date(e.ts).toLocaleTimeString()}
                        </td>
                        <td style={{ color: 'var(--primary)', fontSize: '0.85rem' }}>{e.origin}</td>
                        <td>
                          <span className={`badge badge-${e.type || 'console'}`}>
                            {e.type}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: isErr ? 'var(--error)' : e.level === 'warn' ? 'var(--warn)' : '#fff', wordBreak: 'break-all', maxWidth: '500px' }}>
                          {msg}
                        </td>
                        <td style={{ textAlign: 'center' }} onClick={(evt) => evt.stopPropagation()}>
                          <a
                            href={`/sessions/${e.sessionId}`}
                            className="badge badge-performance"
                            style={{ textDecoration: 'none', background: 'rgba(99,102,241,0.08)', color: 'var(--primary)', padding: '6px 10px', cursor: 'pointer' }}
                          >
                            Timeline →
                          </a>
                        </td>
                      </tr>

                      {/* Expanded View */}
                      {isExpanded && (
                        <tr>
                          <td colSpan="5" style={{ background: 'rgba(0,0,0,0.15)', cursor: 'default', padding: '16px' }} onClick={(evt) => evt.stopPropagation()}>
                            <div className="json-viewer" style={{ margin: 0, maxHeight: '300px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.03)', marginBottom: '8px', fontSize: '0.7rem' }}>
                                <span>ROW LOG REFERENCE KEY: {e.id}</span>
                                <span>FULL JSON</span>
                              </div>
                              <pre>{JSON.stringify(e, null, 2)}</pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {total > 50 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '20px' }}>
          <button
            className="btn-primary"
            onClick={() => setPage(p => Math.max(p - 1, 1))}
            disabled={page === 1}
            style={{ padding: '8px 16px', background: page === 1 ? 'rgba(255,255,255,0.02)' : 'var(--primary)', color: page === 1 ? 'var(--text-muted)' : '#fff', cursor: page === 1 ? 'default' : 'pointer' }}
          >
            Previous
          </button>
          <span style={{ display: 'flex', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-muted)', fontFamily: 'monospace', padding: '0 12px' }}>
            Page {page} of {Math.ceil(total / 50)}
          </span>
          <button
            className="btn-primary"
            onClick={() => setPage(p => (p * 50 < total ? p + 1 : p))}
            disabled={page * 50 >= total}
            style={{ padding: '8px 16px', background: page * 50 >= total ? 'rgba(255,255,255,0.02)' : 'var(--primary)', color: page * 50 >= total ? 'var(--text-muted)' : '#fff', cursor: page * 50 >= total ? 'default' : 'pointer' }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
