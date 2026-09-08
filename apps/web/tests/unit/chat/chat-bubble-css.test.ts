import { describe, expect, it } from "vitest";
import chatCss from "../../../src/styles/chat.css?raw";
import {
  contrastRatio,
  parseTokens,
  relativeLuminance,
  ruleDeclaration,
  tokenValue,
} from "../stylesheet-probe";
import globalsCss from "../../../src/styles/globals.css?raw";

describe("A2 bubbles: the design spec's geometry and 3D depth", () => {
  it("paints the AI bubble on the card token with a 2px line and a 6px top-left notch", () => {
    expect(ruleDeclaration(chatCss, ".chat-bubble", "background")).toBe("var(--color-card)");
    expect(ruleDeclaration(chatCss, ".chat-bubble", "border")).toBe("2px solid var(--color-border-soft)");
    expect(ruleDeclaration(chatCss, ".chat-bubble", "border-radius")).toBe("20px");
    expect(ruleDeclaration(chatCss, ".chat-bubble", "border-top-left-radius")).toBe("6px");
  });

  it("keeps the AI bubble text above the WCAG AA 4.5:1 floor on the cream card", () => {
    const tokens = parseTokens(globalsCss);
    const ratio = contrastRatio(tokenValue(tokens, "--color-fg"), tokenValue(tokens, "--color-card"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("gives the user bubble the full 4px teal press shadow, not a grey half-depth", () => {
    const user = ".chat-message--user .chat-bubble";
    expect(ruleDeclaration(chatCss, user, "box-shadow")).toBe("0 4px 0 var(--color-primary-strong)");
    expect(ruleDeclaration(chatCss, user, "border-top-right-radius")).toBe("6px");
  });

  it("writes the user bubble in the teal ink, the only value that clears AA there", () => {
    const tokens = parseTokens(globalsCss);
    const userBubble = /\.chat-message--user \.chat-bubble\s*\{([^}]*)\}/u.exec(chatCss)?.[1] ?? "";
    expect(userBubble).toContain("\n  color: var(--color-primary-ink);");
    const ratio = contrastRatio(tokenValue(tokens, "--color-primary-ink"), tokenValue(tokens, "--color-primary"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("floats the AI bubble above the page floor instead of sinking below it", () => {
    const tokens = parseTokens(globalsCss);
    expect(relativeLuminance(tokenValue(tokens, "--color-card")))
      .toBeGreaterThan(relativeLuminance(tokenValue(tokens, "--color-bg")));
  });

  it("edges the bubble with the soft line, the loud border being for operable chrome", () => {
    const tokens = parseTokens(globalsCss);
    const soft = relativeLuminance(tokenValue(tokens, "--color-border-soft"));
    expect(soft).toBeGreaterThan(relativeLuminance(tokenValue(tokens, "--color-border")));
    expect(ruleDeclaration(chatCss, ".chat-location__input", "border")).toBe("1px solid var(--color-border)");
  });
});
