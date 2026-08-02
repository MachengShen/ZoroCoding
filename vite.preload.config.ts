import { resolve } from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    target: "node22",
    outDir: "dist-electron/preload",
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    lib: {
      entry: resolve("src/preload/index.ts"),
      formats: ["cjs"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: ["electron"],
      output: {
        intro: '"use strict";',
      },
    },
  },
});
