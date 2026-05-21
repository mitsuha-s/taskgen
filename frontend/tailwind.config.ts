import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#111827',
        paper: '#e9eef5',
        graphite: '#101820',
        steel: '#cbd5e1',
        signal: '#0f766e',
        ai: '#0891b2',
        warning: '#d97706',
      },
    },
  },
  plugins: [],
} satisfies Config;
