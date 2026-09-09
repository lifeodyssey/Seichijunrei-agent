/**
 * @vitest-environment jsdom
 *
 * Issue #437 item 1: the adapter's async failure path was only reachable through a
 * real WebGL/import failure, and every other suite injects a fake `attach`. Here the
 * maplibre module itself is stubbed so the real controller runs and its failure path
 * drives the D7 placeholder.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachBasemap } from "../../../src/features/bubble-map/bubble-map-controller";
import { SearchResult } from "../../../src/features/chat/components/SearchResult";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { toSearchSpots } from "../../../src/features/chat/lib/spot-clusters";
import type { SpotRowLike } from "../../../src/features/chat/lib/spot-clusters";

vi.mock("pmtiles", () => ({ Protocol: class { readonly tile = () => undefined; } }));

// Stands in for a browser without a WebGL context: constructing the map throws.
vi.mock("maplibre-gl", () => ({
  addProtocol: () => undefined,
  setWorkerUrl: () => undefined,
  Map: function MapStub(): never { throw new Error("WebGL context unavailable"); },
}));

afterEach(cleanup);

const dict = chatDictFor("ja");

const ONE_CLUSTER: readonly SpotRowLike[] = [
  { id: "u1", name: "宇治橋", lat: 34.89, lng: 135.8, city: "宇治市", screenshot_url: "/s.webp" },
  { id: "u2", name: "宇治川", lat: 34.9, lng: 135.81, city: "宇治市", screenshot_url: "/s.webp" },
];

/** The mount awaits two dynamic imports before it throws; drain past both. */
const settleMount = async (): Promise<void> => {
  for (let tick = 0; tick < 5; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe("real basemap mount failure (issue #437 item 1)", () => {
  it("renders the D7 doodle and map-app link instead of a blank map frame", async () => {
    render(<SearchResult spots={toSearchSpots(ONE_CLUSTER)} dict={dict} />);
    await vi.waitFor(() => {
      expect(document.querySelector(".chat-map-fallback__doodle")).not.toBeNull();
    });
    expect(screen.getByText(dict.errorStates.d7Message)).toBeTruthy();
    expect(screen.getByRole("link", { name: dict.errorStates.d7Open }).getAttribute("href")).toContain("34.89,135.8");
    expect(document.querySelector(".chat-search-map__gl")).toBeNull();
  });

  it("stays silent when the effect is cleaned up before the mount rejects", async () => {
    const onStatus = vi.fn();
    const detach = attachBasemap({ container: document.createElement("div"), points: [{ lat: 34.89, lng: 135.8 }], onStatus });
    detach();
    await settleMount();
    expect(onStatus).not.toHaveBeenCalled();
  });
});
