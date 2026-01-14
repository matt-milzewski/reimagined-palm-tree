import { useEffect, useMemo, useState } from 'react';
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

type SortOption = 'newest' | 'oldest' | 'name-asc' | 'name-desc';

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, idToken, accessToken, loading } = useAuth();
  const [datasets, setDatasets] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isLoadingDatasets, setIsLoadingDatasets] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');

  // Filter and sort datasets
  const filteredDatasets = useMemo(() => {
    let result = [...datasets];

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((d) =>
        d.name?.toLowerCase().includes(query)
      );
    }

    // Sort datasets
    result.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'oldest':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'name-asc':
          return (a.name || '').localeCompare(b.name || '');
        case 'name-desc':
          return (b.name || '').localeCompare(a.name || '');
        default:
          return 0;
      }
    });

    return result;
  }, [datasets, searchQuery, sortBy]);

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

        {/* Search and filter controls */}
        {datasets.length > 0 && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ display: 'grid', gap: 6, flex: 1, minWidth: 200 }}>
                <label htmlFor="search-datasets" className="field-label">Search datasets</label>
                <input
                  id="search-datasets"
                  className="input"
                  placeholder="Filter by name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search datasets by name"
                />
              </div>
              <div style={{ display: 'grid', gap: 6, minWidth: 150 }}>
                <label htmlFor="sort-datasets" className="field-label">Sort by</label>
                <select
                  id="sort-datasets"
                  className="input"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  aria-label="Sort datasets"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="name-asc">Name A-Z</option>
                  <option value="name-desc">Name Z-A</option>
                </select>
              </div>
            </div>
            {searchQuery && (
              <div style={{ marginTop: 12, color: 'var(--muted)', fontSize: 13 }}>
                Showing {filteredDatasets.length} of {datasets.length} datasets
              </div>
            )}
          </div>
        )}

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
          ) : filteredDatasets.length === 0 ? (
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <p style={{ color: 'var(--muted)', margin: 0 }}>
                No datasets match your search. Try a different filter.
              </p>
            </div>
          ) : (
            filteredDatasets.map((dataset) => (
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
