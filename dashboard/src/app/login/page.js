"use client";

import React from 'react';
import { useAuth } from '../layout';

export default function LoginPage() {
  const ctx = useAuth();

  const [mode, setMode] = React.useState('admin'); // 'admin' | 'developer'
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [monitoringKey, setMonitoringKey] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  // If already logged in, redirect
  React.useEffect(() => {
    if (ctx?.auth?.token) {
      window.location.replace('/dashboard');
    }
  }, [ctx?.auth?.token]);

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${ctx?.api || 'http://localhost:4000'}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (res.ok) {
        ctx.setAuth(data.token, data.user);
        window.location.replace('/authority/projects');
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (err) {
      setError('Cannot connect to backend server. Is it running on port 4000?');
    } finally {
      setLoading(false);
    }
  };

  const handleDevLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${ctx?.api || 'http://localhost:4000'}/v1/auth/project-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, monitoringKey })
      });
      const data = await res.json();
      if (res.ok) {
        ctx.setAuth(data.token, {
          role: 'developer',
          name: data.project.name,
          email: `project:${data.project.id}`
        }, data.project.id);
        window.location.replace('/dashboard');
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (err) {
      setError('Cannot connect to backend server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-logo">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h2 className="auth-title">Bug Monitor</h2>
        <p className="auth-subtitle">Universal Observability Platform</p>

        {error && <div className="error-banner">{error}</div>}

        {/* Mode Toggle */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '4px' }}>
          <button
            onClick={() => setMode('admin')}
            style={{
              flex: 1, padding: '8px', borderRadius: '6px', border: 'none',
              background: mode === 'admin' ? 'var(--primary)' : 'transparent',
              color: mode === 'admin' ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer', fontWeight: mode === 'admin' ? '600' : '400', fontSize: '0.85rem'
            }}
          >Administrator</button>
          <button
            onClick={() => setMode('developer')}
            style={{
              flex: 1, padding: '8px', borderRadius: '6px', border: 'none',
              background: mode === 'developer' ? 'var(--primary)' : 'transparent',
              color: mode === 'developer' ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer', fontWeight: mode === 'developer' ? '600' : '400', fontSize: '0.85rem'
            }}
          >Developer</button>
        </div>

        {mode === 'admin' ? (
          <form onSubmit={handleAdminLogin}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input type="email" className="input-text" placeholder="admin@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input type="password" className="input-text" placeholder="Enter password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '10px' }} disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleDevLogin}>
            <div className="form-group">
              <label className="form-label">Project ID</label>
              <input type="text" className="input-text" placeholder="PROJ-1001" value={projectId} onChange={(e) => setProjectId(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Monitoring Key</label>
              <input type="password" className="input-text" placeholder="BM_..." value={monitoringKey} onChange={(e) => setMonitoringKey(e.target.value)} required />
            </div>
            <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '10px' }} disabled={loading}>
              {loading ? 'Connecting...' : 'Access Project'}
            </button>
          </form>
        )}

        <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {mode === 'admin' ? (
            <>Don't have an account? <a href="/register" style={{ color: 'var(--primary)' }}>Register here</a></>
          ) : (
            <>Ask your administrator for a Project ID and Monitoring Key</>
          )}
        </div>
      </div>
    </div>
  );
}
