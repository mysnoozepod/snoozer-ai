/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        omniaPurple: "#4B3CFA",
        omniaGold: "#FFD700",
        omniaDark: "#1A1A1A",
        omniaGray: "#F3F4F6",
      },
      fontFamily: {
        heading: ["Poppins", "sans-serif"],
      },
    },
  },
  safelist: [
    // critical classes used on Welcome hero so we can immediately verify CSS exists
    "w-40","md:w-48","h-auto","w-16","h-16","max-w-lg",
    "rounded-3xl","shadow-2xl","p-10","text-center","flex","items-center","gap-6",
    "bg-white","bg-gradient-to-b"
  ],
  plugins: [],
};
