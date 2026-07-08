/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        obsidian: {
          900: "#050505",
          800: "#0a0a0a",
          700: "#121212",
          600: "#1a1a1a",
        },
        fever: {
          100: "#ffe5e5",
          300: "#ff9999",
          500: "#ff4d4d",
          700: "#ff0000",
          900: "#cc0000",
        },
        signal: {
          100: "#e5ffe5",
          300: "#99ff99",
          500: "#00ff00",
          700: "#00cc00",
          900: "#009900",
        },
        cyber: {
          blue: "#00f0ff",
          purple: "#bf00ff",
          yellow: "#ffe600",
        }
      },
      fontFamily: {
        mono: ['"Space Mono"', "monospace"],
        sans: ['"Inter"', "sans-serif"],
      },
      animation: {
        'pulse-fast': 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scanline': 'scanline 8s linear infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(255, 0, 0, 0.2), inset 0 0 5px rgba(255, 0, 0, 0.1)' },
          '100%': { boxShadow: '0 0 20px rgba(255, 0, 0, 0.6), inset 0 0 10px rgba(255, 0, 0, 0.2)' },
        }
      }
    },
  },
  plugins: [],
};
