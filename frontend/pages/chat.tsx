import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { NavBar } from '../components/NavBar';
import { Dataset, DatasetPicker } from '../components/DatasetPicker';
import { ChatThread } from '../components/ChatThread';
import { ChatComposer } from '../components/ChatComposer';
import { CitationsPanel } from '../components/CitationsPanel';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Citation, ChatFilters, useChat } from '../lib/useChat';

export default function ChatPage() {
  const router = useRouter();
  const { isAuthenticated, idToken, accessToken, loading } = useAuth();
  const [selectedDataset, setSelectedDataset] = useState<Dataset | undefined>();
  const [filterState, setFilterState] = useState({
    docTypes: '',
    disciplines: '',
    standards: '',
    includeSuperseded: false
  });

  const token = idToken || accessToken;
  const datasetId = selectedDataset?.datasetId;

  const filters: ChatFilters | undefined = useMemo(() => {
    const buildList = (value: string, transform: (entry: string) => string) =>
      value
        .split(',')
        .map((entry) => transform(entry.trim()))
        .filter((entry) => entry.length > 0);

    const docTypes = buildList(filterState.docTypes, (entry) => entry.toLowerCase());
    const disciplines = buildList(filterState.disciplines, (entry) => entry.toLowerCase());
    const standards = buildList(filterState.standards, (entry) => entry.toUpperCase());

    const nextFilters: ChatFilters = {};
    if (docTypes.length) nextFilters.docTypes = docTypes;
    if (disciplines.length) nextFilters.disciplines = disciplines;
    if (standards.length) nextFilters.standards = standards;
    if (filterState.includeSuperseded) nextFilters.includeSuperseded = true;

    return Object.keys(nextFilters).length ? nextFilters : undefined;
  }, [filterState]);

  const {
    messages,
    selectedMessage,
    selectedMessageId,
    isSending,
    error,
    sendMessage,
    retryMessage,
    selectMessage
  } = useChat({ datasetId, accessToken: token, filters });

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [loading, isAuthenticated]);

  const datasetStatus = selectedDataset?.status;
  const datasetReady = datasetStatus === 'READY';

  const statusClass = useMemo(() => {
    if (!datasetStatus) return 'badge info';
    if (datasetStatus === 'READY') return 'badge success';
    if (datasetStatus === 'FAILED') return 'badge critical';
    return 'badge warn';
  }, [datasetStatus]);

  const handleOpenSource = async (citation: Citation) => {
    if (!token || !datasetId || !citation.doc_id) return;
    const response = await apiRequest<{ url: string }>(
      `/documents/${citation.doc_id}/presign?datasetId=${datasetId}`,
      { accessToken: token }
    );
    window.open(response.url, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <NavBar />
      <main>
        <div className="page-header">
          <h1 className="page-title">Chat</h1>
          <p className="page-subtitle">Chat with a single dataset and keep responses grounded in citations.</p>
        </div>

        <div className="chat-shell card">
          <div className="chat-header">
            <DatasetPicker value={datasetId} onSelect={setSelectedDataset} />
            {selectedDataset && <span className={statusClass}>{datasetStatus}</span>}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gap: 6 }}>
                <label className="field-label" htmlFor="filter-doc-types">Doc types (comma-separated)</label>
                <input
                  id="filter-doc-types"
                  className="input"
                  placeholder="specification, contract"
                  value={filterState.docTypes}
                  onChange={(event) => setFilterState((prev) => ({ ...prev, docTypes: event.target.value }))}
                />
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                <label className="field-label" htmlFor="filter-disciplines">Disciplines (comma-separated)</label>
                <input
                  id="filter-disciplines"
                  className="input"
                  placeholder="structural, electrical"
                  value={filterState.disciplines}
                  onChange={(event) => setFilterState((prev) => ({ ...prev, disciplines: event.target.value }))}
                />
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                <label className="field-label" htmlFor="filter-standards">Standards (comma-separated)</label>
                <input
                  id="filter-standards"
                  className="input"
                  placeholder="AS 3600, NCC"
                  value={filterState.standards}
                  onChange={(event) => setFilterState((prev) => ({ ...prev, standards: event.target.value }))}
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={filterState.includeSuperseded}
                  onChange={(event) =>
                    setFilterState((prev) => ({ ...prev, includeSuperseded: event.target.checked }))
                  }
                />
                Include superseded files in retrieval
              </label>
            </div>
          </div>

          {!selectedDataset && (
            <div className="chat-notice">
              Select a dataset to start chatting.
            </div>
          )}

          {selectedDataset && !datasetReady && (
            <div className="chat-notice warn">
              Dataset status is {datasetStatus || 'UNKNOWN'}. Chat is available when the dataset is READY.
            </div>
          )}

          {error && <div className="chat-notice error">{error}</div>}

          <div className="chat-layout">
            <div className="chat-pane">
              <ChatThread
                messages={messages}
                selectedMessageId={selectedMessageId}
                onSelectMessage={selectMessage}
                onRetry={retryMessage}
              />
              <ChatComposer disabled={!datasetReady || isSending} onSend={sendMessage} />
            </div>
            <CitationsPanel
              citations={selectedMessage?.citations}
              hasSelection={Boolean(selectedMessage)}
              onOpenSource={handleOpenSource}
            />
          </div>
        </div>
      </main>
    </>
  );
}
