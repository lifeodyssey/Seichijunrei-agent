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
      "**/tests/conversation-api.test.ts",
      "**/tests/conversation-history.test.ts",
      "**/tests/supabase-config.test.ts",
      "**/tests/type-guards.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["components/**", "hooks/**", "lib/**", "contexts/**"],
      exclude: ["**/node_modules/**", "lib/mock-data/**"],
      // Floors based on current coverage — ratchet up as tests improve
      thresholds: {
        lines: 59,
        statements: 56,
        functions: 49,
        branches: 50,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
