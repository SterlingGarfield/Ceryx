import { startVitest } from "vitest/node";

const filters = ["src/AgentClient.runtime.test.js"];

await startVitest(
  "test",
  filters,
  {
    root: process.cwd(),
    config: false,
    run: true,
    pool: "threads"
  },
  {
    resolve: {
      preserveSymlinks: true
    }
  }
);
