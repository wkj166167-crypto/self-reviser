import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        exhibition: resolve(rootDir, "index.html"),
        adminArchive: resolve(rootDir, "admin.html"),
      },
    },
  },
});
