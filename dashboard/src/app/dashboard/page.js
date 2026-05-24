"use client";

import React from 'react';
import { useAuth } from '../layout';

export default function DashboardOverview() {
  const [stats, setStats] = React.useState(null);
  const [errors, setErrors] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState('');

  const authContext = useAuth();

  React.useEffect(() => {
    async function fetchData() {
      const auth = authContext?.token || localStorage.getItem('bug_monitor_auth');
      // Don't filter by origin by default - show all data
      const originQuery = '';
      
      try {
        const [statsRes, errorsRes] = await Promise.all([
          fetch(`http://localhost:4000/v1/stats${originQuery}`, {
            headers: { 'x-bug-monitor-auth': auth }
          }),
          fetch(`http://localhost:4000/v1/errors${originQuery}`, {
            headers: { 'x-bug-monitor-auth': auth }
          })
        ]);

        if (statsRes.ok && errorsRes.ok) {
          const statsData = await statsRes.json();
          const errorsData = await errorsRes.json();
          setStats(statsData);
          setErrors(errorsData.slice(0, 5)); // top 5 errors
          setErrorMsg('');
        } else {
          setErrorMsg('Failed to load dashboard metrics. Verify backend authentication.');
        }
      } catch (err) {
        setErrorMsg('Cannot connect to backend server. Is npm run dev running on port 4000?');
      } finally {
        setLoading(false);
      }
    }
    
    // Fetch immediately on mount
    fetchData();
    
    // Set up interval to fetch every second for live updates
    const interval = setInterval(fetchData, 1000);
    
    // Cleanup interval on unmount
    return () => clearInterval(interval);
  }, [authContext?.token, authContext?.activeDomain]);

  if (loading) {
    return <div style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>Loading Forensics overview...</div>;
  }

  if (errorMsg) {
    return (
      <div>
        <h1 className="page-title">Overview</h1>
        <div className="error-banner" style={{ marginTop: '20px', textAlign: 'left' }}>
          <strong>Connection Error:</strong> {errorMsg}
        </div>
      </div>
    );
  }

  // Find max hourly count for scale in our visual graph
  const maxCount = stats?.hourlyData ? Math.max(...stats.hourlyData.map((h) => h.count), 1) : 1;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Forensic Command Center</h1>
          <p className="page-subtitle">Real-time telemetry and web application crash forensics</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="badge badge-performance" style={{ padding: '6px 12px' }}>
            <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--success)', marginRight: '6px', animation: 'pulse 1.5s infinite' }}></span>
            Ingestion Online
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-info">
            <span className="stat-label">Total Events Logs</span>
            <span className="stat-value">{stats?.totalEvents?.toLocaleString() || 0}</span>
          </div>
          <div className="stat-icon primary">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-info">
            <span className="stat-label">Total Sessions</span>
            <span className="stat-value">{stats?.totalSessions?.toLocaleString() || 0}</span>
          </div>
          <div className="stat-icon success">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-info">
            <span className="stat-label">Telemetry Errors</span>
            <span className="stat-value" style={{ color: 'var(--error)' }}>{stats?.totalErrors?.toLocaleString() || 0}</span>
          </div>
          <div className="stat-icon error">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path></svg>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-info">
            <span className="stat-label">Monitored Domains</span>
            <span className="stat-value">{stats?.totalSites || 0}</span>
          </div>
          <div className="stat-icon warn">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line></svg>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
        
        {/* Activity Chart Card */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 className="card-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"></path><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"></path></svg>
            Event Density (Last 24 Hours)
          </h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: '180px', padding: '10px 0', borderBottom: '1px solid var(--border)', flexGrow: 1 }}>
            {stats?.hourlyData?.map((hour, idx) => {
              const heightPercent = Math.max((hour.count / maxCount) * 100, 3);
              return (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: `${100 / 24}%`, height: '100%', justifyContent: 'flex-end', group: 'bar' }} title={`${hour.count} events at ${hour.time}`}>
                  <div style={{
                    width: '60%', 
                    height: `${heightPercent}%`, 
                    background: 'linear-gradient(to top, rgba(99, 102, 241, 0.1), var(--primary))', 
                    borderRadius: '4px 4px 0 0',
                    transition: 'all 0.3s ease',
                    boxShadow: '0 0 8px rgba(99, 102, 241, 0.2)'
                  }}></div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            <span>24 Hours Ago</span>
            <span>Now</span>
          </div>
        </div>

        {/* Current Info Panel */}
        <div className="card">
          <h3 className="card-title">Live Collector Node</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>TELEMETRY ENDPOINT</div>
              <code style={{ fontSize: '0.85rem', color: 'var(--primary)', fontFamily: 'monospace' }}>http://localhost:4000/v1/telemetry/upload</code>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Console Port</span>
              <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>3000 (Localhost)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Active Sessions (30m)</span>
              <span style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--success)' }}>{stats?.activeSessions || 0}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Storage Engine</span>
              <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>SQLite WAL</span>
            </div>
          </div>
        </div>

      </div>

      {/* Recent Errors */}
      <div className="card" style={{ marginTop: '8px' }}>
        <h3 className="card-title" style={{ color: 'var(--error)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path></svg>
          Critical Forensic Highlights (Top Errors Grouped)
        </h3>
        {errors.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎉</div>
            <div className="empty-text">No errors captured in the system! All operations fully functional.</div>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Origin</th>
                  <th>Forensic Exception Message</th>
                  <th style={{ textAlign: 'center' }}>Occurrences</th>
                  <th style={{ textAlign: 'center' }}>Unique Sessions</th>
                  <th>Last Captured</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((err, idx) => (
                  <tr key={idx} onClick={() => window.location.href = '/errors'}>
                    <td style={{ color: 'var(--primary)', fontWeight: '500' }}>{err.origin}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all', maxWidth: '400px' }}>
                      <span className="badge badge-error" style={{ marginRight: '8px' }}>ERR</span>
                      {err.message}
                    </td>
                    <td style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: '700' }}>{err.count}</td>
                    <td style={{ textAlign: 'center', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{err.sessionCount}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(err.lastSeen).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      
      {/* Keyframes/pulse animation */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes pulse {
          0% { transform: scale(0.95); opacity: 0.5; }
          50% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(0.95); opacity: 0.5; }
        }
      `}} />
    </div>
  );
}
