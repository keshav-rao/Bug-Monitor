"use client";

import React from 'react';

export default function Home() {
  React.useEffect(() => {
    window.location.replace('/dashboard');
  }, []);

  return (
    <div style={{ padding: '40px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
      Redirecting to Forensic Dashboard...
    </div>
  );
}
