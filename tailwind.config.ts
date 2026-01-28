import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./pages/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 40px rgba(125, 211, 252, 0.25)",
      },
      colors: {
        ink: "#0b0b10",
        panel: "#111320",
        haze: "#1c2236",
      },
    },
  },
  plugins: [],
};

export default config;
