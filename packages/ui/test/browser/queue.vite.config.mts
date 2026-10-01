import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwind()],
  // 队列场景只消费实际 test IDs 与默认语言，避免拉入无关业务入口。
  resolve: {
    alias: [
      { find: "@", replacement: resolve(import.meta.dirname, "../../src") },
      { find: /^@zcode\/shared$/, replacement: resolve(import.meta.dirname, "queueShared.ts") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5189,
    strictPort: true,
    fs: { allow: [resolve(import.meta.dirname, "../../../..")] },
  },
  optimizeDeps: {
    entries: [resolve(import.meta.dirname, "queue.html")],
    include: ["react", "react-dom/client"],
  },
});
