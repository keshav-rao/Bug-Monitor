"use client";

import React from 'react';
import { useAuth } from './layout';

export default function Home() {
  const ctx = useAuth();

  React.useEffect(() => {
    if (ctx?.user?.role === 'admin') {
      window.location.replace('/authority/projects');
    } else {
      window.location.replace('/dashboard');
    }
  }, [ctx?.user]);

  return (
    <div style={{ padding: '40px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
      Redirecting...
    </div>
  );
}
