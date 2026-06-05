import { Sparkles } from 'lucide-react';

const SUGGESTIONS = [
  'What was my biggest expense?',
  'How much did I spend on food last month?',
  'Which merchants look like recurring subscriptions?',
  'Compare food and travel spending',
  'What is my portfolio worth today?',
  'Which mutual fund gave the best return?',
  'Show me my top 5 merchants by spend',
  'What is my monthly subscription cost?',
];

interface Props {
  onSelect: (q: string) => void;
  disabled: boolean;
}

export default function SuggestedQuestions({ onSelect, disabled }: Props) {
  return (
    <div className="px-4 pb-3 animate-fade-in">
      <div className="flex items-center gap-1.5 text-xs text-tara-muted mb-2.5 px-1">
        <Sparkles size={11} />
        <span>Suggested questions</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => onSelect(q)}
            disabled={disabled}
            className="
              text-xs px-3 py-1.5 rounded-full border border-tara-border
              bg-tara-surface text-tara-muted
              hover:bg-tara-card hover:text-tara-text hover:border-tara-blue/50
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-all duration-150
            "
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
