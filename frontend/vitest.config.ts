import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],

    exclude: [
      "**/node_modules/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["components/**", "hooks/**", "lib/**", "contexts/**"],
      exclude: ["**/node_modules/**", "lib/mock-data/**"],
      // Floors based on current coverage — only ratchet UP, never lower
      thresholds: {
        lines: 71,
        statements: 68,
        functions: 61,
        branches: 58,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
