/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColdStart } from "../../../src/features/chat/components/ColdStart";
import { chatDictFor } from "../../../src/features/chat/i18n";

const ja = chatDictFor("ja");

const ENTRIES = [
  { title: ja.entryAnimeTitle, prompt: ja.entryAnimePrompt },
  { title: ja.entryCityTitle, prompt: ja.entryCityPrompt },
  { title: ja.entryChatTitle, prompt: ja.entryChatPrompt },
] as const;

afterEach(cleanup);

function renderColdStart(onChip = vi.fn()) {
  render(<ColdStart dict={ja} onChip={onChip} />);
  return onChip;
}

describe("A1 cold start (direction-E)", () => {
  it("headlines the frozen heading and its one-line sub", () => {
    renderColdStart();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(ja.coldStartHeading);
    expect(screen.getByText(ja.coldStartSub)).toBeTruthy();
  });

  it.each(ENTRIES)("ships the entry door $title with its prompt", ({ title }) => {
    renderColdStart();
    expect(screen.getByRole("button", { name: title })).toBeTruthy();
  });

  it("sends the entry prompt when a door is clicked", () => {
    const onChip = renderColdStart();
    fireEvent.click(screen.getByRole("button", { name: ja.entryCityTitle }));
    expect(onChip).toHaveBeenCalledWith(ja.entryCityPrompt);
  });

  it("sends the sample prompt from the teal sample link", () => {
    const onChip = renderColdStart();
    fireEvent.click(screen.getByRole("button", { name: ja.sampleLink }));
    expect(onChip).toHaveBeenCalledWith(ja.samplePrompt);
  });

  it("tints each door in its own accent ground", () => {
    renderColdStart();
    expect(screen.getByRole("button", { name: ja.entryAnimeTitle }).className).toContain("bg-primary-soft");
    expect(screen.getByRole("button", { name: ja.entryCityTitle }).className).toContain("bg-gold-soft");
    expect(screen.getByRole("button", { name: ja.entryChatTitle }).className).toContain("bg-walk-bg");
  });

  it("disables every door and the sample link while the backend is unreachable", () => {
    render(<ColdStart dict={ja} onChip={vi.fn()} disabled />);
    for (const { title } of ENTRIES) {
      expect(screen.getByRole("button", { name: title }).hasAttribute("disabled")).toBe(true);
    }
    expect(screen.getByRole("button", { name: ja.sampleLink }).hasAttribute("disabled")).toBe(true);
  });
});
