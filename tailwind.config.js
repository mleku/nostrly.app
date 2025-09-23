/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          accent: '#00d4aa',
        },
        text: {
          base: '#cccccc',
        },
        bg: {
          app: '#162a2f',
          panel: '#263238',
          hover: '#1b3a40',
          header: '#000000',
        },
        border: {
          strong: '#000000',
        },
      },
      maxWidth: {
        content: '1200px',
      },
      boxShadow: {
        modal: '0 10px 30px rgba(0, 0, 0, 0.4)',
      },
    },
  },
  plugins: [],
}
