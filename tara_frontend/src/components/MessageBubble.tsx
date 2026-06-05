import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { TrendingUp, User, AlertCircle, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import type { Message } from '../types';

interface Props { message: Message; }

export default function MessageBubble({ message }: Props) {
  const [copied, setCopied] = useState(false);
  const isUser  = message.role === 'user';
  const isError = message.role === 'error';

  const copy = () => {
    navigator.clipboard.writeText(message.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (isUser) {
    return (
      <div className="flex justify-end px-3 md:px-4 py-2 animate-slide-up">
        <div className="flex items-end gap-2 md:gap-2.5 max-w-[88%] md:max-w-[72%]">
          <div className="glass border border-border/80 text-textPrimary px-4 py-3 rounded-2xl rounded-br-sm text-[15px] leading-relaxed shadow-card">
            {message.text}
          </div>
          <div className="w-8 h-8 rounded-full btn-gradient flex items-center justify-center flex-shrink-0 mb-0.5 shadow-accent">
            <User size={13} className="text-white" />
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex gap-3 px-4 py-3 animate-slide-up">
        <div className="w-8 h-8 rounded-xl bg-rose/15 border border-rose/30 flex items-center justify-center flex-shrink-0 mt-0.5">
          <AlertCircle size={14} className="text-rose" />
        </div>
        <div className="flex-1 glass border border-rose/20 rounded-xl px-4 py-3 text-rose text-[14px] leading-relaxed">
          <p className="font-medium mb-1">Something went wrong</p>
          <p className="text-rose/70 text-[13px]">{message.text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="group px-3 md:px-4 py-3 animate-slide-up hover:bg-white/[0.01] rounded-xl transition-colors mx-0.5 md:mx-1">
      <div className="max-w-3xl mx-auto flex gap-3 md:gap-4">
        {/* Avatar */}
        <div className="w-8 h-8 rounded-xl btn-gradient flex items-center justify-center flex-shrink-0 mt-0.5 shadow-accent">
          <TrendingUp size={14} className="text-white" strokeWidth={2.5} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-bold gradient-text mb-2.5 tracking-wide">TARA</p>
          <div className="prose-tara">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }) {
                  if (className?.includes('language-')) {
                    return (
                      <pre className="bg-navy border border-border rounded-xl p-4 mb-3 overflow-x-auto">
                        <code className="font-mono text-[13px] text-textPrimary" {...props}>{children}</code>
                      </pre>
                    );
                  }
                  return (
                    <code className="font-mono text-accent bg-accent/10 border border-accent/20 px-1.5 py-0.5 rounded text-[13px]" {...props}>
                      {children}
                    </code>
                  );
                },
                table({ children }) {
                  return (
                    <div className="overflow-x-auto mb-3 rounded-xl border border-border">
                      <table className="w-full border-collapse text-sm">{children}</table>
                    </div>
                  );
                },
                th({ children }) {
                  return <th className="text-left px-4 py-2.5 border-b border-border font-semibold text-textPrimary bg-navy/80 text-[13px]">{children}</th>;
                },
                td({ children }) {
                  return <td className="px-4 py-2.5 border-b border-border/40 text-[13px]">{children}</td>;
                },
              }}
            >
              {message.text}
            </ReactMarkdown>
          </div>

          {/* Copy */}
          <button
            onClick={copy}
            className="mt-2 flex items-center gap-1.5 text-[11px] text-textMuted hover:text-accent transition-colors opacity-0 group-hover:opacity-100"
          >
            {copied ? <Check size={11} className="text-accent" /> : <Copy size={11} />}
            {copied ? 'Copied!' : 'Copy response'}
          </button>
        </div>
      </div>
    </div>
  );
}
