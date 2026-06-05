import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Square, TrendingUp, Menu, X, Bell, Zap } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import Sidebar, { type ChatSession } from './components/Sidebar';
import MessageBubble from './components/MessageBubble';
import TypingIndicator from './components/TypingIndicator';
import SuggestedQuestions from './components/SuggestedQuestions';
import { askTara } from './api';
import type { Message } from './types';

function makeWelcome(): Message {
  return {
    id: 'welcome',
    role: 'tara',
    text: "Hi! I'm **Tara**, your personal Finance Research Agent.\n\nI answer questions about your spending, investments, and subscriptions using your actual data — every number comes directly from your database, never guessed.\n\nWhat would you like to know today?",
    timestamp: new Date(),
  };
}

interface ConversationState {
  messages: Message[];
  showSuggestions: boolean;
}

export default function App() {
  const [sessions, setSessions]           = useState<ChatSession[]>([]);
  const [activeId, setActiveId]           = useState<string>('new');
  const [conversations, setConversations] = useState<Record<string, ConversationState>>({
    new: { messages: [makeWelcome()], showSuggestions: true },
  });
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  // On mobile: default closed; on desktop: default open
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  const current = conversations[activeId] ?? { messages: [makeWelcome()], showSuggestions: true };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [current.messages, loading]);

  // Close sidebar on mobile when window resizes down
  useEffect(() => {
    const handler = () => {
      if (window.innerWidth < 768) setSidebarOpen(false);
      else setSidebarOpen(true);
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const updateConv = (id: string, patch: Partial<ConversationState>) =>
    setConversations((p) => ({ ...p, [id]: { ...p[id], ...patch } }));

  const sendMessage = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || loading) return;

    // Close sidebar on mobile after sending
    if (window.innerWidth < 768) setSidebarOpen(false);

    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';

    const isFirst = activeId === 'new' && current.messages.length <= 1;
    let sid = activeId;

    if (isFirst) {
      sid = uuidv4();
      const title = question.length > 38 ? question.slice(0, 38) + '…' : question;
      setSessions((p) => [{ id: sid, title, preview: question, timestamp: new Date() }, ...p]);
      setConversations((p) => ({
        ...p,
        [sid]: { ...p['new'] },
        new: { messages: [makeWelcome()], showSuggestions: true },
      }));
      setActiveId(sid);
    }

    const baseMessages = isFirst
      ? (conversations['new']?.messages ?? [makeWelcome()])
      : (conversations[sid]?.messages ?? []);

    const userMsg: Message = { id: uuidv4(), role: 'user', text: question, timestamp: new Date() };
    setConversations((p) => ({
      ...p,
      [sid]: { showSuggestions: false, messages: [...(p[sid]?.messages ?? baseMessages), userMsg] },
    }));

    setLoading(true);
    try {
      const answer = await askTara(question);
      const taraMsg: Message = { id: uuidv4(), role: 'tara', text: answer, timestamp: new Date() };
      setConversations((p) => ({
        ...p,
        [sid]: { ...p[sid], messages: [...(p[sid]?.messages ?? []), taraMsg] },
      }));
      setSessions((p) => p.map((s) => s.id === sid ? { ...s, preview: answer.slice(0, 60) } : s));
    } catch (err) {
      const errMsg: Message = {
        id: uuidv4(), role: 'error',
        text: err instanceof Error ? err.message : 'Something went wrong.',
        timestamp: new Date(),
      };
      setConversations((p) => ({
        ...p,
        [sid]: { ...p[sid], messages: [...(p[sid]?.messages ?? []), errMsg] },
      }));
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [loading, activeId, conversations, current.messages.length]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  };

  const isEmpty = current.messages.length <= 1 && current.showSuggestions;
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#080c14' }}>

      {/* Stars background */}
      <div className="stars-bg" />

      {/* Ambient glows */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-accent2/5 rounded-full blur-3xl" />
      </div>

      {/* Sidebar — slide-over on mobile, inline on desktop */}
      {sidebarOpen && (
        <>
          {/* Mobile backdrop */}
          <div
            className="md:hidden fixed inset-0 bg-black/60 z-20 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="fixed md:relative inset-y-0 left-0 z-30 md:z-10 w-64 flex-shrink-0">
            <Sidebar
              sessions={sessions}
              activeId={activeId}
              onNew={() => {
                setActiveId('new');
                setInput('');
                if (window.innerWidth < 768) setSidebarOpen(false);
                setTimeout(() => inputRef.current?.focus(), 100);
              }}
              onSelect={(id) => {
                setActiveId(id);
                setInput('');
                if (window.innerWidth < 768) setSidebarOpen(false);
              }}
              onDelete={(id) => {
                setSessions((p) => p.filter((s) => s.id !== id));
                setConversations((p) => { const c = { ...p }; delete c[id]; return c; });
                if (activeId === id) setActiveId('new');
              }}
            />
          </div>
        </>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">

        {/* Top bar */}
        <div className="flex items-center gap-2 md:gap-3 px-3 md:px-5 py-3 md:py-3.5 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-textMuted hover:text-textPrimary hover:bg-card transition-colors flex-shrink-0"
          >
            {sidebarOpen && !isMobile ? <X size={15} /> : <Menu size={15} />}
          </button>

          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg btn-gradient flex items-center justify-center shadow-accent flex-shrink-0">
              <TrendingUp size={13} className="text-white" strokeWidth={2.5} />
            </div>
            <div className="hidden sm:block">
              <span className="font-semibold text-textPrimary text-sm">Tara</span>
              <span className="ml-2 text-[11px] text-textMuted">Finance Research Agent</span>
            </div>
            <span className="sm:hidden font-semibold text-textPrimary text-sm">Tara</span>
          </div>

          <div className="ml-auto flex items-center gap-1.5 md:gap-2">
            <div className="flex items-center gap-1.5 px-2 md:px-2.5 py-1 rounded-full bg-accent/10 border border-accent/20">
              <Zap size={11} className="text-accent" />
              <span className="text-[11px] text-accent font-medium hidden sm:inline">Live</span>
            </div>
            <button className="w-8 h-8 rounded-lg flex items-center justify-center text-textMuted hover:text-textPrimary hover:bg-card transition-colors relative">
              <Bell size={14} />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-accent rounded-full" />
            </button>
          </div>
        </div>

        {/* Messages / Empty state */}
        <div className="flex-1 overflow-y-auto">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center min-h-full px-4 py-8 md:pb-10">
              <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl btn-gradient flex items-center justify-center mb-4 md:mb-5 shadow-accent animate-float">
                <TrendingUp size={26} className="text-white" strokeWidth={2} />
              </div>
              <h1 className="text-2xl md:text-3xl font-bold mb-2">
                <span className="gradient-text">Good evening!</span>
              </h1>
              <p className="text-textSecondary text-[14px] md:text-[15px] mb-2 text-center max-w-sm md:max-w-md">
                Ask Tara anything about your finances.
              </p>
              <p className="text-textMuted text-[11px] md:text-[12px] mb-8 md:mb-10 text-center">
                Every answer is sourced from your database — never hallucinated.
              </p>
              <SuggestedQuestions onSelect={sendMessage} disabled={loading} />
            </div>
          ) : (
            <div className="max-w-3xl mx-auto w-full py-2 md:py-4">
              {current.messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {loading && <TypingIndicator />}
              <div ref={bottomRef} className="h-4 md:h-6" />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="flex-shrink-0 px-3 md:px-4 pb-3 md:pb-5 pt-2 md:pt-3">
          <div className="max-w-3xl mx-auto">
            <div className="relative rounded-xl md:rounded-2xl border border-border/80 bg-card/80 focus-within:border-accent/40 focus-within:shadow-accent transition-all duration-200 shadow-card">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Ask Tara about your finances…"
                disabled={loading}
                className="
                  w-full bg-transparent text-textPrimary placeholder-textMuted
                  text-[14px] md:text-[15px] resize-none outline-none
                  px-4 md:px-5 py-3 md:py-4 pr-12 md:pr-14 leading-relaxed
                  disabled:opacity-60 min-h-[48px] md:min-h-[54px] max-h-48 md:max-h-52
                "
              />
              <button
                onClick={() => !loading && sendMessage(input)}
                disabled={!input.trim() && !loading}
                className={`
                  absolute right-2.5 md:right-3 bottom-2.5 md:bottom-3 w-8 md:w-9 h-8 md:h-9 rounded-lg md:rounded-xl
                  flex items-center justify-center transition-all duration-150
                  ${input.trim() && !loading
                    ? 'btn-gradient text-white shadow-accent'
                    : loading
                    ? 'bg-card border border-border text-textMuted cursor-pointer hover:border-rose/40 hover:text-rose'
                    : 'bg-card border border-border text-textMuted opacity-50 cursor-not-allowed'
                  }
                `}
              >
                {loading ? <Square size={12} fill="currentColor" /> : <Send size={13} strokeWidth={2.5} />}
              </button>
            </div>

            {/* Footer hint — hidden on small phones */}
            <div className="hidden sm:flex items-center justify-center gap-3 md:gap-4 mt-2">
              <span className="text-[11px] text-textMuted">
                <kbd className="px-1.5 py-0.5 bg-card rounded border border-border text-[10px]">Enter</kbd> send
              </span>
              <span className="text-textMuted/30 text-[10px]">·</span>
              <span className="text-[11px] text-textMuted">
                <kbd className="px-1.5 py-0.5 bg-card rounded border border-border text-[10px]">Shift+Enter</kbd> new line
              </span>
              <span className="text-textMuted/30 text-[10px]">·</span>
              <span className="text-[11px] text-textMuted">All data from PostgreSQL</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
