import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { NavBar } from '../components/NavBar';

type UploadState = {
  fileName: string;
  progress: number;
  status: string;
};

function FileTableSkeleton() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <tr key={i}>
          <td><div className="skeleton skeleton-cell name" /></td>
          <td><div className="skeleton skeleton-cell status" /></td>
          <td><div className="skeleton skeleton-cell id" /></td>
          <td><div className="skeleton skeleton-cell button" /></td>
        </tr>
      ))}
    </>
  );
}

export default function DatasetPage() {
  const router = useRouter();
  const { isReady } = router;
  const { datasetId } = router.query;
  const datasetKey = isReady ? (Array.isArray(datasetId) ? datasetId[0] : datasetId) : undefined;
  const { isAuthenticated, idToken, accessToken, loading } = useAuth();
  const [files, setFiles] = useState<any[]>([]);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [error, setError] = useState('');
  const [isLoadingFiles, setIsLoadingFiles] = useState(true);

  const loadFiles = async () => {
    const token = idToken || accessToken;
    if (!datasetKey || !token) return;
    setIsLoadingFiles(true);
    try {
      const result = await apiRequest<{ files: any[] }>(`/datasets/${datasetKey}/files`, { accessToken: token });
      setFiles(result.files || []);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [loading, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated && datasetKey) {
      loadFiles().catch(() => setError('Failed to load files.'));
    }
  }, [isAuthenticated, datasetKey, idToken, accessToken]);

  const pollingNeeded = useMemo(
    () => files.some((file) => ['UPLOADED_PENDING', 'PROCESSING'].includes(file.status)),
    [files]
  );

  useEffect(() => {
    if (!pollingNeeded) return;
    const interval = setInterval(() => {
      loadFiles().catch(() => undefined);
    }, 5000);
    return () => clearInterval(interval);
  }, [pollingNeeded, datasetKey, idToken, accessToken]);

  const uploadFile = async (file: File) => {
    const token = idToken || accessToken;
    if (!datasetKey || !token) return;
    const presign = await apiRequest<{ fileId: string; uploadUrl: string }>(
      `/datasets/${datasetKey}/files/presign`,
      {
        method: 'POST',
        accessToken: token,
        body: { filename: file.name, contentType: file.type || 'application/pdf' }
      }
    );

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', presign.uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type || 'application/pdf');
      xhr.setRequestHeader('x-amz-server-side-encryption', 'AES256');
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploads((current) =>
            current.map((u) => (u.fileName === file.name ? { ...u, progress } : u))
          );
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error('Upload failed'));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(file);
    });
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []);
    if (!selected.length) return;

    setUploads((current) => [
      ...current,
      ...selected.map((file) => ({ fileName: file.name, progress: 0, status: 'UPLOADING' }))
    ]);

    for (const file of selected) {
      try {
        await uploadFile(file);
        setUploads((current) =>
          current.map((u) => (u.fileName === file.name ? { ...u, status: 'COMPLETE', progress: 100 } : u))
        );
      } catch (err) {
        setUploads((current) =>
          current.map((u) => (u.fileName === file.name ? { ...u, status: 'FAILED' } : u))
        );
      }
    }

    await loadFiles();
  };

  return (
    <>
      <NavBar />
      <main>
        <div className="page-header">
          <h1 className="page-title">Dataset</h1>
          <p className="page-subtitle">Dataset ID: {datasetKey}</p>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label htmlFor="file-upload" className="sr-only">Upload PDF files</label>
            <input
              id="file-upload"
              type="file"
              accept="application/pdf"
              multiple
              onChange={handleUpload}
              aria-label="Upload PDF files"
            />
            <button className="btn secondary" onClick={loadFiles} aria-label="Refresh file list">
              Refresh
            </button>
          </div>
          {error && <div style={{ color: 'var(--critical)', marginTop: 12 }}>{error}</div>}

          {uploads.length > 0 && (
            <div className="upload-list">
              {uploads.map((upload) => (
                <div key={upload.fileName} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>{upload.fileName}</div>
                    <div>{upload.status}</div>
                  </div>
                  <div style={{ marginTop: 8, background: '#efe4d6', borderRadius: 8 }}>
                    <div
                      style={{
                        width: `${upload.progress}%`,
                        height: 8,
                        background: 'var(--accent)',
                        borderRadius: 8
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Latest Job</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {isLoadingFiles ? (
                <FileTableSkeleton />
              ) : files.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>
                    No files uploaded yet. Use the file input above to upload PDFs.
                  </td>
                </tr>
              ) : (
                files.map((file) => (
                  <tr key={file.fileId}>
                    <td>{file.filename}</td>
                    <td className={`status ${file.status?.toLowerCase()}`}>{file.status}</td>
                    <td>{file.latestJobId || '-'}</td>
                    <td>
                      {file.latestJobId && (
                        <button
                          className="btn secondary"
                          onClick={() => router.push(`/file?datasetId=${datasetKey}&fileId=${file.fileId}`)}
                        >
                          View results
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
