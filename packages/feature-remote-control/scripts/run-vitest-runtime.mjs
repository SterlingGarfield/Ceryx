import { startVitest } from "vitest/node";

const filters = [
  "src/components.runtime.test.js",
  "src/clipboardBridge.runtime.test.js",
  "src/gestureEngine.runtime.test.js",
  "src/keyboardShortcuts.runtime.test.js",
  "src/useWebRtcViewport.runtime.test.js",
  "src/ViewportQualityIndicator.runtime.test.js"
];

await startVitest(
  "test",
  filters,
  {
    root: process.cwd(),
    config: false,
    run: true,
    pool: "threads",
    environment: "jsdom"
  },
  {
    resolve: {
      preserveSymlinks: true
    }
  }
);
