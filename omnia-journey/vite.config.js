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
    assetsDir: "",              // put emitted assets at the ROOT of dist/
    cssCodeSplit: true,         // keep CSS separate so Tailwind utilities are preserved
    sourcemap: false,
    emptyOutDir: true,
    rollupOptions: {
      // Keep a single JS entry, but fingerprint JS/CSS so a manual Amplify
      // deployment cannot reuse the previous showroom bundle from browser/CDN cache.
      output: {
        manualChunks: undefined,
        entryFileNames: "app-[hash].js",
        // Put all other assets (including CSS) at root with their original names
        assetFileNames: (assetInfo) => {
          // Keep the main stylesheet at root and fingerprint it with the build.
          if (assetInfo.name && assetInfo.name.endsWith(".css")) {
            return "index-[hash][extname]";
          }
          // images/fonts/etc keep their original names at root
          return "[name][extname]";
        },
      },
    },
  },
});
