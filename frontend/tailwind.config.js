/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#FAF9F7",
        card: "#FFFFFF",
        edge: "#E8E5E0",
        edgeDark: "#D8D4CC",
        ink: "#1C1B1A",
        mute: "#6B6862",
        faint: "#9B968C",
        brand: {
          DEFAULT: "#B45309",
          soft: "#F5EBDD",
          hover: "#92400E",
        },
        jade: {
          DEFAULT: "#0F766E",
          soft: "#E4F0EE",
          hover: "#115E59",
        },
        rise: "#D14343",
        fall: "#2E9E5B",
      },
      fontFamily: {
        serif: ['"Noto Serif SC"', '"Songti SC"', "STSong", "serif"],
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          "sans-serif",
        ],
        mono: ['"SF Mono"', "Menlo", "Consolas", '"Liberation Mono"', "monospace"],
      },
      borderRadius: {
        card: "12px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(28, 27, 26, 0.04)",
        pop: "0 8px 28px rgba(28, 27, 26, 0.10)",
      },
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        fadeUp: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
      },
      animation: {
        blink: "blink 1s step-end infinite",
        fadeUp: "fadeUp .28s ease-out both",
        shimmer: "shimmer 1.4s linear infinite",
      },
    },
  },
  plugins: [],
};
