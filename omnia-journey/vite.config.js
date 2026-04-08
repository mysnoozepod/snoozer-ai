// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  base: "/",                    // absolute root for URLs
  plugins: [react()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  build: {
    outDir: "dist",
    assetsDir: "",              // put emitted assets at the ROOT of dist/
    cssCodeSplit: true,         // keep CSS separate so Tailwind utilities are preserved
    sourcemap: false,
    emptyOutDir: true,
    rollupOptions: {
      // prevent chunk-splitting so we only emit one JS entry file (app.js)
      output: {
        manualChunks: undefined,
        entryFileNames: "app.js",
        // Put all other assets (including CSS) at root with their original names
        assetFileNames: (assetInfo) => {
          // Force the main CSS bundle to be index.css at root
          if (assetInfo.name && assetInfo.name.endsWith(".css")) {
            return "index.css";
          }
          // images/fonts/etc keep their original names at root
          return "[name][extname]";
        },
      },
    },
  },
});
