"use client";

import React from 'react';
import { useAuth } from '../layout';

export default function ErrorAnalysis() {
  const ctx = useAuth();
  const [errors, setErrors] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState('');
  const [expandedError, setExpandedError] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [sourceType, setSourceType] = React.useState('');

  React.useEffect(() => {
    async function fetchErrors() {
      const auth = ctx?.token || localStorage.getItem('bug_monitor_token');
      const params = new URLSearchParams();
      if (search) params.set('origin', search);
      if (sourceType) params.set('sourceType', sourceType);
      if (ctx?.activeProject) params.set('projectId', ctx.activeProject);

      try {
        const res = await fetch(`${ctx?.api || 'http://localhost:4000'}/v1/errors?${params}`, {
          headers: { 'x-bug-monitor-auth': `Bearer ${auth}` }
        });
        if (res.ok) {
          const data = await res.json();
          setErrors(data || []);
          setErrorMsg('');
        } else {
          setErrorMsg('Failed to load error groupings.');
        }
      } catch (err) {
        setErrorMsg('Unable to establish connection with server API.');
      } finally {
        setLoading(false);
      }
    }

    fetchErrors();
    const interval = setInterval(fetchErrors, 1000);
    return () => clearInterval(interval);
  }, [ctx?.token, ctx?.activeProject, search, sourceType]);

  const toggleErrorDetails = (idx) => {
    setExpandedError(prev => (prev === idx ? null : idx));
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ color: 'var(--error)' }}>Forensic Error Analysis</h1>
          <p className="page-subtitle">Deduplicated runtime exceptions across all monitoring sources</p>
        </div>
      </div>

      {errorMsg && <div className="error-banner" style={{ marginBottom: '24px' }}><strong>Error:</strong> {errorMsg}</div>}

      <div className="card" style={{ padding: '16px', marginBottom: '24px', display: 'flex', gap: '16px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flexGrow: 1 }}>
          <input type="text" className="input-text" placeholder="Filter by origin..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: '40px' }} />
          <div style={{ position: 'absolute', left: '14px', top: '12px', color: 'var(--text-muted)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </div>
        </div>
        <select value={sourceType} onChange={(e) => setSourceType(e.target.value)}
          style={{ background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
          <option value="">All Sources</option>
          <option value="browser">Browser</option>
          <option value="sap">SAP</option>
          <option value="desktop">Desktop</option>
          <option value="api">API</option>
        </select>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          Errors: <strong style={{ color: '#fff' }}>{errors.length}</strong>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: '32px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>Executing error deduplication engine...</div>
        ) : errors.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎉</div>
            <div className="empty-text">Zero runtime exceptions recorded!</div>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Origin</th>
                  <th>Source</th>
                  <th>Exception</th>
                  <th>File</th>
                  <th style={{ textAlign: 'center' }}>Count</th>
                  <th style={{ textAlign: 'center' }}>Sessions</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((err, idx) => {
                  const isExpanded = expandedError === idx;
                  return (
                    <React.Fragment key={idx}>
                      <tr onClick={() => toggleErrorDetails(idx)}>
                        <td style={{ color: 'var(--primary)', fontWeight: '500', fontSize: '0.85rem' }}>{err.origin}</td>
                        <td><span className={`badge badge-${err.sourceType === 'browser' ? 'performance' : err.sourceType === 'sap' ? 'warn' : 'info'}`}>{err.sourceType || 'browser'}</span></td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', maxWidth: '400px', wordBreak: 'break-all' }}>
                          <span className="badge badge-error" style={{ marginRight: '8px' }}>CRITICAL</span>
                          <strong>{err.message}</strong>
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontFamily: 'monospace' }}>
                          {err.file ? err.file.split('/').pop() : '—'}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: '700', color: 'var(--error)' }}>{err.count}</td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace', color: 'var(--purple)', fontWeight: '600' }}>{err.sessionCount}</td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan="6" style={{ background: 'rgba(0,0,0,0.18)', cursor: 'default', padding: '24px' }} onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                              {err.file && (
                                <div>
                                  <h4 style={{ fontSize: '0.85rem', fontWeight: '600', color: '#fff', marginBottom: '8px' }}>SOURCE LOCATOR</h4>
                                  <code style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: '6px', fontSize: '0.82rem', color: 'var(--primary)', display: 'block', fontFamily: 'monospace', wordBreak: 'break-all' }}>{err.file}</code>
                                </div>
                              )}
                              {err.stack && (
                                <div>
                                  <h4 style={{ fontSize: '0.85rem', fontWeight: '600', color: '#fff', marginBottom: '8px' }}>STACK TRACE</h4>
                                  <pre style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '0.78rem', fontFamily: 'monospace', overflowX: 'auto', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{err.stack}</pre>
                                </div>
                              )}
                              <div>
                                <h4 style={{ fontSize: '0.85rem', fontWeight: '600', color: '#fff', marginBottom: '8px' }}>AFFECTED SESSIONS</h4>
                                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                  {err.sessions.map((sId) => (
                                    <a key={sId} href={`/sessions/${sId}`}
                                      className="badge badge-performance"
                                      style={{ textDecoration: 'none', background: 'rgba(99,102,241,0.08)', color: 'var(--primary)', border: '1px solid rgba(99,102,241,0.15)', padding: '8px 12px', cursor: 'pointer', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                      Session {sId.slice(0, 8)}... →
                                    </a>
                                  ))}
                                </div>
                              </div>
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
    </div>
  );
}
