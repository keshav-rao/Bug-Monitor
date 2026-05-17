"use client";


import './globals.css';
import React from 'react';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <title>Bug Monitor — Failure Forensics Dashboard</title>
        <meta name="description" content="Forensic debugging platform and timeline analysis for web applications." />
      </head>
      <body style={{ display: 'block', height: '100vh', margin: 0 }}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}

// ─── Simple Auth Wrapper & Sidebar Layout ────────────────────────────────────

const AuthContext = React.createContext(null);

export function useAuth() {
  return React.useContext(AuthContext);
}

function AuthProvider({ children }) {
  const [auth, setAuth] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [activePath, setActivePath] = React.useState('/dashboard');
  
  // Domain Filter State
  const [activeDomain, setActiveDomain] = React.useState('');
  const [sites, setSites] = React.useState([]);

  React.useEffect(() => {
    const saved = localStorage.getItem('bug_monitor_auth');
    if (saved) {
      setAuth(saved);
      fetchSites(saved);
    }
    const savedDomain = localStorage.getItem('bug_monitor_domain');
    if (savedDomain) {
      setActiveDomain(savedDomain);
    }
    setLoading(false);

    // Set initial active path based on current window location
    if (typeof window !== 'undefined') {
      setActivePath(window.location.pathname);
    }
  }, []);

  const fetchSites = async (token) => {
    try {
      const res = await fetch('http://localhost:4000/v1/sites', {
        headers: { 'x-bug-monitor-auth': token }
      });
      if (res.ok) {
        const data = await res.json();
        setSites(data || []);
      }
    } catch (err) {}
  };

  const handleDomainChange = (e) => {
    const val = e.target.value;
    setActiveDomain(val);
    localStorage.setItem('bug_monitor_domain', val);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('http://localhost:4000/v1/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        localStorage.setItem('bug_monitor_auth', password);
        setAuth(password);
        fetchSites(password);
      } else {
        setError('Invalid password. Please try again.');
      }
    } catch (err) {
      setError('Cannot connect to backend API server at localhost:4000. Make sure the backend is running!');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('bug_monitor_auth');
    setAuth(null);
  };

  if (loading) {
    return (
      <div className="auth-wrapper">
        <div style={{ fontFamily: 'monospace', color: '#94a3b8' }}>Initializing Forensics...</div>
      </div>
    );
  }

  // Render Login screen if not authenticated
  if (!auth) {
    return (
      <div className="auth-wrapper">
        <div className="auth-card">
          <div className="auth-logo">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <h2 className="auth-title">Bug Monitor</h2>
          <p className="auth-subtitle">Failure Forensics Platform</p>
          
          {error && <div className="error-banner">{error}</div>}

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">Security Password</label>
              <input
                type="password"
                className="input-text"
                placeholder="Enter password..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                required
              />
            </div>
            <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '10px' }}>
              Verify Access Key
            </button>
          </form>
          <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Default Local Key: <code style={{ color: 'var(--primary)', background: 'rgba(99,102,241,0.08)', padding: '2px 6px', borderRadius: '4px' }}>bugmonitor123</code>
          </div>
        </div>
      </div>
    );
  }

  // Render Dashboard sidebar layout if authenticated
  return (
    <AuthContext.Provider value={{ token: auth, activeDomain, setActiveDomain, logout: handleLogout }}>
      <div className="layout">
        
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-logo" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '24px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="logo-text">Bug Monitor</span>
            </div>
            
            {/* Global Domain Filter Dropdown */}
            <div style={{ width: '100%' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: '600' }}>ACTIVE ENVIRONMENT</div>
              <select 
                value={activeDomain}
                onChange={handleDomainChange}
                style={{ width: '100%', padding: '8px 10px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', outline: 'none', cursor: 'pointer' }}
              >
                <option value="">All Domains</option>
                {sites.map(s => (
                  <option key={s.origin} value={s.origin}>{s.name} ({s.origin})</option>
                ))}
              </select>
            </div>
          </div>

          <nav className="sidebar-menu">
            <a href="/dashboard" className={`menu-link ${activePath === '/dashboard' ? 'active' : ''}`} onClick={() => setActivePath('/dashboard')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9"></rect><rect x="14" y="3" width="7" height="5"></rect><rect x="14" y="12" width="7" height="9"></rect><rect x="3" y="16" width="7" height="5"></rect></svg>
              Overview
            </a>
            <a href="/sessions" className={`menu-link ${activePath.startsWith('/sessions') ? 'active' : ''}`} onClick={() => setActivePath('/sessions')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
              Sessions Explorer
            </a>
            <a href="/events" className={`menu-link ${activePath === '/events' ? 'active' : ''}`} onClick={() => setActivePath('/events')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
              Event Query Log
            </a>
            <a href="/errors" className={`menu-link ${activePath === '/errors' ? 'active' : ''}`} onClick={() => setActivePath('/errors')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
              Error Analysis
            </a>
            <a href="/sites" className={`menu-link ${activePath === '/sites' ? 'active' : ''}`} onClick={() => setActivePath('/sites')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
              Register Websites
            </a>
          </nav>

          <div className="sidebar-footer">
            <div className="user-badge">
              <div className="avatar">A</div>
              <div className="user-info">
                <span className="username">Administrator</span>
                <span className="role">Local Console</span>
              </div>
            </div>
            <button className="logout-btn" onClick={handleLogout}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              Lock Console
            </button>
          </div>
        </aside>

        {/* Main Panel Content */}
        <main className="main-content">
          {children}
        </main>
      </div>
    </AuthContext.Provider>
  );
}
