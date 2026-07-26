/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        mae: {
          bg:               '#0d0d0d',
          surface:          '#161616',
          'bubble-assistant': '#1a1a1a',
          'bubble-user':    '#1e1e1e',
          border:           '#2a2a2a',
          text:             '#f2f2f2',
          muted:            '#8a8a8a',
          accent:           '#d8e778',
          'accent-on':      '#0d0d0d',
          error:            '#f85149',
          'error-bg':       'rgba(248, 81, 73, 0.12)',
          progress:         '#5b8fd6',
          'progress-bg':    'rgba(91, 143, 214, 0.12)',
        },
      },
      fontFamily: {
        sans: ['Maitree', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        'chat': ['0.9375rem', { lineHeight: '1.6' }],
        'sidebar-title': ['0.8125rem', { lineHeight: '1.4', fontWeight: '500' }],
        'sidebar-meta': ['0.75rem', { lineHeight: '1.4', fontWeight: '400' }],
        'label': ['0.6875rem', { lineHeight: '1.4', fontWeight: '600' }],
        'topbar': ['0.875rem', { lineHeight: '1.4', fontWeight: '600' }],
      },
      maxWidth: {
        'chat-col': '820px',
        'chat-col-wide': '900px',
      },
      keyframes: {
        'message-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'typing-bounce': {
          '0%, 60%, 100%': { opacity: '0.2', transform: 'translateY(0)' },
          '30%':           { opacity: '1', transform: 'translateY(-5px)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '0.4' },
          '50%':      { opacity: '0.7' },
        },
      },
      animation: {
        'message-in': 'message-in 0.18s ease-out',
        'typing-bounce': 'typing-bounce 1.2s ease-in-out infinite',
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};