/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        mae: {
          bg:                 '#fafbf8',
          surface:            '#ffffff',
          sidebar:            '#f2f5f6',
          'bubble-assistant': '#e7edf1',
          'bubble-user':      '#e5edf6',
          border:             '#d4dce4',
          text:               '#121f38',
          muted:              '#495870',
          accent:             '#274a76',
          'accent-soft':      '#edf5cf',
          'accent-on':        '#ffffff',
          lime:               '#d9ef62',
          error:              '#a12630',
          'error-bg':         '#f9e8ea',
          progress:           '#345d91',
          'progress-bg':      '#e4edf9',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'sans-serif'],
        display: ['Maitree', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        'chat': ['1.0625rem', { lineHeight: '1.65' }],
        'sidebar-title': ['0.9375rem', { lineHeight: '1.4', fontWeight: '500' }],
        'sidebar-meta': ['0.8125rem', { lineHeight: '1.4', fontWeight: '400' }],
        'label': ['0.6875rem', { lineHeight: '1.4', fontWeight: '600' }],
        'topbar': ['0.875rem', { lineHeight: '1.4', fontWeight: '600' }],
      },
      maxWidth: {
        'chat-col': '51rem',
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