import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src/renderer") },
  },
  server: {
    host: "127.0.0.1",
    port: 43123,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:43124",
      "/vm": { target: "http://127.0.0.1:43124", ws: true },
    },
  },
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
  },
});
