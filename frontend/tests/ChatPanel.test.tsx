/**
 * AC: After first message, WelcomeScreen replaced by message list.
 * AC: onLocationAcquired callback from ChatInput propagates coords to onSend.
 * -> unit
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatPanel from "@/components/chat/ChatPanel";
import { LocaleProvider } from "@/lib/i18n-context";
import type { ChatMessage } from "@/lib/types";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";

const jaFull = jaDict as unknown as Dict;

function makeMessage(id: string, role: "user" | "assistant", text: string): ChatMessage {
  return { id, role, text, timestamp: Date.now() };
}

function renderChatPanel(
  messages: ChatMessage[],
  onSend = vi.fn(),
) {
  return render(
    <LocaleProvider>
      <ChatPanel
        messages={messages}
        sending={false}
        activeMessageId={null}
        dict={jaFull}
        locale="ja"
        onSend={onSend}
        onActivate={vi.fn()}
      />
    </LocaleProvider>,
  );
}

describe("ChatPanel", () => {
  it("renders WelcomeScreen when messages are empty", () => {
    renderChatPanel([]);
    expect(screen.getByText("聖地巡礼")).toBeInTheDocument();
  });

  it("renders message text when messages are non-empty", () => {
    renderChatPanel([makeMessage("m1", "user", "君の名は の聖地を教えて")]);
    expect(screen.getByText("君の名は の聖地を教えて")).toBeInTheDocument();
  });

  it("does not render WelcomeScreen when messages are non-empty", () => {
    renderChatPanel([makeMessage("m1", "user", "テストメッセージ")]);
    expect(screen.queryByText("聖地巡礼")).not.toBeInTheDocument();
  });

  describe("typing and sending a message", () => {
    it("calls onSend with the typed text when Enter is pressed", async () => {
      const onSend = vi.fn();
      renderChatPanel([], onSend);
      const textarea = screen.getByRole("textbox");
      await userEvent.type(textarea, "ゆるキャン の聖地");
      await act(async () => {
        await userEvent.keyboard("{Enter}");
      });
      await waitFor(() => {
        expect(onSend).toHaveBeenCalledWith("ゆるキャン の聖地", null);
      });
    });
  });

  describe("geolocation coords wiring", () => {
    let savedGeo: Geolocation | undefined;

    beforeEach(() => {
      savedGeo = navigator.geolocation;
    });

    afterEach(() => {
      Object.defineProperty(navigator, "geolocation", {
        value: savedGeo,
        configurable: true,
      });
    });

    it("passes coords to onSend after location is acquired via ChatInput", async () => {
      // Keep getCurrentPosition pending so the prompt stays open and we can
      // verify onLocationAcquired is wired — then resolve it manually.
      let resolveGeo!: (lat: number, lng: number) => void;
      const geo = {
        getCurrentPosition: vi.fn((success: PositionCallback) => {
          resolveGeo = (lat, lng) =>
            success({ coords: { latitude: lat, longitude: lng } } as GeolocationPosition);
        }),
      };
      Object.defineProperty(navigator, "geolocation", {
        value: geo,
        configurable: true,
      });

      const onSend = vi.fn();
      renderChatPanel([], onSend);

      // Open the location prompt
      const locationBtn = screen.getByRole("button", { name: /location/i });
      await userEvent.click(locationBtn);

      // The location prompt opens inside aria-label="location prompt"
      const locationPrompt = await screen.findByRole("region", {
        name: "location prompt",
      });
      const useCurrentBtn = await screen.findByRole(
        "button",
        { name: /current location|現在地を使う/i },
        { container: locationPrompt },
      );
      await userEvent.click(useCurrentBtn);

      // Now geo is pending (acquiring state) — resolve it
      await act(async () => {
        resolveGeo(35.0, 135.0);
      });

      // Prompt closes after coords acquired — type and submit a message
      const textarea = screen.getByRole("textbox");
      await userEvent.type(textarea, "test message");
      await act(async () => {
        await userEvent.keyboard("{Enter}");
      });

      await waitFor(() => {
        expect(onSend).toHaveBeenCalledWith("test message", { lat: 35.0, lng: 135.0 });
      });
    });
  });
});
