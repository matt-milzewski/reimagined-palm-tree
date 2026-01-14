import { useEffect, useRef, useState } from 'react';
import { ChatMessage } from '../lib/useChat';

type ChatThreadProps = {
  messages: ChatMessage[];
  selectedMessageId?: string | null;
  onSelectMessage: (messageId: string) => void;
  onRetry: (messageId: string) => void;
};

export function ChatThread({ messages, selectedMessageId, onSelectMessage, onRetry }: ChatThreadProps) {
  const threadRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    const container = threadRef.current;
    if (!container || !autoScroll) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages, autoScroll]);

  const handleScroll = () => {
    const container = threadRef.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    setAutoScroll(distance < 120);
  };

  const handleCopy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch (err) {
      return;
    }
  };

  return (
    <div className="chat-thread" ref={threadRef} onScroll={handleScroll}>
      {messages.length === 0 && (
        <div className="chat-empty">
          <p>Ask a question to start the conversation.</p>
        </div>
      )}
      {messages.map((message) => (
        <div
          key={message.id}
          className={`chat-message ${message.role} ${selectedMessageId === message.id ? 'selected' : ''}`}
        >
          <div className="chat-bubble">
            <div className="chat-meta">
              <span className="chat-role">{message.role === 'user' ? 'You' : 'Assistant'}</span>
              <span className="chat-time">
                {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div className="chat-content">
              {message.content || (message.status === 'streaming' ? 'Thinking...' : '')}
            </div>
            {message.role === 'assistant' && (
              <div className="chat-actions">
                <button
                  className="btn secondary"
                  onClick={() => handleCopy(message.content || '')}
                  aria-label="Copy message to clipboard"
                >
                  Copy
                </button>
                {message.status === 'error' && (
                  <button
                    className="btn"
                    onClick={() => onRetry(message.id)}
                    aria-label="Retry sending this message"
                  >
                    Retry
                  </button>
                )}
                <button
                  className="btn ghost"
                  onClick={() => onSelectMessage(message.id)}
                  aria-label="View citations for this message"
                >
                  Citations
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
