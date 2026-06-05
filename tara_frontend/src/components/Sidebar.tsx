import { Plus, MessageSquare, TrendingUp, Trash2, Sparkles, BarChart2, CreditCard, Settings } from 'lucide-react';

export interface ChatSession {
  id: string;
  title: string;
  preview: string;
  timestamp: Date;
}

interface Props {
  sessions: ChatSession[];
  activeId: string;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const NAV_ITEMS = [
  { icon: MessageSquare, label: 'Chat',       id: 'chat' },
  { icon: BarChart2,     label: 'Portfolio',  id: 'portfolio' },
  { icon: CreditCard,    label: 'Spending',   id: 'spending' },
  { icon: Sparkles,      label: 'Insights',   id: 'insights' },
];

function timeLabel(d: Date): string {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)    return 'Just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

export default function Sidebar({ sessions, activeId, onNew, onSelect, onDelete }: Props) {
  return (
    <aside className="w-64 flex-shrink-0 flex flex-col h-full bg-dark relative z-10">

      {/* Logo */}
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl btn-gradient flex items-center justify-center shadow-accent animate-glow">
            <TrendingUp size={17} className="text-white" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="font-bold text-base text-textPrimary leading-none">Tara</h1>
            <p className="text-[10px] text-textMuted mt-0.5">Finance Agent</p>
          </div>
        </div>

        {/* New Chat */}
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-border bg-card hover:bg-cardHover hover:border-accent/40 transition-all duration-200 group text-sm font-medium text-textSecondary hover:text-textPrimary"
        >
          <Plus size={15} className="group-hover:text-accent transition-colors" />
          New conversation
        </button>
      </div>

      {/* Nav links */}
      <div className="px-3 mb-2">
        {NAV_ITEMS.map((item) => {
          const active = item.id === 'chat';
          return (
            <div
              key={item.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 cursor-pointer transition-all duration-150 text-sm
                ${active
                  ? 'btn-gradient text-white font-semibold shadow-accent'
                  : 'text-textSecondary hover:bg-card hover:text-textPrimary'
                }`}
            >
              <item.icon size={15} className={active ? 'text-white' : ''} />
              {item.label}
              {active && <span className="ml-auto text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full">Active</span>}
            </div>
          );
        })}
      </div>


      {/* Chat History */}
      <div className="flex-1 overflow-y-auto px-3 py-1 space-y-0.5">
        {sessions.length > 0 && (
          <p className="text-[10px] uppercase tracking-widest text-textMuted px-2 py-1.5">Recent Chats</p>
        )}
        {sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <MessageSquare size={28} className="text-textMuted opacity-30 mb-2" />
            <p className="text-[12px] text-textMuted">No chats yet</p>
            <p className="text-[11px] text-textMuted opacity-60 mt-0.5">Start a conversation above</p>
          </div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`
              group flex items-start gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-100
              ${s.id === activeId
                ? 'bg-accent/10 border border-accent/20 text-textPrimary'
                : 'hover:bg-card text-textSecondary hover:text-textPrimary border border-transparent'}
            `}
          >
            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${s.id === activeId ? 'bg-accent' : 'bg-textMuted/40'}`} />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium truncate leading-snug">{s.title}</p>
              <p className="text-[11px] text-textMuted truncate mt-0.5">{timeLabel(s.timestamp)}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-rose/20 hover:text-rose transition-all flex-shrink-0"
              title="Delete"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>

      {/* Bottom */}
      <div className="mx-3 mb-3 mt-1">
        <div className="flex items-center gap-2 px-2 py-2 rounded-xl hover:bg-card cursor-pointer transition-colors group">
          <Settings size={13} className="text-textMuted group-hover:text-textSecondary" />
          <span className="text-[12px] text-textMuted group-hover:text-textSecondary">Settings</span>
        </div>
        <div className="flex items-center gap-2.5 px-2 py-2.5 rounded-xl bg-card border border-border mt-1">
          <div className="w-7 h-7 rounded-full btn-gradient flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">T</div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-textPrimary truncate">Finance Agent</p>
            <p className="text-[10px] text-textMuted">Llama 4 Scout · Groq</p>
          </div>
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse-slow flex-shrink-0" />
        </div>
      </div>
    </aside>
  );
}
