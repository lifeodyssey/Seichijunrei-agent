/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "../../../src/features/chat/components/ChatInput";
import { chatDictFor } from "../../../src/features/chat/i18n";

const ja = chatDictFor("ja");
const DRAFT = "宇治にいきたい";

beforeEach(() => { sessionStorage.clear(); });
afterEach(cleanup);

function field(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox");
}

function sendKey(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", { name: ja.send });
}

function typeDraft(): void {
  fireEvent.change(field(), { target: { value: DRAFT } });
}

describe("G3: the send key follows the field", () => {
  it("withholds the key while the field is empty", () => {
    render(<ChatInput dict={ja} disabled={false} onSend={vi.fn()} />);
    expect(sendKey().disabled).toBe(true);
  });

  it("arms the key as soon as there is something to send", () => {
    render(<ChatInput dict={ja} disabled={false} onSend={vi.fn()} />);
    typeDraft();
    expect(sendKey().disabled).toBe(false);
  });

  it("swallows an Enter press on an empty field instead of sending nothing", () => {
    const onSend = vi.fn();
    render(<ChatInput dict={ja} disabled={false} onSend={onSend} />);
    fireEvent.submit(field());
    expect(onSend).not.toHaveBeenCalled();
  });

  it("withholds it again for whitespace alone, which is nothing to send", () => {
    render(<ChatInput dict={ja} disabled={false} onSend={vi.fn()} />);
    fireEvent.change(field(), { target: { value: "   " } });
    expect(sendKey().disabled).toBe(true);
  });
});

describe("G4: a running turn keeps the field, not the key", () => {
  it("leaves the field editable while the turn runs", () => {
    render(<ChatInput dict={ja} disabled={false} busy onSend={vi.fn()} />);
    typeDraft();
    expect(field().disabled).toBe(false);
    expect(field().value).toBe(DRAFT);
  });

  it("withholds the send key even with text waiting — no queued sends", () => {
    const onSend = vi.fn();
    render(<ChatInput dict={ja} disabled={false} busy onSend={onSend} />);
    typeDraft();
    expect(sendKey().disabled).toBe(true);
  });

  it("swallows an Enter press mid-turn so a second send cannot slip out", () => {
    const onSend = vi.fn();
    render(<ChatInput dict={ja} disabled={false} busy onSend={onSend} />);
    typeDraft();
    fireEvent.submit(field());
    expect(onSend).not.toHaveBeenCalled();
    expect(field().value).toBe(DRAFT);
  });

  it("says what it is doing in the placeholder, then gives the invitation back", () => {
    const view = render(<ChatInput dict={ja} disabled={false} busy onSend={vi.fn()} />);
    expect(field().placeholder).toBe(ja.busyPlaceholder);
    view.rerender(<ChatInput dict={ja} disabled={false} onSend={vi.fn()} />);
    expect(field().placeholder).toBe(ja.inputPlaceholder);
  });

  it("dims the pill only while busy", () => {
    const view = render(<ChatInput dict={ja} disabled={false} busy onSend={vi.fn()} />);
    expect(document.querySelector("form")?.className).toContain("opacity-75");
    view.rerender(<ChatInput dict={ja} disabled={false} onSend={vi.fn()} />);
    expect(document.querySelector("form")?.className).not.toContain("opacity-75");
  });

  it("still takes the field away when the page itself is out of service (A5)", () => {
    render(<ChatInput dict={ja} disabled onSend={vi.fn()} />);
    expect(field().disabled).toBe(true);
  });
});

describe("G5: a failed turn gives the words back", () => {
  it("refills the field with the text the failed send took", () => {
    const view = render(<ChatInput dict={ja} disabled={false} onSend={vi.fn()} />);
    typeDraft();
    fireEvent.click(sendKey());
    expect(field().value).toBe("");
    view.rerender(<ChatInput dict={ja} disabled={false} sendFailed onSend={vi.fn()} />);
    expect(field().value).toBe(DRAFT);
  });

  it("puts the caret at the end so the visitor can keep typing", () => {
    const view = render(<ChatInput dict={ja} disabled={false} onSend={vi.fn()} />);
    typeDraft();
    fireEvent.click(sendKey());
    view.rerender(<ChatInput dict={ja} disabled={false} sendFailed onSend={vi.fn()} />);
    expect(document.activeElement).toBe(field());
    expect(field().selectionStart).toBe(DRAFT.length);
  });

  it("refills once: clearing the refilled draft is the visitor's decision", () => {
    const view = render(<ChatInput dict={ja} disabled={false} onSend={vi.fn()} />);
    typeDraft();
    fireEvent.click(sendKey());
    view.rerender(<ChatInput dict={ja} disabled={false} sendFailed onSend={vi.fn()} />);
    fireEvent.change(field(), { target: { value: "" } });
    view.rerender(<ChatInput dict={ja} disabled={false} onSend={vi.fn()} />);
    view.rerender(<ChatInput dict={ja} disabled={false} sendFailed onSend={vi.fn()} />);
    expect(field().value).toBe("");
  });

  it("leaves an untouched composer alone when a failure arrives with nothing sent", () => {
    const view = render(<ChatInput dict={ja} disabled={false} onSend={vi.fn()} />);
    typeDraft();
    view.rerender(<ChatInput dict={ja} disabled={false} sendFailed onSend={vi.fn()} />);
    expect(field().value).toBe(DRAFT);
  });
});
