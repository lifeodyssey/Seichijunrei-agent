import { describe, expect, it } from "vitest";
import chatCss from "../../../src/styles/chat.css?raw";
import globalsCss from "../../../src/styles/globals.css?raw";
import {
  contrastRatio,
  gradientStop,
  parseBlockTokens,
  parseTokens,
  referencedTokens,
  ruleDeclaration,
  tokenValue,
} from "../stylesheet-probe";

const day = parseTokens(globalsCss);
const night = parseBlockTokens(globalsCss, '[data-theme="night"]');
const STOPS = [0, 0.25, 0.5, 0.75, 1] as const;

function paletteOf(theme: Record<string, string>, name: string): string {
  return tokenValue({ ...day, ...theme }, name);
}

function gradientRatios(theme: Record<string, string>, selector: string): readonly number[] {
  const [from = "", to = ""] = referencedTokens(ruleDeclaration(chatCss, selector, "background") ?? "");
  const ink = paletteOf(theme, referencedTokens(ruleDeclaration(chatCss, selector, "color") ?? "")[0] ?? "");
  return STOPS.map((stop) =>
    contrastRatio(gradientStop(paletteOf(theme, from), paletteOf(theme, to), stop), ink));
}

/* The G1-G4 composer rules moved to Tailwind with the direction-E composer
   (ChatInput.tsx / ComposerDock.tsx); the gradient cards below still live in
   chat.css and keep their AA pins. */

describe("B2c mood card / D9 scene fallback: AA at every point of the gradient", () => {
  it.each([".chat-mood", ".chat-scene-thumb--fallback"])("clears 4.5:1 across %s by day", (selector) => {
    expect(Math.min(...gradientRatios({}, selector))).toBeGreaterThanOrEqual(4.5);
  });

  it("clears 4.5:1 at night too, where --color-primary-fg would invert to an ink", () => {
    const NIGHT_CARDS = '[data-theme="night"] .chat-mood,\n[data-theme="night"] .chat-scene-thumb--fallback';
    expect(Math.min(...gradientRatios(night, NIGHT_CARDS))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokenValue(night, "--color-primary-fg"), tokenValue(day, "--color-primary-strong"))).toBeLessThan(4.5);
  });

  it("would have broken at the light end on the old primary gradient", () => {
    const white = tokenValue(day, "--color-primary-fg");
    expect(contrastRatio(tokenValue(day, "--color-primary"), white)).toBeLessThan(4.5);
  });
});
