import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#172033',
        paper: '#f7f5ff',
        leaf: '#266f85',
        moss: '#e7e5ff',
        honey: '#ffcf70',
        coral: '#ff8a7a',
        skyglass: '#dff7ff',
      },
    },
  },
  plugins: [],
} satisfies Config;
