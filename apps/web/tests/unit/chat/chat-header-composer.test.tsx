/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatHeader } from "../../../src/features/chat/components/ChatHeader";
import { ComposerDock } from "../../../src/features/chat/components/ComposerDock";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { TEST_ORIGIN } from "../../msw/fixtures";

const ja = chatDictFor("ja");
const GATE = { locked: false, busy: false, failed: false } as const;

afterEach(cleanup);

describe("ChatHeader", () => {
  it("renders the crumb, the journey title, and the autosaved pill", () => {
    render(<ChatHeader dict={ja} />);
    expect(screen.getByText(ja.crumbJourneys)).toBeTruthy();
    expect(screen.getByText(ja.titleNewJourney)).toBeTruthy();
    expect(screen.getByText(ja.autosaved)).toBeTruthy();
  });
});

function renderComposer() {
  return render(
    <ComposerDock dict={ja} baseUrl={TEST_ORIGIN} photo={{ locale: "ja" }} gate={GATE} quotaLocked={false} onSend={vi.fn()} />,
  );
}

describe("ComposerDock", () => {
  it("pins the camera key inside the pill with the photo flow's accessible name", () => {
    renderComposer();
    const camera = screen.getByLabelText(ja.photo.upload);
    expect(camera.tagName).toBe("INPUT");
    expect(camera.getAttribute("type")).toBe("file");
  });

  it("keeps the gold send disc labelled with the send key", () => {
    renderComposer();
    const send = screen.getByRole("button", { name: ja.send });
    expect(send.className).toContain("bg-gold");
    expect(send.hasAttribute("disabled")).toBe(true);
  });

  it("writes the two-sided hint line under the pill", () => {
    renderComposer();
    expect(screen.getByText(ja.hintSend)).toBeTruthy();
    expect(screen.getByText(ja.hintCamera)).toBeTruthy();
  });

  it("sends typed text through the dock's onSend", () => {
    const onSend = vi.fn();
    render(
      <ComposerDock dict={ja} baseUrl={TEST_ORIGIN} photo={{ locale: "ja" }} gate={GATE} quotaLocked={false} onSend={onSend} />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "宇治にいきたい" } });
    fireEvent.click(screen.getByRole("button", { name: ja.send }));
    expect(onSend).toHaveBeenCalledWith("宇治にいきたい");
  });
});
