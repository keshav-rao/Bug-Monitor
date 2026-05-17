"use client";

import React from 'react';

export default function SessionTimeline({ params }) {
  const sessionId = params.id;
  
  const [session, setSession] = React.useState(null);
  const [events, setEvents] = React.useState([]);
  const [filter, setFilter] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [expandedEvents, setExpandedEvents] = React.useState({});
  const [loading, setLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState('');

  React.useEffect(() => {
    async function fetchSessionData() {
      const auth = localStorage.getItem('bug_monitor_auth');
      try {
        const [sessionRes, eventsRes] = await Promise.all([
          fetch(`http://localhost:4000/v1/sessions/${sessionId}`, {
            headers: { 'x-bug-monitor-auth': auth }
          }),
          fetch(`http://localhost:4000/v1/sessions/${sessionId}/events`, {
            headers: { 'x-bug-monitor-auth': auth }
          })
        ]);

        if (sessionRes.ok && eventsRes.ok) {
          const sessionData = await sessionRes.json();
          const eventsData = await eventsRes.json();
          setSession(sessionData);
          setEvents(eventsData || []);
        } else {
          setErrorMsg('Failed to reconstruct session history. Authenticate or reload.');
        }
      } catch (err) {
        setErrorMsg('Cannot communicate with local API backend server. Check if port 4000 is open.');
      } finally {
        setLoading(false);
      }
    }
    fetchSessionData();
  }, [sessionId]);

  const toggleExpand = (id) => {
    setExpandedEvents(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Helper to format event timestamps relative to session start
  const getRelativeTime = (ts) => {
    if (!session) return '0s';
    const diff = ts - session.startedAt;
    if (diff < 1000) return '0.0s';
    return `+${(diff / 1000).toFixed(1)}s`;
  };

  const getEventBadgeClass = (type) => {
    return `badge badge-${type || 'console'}`;
  };

  const getDotClass = (type) => {
    return `timeline-dot ${type || 'console'}`;
  };

  // Helper to extract a friendly summary message for the timeline row
  const getFriendlyMessage = (e) => {
    switch (e.type) {
      case 'console': {
        const args = Array.isArray(e.args) ? e.args.join(' ') : e.message || '';
        return `[${e.level || 'log'}] ${args}`;
      }
      case 'network': {
        const status = e.status ? `[${e.status}]` : '';
        const dur = e.duration ? `(${e.duration}ms)` : '';
        const method = e.method || 'GET';
        if (e.subtype?.includes('error') || e.error) {
          return `✗ ${method} ${e.url || e.name || ''} — ${e.error || 'Network Error'}`;
        }
        return `← ${method} ${status} ${e.url || e.name || ''} ${dur}`;
      }
      case 'error': {
        if (e.subtype === 'csp_violation') {
          return `CSP Blocked: '${e.blockedURI}' via directive '${e.violatedDirective}'`;
        }
        if (e.subtype === 'resource_load_error') {
          return `Failed to load <${e.tag || 'resource'}>: ${e.src || ''}`;
        }
        return `${e.message || e.subtype || 'Unhandled runtime exception'}`;
      }
      case 'interaction':
        return `${e.action} on ${e.target?.tag || 'element'} ${e.target?.text ? `"${e.target.text.slice(0, 30)}"` : ''}`;
      case 'memory':
        return `Memory Check: Heap Used: ${(e.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB / Total: ${(e.totalJSHeapSize / 1024 / 1024).toFixed(1)}MB`;
      case 'storage':
        return `${e.storageType}.${e.action}(${e.key || ''})`;
      case 'source':
        return `${e.action}: ${e.src || e.href || e.scriptURL || ''}`;
      case 'lifecycle':
        return `Page state transition: ${e.action} → ${e.url || ''}`;
      case 'dom':
        return `${e.count} DOM mutations observed on element <${e.samples?.[0]?.target?.tag || 'div'}>`;
      default:
        return JSON.stringify(e);
    }
  };

  // Filter & Search logic
  const filteredEvents = events.filter(e => {
    // 1. Type Filter
    let matchesType = true;
    if (filter !== 'all') {
      if (filter === 'network') {
        matchesType = e.type === 'network' || (e.type === 'performance' && e.entryType === 'resource');
      } else if (filter === 'performance') {
        matchesType = e.type === 'performance' && e.entryType !== 'resource';
      } else if (filter === 'error') {
        matchesType = e.type === 'error' || (e.type === 'network' && e.subtype?.includes('error'));
      } else {
        matchesType = e.type === filter;
      }
    }
    
    // 2. Search Text
    let matchesSearch = true;
    if (search) {
      const msg = getFriendlyMessage(e).toLowerCase();
      const payloadString = JSON.stringify(e).toLowerCase();
      const term = search.toLowerCase();
      matchesSearch = msg.includes(term) || payloadString.includes(term);
    }

    return matchesType && matchesSearch;
  });

  if (loading) {
    return <div style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>Reconstructing flight timeline...</div>;
  }

  if (errorMsg) {
    return (
      <div className="error-banner">
        <strong>Error:</strong> {errorMsg}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <a href="/sessions" style={{ color: 'var(--primary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: '600', marginBottom: '8px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            Back to Sessions
          </a>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            Session Timeline Reconstruct
          </h1>
          <p className="page-subtitle">Chronological forensic replay of all interactions, execution processes, and network cycles</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: '24px', alignItems: 'start' }}>
        
        {/* Left Side: Metadata & Breakdown Panel */}
        <div style={{ position: 'sticky', top: '24px' }}>
          
          {/* Metadata Card */}
          <div className="card">
            <h3 className="card-title">Session Header</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.85rem' }}>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: '4px' }}>SESSION ID</div>
                <code style={{ fontFamily: 'monospace', display: 'block', wordBreak: 'break-all', padding: '6px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.78rem' }}>
                  {session?.sessionId}
                </code>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Site Origin</span>
                <span style={{ fontWeight: '600', color: 'var(--primary)' }}>{session?.origin}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Started At</span>
                <span>{new Date(session?.startedAt).toLocaleTimeString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Total Lifespan</span>
                <span>{((session?.lastSeen - session?.startedAt) / 1000).toFixed(1)}s</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Captured Logs</span>
                <span style={{ fontWeight: '700' }}>{session?.eventCount}</span>
              </div>
            </div>
          </div>

          {/* Breakdown Card */}
          <div className="card">
            <h3 className="card-title">Density Profile</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {session?.breakdown && Object.entries(session.breakdown).length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No telemetry breakdown available</div>
              ) : (
                Object.entries(session?.breakdown || {}).sort((a,b) => b[1] - a[1]).map(([type, count]) => {
                  const maxVal = Math.max(...Object.values(session.breakdown), 1);
                  const barWidth = `${(count / maxVal) * 100}%`;
                  return (
                    <div key={type} style={{ fontSize: '0.82rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', textTransform: 'capitalize' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{type}</span>
                        <strong style={{ fontFamily: 'monospace' }}>{count}</strong>
                      </div>
                      <div style={{ width: '100%', height: '5px', background: 'rgba(255,255,255,0.02)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ width: barWidth, height: '100%', borderRadius: '2px', background: `var(--${type === 'network' ? 'info' : type === 'error' ? 'error' : type === 'interaction' ? 'purple' : type === 'storage' ? 'warn' : type === 'performance' ? 'success' : 'primary'})` }}></div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Timeline Panel */}
        <div>
          
          {/* Filters Bar */}
          <div className="card" style={{ padding: '16px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px', borderBottom: '1px solid var(--border)', marginBottom: '16px' }}>
              {['all', 'console', 'network', 'error', 'interaction', 'performance', 'storage', 'lifecycle', 'dom'].map(btnType => (
                <button
                  key={btnType}
                  onClick={() => setFilter(btnType)}
                  style={{
                    background: filter === btnType ? 'rgba(99,102,241,0.1)' : 'none',
                    border: filter === btnType ? '1px solid var(--primary)' : '1px solid transparent',
                    color: filter === btnType ? '#fff' : 'var(--text-muted)',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    fontWeight: filter === btnType ? '600' : '400',
                    textTransform: 'capitalize',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s'
                  }}
                >
                  {btnType}
                </button>
              ))}
            </div>

            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className="input-text"
                placeholder="Search matching logs, errors, or variables..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: '40px' }}
              />
              <div style={{ position: 'absolute', left: '14px', top: '12px', color: 'var(--text-muted)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              </div>
            </div>
          </div>

          {/* Timeline Feed */}
          <div className="timeline">
            {filteredEvents.length === 0 ? (
              <div className="card" style={{ padding: '32px' }}>
                <div className="empty-state">
                  <div className="empty-icon">📡</div>
                  <div className="empty-text">No timeline events matched the filter filters. Try switching filters or clearing search.</div>
                </div>
              </div>
            ) : (
              filteredEvents.map((e) => {
                const isExpanded = !!expandedEvents[e.id];
                const msg = getFriendlyMessage(e);
                const relTime = getRelativeTime(e.ts);
                const badgeClass = getEventBadgeClass(e.type);
                const dotClass = getDotClass(e.type);

                return (
                  <div key={e.id} className="timeline-item">
                    <div className={dotClass}></div>
                    
                    <div className="timeline-content" onClick={() => toggleExpand(e.id)} style={{ cursor: 'pointer' }}>
                      <div className="timeline-header">
                        <div className="timeline-meta">
                          <span className={badgeClass}>{e.type}</span>
                          {e.subtype && <span className="badge" style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)' }}>{e.subtype}</span>}
                          {e.ok === false && <span className="badge badge-error">FAILED</span>}
                          {e.level === 'error' && <span className="badge badge-error">ERROR</span>}
                          {e.level === 'warn' && <span className="badge badge-storage" style={{ background: 'rgba(234,179,8,0.12)', color: 'var(--warn)' }}>WARN</span>}
                        </div>
                        <div className="timeline-time">{relTime} ({new Date(e.ts).toLocaleTimeString()})</div>
                      </div>

                      <div className="timeline-body" style={{ color: e.level === 'error' || e.ok === false ? 'var(--error)' : e.level === 'warn' ? 'var(--warn)' : '#fff' }}>
                        {msg}
                      </div>

                      {/* Expandable JSON details */}
                      {isExpanded && (
                        <div className="json-viewer" onClick={(evt) => evt.stopPropagation()}>
                          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '6px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                            <span>METADATA EXPOSED SCHEMA</span>
                            <span style={{ color: 'var(--primary)' }}>JSON PAYLOAD</span>
                          </div>
                          <pre>{JSON.stringify(e, null, 2)}</pre>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
