/**
 * @vitest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotFound } from "../../src/components/NotFound";
import { AppRouterContext } from "./_router";

describe("NotFound", () => {
  it("renders the fallback brand, status, and home link", () => {
    render(<AppRouterContext><NotFound /></AppRouterContext>);

    const link = screen.getByRole("link", { name: "Return home" });

    expect(screen.getByText("Animichi")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "404" })).toBeTruthy();
    expect(screen.getByText("Page not found")).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/");
  });
});
