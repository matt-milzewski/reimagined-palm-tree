import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { NavBar } from '../components/NavBar';

function DatasetSkeleton() {
  return (
    <div className="skeleton-card">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-text short" />
      <div className="skeleton skeleton-badge" />
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, idToken, accessToken, loading } = useAuth();
  const [datasets, setDatasets] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isLoadingDatasets, setIsLoadingDatasets] = useState(true);

  const loadDatasets = async () => {
    const token = idToken || accessToken;
    if (!token) return;
    setIsLoadingDatasets(true);
    try {
      const result = await apiRequest<{ datasets: any[] }>('/datasets', { accessToken: token });
      setDatasets(result.datasets || []);
    } finally {
      setIsLoadingDatasets(false);
    }
  };

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [loading, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      loadDatasets().catch(() => setError('Failed to load datasets.'));
    }
  }, [isAuthenticated, idToken, accessToken]);

  const createDataset = async () => {
    const token = idToken || accessToken;
    if (!name.trim() || !token) return;
    try {
      await apiRequest('/datasets', {
        method: 'POST',
        accessToken: token,
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
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ display: 'grid', gap: 6, flex: 1, minWidth: 200 }}>
              <label htmlFor="dataset-name" className="field-label">Dataset name</label>
              <input
                id="dataset-name"
                className="input"
                placeholder="Enter dataset name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-required="true"
              />
            </div>
            <button className="btn" onClick={createDataset} aria-label="Create new dataset">
              Create dataset
            </button>
          </div>
          {error && <div style={{ color: 'var(--critical)', marginTop: 12 }} role="alert">{error}</div>}
        </div>

        <div className="grid two">
          {isLoadingDatasets ? (
            <>
              <DatasetSkeleton />
              <DatasetSkeleton />
              <DatasetSkeleton />
            </>
          ) : datasets.length === 0 ? (
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <p style={{ color: 'var(--muted)', margin: 0 }}>
                No datasets yet. Create your first dataset above to get started.
              </p>
            </div>
          ) : (
            datasets.map((dataset) => (
              <div className="card" key={dataset.datasetId}>
                <h3 style={{ marginTop: 0 }}>{dataset.name}</h3>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  Created {new Date(dataset.createdAt).toLocaleDateString()}
                </div>
                <button
                  className="btn secondary"
                  style={{ marginTop: 16 }}
                  onClick={() => router.push(`/dataset?datasetId=${dataset.datasetId}`)}
                >
                  View dataset
                </button>
              </div>
            ))
          )}
        </div>
      </main>
    </>
  );
}
