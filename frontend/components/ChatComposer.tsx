import { useState } from 'react';

type ChatComposerProps = {
  disabled?: boolean;
  onSend: (message: string) => Promise<void> | void;
};

export function ChatComposer({ disabled, onSend }: ChatComposerProps) {
  const [value, setValue] = useState('');

  const handleSend = async () => {
    if (!value.trim()) return;
    await onSend(value);
    setValue('');
  };

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      await handleSend();
    }
  };

  return (
    <div className="chat-composer">
      <label htmlFor="chat-message-input" className="sr-only">
        Message
      </label>
      <textarea
        id="chat-message-input"
        className="input chat-input"
        placeholder="Ask about the selected dataset..."
        rows={3}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-label="Type your message"
      />
      <button
        className="btn"
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        aria-label="Send message"
      >
        Send
      </button>
    </div>
  );
}
