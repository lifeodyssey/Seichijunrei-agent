"use client";

import { useEffect, useState } from "react";

/**
 * MSW Provider — starts the mock service worker in development.
 * Only active when NEXT_PUBLIC_MOCK_MODE=true.
 * Renders children only after MSW is ready (prevents race conditions).
 */
export default function MSWProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const mockMode = process.env.NEXT_PUBLIC_MOCK_MODE === "true";

  useEffect(() => {
    if (!mockMode) {
      setReady(true);
      return;
    }

    async function start() {
      const { worker } = await import("./browser");
      await worker.start({
        onUnhandledRequest: "bypass", // don't warn about unhandled requests (images, etc.)
      });
      setReady(true);
    }

    start();
  }, [mockMode]);

  if (!ready) {
    return null; // or a loading indicator
  }

  return <>{children}</>;
}
