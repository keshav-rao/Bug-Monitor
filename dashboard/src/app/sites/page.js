"use client";

import React from 'react';
import { useAuth } from '../layout';

export default function RegisterWebsites() {
  const authContext = useAuth();
  const [sites, setSites] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState('');
  
  // Registration Form State
  const [name, setName] = React.useState('');
  const [origin, setOrigin] = React.useState('');
  const [formError, setFormError] = React.useState('');
  const [formSuccess, setFormSuccess] = React.useState('');

  // Obfuscation toggles for keys
  const [visibleKeys, setVisibleKeys] = React.useState({});

  const getAuth = () => authContext?.token || localStorage.getItem('bug_monitor_token');

  const fetchSites = async () => {
    const auth = getAuth();
    try {
      const res = await fetch(`${authContext?.api || 'http://localhost:4000'}/v1/sites`, {
        headers: { 'x-bug-monitor-auth': `Bearer ${auth}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSites(data || []);
      } else {
        setErrorMsg('Failed to load registered sites. Unauthenticated.');
      }
    } catch (err) {
      setErrorMsg('Cannot communicate with backend server.');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchSites();
  }, []);

  const handleRegister = async (e) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!name.trim() || !origin.trim()) {
      setFormError('Please enter both a Site Name and an Origin Domain.');
      return;
    }

    const auth = getAuth();
    const api = authContext?.api || 'http://localhost:4000';
    try {
      const res = await fetch(`${api}/v1/sites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-bug-monitor-auth': `Bearer ${auth}`
        },
        body: JSON.stringify({ name, origin })
      });

      if (res.ok) {
        setFormSuccess('✓ Origin successfully registered to forensics!');
        setName('');
        setOrigin('');
        fetchSites();
        if (authContext?.refreshSites) authContext.refreshSites();
      } else {
        const errData = await res.json();
        setFormError(errData.error || 'Failed to register site.');
      }
    } catch (err) {
      setFormError('Cannot reach local server.');
    }
  };

  const handleDelete = async (originToDelete) => {
    if (!confirm(`Stop monitoring and delete registration for ${originToDelete}?`)) return;

    const auth = getAuth();
    const api = authContext?.api || 'http://localhost:4000';
    try {
      const res = await fetch(`${api}/v1/sites`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-bug-monitor-auth': `Bearer ${auth}`
        },
        body: JSON.stringify({ origin: originToDelete })
      });

      if (res.ok) {
        fetchSites();
        if (authContext?.refreshSites) authContext.refreshSites();
      } else {
        setErrorMsg('Failed to delete registration.');
      }
    } catch (err) {
      setErrorMsg('Cannot reach backend server.');
    }
  };

  const toggleKeyVisibility = (org) => {
    setVisibleKeys(prev => ({
      ...prev,
      [org]: !prev[org]
    }));
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    alert('API Key copied to clipboard!');
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Monitored Domains</h1>
          <p className="page-subtitle">Register targets and manage forensic access credentials</p>
        </div>
      </div>

      {errorMsg && (
        <div className="error-banner" style={{ marginBottom: '24px' }}>
          <strong>Error:</strong> {errorMsg}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '24px', alignItems: 'start' }}>
        
        {/* Registration Form */}
        <div className="card">
          <h3 className="card-title">Add Monitored Site</h3>
          {formError && <div className="error-banner" style={{ fontSize: '0.85rem', padding: '10px' }}>{formError}</div>}
          {formSuccess && <div className="badge badge-performance" style={{ display: 'block', width: '100%', marginBottom: '16px', padding: '10px', fontSize: '0.82rem', textAlign: 'center' }}>{formSuccess}</div>}

          <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Display/Site Name</label>
              <input
                type="text"
                className="input-text"
                placeholder="e.g. My Web App"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Origin Domain URL</label>
              <input
                type="text"
                className="input-text"
                placeholder="e.g. https://www.iswaran.com"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="btn-primary" style={{ justifyContent: 'center', marginTop: '10px' }}>
              Add Site To Forensics
            </button>
          </form>
          
          <div style={{ marginTop: '24px', padding: '14px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
            <strong>💡 Empty List Fallback:</strong> If no sites are registered in this dashboard list, the extension is open to record <strong>every site</strong> you visit! Registering domains restricts recording exclusively to those listed.
          </div>
        </div>

        {/* Registered sites list */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
            <h3 className="card-title" style={{ margin: 0, fontSize: '0.95rem' }}>Active Forensics Sites</h3>
          </div>

          {loading ? (
            <div style={{ padding: '32px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>Querying domains database...</div>
          ) : sites.length === 0 ? (
            <div className="empty-state" style={{ padding: '60px 24px' }}>
              <div className="empty-icon">🌐</div>
              <div className="empty-text">No domains registered. Currently recording all site origins.</div>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Site Details</th>
                    <th>Origin Domain</th>
                    <th>Forensic API Key</th>
                    <th style={{ textAlign: 'center' }}>Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((s) => {
                    const isVisible = !!visibleKeys[s.origin];
                    return (
                      <tr key={s.origin}>
                        <td>
                          <div style={{ fontWeight: '600' }}>{s.name}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Registered {new Date(s.createdAt).toLocaleDateString()}</div>
                        </td>
                        <td style={{ color: 'var(--primary)', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                          {s.origin}
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <code style={{ background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                              {isVisible ? s.apiKey : '••••••••••••••••••••'}
                            </code>
                            <button
                              onClick={() => toggleKeyVisibility(s.origin)}
                              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem' }}
                              title={isVisible ? 'Hide API Key' : 'Reveal API Key'}
                            >
                              {isVisible ? 'Hide' : 'Show'}
                            </button>
                            {isVisible && (
                              <button
                                onClick={() => handleCopy(s.apiKey)}
                                style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600' }}
                              >
                                Copy
                              </button>
                            )}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            onClick={() => handleDelete(s.origin)}
                            style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: '1.1rem' }}
                            title="Delete monitoring site"
                          >
                            🗑
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
