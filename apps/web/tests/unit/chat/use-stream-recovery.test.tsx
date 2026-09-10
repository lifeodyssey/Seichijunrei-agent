/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStreamRecovery } from "../../../src/features/chat/use-stream-recovery";
import { clearAuthToken } from "../../../src/lib/auth/auth-session";

vi.mock(import("../../../src/lib/auth/auth-session"), { spy: true });

function chatFixture() {
  return { clearError: vi.fn(), regenerate: vi.fn().mockResolvedValue(undefined), resumeStream: vi.fn().mockResolvedValue(undefined) };
}

it("a request with no accepted session retries its same message through regenerate", () => {
  const chat = chatFixture();
  const view = renderHook(() => useStreamRecovery(chat, () => undefined));
  act(() => { view.result.current.recover(); });
  expect(chat.regenerate).toHaveBeenCalledTimes(1);
  expect(chat.resumeStream).not.toHaveBeenCalled();
  expect(chat.clearError).toHaveBeenCalledTimes(1);
});

it("an accepted operation reconnects through the official SDK without resubmission", async () => {
  const chat = chatFixture();
  const view = renderHook(() => useStreamRecovery(chat, () => "session-native"));
  act(() => { view.result.current.recover(); });
  await waitFor(() => { expect(view.result.current.recovering).toBe(false); });
  expect(chat.resumeStream).toHaveBeenCalledWith({ metadata: { latest: false } });
  expect(chat.regenerate).not.toHaveBeenCalled();
});

it("keeps recovery visible while the native view is being restored", async () => {
  const chat = chatFixture();
  let finish = () => { /* assigned by the promise constructor */ };
  const completion = new Promise<void>((resolve) => { finish = resolve; });
  chat.resumeStream.mockReturnValue(completion);
  const view = renderHook(() => useStreamRecovery(chat, () => "session-native"));
  act(() => { view.result.current.recover(); });
  expect(view.result.current.recovering).toBe(true);
  await act(async () => { finish(); await completion; });
  expect(view.result.current.recovering).toBe(false);
});

it("finishes recovery bookkeeping when the transport rejects", async () => {
  const chat = chatFixture();
  chat.resumeStream.mockRejectedValue(new Error("network unavailable"));
  const view = renderHook(() => useStreamRecovery(chat, () => "session-native"));
  act(() => { view.result.current.recover(); });
  await waitFor(() => { expect(view.result.current.recovering).toBe(false); });
  expect(chat.regenerate).not.toHaveBeenCalled();
});

it("refreshes authentication before requesting current native state", async () => {
  const chat = chatFixture();
  const view = renderHook(() => useStreamRecovery(chat, () => "session-native"));
  act(() => { view.result.current.recoverExpired(); });
  expect(clearAuthToken).toHaveBeenCalledTimes(1);
  await waitFor(() => { expect(chat.resumeStream).toHaveBeenCalledWith({ metadata: { latest: true } }); });
});

describe("a failed typed selection", () => {
  it("retains its own idempotent resend action", () => {
    const chat = chatFixture();
    const resend = vi.fn();
    const view = renderHook(() => useStreamRecovery(chat, () => "session-native", { failed: true, resend }));
    act(() => { view.result.current.recover(); });
    expect(resend).toHaveBeenCalledTimes(1);
    expect(chat.resumeStream).not.toHaveBeenCalled();
    expect(chat.regenerate).not.toHaveBeenCalled();
  });

  it("conflict recovery discovers current native state rather than resending a stale pick", async () => {
    const chat = chatFixture();
    const resend = vi.fn();
    const view = renderHook(() => useStreamRecovery(chat, () => "session-native", { failed: true, resend }));
    act(() => { view.result.current.recoverLatest(); });
    await waitFor(() => { expect(chat.resumeStream).toHaveBeenCalledWith({ metadata: { latest: true } }); });
    expect(resend).not.toHaveBeenCalled();
  });
});
