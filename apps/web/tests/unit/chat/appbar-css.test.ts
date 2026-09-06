import { describe, expect, it } from "vitest";
import globalsCss from "../../../src/styles/globals.css?raw";
import chatCss from "../../../src/styles/chat.css?raw";
import appBarSource from "../../../src/features/chat/components/ChatAppBar.tsx?raw";
import sidebarSource from "../../../src/features/chat/components/ChatSidebar.tsx?raw";
import headerSource from "../../../src/features/chat/components/ChatHeader.tsx?raw";
import shellSource from "../../../src/features/chat/components/ChatShell.tsx?raw";
import composerSource from "../../../src/features/chat/components/ComposerDock.tsx?raw";
import coldStartSource from "../../../src/features/chat/components/ColdStart.tsx?raw";
import chatInputSource from "../../../src/features/chat/components/ChatInput.tsx?raw";
import photoUploadSource from "../../../src/features/chat/components/PhotoSearchUpload.tsx?raw";
import {
  contrastRatio,
  parseBlockTokens,
  parseTokens,
  tokenValue,
} from "../stylesheet-probe";

const day = parseTokens(globalsCss);
const night = parseBlockTokens(globalsCss, '[data-theme="night"]');
/* What a night browser actually computes: the night overrides layered on the
 * day palette. The night block only redefines the tokens that flip. */
const nightPalette: Record<string, string> = { ...day, ...night };

const FRAME_SOURCES: readonly (readonly [string, string])[] = [
  ["ChatAppBar.tsx", appBarSource],
  ["ChatSidebar.tsx", sidebarSource],
  ["ChatHeader.tsx", headerSource],
  ["ChatShell.tsx", shellSource],
  ["ComposerDock.tsx", composerSource],
  ["ColdStart.tsx", coldStartSource],
  ["ChatInput.tsx", chatInputSource],
  ["PhotoSearchUpload.tsx", photoUploadSource],
];

/** The direction-E frame is Tailwind classes, so the old appbar/composer CSS
 * rules are gone from chat.css — what these tests pin now is that every new
 * chrome surface speaks tokens only (no literal hex), the way the frozen
 * message-flow CSS still does. */
describe("direction-E frame: token-only chrome", () => {
  it.each(FRAME_SOURCES)("%s carries no hardcoded hex color", (_name, source) => {
    const withoutComments = source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/[^\n]*/g, "");
    expect(withoutComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("grounds the page on the leaf field token, not a page-color rule", () => {
    expect(chatCss).not.toContain(".chat-page");
    expect(shellSource).toContain("[background-color:var(--color-ground)]");
    expect(shellSource).toContain("[background-image:var(--leaf-tile-image)]");
  });

  it("hides the retired hand-written appbar and composer rules entirely", () => {
    expect(chatCss).not.toContain(".chat-appbar");
    expect(chatCss).not.toContain(".chat-input__");
    expect(chatCss).not.toContain(".chat-cold-start__");
  });
});

describe("night line stack: the operable floor for the pill", () => {
  it("keeps the soft line above 3:1 on night paper, quieter than the loud border", () => {
    const softRatio = contrastRatio(tokenValue(night, "--color-border-soft"), tokenValue(night, "--color-paper"));
    const loudRatio = contrastRatio(tokenValue(night, "--color-border"), tokenValue(night, "--color-paper"));
    expect(softRatio).toBeGreaterThanOrEqual(3);
    expect(loudRatio).toBeGreaterThan(softRatio);
  });

  it("keeps the bright teal above 3:1 on the composer card at night (the pill's focus edge)", () => {
    /* The direction-E pill focuses with a bright-teal edge at night; the deep
     * teal that carried the day edge falls under 1.4.11's 3:1 on night card. */
    expect(contrastRatio(tokenValue(nightPalette, "--color-primary"), tokenValue(nightPalette, "--color-card"))).toBeGreaterThanOrEqual(3);
  });
});

describe("gold CTA: the send disc and new-journey pill stay legible at night", () => {
  it("keeps the theme-invariant gold ink above 4.5:1 on solid gold", () => {
    expect(contrastRatio(tokenValue(day, "--color-gold-ink"), tokenValue(day, "--color-gold"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokenValue(nightPalette, "--color-gold-ink"), tokenValue(nightPalette, "--color-gold"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("direction-E accents: teal text and the focus ring on both themes", () => {
  it("keeps the day pill focus edge (deep teal) above 3:1 on the composer card", () => {
    expect(contrastRatio(tokenValue(day, "--color-primary-strong"), tokenValue(day, "--color-card"))).toBeGreaterThanOrEqual(3);
  });

  it("keeps the focus outline ink above 3:1 on the page paper in both themes", () => {
    /* Every direction-E control rings with ground-ink on focus-visible; the
     * token flips with the theme, so both pairings must clear 1.4.11's 3:1. */
    expect(contrastRatio(tokenValue(day, "--color-ground-ink"), tokenValue(day, "--color-paper"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(tokenValue(nightPalette, "--color-ground-ink"), tokenValue(nightPalette, "--color-paper"))).toBeGreaterThanOrEqual(3);
  });

  it("keeps the night bright-teal text above 4.5:1 on the soft chip and the night paper", () => {
    /* The autosaved pill (12px) and the sample link (13.5px) are small text:
     * at night they speak the bright teal, never the 3.04:1 deep teal. */
    expect(contrastRatio(tokenValue(nightPalette, "--color-primary"), tokenValue(nightPalette, "--color-primary-soft"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokenValue(nightPalette, "--color-primary"), tokenValue(nightPalette, "--color-paper"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the gold and leaf door text above 4.5:1 on their tinted grounds in both themes", () => {
    /* The city and chat doors tint with the gold/walk pairs; both tokens flip
     * at night, so all four pairings must clear AA for the 16px bold titles. */
    expect(contrastRatio(tokenValue(day, "--color-gold-fg"), tokenValue(day, "--color-gold-soft"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokenValue(nightPalette, "--color-gold-fg"), tokenValue(nightPalette, "--color-gold-soft"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokenValue(day, "--color-walk-fg"), tokenValue(day, "--color-walk-bg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokenValue(nightPalette, "--color-walk-fg"), tokenValue(nightPalette, "--color-walk-bg"))).toBeGreaterThanOrEqual(4.5);
  });
});

/** Class strings using `[display:*]` must not also carry a bare display
 * utility — the animal-island sheet ships an unlayered `.flex`/`.grid`/
 * `.hidden` that beats our layered variants and would pin the mobile bar
 * open on desktop. Collect-then-assert keeps the test itself branch-free. */
function displayUtilityOffenders(sources: readonly (readonly [string, string])[]): string[] {
  const offenders: string[] = [];
  for (const [name, source] of sources) {
    const literals = source.match(/"[^"\n]*\[display:[^"\n]*"/g) ?? [];
    const bare = literals.filter((literal) => literal.split(/\s+/).some((token) => token === "flex" || token === "grid" || token === "hidden"));
    offenders.push(...bare.map((literal) => `${name}: ${literal}`));
  }
  return offenders;
}

describe("direction-E frame: the animal-island display-utility guard", () => {
  it("never mixes a bare display utility into a class string that uses [display:*]", () => {
    expect(displayUtilityOffenders(FRAME_SOURCES)).toEqual([]);
  });
});
