import { describe, expect, it } from "vitest";
import chatCss from "../../../src/styles/chat.css?raw";
import { ruleDeclaration } from "../stylesheet-probe";

describe("B2b running step: gold + shimmer", () => {
  const running = '.chat-step[data-status="running"]';

  it("animates the running step with the shimmer keyframes", () => {
    expect(ruleDeclaration(chatCss, running, "animation")).toContain("chat-shimmer");
    expect(chatCss).toContain("@keyframes chat-shimmer");
  });

  it("marks the running step with a gold dot", () => {
    const dot = `${running}::before`;
    expect(ruleDeclaration(chatCss, dot, "background")).toBe("var(--color-warning-fg)");
    expect(ruleDeclaration(chatCss, dot, "border-radius")).toBe("50%");
  });
});

describe("retried step: muted, not alarming", () => {
  const retried = '.chat-step[data-status="retried"]';

  it("mutes the retried step instead of borrowing the error token", () => {
    expect(ruleDeclaration(chatCss, retried, "color")).toBe("var(--color-muted-fg)");
    expect(ruleDeclaration(chatCss, retried, "text-decoration")).toBe("line-through");
  });

  it("keeps the error token reserved for terminal failures", () => {
    const error = '.chat-step[data-status="error"]';
    expect(ruleDeclaration(chatCss, error, "color")).toBe("var(--color-error-strong)");
  });

  it("hides the retried note visually while leaving it in the accessibility tree", () => {
    const note = ".chat-step__note";
    expect(ruleDeclaration(chatCss, note, "clip-path")).toBe("inset(50%)");
    expect(ruleDeclaration(chatCss, note, "position")).toBe("absolute");
    expect(ruleDeclaration(chatCss, note, "width")).toBe("1px");
  });
});

describe("B2a typing dots", () => {
  it("bounces the dots with a staggered CSS keyframe animation", () => {
    expect(ruleDeclaration(chatCss, ".chat-typing__dot", "animation")).toContain("chat-dot-bounce");
    expect(chatCss).toContain("@keyframes chat-dot-bounce");
    expect(ruleDeclaration(chatCss, ".chat-typing__dot:nth-child(2)", "animation-delay")).toBe("0.15s");
    expect(ruleDeclaration(chatCss, ".chat-typing__dot:nth-child(3)", "animation-delay")).toBe("0.3s");
  });
});

describe("B2c mood card: gradient over semantic tokens", () => {
  it("paints the quote over a primary-token gradient with light text", () => {
    expect(ruleDeclaration(chatCss, ".chat-mood", "color")).toBe("var(--color-primary-fg)");
    expect(ruleDeclaration(chatCss, ".chat-mood", "background")).toContain("var(--color-primary-strong)");
  });

  it("keeps the quote legible with a text-shadow", () => {
    expect(ruleDeclaration(chatCss, ".chat-mood__quote", "text-shadow")).toContain("var(--shadow-3d)");
  });
});

describe("B4 settled footprint: elapsed emphasis over a semantic token", () => {
  it("emphasises the elapsed time with the primary-strong token", () => {
    expect(ruleDeclaration(chatCss, ".chat-settled__elapsed", "color")).toBe("var(--color-primary-strong)");
  });
});

describe("WCAG 2.2.2: the new looping motion yields to the reduce preference", () => {
  it("disables the row-in animation under reduced motion", () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\}/u.exec(chatCss)?.[1] ?? "";
    expect(block).toContain(".chat-message");
  });

  it("animates each landed turn with the row-in keyframes", () => {
    expect(ruleDeclaration(chatCss, ".chat-message", "animation")).toContain("chat-row-in");
    expect(chatCss).toContain("@keyframes chat-row-in");
  });
});
