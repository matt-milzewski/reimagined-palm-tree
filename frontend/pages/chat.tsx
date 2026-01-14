import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { NavBar } from '../components/NavBar';
import { Dataset, DatasetPicker } from '../components/DatasetPicker';
import { ChatThread } from '../components/ChatThread';
import { ChatComposer } from '../components/ChatComposer';
import { CitationsPanel } from '../components/CitationsPanel';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Citation, useChat } from '../lib/useChat';

export default function ChatPage() {
  const router = useRouter();
  const { isAuthenticated, idToken, accessToken, loading } = useAuth();
  const [selectedDataset, setSelectedDataset] = useState<Dataset | undefined>();

  const token = idToken || accessToken;
  const datasetId = selectedDataset?.datasetId;

  const {
    messages,
    selectedMessage,
    selectedMessageId,
    isSending,
    error,
    sendMessage,
    retryMessage,
    selectMessage
  } = useChat({ datasetId, accessToken: token });

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
