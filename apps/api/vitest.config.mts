import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
    server: {
      deps: {
        inline: ["sanitize-html"],
      },
    },
  },
});
