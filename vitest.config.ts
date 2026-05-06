import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      exclude: [
        "src/server/ui/assets/app.js"
      ],
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      thresholds: {
        statements: 80,
        branches: 80
      }
    }
  }
});
