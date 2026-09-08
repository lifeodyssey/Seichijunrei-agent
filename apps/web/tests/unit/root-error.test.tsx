/**
 * @vitest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RootError } from "../../src/components/RootError";
import { AppRouterContext } from "./_router";

describe("RootError", () => {
  it("renders the branded fallback with a home link, never the caught error", () => {
    render(<AppRouterContext><RootError /></AppRouterContext>);

    const link = screen.getByRole("link", { name: "Return home" });

    expect(screen.getByText("Animichi")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/");
  });
});
