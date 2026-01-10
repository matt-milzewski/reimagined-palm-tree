import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { NavBar } from '../components/NavBar';

const severityOrder = ['CRITICAL', 'WARN', 'INFO'];

export default function FileResultsPage() {
  const router = useRouter();
  const { datasetId, fileId } = router.query;
  const datasetKey = Array.isArray(datasetId) ? datasetId[0] : datasetId;
  const fileKey = Array.isArray(fileId) ? fileId[0] : fileId;
  const { isAuthenticated, idToken, accessToken, loading } = useAuth();
  const [file, setFile] = useState<any>(null);
  const [job, setJob] = useState<any>(null);
  const [qualityReport, setQualityReport] = useState<any>(null);
  const [error, setError] = useState('');

  const loadFile = async () => {
    const token = idToken || accessToken;
    if (!datasetKey || !fileKey || !token) return;
    const result = await apiRequest<{ file: any; job: any }>(
      `/datasets/${datasetKey}/files/${fileKey}`,
      { accessToken: token }
    );
    setFile(result.file);
    setJob(result.job);
  };

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated && datasetKey && fileKey) {
      loadFile().catch(() => setError('Failed to load file results.'));
    }
  }, [isAuthenticated, datasetKey, fileKey, idToken, accessToken]);

  useEffect(() => {
    const loadQualityReport = async () => {
      const token = idToken || accessToken;
      if (!datasetKey || !fileKey || !job?.jobId || !token) return;
      if (job.status !== 'COMPLETE') return;
      const { url } = await apiRequest<{ url: string }>(
        `/datasets/${datasetKey}/files/${fileKey}/jobs/${job.jobId}/download?type=quality`,
        { accessToken: token }
      );
      const response = await fetch(url);
      const report = await response.json();
      setQualityReport(report);
    };

    loadQualityReport().catch(() => undefined);
  }, [job?.jobId, job?.status, datasetKey, fileKey, idToken, accessToken]);

  const groupedFindings = useMemo(() => {
    const findings = qualityReport?.findings || [];
    const groups: Record<string, any[]> = { CRITICAL: [], WARN: [], INFO: [] };
    findings.forEach((finding: any) => {
      if (groups[finding.severity]) {
        groups[finding.severity].push(finding);
      }
    });
    return groups;
  }, [qualityReport]);

  const downloadArtifact = async (type: string) => {
    const token = idToken || accessToken;
    if (!datasetKey || !fileKey || !job?.jobId || !token) return;
    const result = await apiRequest<{ url: string }>(
      `/datasets/${datasetKey}/files/${fileKey}/jobs/${job.jobId}/download?type=${type}`,
      { accessToken: token }
    );
    window.open(result.url, '_blank');
  };

  return (
    <>
      <NavBar />
      <main>
        <div className="page-header">
          <h1 className="page-title">File results</h1>
          <p className="page-subtitle">{file?.filename}</p>
        </div>

        {error && <div style={{ color: 'var(--critical)', marginBottom: 12 }}>{error}</div>}

        <div className="grid two" style={{ marginBottom: 20 }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Readiness score</h3>
            <div style={{ fontSize: 48, fontWeight: 700 }}>{job?.readinessScore ?? '--'}</div>
            <div style={{ color: 'var(--muted)' }}>0 - 100 scale</div>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Status</h3>
            <div className={`status ${file?.status?.toLowerCase()}`}>{file?.status}</div>
            {job?.errorMessage && <div style={{ color: 'var(--critical)' }}>{job.errorMessage}</div>}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Artifacts</h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn secondary" onClick={() => downloadArtifact('extracted')}>Extracted text</button>
            <button className="btn secondary" onClick={() => downloadArtifact('document')}>Document JSON</button>
            <button className="btn secondary" onClick={() => downloadArtifact('chunks')}>Chunks JSONL</button>
            <button className="btn secondary" onClick={() => downloadArtifact('quality')}>Quality report</button>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Findings</h3>
          <div className="findings">
            {severityOrder.map((severity) => (
              <div key={severity}>
                <div className={`badge ${severity.toLowerCase()}`} style={{ marginBottom: 8 }}>
                  {severity} ({groupedFindings[severity]?.length || 0})
                </div>
                {groupedFindings[severity]?.map((finding: any, index: number) => (
                  <div key={`${severity}-${index}`} className="finding">
                    <div style={{ fontWeight: 600 }}>{finding.type}</div>
                    <div style={{ color: 'var(--muted)' }}>{finding.description}</div>
                    {finding.recommendation && (
                      <div style={{ marginTop: 6 }}>Recommendation: {finding.recommendation}</div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
