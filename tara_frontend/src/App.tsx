import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, RotateCcw } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import Header from './components/Header';
import MessageBubble from './components/MessageBubble';
import TypingIndicator from './components/TypingIndicator';
import SuggestedQuestions from './components/SuggestedQuestions';
import { askTara } from './api';
import type { Message } from './types';

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'tara',
  text: "Hi! I'm **Tara**, your Finance Research Agent 💹\n\nI can answer questions about your spending, investments, and subscriptions — all from your actual data, never guessed.\n\nWhat would you like to know?",
  timestamp: new Date(),
};

export default function App() {
  const [messages, setMessages]     = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || loading) return;

    setShowSuggestions(false);
    setInput('');

    // Add user message
    const userMsg: Message = {
      id: uuidv4(),
      role: 'user',
      text: question,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const answer = await askTara(question);
      const taraMsg: Message = {
        id: uuidv4(),
        role: 'tara',
        text: answer,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, taraMsg]);
    } catch (err) {
      const errMsg: Message = {
        id: uuidv4(),
        role: 'error',
        text: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
      // Refocus input after response
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [loading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleReset = () => {
    setMessages([WELCOME_MESSAGE]);
    setShowSuggestions(true);
    setInput('');
    inputRef.current?.focus();
  };

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
  };

  return (
    <div className="flex flex-col h-screen bg-tara-bg font-sans max-w-3xl mx-auto">
      <Header />

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {loading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Suggested questions — shown only at start */}
      {showSuggestions && !loading && (
        <SuggestedQuestions
          onSelect={(q) => sendMessage(q)}
          disabled={loading}
        />
      )}

      {/* Input bar */}
      <div className="px-4 pb-5 pt-2 border-t border-tara-border bg-tara-bg">
        <div className="flex items-end gap-2 bg-tara-surface border border-tara-border rounded-2xl px-4 py-3 focus-within:border-tara-blue/60 transition-colors">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask Tara anything about your finances…"
            disabled={loading}
            className="
              flex-1 bg-transparent text-tara-text placeholder-tara-muted
              text-sm resize-none outline-none leading-relaxed
              disabled:opacity-50 min-h-[24px] max-h-40
            "
          />

          <div className="flex items-center gap-1.5 pb-0.5">
            {/* Reset button */}
            <button
              onClick={handleReset}
              title="Start new conversation"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-tara-muted hover:text-tara-text hover:bg-tara-card transition-colors"
            >
              <RotateCcw size={13} />
            </button>

            {/* Send button */}
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              className="
                w-8 h-8 flex items-center justify-center rounded-xl
                bg-tara-green text-tara-bg font-medium
                hover:bg-tara-green/90 active:scale-95
                disabled:opacity-30 disabled:cursor-not-allowed
                transition-all duration-150
              "
            >
              <Send size={14} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        <p className="text-center text-tara-muted text-[10px] mt-2">
          Shift+Enter for new line · All answers sourced from your PostgreSQL data
        </p>
      </div>
    </div>
  );
}
