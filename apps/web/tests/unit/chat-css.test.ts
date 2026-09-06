import { describe, expect, it } from "vitest";
import chatCss from "../../src/styles/chat.css?raw";
import { ruleDeclaration } from "./stylesheet-probe";

describe("chat bubble sizing", () => {
  it("shrinks bubbles to their content instead of the full column", () => {
    expect(ruleDeclaration(chatCss, ".chat-bubble", "width")).toBe("fit-content");
  });

  it("keeps a readable max width on bubbles", () => {
    expect(ruleDeclaration(chatCss, ".chat-bubble", "max-width")).toBe("78%");
  });

  it("aligns user bubbles to the end of the column", () => {
    const selector = ".chat-message--user .chat-bubble";
    expect(ruleDeclaration(chatCss, selector, "align-self")).toBe("flex-end");
    expect(ruleDeclaration(chatCss, selector, "margin-left")).toBe("auto");
  });
});

/* The centred message column moved into the direction-E panel (Tailwind,
   ChatShell.tsx); chat.css no longer owns a page-frame rule. */
describe("chat body column", () => {
  it("declares no hand-written frame rules since the direction-E rebuild", () => {
    /* `ruleDeclaration` THROWS on a missing rule; a deleted selector is the
     * assertion here, so the sheet must simply never name the old frame. */
    expect(chatCss).not.toContain(".chat-body");
    expect(chatCss).not.toContain(".chat-dock");
  });
});
