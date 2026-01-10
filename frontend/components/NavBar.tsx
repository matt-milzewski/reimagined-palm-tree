import Link from 'next/link';
import { useAuth } from '../lib/auth';

export function NavBar() {
  const { isAuthenticated, logout } = useAuth();

  return (
    <div className="navbar">
      <div>
        <div style={{ fontWeight: 700 }}>RAG Readiness Pipeline</div>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Construction data readiness for AI assistants</div>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {isAuthenticated && (
          <>
            <Link className="btn secondary" href="/dashboard">Dashboard</Link>
            <button className="btn" onClick={logout}>Logout</button>
          </>
        )}
      </div>
    </div>
  );
}
