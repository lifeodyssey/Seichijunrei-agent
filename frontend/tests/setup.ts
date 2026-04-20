import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./mocks/server";
import { beforeAll, afterEach, afterAll } from "vitest";

// Set the runtime URL to match MSW handlers' base URL
process.env.NEXT_PUBLIC_RUNTIME_URL = "http://localhost:8000";

// jsdom polyfills for browser APIs used by components
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

globalThis.IntersectionObserver = class IntersectionObserver {
  constructor(_cb: IntersectionObserverCallback) {}
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;

// scrollIntoView is not implemented in jsdom
window.HTMLElement.prototype.scrollIntoView = function () {};

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
