import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./mocks/server";
import { beforeAll, afterEach, afterAll } from "vitest";

// Set the runtime URL to match MSW handlers' base URL
process.env.NEXT_PUBLIC_RUNTIME_URL = "http://localhost:8000";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
