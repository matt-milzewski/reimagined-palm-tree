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
            {/* Construction metadata badges */}
            <div className="citation-metadata">
              {citation.doc_type && (
                <span className={`badge doc-type-${citation.doc_type}`}>
                  {citation.doc_type.toUpperCase()}
                </span>
              )}
              {citation.discipline && (
                <span className="badge discipline">{citation.discipline}</span>
              )}
              {citation.section_reference && (
                <span className="badge section">§{citation.section_reference}</span>
              )}
            </div>
            {citation.standards_referenced && citation.standards_referenced.length > 0 && (
              <div className="citation-standards">
                {citation.standards_referenced.slice(0, 3).map((std, idx) => (
                  <span key={idx} className="badge standard">{std}</span>
                ))}
              </div>
            )}
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
