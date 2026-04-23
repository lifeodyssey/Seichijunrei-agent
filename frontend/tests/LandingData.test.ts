/**
 * LandingData — handleImageError fallback behavior.
 *
 * Covers:
 * - target.style.display is set to "none"
 * - parent.style.background is set to the gradient fallback
 */

import { describe, it, expect } from "vitest";
import { handleImageError } from "@/components/auth/LandingData";

function makeMockEvent(hasParent = true) {
  const target = {
    style: { display: "" } as CSSStyleDeclaration,
    parentElement: hasParent
      ? ({ style: { background: "" } } as unknown as HTMLElement)
      : null,
  };
  return {
    currentTarget: target,
  } as unknown as React.SyntheticEvent<HTMLImageElement>;
}

describe("handleImageError", () => {
  it("hides the image by setting display to none", () => {
    const event = makeMockEvent();
    handleImageError(event);
    expect(event.currentTarget.style.display).toBe("none");
  });

  it("applies gradient fallback to parent element", () => {
    const event = makeMockEvent();
    handleImageError(event);
    const parent = event.currentTarget.parentElement!;
    expect(parent.style.background).toContain("linear-gradient");
    expect(parent.style.background).toContain("oklch");
  });

  it("does not throw when parent element is null", () => {
    const event = makeMockEvent(false);
    expect(() => handleImageError(event)).not.toThrow();
    expect(event.currentTarget.style.display).toBe("none");
  });
});
