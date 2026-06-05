import { TrendingUp } from 'lucide-react';

export default function TypingIndicator() {
  return (
    <div className="flex gap-3 animate-fade-in">
      {/* Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-tara-green/15 border border-tara-green/30">
        <TrendingUp size={14} className="text-tara-green" />
      </div>

      {/* Dots */}
      <div className="flex items-center gap-1 bg-tara-card border border-tara-border px-4 py-3 rounded-2xl rounded-tl-sm">
        <span className="w-1.5 h-1.5 rounded-full bg-tara-muted animate-bounce [animation-delay:-0.3s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-tara-muted animate-bounce [animation-delay:-0.15s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-tara-muted animate-bounce" />
      </div>
    </div>
  );
}
