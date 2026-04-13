import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    exclude: [
      "**/node_modules/**",
      "**/tests/conversation-api.test.ts",
      "**/tests/conversation-history.test.ts",
      "**/tests/supabase-config.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
