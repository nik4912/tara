import { TrendingUp } from 'lucide-react';

export default function TypingIndicator() {
  return (
    <div className="px-4 py-3 animate-fade-in mx-1">
      <div className="max-w-3xl mx-auto flex gap-4">
        <div className="w-8 h-8 rounded-xl btn-gradient flex items-center justify-center flex-shrink-0 mt-0.5 shadow-accent">
          <TrendingUp size={14} className="text-white" strokeWidth={2.5} />
        </div>
        <div className="flex-1">
          <p className="text-[12px] font-bold gradient-text mb-2.5 tracking-wide">TARA</p>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-2 h-2 rounded-full bg-accent/60"
                style={{ animation: `blink 1.2s ${i * 0.2}s ease-in-out infinite` }}
              />
            ))}
            <span className="text-[13px] text-textMuted ml-2 italic">Analyzing your data…</span>
          </div>
        </div>
      </div>
    </div>
  );
}
