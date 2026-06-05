import { TrendingUp } from 'lucide-react';

export default function Header() {
  return (
    <header className="flex items-center gap-3 px-6 py-4 border-b border-tara-border bg-tara-surface/80 backdrop-blur-sm sticky top-0 z-10">
      {/* Logo */}
      <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-tara-green to-tara-blue shadow-lg shadow-tara-green/20">
        <TrendingUp size={18} className="text-tara-bg" strokeWidth={2.5} />
      </div>

      {/* Name + tagline */}
      <div>
        <h1 className="text-tara-text font-semibold text-base leading-tight tracking-tight">
          Tara
          <span className="ml-2 text-xs font-normal px-1.5 py-0.5 rounded-full bg-tara-greenDim/30 text-tara-green border border-tara-greenDim/40">
            Finance Agent
          </span>
        </h1>
        <p className="text-tara-muted text-xs mt-0.5">Powered by your data · Never hallucinates</p>
      </div>

      {/* Status dot */}
      <div className="ml-auto flex items-center gap-1.5 text-xs text-tara-muted">
        <span className="w-2 h-2 rounded-full bg-tara-green animate-pulse-slow" />
        Online
      </div>
    </header>
  );
}
