import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: fileURLToPath(new URL("../../../..", import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 5199, strictPort: true },
  define: {
    __ZCODE_VERSION__: JSON.stringify("test"),
    __ZCODE_COMMIT__: JSON.stringify("test"),
    __ZCODE_ENV__: JSON.stringify("test"),
  },
});
