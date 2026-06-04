import { defineConfig } from "vitest/config";

const isWindows = process.platform === "win32";

export default defineConfig({
  resolve: {
    preserveSymlinks: isWindows
  }
});
