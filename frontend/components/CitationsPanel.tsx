import { Citation } from '../lib/useChat';

type CitationsPanelProps = {
  citations?: Citation[];
  hasSelection?: boolean;
  onOpenSource: (citation: Citation) => void;
};

export function CitationsPanel({ citations, hasSelection, onOpenSource }: CitationsPanelProps) {
  if (!citations || citations.length === 0) {
    return (
      <aside className="citations-panel card">
        <h3>Citations</h3>
        <p className="hint">
          {hasSelection ? 'No sources are available for this response.' : 'Select an assistant response to see sources.'}
        </p>
      </aside>
    );
  }

  return (
    <aside className="citations-panel card">
      <h3>Citations</h3>
      <div className="citations-list">
        {citations.map((citation) => (
          <div key={citation.chunk_id} className="citation-item">
            <div className="citation-header">
              <div>
                <strong>{citation.filename || 'Source file'}</strong>
                {citation.page !== null && citation.page !== undefined && (
                  <span className="citation-page">Page {citation.page}</span>
                )}
              </div>
              {typeof citation.score === 'number' && (
                <span className="citation-score">{citation.score.toFixed(2)}</span>
              )}
            </div>
            <details>
              <summary>View excerpt</summary>
              <p className="citation-snippet">{citation.snippet || 'No excerpt available.'}</p>
            </details>
            <div className="citation-actions">
              <button
                className="btn secondary"
                onClick={() => onOpenSource(citation)}
                disabled={!citation.doc_id}
              >
                Open source
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
