import { defineConfig } from "vite";
import base from "./queue.vite.config.mts";
import { resolve } from "node:path";
export default defineConfig({
  ...base,
  resolve: {
    alias: [
      {
        find: "@/hooks/useZCodeSessionService.js",
        replacement: resolve(import.meta.dirname, "taskSwitchMocks.ts"),
      },
      {
        find: "@/lib/zcodeSessionProjection.js",
        replacement: resolve(import.meta.dirname, "taskSwitchMocks.ts"),
      },
      ...(base.resolve!.alias as { find: string | RegExp; replacement: string }[]),
    ],
  },
  server: { ...base.server, port: 5190 },
  optimizeDeps: {
    ...base.optimizeDeps,
    entries: [resolve(import.meta.dirname, "taskSwitch.html")],
  },
});
