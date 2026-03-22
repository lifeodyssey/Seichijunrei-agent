"use client";

import { useState, useCallback } from "react";

const STORAGE_KEY = "seichi_session_id";

export function useSession() {
  const [sessionId, setSessionIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(STORAGE_KEY);
  });

  const setSessionId = useCallback((id: string | null) => {
    setSessionIdState(id);
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const clearSession = useCallback(() => {
    setSessionIdState(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { sessionId, setSessionId, clearSession };
}
