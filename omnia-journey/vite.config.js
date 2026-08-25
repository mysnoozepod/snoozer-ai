// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { execSync } from "child_process";
import { readFileSync } from "fs";

function readBuildCommit() {
  try {
    return (
      process.env.VITE_BUILD_COMMIT ||
      execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim()
    );
  } catch {
    return process.env.VITE_BUILD_COMMIT || "unknown";
  }
}

function readFrontendVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8"));
    return process.env.VITE_FRONTEND_VERSION || pkg.version || "unknown";
  } catch {
    return process.env.VITE_FRONTEND_VERSION || "unknown";
  }
}

export default defineConfig({
  base: "/",                    // absolute root for URLs
  plugins: [react()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  define: {
    __SNOOZE_BUILD_COMMIT__: JSON.stringify(readBuildCommit()),
    __SNOOZE_BUILD_TIMESTAMP__: JSON.stringify(
      process.env.VITE_BUILD_TIMESTAMP || new Date().toISOString()
    ),
    __SNOOZE_FRONTEND_VERSION__: JSON.stringify(readFrontendVersion()),
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",        // Amplify explicitly passes /assets/* through before the SPA fallback
    cssCodeSplit: true,         // keep CSS separate so Tailwind utilities are preserved
    sourcemap: false,
    emptyOutDir: true,
    rollupOptions: {
      // Keep emitted application assets under /assets so the existing Amplify
      // routing contract serves them instead of rewriting them to index.html.
      // Fingerprint JS/CSS so manual deployments cannot reuse a stale bundle.
      output: {
        manualChunks: undefined,
        entryFileNames: "assets/app-[hash].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith(".css")) {
            return "assets/index-[hash][extname]";
          }
          return "assets/[name][extname]";
        },
      },
    },
  },
});
