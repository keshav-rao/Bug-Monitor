"use client";

import React from 'react';
import { useAuth } from '../layout';

export default function ErrorAnalysis() {
  const [errors, setErrors] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState('');
  const [expandedError, setExpandedError] = React.useState(null);

  const authContext = useAuth();

  React.useEffect(() => {
    async function fetchErrors() {
      const auth = authContext?.token || localStorage.getItem('bug_monitor_auth');
      // Don't filter by origin by default - show all data
      const originQuery = '';
      
      try {
        const res = await fetch(`http://localhost:4000/v1/errors${originQuery}`, {
          headers: { 'x-bug-monitor-auth': auth }
        });
        if (res.ok) {
          const data = await res.json();
          setErrors(data || []);
          setErrorMsg('');
        } else {
          setErrorMsg('Failed to load error groupings. Unauthenticated.');
        }
      } catch (err) {
        setErrorMsg('Unable to establish connection with server API database at port 4000.');
      } finally {
        setLoading(false);
      }
    }
    
    // Fetch immediately on mount
    fetchErrors();
    
    // Set up interval to fetch every second for live updates
    const interval = setInterval(fetchErrors, 1000);
    
    // Cleanup interval on unmount
    return () => clearInterval(interval);
  }, [authContext?.token, authContext?.activeDomain]);

  const toggleErrorDetails = (idx) => {
    setExpandedError(prev => (prev === idx ? null : idx));
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ color: 'var(--error)' }}>Forensic Error Analysis</h1>
          <p className="page-subtitle">Deduplicated runtime exceptions and stack traces aggregated by frequency and severity</p>
        </div>
      </div>

      {errorMsg && (
        <div className="error-banner" style={{ marginBottom: '24px' }}>
          <strong>Error:</strong> {errorMsg}
        </div>
      )}

      {/* Main Container */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Aggregated Unique Exceptions Found: <strong style={{ color: '#fff' }}>{errors.length}</strong>
          </span>
        </div>

        {loading ? (
          <div style={{ padding: '32px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>Executing error deduplication engine...</div>
        ) : errors.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎉</div>
            <div className="empty-text">Zero runtime exceptions recorded in the telemetry base! Beautiful health score.</div>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Origin Site</th>
                  <th>Forensic Crash Exception</th>
                  <th>Source File Reference</th>
                  <th style={{ textAlign: 'center' }}>Total Counts</th>
                  <th style={{ textAlign: 'center' }}>Affected Journeys</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((err, idx) => {
                  const isExpanded = expandedError === idx;
                  return (
                    <React.Fragment key={idx}>
                      <tr onClick={() => toggleErrorDetails(idx)}>
                        <td style={{ color: 'var(--primary)', fontWeight: '500', fontSize: '0.85rem' }}>{err.origin}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', maxWidth: '400px', wordBreak: 'break-all' }}>
                          <span className="badge badge-error" style={{ marginRight: '8px' }}>CRITICAL</span>
                          <strong>{err.message}</strong>
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontFamily: 'monospace' }}>
                          {err.file ? err.file.split('/').pop() : 'Anonymous Block / WebRequest'}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: '700', color: 'var(--error)' }}>
                          {err.count}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace', color: 'var(--purple)', fontWeight: '600' }}>
                          {err.sessionCount}
                        </td>
                      </tr>

                      {/* Expanded Trace and Timeline Link */}
                      {isExpanded && (
                        <tr>
                          <td colSpan="5" style={{ background: 'rgba(0,0,0,0.18)', cursor: 'default', padding: '24px' }} onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                              
                              {/* Source Reference Details */}
                              {err.file && (
                                <div>
                                  <h4 style={{ fontSize: '0.85rem', fontWeight: '600', color: '#fff', marginBottom: '8px' }}>CRASH SOURCE LOCATOR</h4>
                                  <code style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: '6px', fontSize: '0.82rem', color: 'var(--primary)', display: 'block', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                    {err.file}
                                  </code>
                                </div>
                              )}

                              {/* Stack Trace */}
                              {err.stack && (
                                <div>
                                  <h4 style={{ fontSize: '0.85rem', fontWeight: '600', color: '#fff', marginBottom: '8px' }}>TRACE EXECUTION STACK</h4>
                                  <pre style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '0.78rem', fontFamily: 'monospace', overflowX: 'auto', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>
                                    {err.stack}
                                  </pre>
                                </div>
                              )}

                              {/* Impacted Timelines */}
                              <div>
                                <h4 style={{ fontSize: '0.85rem', fontWeight: '600', color: '#fff', marginBottom: '8px' }}>IMPACTED TIMELINE JOURNEYS (CHRONOLOGICAL RE-ENACTMENT)</h4>
                                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                  {err.sessions.map((sId) => (
                                    <a
                                      key={sId}
                                      href={`/sessions/${sId}`}
                                      className="badge badge-performance"
                                      style={{ textDecoration: 'none', background: 'rgba(99,102,241,0.08)', color: 'var(--primary)', border: '1px solid rgba(99,102,241,0.15)', padding: '8px 12px', cursor: 'pointer', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.75rem' }}
                                    >
                                      Session {sId.slice(0, 8)}... Timeline →
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
