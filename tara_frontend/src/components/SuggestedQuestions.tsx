import { TrendingUp, CreditCard, PieChart, Search, Repeat, BarChart2, DollarSign, Award } from 'lucide-react';

const SUGGESTIONS = [
  { icon: CreditCard,  color: 'text-sky',    bg: 'bg-sky/10 border-sky/20',    label: 'Biggest Expense',      text: 'What was my single biggest expense?' },
  { icon: PieChart,    color: 'text-accent',  bg: 'bg-accent/10 border-accent/20', label: 'Spending Breakdown',  text: 'Show me my total spending by category' },
  { icon: TrendingUp,  color: 'text-accent2', bg: 'bg-accent2/10 border-accent2/20', label: 'Portfolio Value',  text: 'What is my portfolio worth today and how much have I made?' },
  { icon: Repeat,      color: 'text-gold',    bg: 'bg-gold/10 border-gold/20',  label: 'Subscriptions',        text: 'Which merchants look like recurring subscriptions?' },
  { icon: Search,      color: 'text-rose',    bg: 'bg-rose/10 border-rose/20',  label: 'Top Merchants',        text: 'What are my top 5 merchants by net spend?' },
  { icon: BarChart2,   color: 'text-sky',     bg: 'bg-sky/10 border-sky/20',    label: 'Food vs Travel',       text: 'Compare my food and travel spending month by month' },
  { icon: Award,       color: 'text-accent',  bg: 'bg-accent/10 border-accent/20', label: 'Best Fund Return', text: 'Which mutual fund gave me the best return since I bought it?' },
  { icon: DollarSign,  color: 'text-gold',    bg: 'bg-gold/10 border-gold/20',  label: 'Monthly Trends',      text: 'Show me a month-by-month breakdown of my total spending' },
];

interface Props {
  onSelect: (q: string) => void;
  disabled: boolean;
}

export default function SuggestedQuestions({ onSelect, disabled }: Props) {
  return (
    <div className="w-full max-w-2xl mx-auto px-4 animate-fade-in">
      <p className="text-[11px] text-textMuted uppercase tracking-widest text-center mb-4">Quick Actions</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-2.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.text}
            onClick={() => onSelect(s.text)}
            disabled={disabled}
            className={`
              flex items-center gap-3 text-left px-4 py-3.5 rounded-xl border
              ${s.bg} hover:scale-[1.02] active:scale-[0.99]
              disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100
              transition-all duration-200 group glass
            `}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${s.bg}`}>
              <s.icon size={15} className={s.color} />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-textPrimary">{s.label}</p>
              <p className="text-[11px] text-textMuted truncate mt-0.5">{s.text}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
