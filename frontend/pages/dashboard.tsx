import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { NavBar } from '../components/NavBar';

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, accessToken, loading } = useAuth();
  const [datasets, setDatasets] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const loadDatasets = async () => {
    if (!accessToken) return;
    const result = await apiRequest<{ datasets: any[] }>('/datasets', { accessToken });
    setDatasets(result.datasets || []);
  };

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/');
    }
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated) {
      loadDatasets().catch(() => setError('Failed to load datasets.'));
    }
  }, [isAuthenticated, accessToken]);

  const createDataset = async () => {
    if (!name.trim() || !accessToken) return;
    try {
      await apiRequest('/datasets', {
        method: 'POST',
        accessToken,
        body: { name }
      });
      setName('');
      await loadDatasets();
    } catch (err) {
      setError('Failed to create dataset.');
    }
  };

  return (
    <>
      <NavBar />
      <main>
        <div className="page-header">
          <h1 className="page-title">Datasets</h1>
          <p className="page-subtitle">Create datasets to organize ingestion jobs.</p>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <input
              className="input"
              placeholder="Dataset name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="btn" onClick={createDataset}>Create dataset</button>
          </div>
          {error && <div style={{ color: 'var(--critical)', marginTop: 12 }}>{error}</div>}
        </div>

        <div className="grid two">
          {datasets.map((dataset) => (
            <div className="card" key={dataset.datasetId}>
              <h3 style={{ marginTop: 0 }}>{dataset.name}</h3>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Created {dataset.createdAt}</div>
              <button
                className="btn secondary"
                style={{ marginTop: 16 }}
                onClick={() => router.push(`/dataset?datasetId=${dataset.datasetId}`)}
              >
                View dataset
              </button>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
