import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';

export type Dataset = {
  datasetId: string;
  name: string;
  status?: string;
  updatedAt?: string;
  createdAt?: string;
};

type DatasetPickerProps = {
  value?: string;
  onSelect: (dataset?: Dataset) => void;
};

export function DatasetPicker({ value, onSelect }: DatasetPickerProps) {
  const { isAuthenticated, idToken, accessToken } = useAuth();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const token = idToken || accessToken;

  const loadDatasets = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const result = await apiRequest<{ datasets: Dataset[] }>('/datasets', { accessToken: token });
      setDatasets(result.datasets || []);
      setError('');
    } catch (err) {
      setError('Failed to load datasets.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadDatasets().catch(() => undefined);
    }
  }, [isAuthenticated, token]);

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const datasetId = event.target.value;
    const selected = datasets.find((dataset) => dataset.datasetId === datasetId);
    onSelect(selected);
  };

  return (
    <div className="dataset-picker">
      <label className="field-label" htmlFor="dataset-picker">
        Dataset
      </label>
      <div className="dataset-picker-row">
        <select
          id="dataset-picker"
          className="input"
          value={value || ''}
          onChange={handleChange}
          disabled={loading}
        >
          <option value="">Select a dataset</option>
          {datasets.map((dataset) => (
            <option
              key={dataset.datasetId}
              value={dataset.datasetId}
              disabled={dataset.status !== 'READY'}
            >
              {dataset.name} {dataset.status ? `(${dataset.status})` : ''}
            </option>
          ))}
        </select>
        <button className="btn secondary" onClick={loadDatasets} disabled={loading}>
          Refresh
        </button>
      </div>
      {error && <div className="hint error">{error}</div>}
    </div>
  );
}
