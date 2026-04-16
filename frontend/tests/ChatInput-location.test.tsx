/**
 * AC: Location button tap triggers browser geolocation prompt; on success, coords stored in state -> browser
 * AC: Browser does not support geolocation — location button hidden -> unit
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatInput from "@/components/chat/ChatInput";
import { LocaleProvider } from "@/lib/i18n-context";

function renderChatInput(props: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
  return render(
    <LocaleProvider>
      <ChatInput onSend={vi.fn()} {...props} />
    </LocaleProvider>,
  );
}

describe("ChatInput location button", () => {
  let originalGeo: Geolocation | undefined;

  beforeEach(() => {
    originalGeo = navigator.geolocation;
  });

  afterEach(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: originalGeo,
      configurable: true,
    });
  });

  it("renders location button when geolocation is supported", () => {
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: vi.fn() },
      configurable: true,
    });

    renderChatInput();
    expect(screen.getByLabelText("location")).toBeInTheDocument();
  });

  it("hides location button when geolocation is not supported", () => {
    Object.defineProperty(navigator, "geolocation", {
      value: undefined,
      configurable: true,
    });

    renderChatInput();
    expect(screen.queryByLabelText("location")).not.toBeInTheDocument();
  });

  it("opens LocationPrompt when location button is clicked", async () => {
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: vi.fn() },
      configurable: true,
    });

    renderChatInput();
    await userEvent.click(screen.getByLabelText("location"));

    // LocationPrompt rendered inline — check by region role
    expect(screen.getByRole("region", { name: "location prompt" })).toBeInTheDocument();
  });

  it("dismisses LocationPrompt on dismiss", async () => {
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: vi.fn() },
      configurable: true,
    });

    renderChatInput();
    await userEvent.click(screen.getByLabelText("location"));
    expect(screen.getByRole("region", { name: "location prompt" })).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("dismiss location prompt"));
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "location prompt" })).not.toBeInTheDocument();
    });
  });
});
