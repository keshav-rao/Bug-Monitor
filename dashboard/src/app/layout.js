"use client";

import './globals.css';
import React from 'react';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <title>Bug Monitor — Universal Observability Platform</title>
        <meta name="description" content="Multi-source observability and forensic debugging platform." />
      </head>
      <body style={{ display: 'block', height: '100vh', margin: 0 }}>
        <AppShell>
          {children}
        </AppShell>
      </body>
    </html>
  );
}

const AuthContext = React.createContext(null);

export function useAuth() {
  return React.useContext(AuthContext);
}

const API = 'http://localhost:4000';

function AppShell({ children }) {
  const [auth, setAuth] = React.useState(null); // { token, user }
  const [loading, setLoading] = React.useState(true);
  const [activePath, setActivePath] = React.useState('/dashboard');
  const [activeProject, setActiveProject] = React.useState(null);
  const [projects, setProjects] = React.useState([]);

  // Restore auth on mount
  React.useEffect(() => {
    const saved = localStorage.getItem('bug_monitor_auth');
    if (saved) {
      // Legacy plain-password auth — clear and redirect to new login
      localStorage.removeItem('bug_monitor_auth');
      localStorage.removeItem('bug_monitor_domain');
      setLoading(false);
      return;
    }

    const token = localStorage.getItem('bug_monitor_token');
    const userJson = localStorage.getItem('bug_monitor_user');
    const projectId = localStorage.getItem('bug_monitor_project');

    if (token && userJson) {
      try {
        const user = JSON.parse(userJson);
        setAuth({ token, user });
        if (user.role === 'developer' && projectId) {
          setActiveProject(projectId);
        }
        fetchUserProjects(token);
      } catch (e) {
        clearAuth();
      }
    }
    setLoading(false);
  }, []);

  const fetchUserProjects = async (token) => {
    try {
      const res = await fetch(`${API}/v1/auth/me`, {
        headers: { 'x-bug-monitor-auth': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.projects) setProjects(data.projects);
      }
    } catch (e) {}
  };

  const setAuthState = (token, user, projectId = null) => {
    localStorage.setItem('bug_monitor_token', token);
    localStorage.setItem('bug_monitor_user', JSON.stringify(user));
    if (projectId) localStorage.setItem('bug_monitor_project', projectId);
    else localStorage.removeItem('bug_monitor_project');
    setAuth({ token, user });
    setActiveProject(projectId);
    fetchUserProjects(token);
  };

  const clearAuth = () => {
    localStorage.removeItem('bug_monitor_token');
    localStorage.removeItem('bug_monitor_user');
    localStorage.removeItem('bug_monitor_project');
    setAuth(null);
    setProjects([]);
    setActiveProject(null);
  };

  const handleLogout = () => clearAuth();

  const isOnAuthPage = typeof window !== 'undefined' &&
    (window.location.pathname === '/login' || window.location.pathname === '/register');

  if (loading) {
    return (
      <div className="auth-wrapper">
        <div style={{ fontFamily: 'monospace', color: '#94a3b8' }}>Initializing Bug Monitor...</div>
      </div>
    );
  }

  // Show login/register pages without sidebar
  if (!auth && isOnAuthPage) {
    return (
      <AuthContext.Provider value={{ api: API, setAuth: setAuthState, auth: null }}>
        {children}
      </AuthContext.Provider>
    );
  }

  // Redirect to login
  if (!auth) {
    if (typeof window !== 'undefined') {
      window.location.replace('/login');
      return null;
    }
    return null;
  }

  const isAdmin = auth.user.role === 'admin';
  const isDev = auth.user.role === 'developer';

  return (
    <AuthContext.Provider value={{
      token: auth.token,
      user: auth.user,
      api: API,
      activeProject,
      setActiveProject,
      projects,
      isAdmin,
      isDev,
      logout: handleLogout,
      refreshProjects: () => fetchUserProjects(auth.token)
    }}>
      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-logo" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '24px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="logo-text">Bug Monitor</span>
            </div>
          </div>

          <nav className="sidebar-menu">
            {/* Authority section (admin only) */}
            {isAdmin && (
              <>
                <div style={{ padding: '8px 16px 4px', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.5px' }}>AUTHORITY</div>
                <a href="/authority/projects" className={`menu-link ${activePath.startsWith('/authority') ? 'active' : ''}`} onClick={() => setActivePath('/authority/projects')}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9"></rect><rect x="14" y="3" width="7" height="5"></rect><rect x="14" y="12" width="7" height="9"></rect><rect x="3" y="16" width="7" height="5"></rect></svg>
                  Projects
                </a>
              </>
            )}

            {/* Monitoring section (everyone) */}
            <div style={{ padding: '16px 16px 4px', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.5px' }}>MONITORING</div>
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
            {isAdmin && (
              <a href="/sites" className={`menu-link ${activePath === '/sites' ? 'active' : ''}`} onClick={() => setActivePath('/sites')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                Sites
              </a>
            )}
          </nav>

          <div className="sidebar-footer">
            <div className="user-badge">
              <div className="avatar">{auth.user.email?.[0]?.toUpperCase() || 'D'}</div>
              <div className="user-info">
                <span className="username">{auth.user.name || auth.user.email || 'Developer'}</span>
                <span className="role">{isAdmin ? 'Administrator' : 'Developer'}</span>
              </div>
            </div>
            <button className="logout-btn" onClick={handleLogout}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              {isAdmin ? 'Lock Console' : 'Disconnect'}
            </button>
          </div>
        </aside>

        <main className="main-content">
          {children}
        </main>
      </div>
    </AuthContext.Provider>
  );
}
