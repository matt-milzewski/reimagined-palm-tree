import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest, ApiError } from './api';

export type Citation = {
  chunk_id: string;
  filename: string;
  page?: number | null;
  snippet?: string;
  score?: number;
  doc_id?: string;
  // Construction-specific metadata
  doc_type?: string;
  discipline?: string;
  section_reference?: string;
  standards_referenced?: string[];
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  status: 'streaming' | 'done' | 'error';
  created_at: string;
};

type ChatState = {
  messages: ChatMessage[];
  selectedMessageId?: string | null;
  conversationId?: string | null;
  isSending: boolean;
  error?: string;
};

type UseChatParams = {
  datasetId?: string;
  accessToken?: string;
  topK?: number;
};

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `msg_${Math.random().toString(36).slice(2)}`;
}

export function useChat({ datasetId, accessToken, topK }: UseChatParams) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    selectedMessageId: null,
    conversationId: null,
    isSending: false
  });

  useEffect(() => {
    setState({ messages: [], selectedMessageId: null, conversationId: null, isSending: false });
  }, [datasetId]);

  const selectMessage = useCallback((messageId: string) => {
    setState((prev) => ({ ...prev, selectedMessageId: messageId }));
  }, []);

  const updateMessage = useCallback((messageId: string, updates: Partial<ChatMessage>) => {
    setState((prev) => ({
      ...prev,
      messages: prev.messages.map((message) =>
        message.id === messageId ? { ...message, ...updates } : message
      )
    }));
  }, []);

  const executeChat = useCallback(
    async (content: string, assistantMessageId: string) => {
      if (!datasetId || !accessToken) {
        setState((prev) => ({ ...prev, error: 'Missing dataset or session.' }));
        return;
      }

      setState((prev) => ({ ...prev, isSending: true, error: undefined }));

      try {
        const response = await apiRequest<{
          conversation_id: string;
          message_id: string;
          answer: string;
          citations: Citation[];
        }>('/chat', {
          method: 'POST',
          accessToken,
          body: {
            dataset_id: datasetId,
            conversation_id: state.conversationId,
            message: content,
            top_k: topK
          }
        });

        setState((prev) => ({
          ...prev,
          conversationId: response.conversation_id,
          selectedMessageId: assistantMessageId,
          messages: prev.messages.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  content: response.answer,
                  citations: response.citations,
                  status: 'done'
                }
              : message
          ),
          isSending: false
        }));
      } catch (error) {
        let errorContent = 'Something went wrong. Please retry.';
        let errorMessage = 'Failed to send message.';

        if (error instanceof ApiError) {
          if (error.status === 409) {
            errorContent = error.message || 'Dataset is not ready for chat.';
            errorMessage = errorContent;
          } else if (error.status === 404) {
            errorContent = error.message || 'Resource not found.';
            errorMessage = errorContent;
          } else if (error.status === 401 || error.status === 403) {
            errorContent = 'Session expired. Please refresh and try again.';
            errorMessage = 'Authentication error.';
          } else if (error.status >= 500) {
            errorContent = 'Server error. Please try again in a moment.';
            errorMessage = error.message || 'Server error occurred.';
          } else {
            errorContent = error.message || errorContent;
            errorMessage = error.message || errorMessage;
          }
        } else if (error instanceof Error) {
          if (error.message.includes('fetch') || error.message.includes('network')) {
            errorContent = 'Network error. Check your connection and retry.';
            errorMessage = 'Network error.';
          }
        }

        updateMessage(assistantMessageId, {
          status: 'error',
          content: errorContent
        });
        setState((prev) => ({
          ...prev,
          isSending: false,
          error: errorMessage
        }));
      }
    },
    [accessToken, datasetId, topK, state.conversationId, updateMessage]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const userMessage: ChatMessage = {
        id: newId(),
        role: 'user',
        content: trimmed,
        status: 'done',
        created_at: nowIso()
      };

      const assistantMessageId = newId();
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        status: 'streaming',
        created_at: nowIso()
      };

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage, assistantMessage]
      }));

      await executeChat(trimmed, assistantMessageId);
    },
    [executeChat]
  );

  const retryMessage = useCallback(
    async (assistantId: string) => {
      const assistantIndex = state.messages.findIndex((message) => message.id === assistantId);
      if (assistantIndex < 0) return;

      const userMessage = [...state.messages]
        .slice(0, assistantIndex)
        .reverse()
        .find((message) => message.role === 'user');
      if (!userMessage) return;

      updateMessage(assistantId, { status: 'streaming', content: '' });
      await executeChat(userMessage.content, assistantId);
    },
    [executeChat, state.messages, updateMessage]
  );

  const selectedMessage = useMemo(
    () => state.messages.find((message) => message.id === state.selectedMessageId),
    [state.messages, state.selectedMessageId]
  );

  return {
    messages: state.messages,
    selectedMessage,
    selectedMessageId: state.selectedMessageId,
    conversationId: state.conversationId,
    isSending: state.isSending,
    error: state.error,
    sendMessage,
    retryMessage,
    selectMessage
  };
}
