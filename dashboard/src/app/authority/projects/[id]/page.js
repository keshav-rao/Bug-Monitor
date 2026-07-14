"use client";

import React from 'react';
import { useAuth } from '../../../layout';

export default function ProjectDetail({ params }) {
  const ctx = useAuth();
  const projectId = params.id;

  const [project, setProject] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [keyVisible, setKeyVisible] = React.useState(false);
  const [regenerating, setRegenerating] = React.useState(false);
  const [stats, setStats] = React.useState(null);

  React.useEffect(() => {
    if (!ctx?.token) return;
    fetch(`${ctx.api}/v1/projects/${projectId}`, {
      headers: { 'x-bug-monitor-auth': `Bearer ${ctx.token}` }
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); } else { setProject(data); }
        setLoading(false);
      })
      .catch(() => { setError('Failed to load project'); setLoading(false); });

    fetch(`${ctx.api}/v1/stats?projectId=${projectId}`, {
      headers: { 'x-bug-monitor-auth': `Bearer ${ctx.token}` }
    })
      .then(r => r.json())
      .then(data => setStats(data))
      .catch(() => {});
  }, [ctx?.token, projectId]);

  const handleRegenerateKey = async () => {
    if (!confirm('Regenerating the key will invalidate the old one. Continue?')) return;
    setRegenerating(true);
    try {
      const res = await fetch(`${ctx.api}/v1/projects/${projectId}/regenerate-key`, {
        method: 'POST',
        headers: { 'x-bug-monitor-auth': `Bearer ${ctx.token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setProject(prev => ({ ...prev, monitoringKey: data.monitoringKey }));
        setKeyVisible(true);
      }
    } catch (e) {}
    setRegenerating(false);
  };

  const handleToggleStatus = async () => {
    const newStatus = project.status === 'active' ? 'paused' : 'active';
    const res = await fetch(`${ctx.api}/v1/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-bug-monitor-auth': `Bearer ${ctx.token}` },
      body: JSON.stringify({ status: newStatus })
    });
    if (res.ok) setProject(prev => ({ ...prev, status: newStatus }));
  };

  if (loading) return <div style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>Loading project...</div>;
  if (error) return <div className="error-banner">{error}</div>;
  if (!project) return null;

  return (
    <div>
      <div className="page-header">
        <div>
          <a href="/authority/projects" style={{ color: 'var(--primary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', marginBottom: '8px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            Back to Projects
          </a>
          <h1 className="page-title">{project.name}</h1>
          <p className="page-subtitle">
            <span style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>{project.id}</span>
            {' · '}
            <span className={`badge ${project.status === 'active' ? 'badge-performance' : 'badge-error'}`} style={{ textTransform: 'capitalize' }}>{project.status}</span>
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px', alignItems: 'start' }}>
        {/* Main Details */}
        <div className="card">
          <h3 className="card-title">Project Details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Company</div><div>{project.company || '—'}</div></div>
            <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Created</div><div>{new Date(project.createdAt).toLocaleDateString()}</div></div>
            <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Retention</div><div>{project.retentionDays} days</div></div>
            <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>AI Analysis</div><div>{project.aiAnalysis ? 'Enabled' : 'Disabled'}</div></div>
            <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Live Monitoring</div><div>{project.liveMonitoring ? 'Enabled' : 'Disabled'}</div></div>
            <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Sources</div><div>{project.monitoringTypes.join(', ')}</div></div>
          </div>

          <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
            <button onClick={handleToggleStatus} className="btn-primary" style={{ background: project.status === 'active' ? 'rgba(234,179,8,0.1)' : 'var(--primary)', color: project.status === 'active' ? 'var(--warn)' : '#fff', border: `1px solid ${project.status === 'active' ? 'var(--warn)' : 'var(--primary)'}`, padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}>
              {project.status === 'active' ? 'Pause Project' : 'Activate Project'}
            </button>
          </div>
        </div>

        {/* Monitoring Key */}
        <div className="card">
          <h3 className="card-title">Monitoring Key</h3>
          <div style={{ marginBottom: '12px' }}>
            {keyVisible ? (
              <code style={{ display: 'block', wordBreak: 'break-all', background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '0.85rem', color: 'var(--primary)', fontFamily: 'monospace' }}>
                {project.monitoringKey}
              </code>
            ) : (
              <code style={{ display: 'block', background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                ••••••••••••••••••••••••••
              </code>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setKeyVisible(!keyVisible)} className="btn-primary" style={{ flex: 1, justifyContent: 'center', background: 'rgba(99,102,241,0.1)', color: 'var(--primary)', border: '1px solid var(--border)' }}>
              {keyVisible ? 'Hide' : 'Reveal'}
            </button>
            {keyVisible && (
              <button onClick={() => { navigator.clipboard.writeText(project.monitoringKey); }} className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>Copy</button>
            )}
          </div>
          <button onClick={handleRegenerateKey} disabled={regenerating} style={{ marginTop: '8px', width: '100%', background: 'none', border: '1px solid var(--error)', color: 'var(--error)', padding: '8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
            {regenerating ? 'Regenerating...' : 'Regenerate Key'}
          </button>
        </div>

        {/* Stats Card */}
        {stats && (
          <div className="card">
            <h3 className="card-title">Project Stats</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Events</div><div style={{ fontWeight: '600' }}>{stats.totalEvents?.toLocaleString() || 0}</div></div>
              <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Sessions</div><div style={{ fontWeight: '600' }}>{stats.totalSessions?.toLocaleString() || 0}</div></div>
              <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Errors</div><div style={{ fontWeight: '600', color: 'var(--error)' }}>{stats.totalErrors?.toLocaleString() || 0}</div></div>
              <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Active Sessions</div><div style={{ fontWeight: '600', color: 'var(--success)' }}>{stats.activeSessions || 0}</div></div>
            </div>
          </div>
        )}
      </div>

      {/* Developer Access Instructions */}
      <div className="card" style={{ marginTop: '24px' }}>
        <h3 className="card-title">Developer Access</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
          Share these credentials with your developer so they can access this project's monitoring data:
        </p>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px 16px', borderRadius: '6px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Project ID</div>
            <code style={{ fontSize: '0.9rem', color: 'var(--primary)', fontFamily: 'monospace' }}>{project.id}</code>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px 16px', borderRadius: '6px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Login URL</div>
            <code style={{ fontSize: '0.9rem', color: 'var(--primary)', fontFamily: 'monospace' }}>/login (Developer mode)</code>
          </div>
        </div>
      </div>
    </div>
  );
}
