"use client";

import React from 'react';
import { useAuth } from '../layout';

export default function SessionsExplorer() {
  const [sessions, setSessions] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const authContext = useAuth();

  React.useEffect(() => {
    async function fetchSessions() {
      const auth = authContext?.token || localStorage.getItem('bug_monitor_auth');
      const offset = (page - 1) * 30;
      let url = `http://localhost:4000/v1/sessions?limit=30&offset=${offset}`;
      
      // Only filter by search if provided
      if (search) {
        url += `&origin=${encodeURIComponent(search)}`;
      }

      try {
        const res = await fetch(url, {
          headers: { 'x-bug-monitor-auth': auth }
        });
        if (res.ok) {
          const data = await res.json();
          setSessions(data.list || []);
          setTotal(data.total || 0);
          setErrorMsg('');
        } else {
          setErrorMsg('Failed to fetch session list. Unauthenticated.');
        }
      } catch (err) {
        setErrorMsg('Cannot connect to backend server. Make sure it is running on port 4000.');
      } finally {
        setLoading(false);
      }
    }

    const timer = setTimeout(fetchSessions, search ? 300 : 0); // Debounce searches
    
    // Set up interval for live updates (refresh every second)
    const interval = setInterval(fetchSessions, 1000);
    
    // Cleanup both timeout and interval
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [search, page, authContext?.token, authContext?.activeDomain]);

  const handleRowClick = (sessionId) => {
    window.location.href = `/sessions/${sessionId}`;
  };

  // Helper to format session duration
  const formatDuration = (start, end) => {
    const diff = end - start;
    if (diff < 1000) return '1s';
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const secLeft = sec % 60;
    if (min < 60) return `${min}m ${secLeft}s`;
    const hrs = Math.floor(min / 60);
    const minLeft = min % 60;
    return `${hrs}h ${minLeft}m`;
  };

  const formatTimeAgo = (ts) => {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    const min = Math.floor(diff / 60000);
    if (min < 60) return `${min}m ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(ts).toLocaleDateString();
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Forensic Sessions Explorer</h1>
          <p className="page-subtitle">Inspect user browsing journeys and complete session reconstructions</p>
        </div>
      </div>

      {errorMsg && (
        <div className="error-banner" style={{ marginBottom: '24px' }}>
          <strong>Error:</strong> {errorMsg}
        </div>
      )}

      {/* Filter panel */}
      <div className="card" style={{ padding: '16px', marginBottom: '24px', display: 'flex', gap: '16px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flexGrow: 1 }}>
          <input
            type="text"
            className="input-text"
            placeholder="Search by site origin (e.g. iswaran.com)..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={{ paddingLeft: '40px' }}
          />
          <div style={{ position: 'absolute', left: '14px', top: '12px', color: 'var(--text-muted)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </div>
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          Total Sessions: <strong style={{ color: '#fff' }}>{total}</strong>
        </div>
      </div>

      {/* Table grid */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: '32px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>Filtering sessions database...</div>
        ) : sessions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🔎</div>
            <div className="empty-text">No forensic sessions found. Try visiting a registered site with the extension enabled!</div>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Origin / Site Domain</th>
                  <th>Session Reference Key</th>
                  <th>Timeline Duration</th>
                  <th style={{ textAlign: 'center' }}>Captured Events</th>
                  <th>First Activity</th>
                  <th>Last Captured</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.sessionId} onClick={() => handleRowClick(s.sessionId)}>
                    <td style={{ color: 'var(--primary)', fontWeight: '600' }}>{s.origin}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                      <code style={{ background: 'rgba(255,255,255,0.03)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                        {s.sessionId}
                      </code>
                    </td>
                    <td style={{ fontFamily: 'monospace' }}>{formatDuration(s.startedAt, s.lastSeen)}</td>
                    <td style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: '700' }}>
                      <span className="badge badge-performance" style={{ background: 'rgba(99,102,241,0.08)', color: 'var(--primary)' }}>
                        {s.eventCount || 0}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {new Date(s.startedAt).toLocaleString()}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {formatTimeAgo(s.lastSeen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination controls */}
      {total > 30 && (
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
            Page {page} of {Math.ceil(total / 30)}
          </span>
          <button
            className="btn-primary"
            onClick={() => setPage(p => (p * 30 < total ? p + 1 : p))}
            disabled={page * 30 >= total}
            style={{ padding: '8px 16px', background: page * 30 >= total ? 'rgba(255,255,255,0.02)' : 'var(--primary)', color: page * 30 >= total ? 'var(--text-muted)' : '#fff', cursor: page * 30 >= total ? 'default' : 'pointer' }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
