import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/auth';
import { NavBar } from '../components/NavBar';

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated, login, loading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, router]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await login(username, password);
      router.push('/dashboard');
    } catch (err) {
      setError('Login failed. Check your credentials.');
    }
  };

  return (
    <>
      <NavBar />
      <main>
        <div className="page-header">
          <h1 className="page-title">RAG Readiness Pipeline</h1>
          <p className="page-subtitle">Upload PDFs and receive normalized, chunked, RAG-ready data.</p>
        </div>

        <div className="card" style={{ maxWidth: 420 }}>
          <h3 style={{ marginTop: 0 }}>Sign in</h3>
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
            <input
              className="input"
              placeholder="Email"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              className="input"
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <div style={{ color: 'var(--critical)' }}>{error}</div>}
            <button className="btn" type="submit" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </main>
    </>
  );
}
