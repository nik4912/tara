import { TrendingUp, User, AlertCircle } from 'lucide-react';
import type { Message } from '../types';

interface Props {
  message: Message;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

/** Very light markdown renderer: bolds **text** and renders newlines */
function renderText(text: string) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={i}>
        {parts.map((part, j) =>
          part.startsWith('**') && part.endsWith('**') ? (
            <strong key={j} className="font-semibold text-tara-text">
              {part.slice(2, -2)}
            </strong>
          ) : (
            <span key={j}>{part}</span>
          )
        )}
        {i < lines.length - 1 && <br />}
      </span>
    );
  });
}

export default function MessageBubble({ message }: Props) {
  const isUser  = message.role === 'user';
  const isError = message.role === 'error';
  const isTara  = message.role === 'tara';

  return (
    <div className={`flex gap-3 animate-slide-up ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`
        flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5
        ${isUser  ? 'bg-tara-user/20 border border-tara-user/40' : ''}
        ${isTara  ? 'bg-tara-green/15 border border-tara-green/30' : ''}
        ${isError ? 'bg-red-500/15 border border-red-500/30' : ''}
      `}>
        {isUser  && <User size={14} className="text-tara-blue" />}
        {isTara  && <TrendingUp size={14} className="text-tara-green" />}
        {isError && <AlertCircle size={14} className="text-red-400" />}
      </div>

      {/* Bubble */}
      <div className={`max-w-[78%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div className={`
          px-4 py-3 rounded-2xl text-sm leading-relaxed
          ${isUser  ? 'bg-tara-user text-white rounded-tr-sm' : ''}
          ${isTara  ? 'bg-tara-card border border-tara-border text-tara-text rounded-tl-sm' : ''}
          ${isError ? 'bg-red-950/50 border border-red-800/50 text-red-300 rounded-tl-sm' : ''}
        `}>
          {isError ? (
            <span>{message.text}</span>
          ) : (
            renderText(message.text)
          )}
        </div>
        <span className="text-tara-muted text-[10px] px-1">{formatTime(message.timestamp)}</span>
      </div>
    </div>
  );
}
