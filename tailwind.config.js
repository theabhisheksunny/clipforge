/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark, professional editor palette
        panel: {
          DEFAULT: '#1a1b1e',
          raised: '#212226',
          sunken: '#141518',
          border: '#2a2b30',
        },
        accent: {
          DEFAULT: '#4f8cff',
          hover: '#6ba1ff',
          muted: '#2d4a7a',
        },
        track: {
          video: '#2a3a52',
          audio: '#2a4a3a',
          image: '#4a3a52',
          text: '#52443a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
