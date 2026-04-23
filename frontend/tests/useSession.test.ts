/**
 * useSession — localStorage-backed session ID management.
 *
 * AC coverage:
 * - initializes from localStorage -> unit
 * - setSessionId persists to localStorage -> unit
 * - setSessionId(null) removes from localStorage -> unit
 * - clearSession removes from localStorage and resets state -> unit
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSession } from "@/hooks/useSession";

const STORAGE_KEY = "seichi_session_id";

// Node.js v22+ ships a built-in `localStorage` that lacks `clear()` and
// `removeItem()`. We replace it with a simple Map-backed mock that satisfies
// the hook's needs.
function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
}

describe("useSession", () => {
  let mockStorage: Storage;
  const origDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

  beforeEach(() => {
    mockStorage = createMockStorage();
    Object.defineProperty(window, "localStorage", {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (origDescriptor) {
      Object.defineProperty(window, "localStorage", origDescriptor);
    }
  });

  it("returns null when localStorage is empty", () => {
    const { result } = renderHook(() => useSession());
    expect(result.current.sessionId).toBeNull();
  });

  it("initializes from localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "existing-session");
    const { result } = renderHook(() => useSession());
    expect(result.current.sessionId).toBe("existing-session");
  });

  it("setSessionId persists value to localStorage", () => {
    const { result } = renderHook(() => useSession());

    act(() => {
      result.current.setSessionId("new-session");
    });

    expect(result.current.sessionId).toBe("new-session");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("new-session");
  });

  it("setSessionId(null) removes from localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "to-remove");
    const { result } = renderHook(() => useSession());

    act(() => {
      result.current.setSessionId(null);
    });

    expect(result.current.sessionId).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clearSession removes from localStorage and resets state", () => {
    localStorage.setItem(STORAGE_KEY, "to-clear");
    const { result } = renderHook(() => useSession());

    expect(result.current.sessionId).toBe("to-clear");

    act(() => {
      result.current.clearSession();
    });

    expect(result.current.sessionId).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
