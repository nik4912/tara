/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy:    '#080c14',
        dark:    '#0d1117',
        card:    '#111827',
        cardHover: '#151d2e',
        border:  '#1e2d45',
        accent:  '#10b981',
        accent2: '#6366f1',
        gold:    '#f59e0b',
        rose:    '#f43f5e',
        sky:     '#38bdf8',
        textPrimary: '#f1f5f9',
        textSecondary: '#94a3b8',
        textMuted: '#4b6075',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      backgroundImage: {
        'gradient-accent': 'linear-gradient(135deg, #10b981 0%, #6366f1 100%)',
        'gradient-card':   'linear-gradient(145deg, #111827 0%, #0d1520 100%)',
        'gradient-sidebar-active': 'linear-gradient(135deg, #10b981 0%, #6366f1 100%)',
      },
      animation: {
        'fade-in':    'fadeIn 0.25s ease-out',
        'slide-up':   'slideUp 0.2s ease-out',
        'pulse-slow': 'pulse 2.5s cubic-bezier(0.4,0,0.6,1) infinite',
        'float':      'float 6s ease-in-out infinite',
        'glow':       'glow 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(10px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        float:   { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        glow:    { '0%,100%': { boxShadow: '0 0 20px rgba(16,185,129,0.2)' }, '50%': { boxShadow: '0 0 40px rgba(16,185,129,0.4)' } },
      },
      boxShadow: {
        'accent': '0 0 20px rgba(16,185,129,0.25)',
        'card':   '0 4px 24px rgba(0,0,0,0.4)',
        'glow':   '0 0 40px rgba(99,102,241,0.2)',
      },
    },
  },
  plugins: [],
};
