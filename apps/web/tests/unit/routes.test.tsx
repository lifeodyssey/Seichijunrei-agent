/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getRouter } from "../../src/router";
import { Route as RootRoute } from "../../src/routes/__root";
import { RootError } from "../../src/components/RootError";
import { AppRouterContext } from "./_router";

describe("route tree rendering", () => {
  it("mounts the root document shell and resolves the index route", async () => {
    const router = getRouter();
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(router.state.matches.some((match) => match.routeId === "/")).toBe(true);
  });

  it("renders the branded 404 through the root not-found boundary", () => {
    const renderNotFound = RootRoute.options.notFoundComponent as () => ReactNode;
    render(<AppRouterContext>{renderNotFound()}</AppRouterContext>);
    expect(screen.getByRole("heading", { name: "404" })).toBeTruthy();
  });

  it("wires the branded error boundary at the root", () => {
    expect(RootRoute.options.errorComponent).toBe(RootError);
  });
});
