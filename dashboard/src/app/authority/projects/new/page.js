"use client";

import React from 'react';
import { useAuth } from '../../../layout';

const SOURCE_TYPES = ['browser', 'sap', 'desktop', 'api'];

export default function NewProject() {
  const ctx = useAuth();

  const [name, setName] = React.useState('');
  const [company, setCompany] = React.useState('');
  const [monitoringTypes, setMonitoringTypes] = React.useState(['browser']);
  const [retentionDays, setRetentionDays] = React.useState(7);
  const [aiAnalysis, setAiAnalysis] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState('');

  const toggleSourceType = (type) => {
    setMonitoringTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('Project name is required'); return; }
    if (monitoringTypes.length === 0) { setError('Select at least one monitoring source type'); return; }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${ctx.api}/v1/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-bug-monitor-auth': `Bearer ${ctx.token}`
        },
        body: JSON.stringify({ name: name.trim(), company: company.trim(), monitoringTypes, retentionDays, aiAnalysis })
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
      } else {
        setError(data.error || 'Failed to create project');
      }
    } catch (err) {
      setError('Cannot connect to backend server.');
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Project Created</h1>
        </div>
        <div className="card" style={{ padding: '32px', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>✅</div>
          <h2 style={{ margin: '0 0 8px' }}>{result.name}</h2>
          <div style={{ color: 'var(--text-muted)', marginBottom: '24px', fontFamily: 'monospace' }}>{result.id}</div>

          <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '16px', marginBottom: '24px', textAlign: 'left' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: '600', marginBottom: '12px' }}>Monitoring Key</div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <code style={{ flex: 1, background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '0.9rem', color: 'var(--primary)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {result.monitoringKey}
              </code>
              <button
                onClick={() => { navigator.clipboard.writeText(result.monitoringKey); }}
                style={{ background: 'var(--primary)', border: 'none', color: '#fff', padding: '12px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}
              >Copy</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', textAlign: 'left', marginBottom: '24px', fontSize: '0.85rem' }}>
            <div><span style={{ color: 'var(--text-muted)' }}>Sources:</span> {result.monitoringTypes.join(', ')}</div>
            <div><span style={{ color: 'var(--text-muted)' }}>Retention:</span> {result.retentionDays} days</div>
            <div><span style={{ color: 'var(--text-muted)' }}>AI Analysis:</span> {result.aiAnalysis ? 'Enabled' : 'Disabled'}</div>
            <div><span style={{ color: 'var(--text-muted)' }}>Status:</span> {result.status}</div>
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <a href="/authority/projects" className="btn-primary" style={{ textDecoration: 'none', padding: '10px 20px' }}>Back to Projects</a>
            <a href="/authority/projects/new" className="btn-primary" style={{ textDecoration: 'none', padding: '10px 20px', background: 'rgba(99,102,241,0.1)', color: 'var(--primary)' }}>Create Another</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">New Project</h1>
          <p className="page-subtitle">Create a monitoring project for your application</p>
        </div>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: '24px' }}>{error}</div>}

      <div className="card" style={{ maxWidth: '600px' }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Project Name *</label>
            <input type="text" className="input-text" placeholder="e.g. ERP Monitoring" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Company (optional)</label>
            <input type="text" className="input-text" placeholder="e.g. Acme Corp" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Monitoring Sources *</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
              {SOURCE_TYPES.map(type => (
                <label key={type} style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px',
                  background: monitoringTypes.includes(type) ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.02)',
                  border: monitoringTypes.includes(type) ? '1px solid var(--primary)' : '1px solid var(--border)',
                  borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem'
                }}>
                  <input type="checkbox" checked={monitoringTypes.includes(type)} onChange={() => toggleSourceType(type)} style={{ accentColor: 'var(--primary)' }} />
                  <span style={{ textTransform: 'capitalize' }}>{type}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Retention Period</label>
              <select className="input-text" value={retentionDays} onChange={(e) => setRetentionDays(parseInt(e.target.value))} style={{ background: 'rgba(0,0,0,0.3)', color: '#fff', cursor: 'pointer' }}>
                <option value={7}>1 Week</option>
                <option value={14}>2 Weeks</option>
                <option value={30}>30 Days</option>
                <option value={90}>90 Days</option>
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">AI Analysis</label>
              <select className="input-text" value={aiAnalysis ? 'true' : 'false'} onChange={(e) => setAiAnalysis(e.target.value === 'true')} style={{ background: 'rgba(0,0,0,0.3)', color: '#fff', cursor: 'pointer' }}>
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </div>
          </div>

          <button type="submit" className="btn-primary" style={{ justifyContent: 'center', marginTop: '10px' }} disabled={loading}>
            {loading ? 'Creating...' : 'Create Project'}
          </button>
        </form>
      </div>
    </div>
  );
}
