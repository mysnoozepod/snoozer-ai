// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  // Keep base at "/" for Amplify hosting
  base: '/',

  plugins: [react()],

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },

  css: {
    postcss: {
      plugins: [require('tailwindcss'), require('autoprefixer')],
    },
  },

  // Use Vite defaults for build → ensures /public assets work correctly
  build: {
    outDir: 'dist',
  },
})
