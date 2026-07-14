"use client";

import React from 'react';
import { useAuth } from '../../layout';

export default function ProjectsList() {
  const ctx = useAuth();
  const [projects, setProjects] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!ctx?.token) return;
    fetch(`${ctx.api}/v1/projects`, {
      headers: { 'x-bug-monitor-auth': `Bearer ${ctx.token}` }
    })
      .then(r => r.json())
      .then(data => { setProjects(Array.isArray(data) ? data : (data?.projects || [])); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ctx?.token]);

  const handleDelete = async (id) => {
    if (!confirm('Delete this project and all associated data?')) return;
    await fetch(`${ctx.api}/v1/projects/${id}`, {
      method: 'DELETE',
      headers: { 'x-bug-monitor-auth': `Bearer ${ctx.token}` }
    });
    setProjects(prev => prev.filter(p => p.id !== id));
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-subtitle">Manage your monitoring projects</p>
        </div>
        <a href="/authority/projects/new" className="btn-primary" style={{ textDecoration: 'none', padding: '10px 20px' }}>
          + New Project
        </a>
      </div>

      {loading ? (
        <div style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>Loading projects...</div>
      ) : projects.length === 0 ? (
        <div className="card" style={{ padding: '48px', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '12px' }}>📦</div>
          <div style={{ color: 'var(--text-muted)' }}>No projects yet. Create your first monitoring project!</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Company</th>
                  <th>Sources</th>
                  <th>Key</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.map(p => (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => window.location.href = `/authority/projects/${p.id}`}>
                    <td>
                      <div style={{ fontWeight: '600' }}>{p.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.id}</div>
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{p.company || '—'}</td>
                    <td>
                      {p.monitoringTypes.map(t => (
                        <span key={t} className={`badge badge-${t === 'browser' ? 'performance' : t === 'sap' ? 'warn' : 'info'}`} style={{ marginRight: '4px', textTransform: 'capitalize' }}>{t}</span>
                      ))}
                    </td>
                    <td>
                      <code style={{ fontSize: '0.75rem', background: 'rgba(0,0,0,0.2)', padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                        {p.monitoringKey?.substring(0, 12)}...
                      </code>
                    </td>
                    <td>
                      <span className={`badge ${p.status === 'active' ? 'badge-performance' : 'badge-error'}`} style={{ textTransform: 'capitalize' }}>
                        {p.status}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(p.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                        style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: '0.8rem' }}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
