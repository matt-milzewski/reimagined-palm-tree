import Link from 'next/link';
import { useAuth } from '../lib/auth';

export function NavBar() {
  const { isAuthenticated, logout } = useAuth();

  return (
    <div className="navbar">
      <div className="brand-stack">
        <Link href="/" className="brand">
          <img src="/ragready-logo.png" alt="RagReady logo" />
          <span>RagReady</span>
        </Link>
        <div className="brand-tagline">Construction data readiness for AI assistants</div>
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
