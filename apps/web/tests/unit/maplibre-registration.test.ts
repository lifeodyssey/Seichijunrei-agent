/** @vitest-environment jsdom */

import { expect, it, vi } from "vitest";
import type { StyleSpecification } from "maplibre-gl";

const maplibre = vi.hoisted(() => {
  class FakeMap {
    on(): this { return this; }
    off(): this { return this; }
    remove(): void { this.off(); }
  }
  return { addProtocol: vi.fn(), FakeMap, removeProtocol: vi.fn(), setWorkerUrl: vi.fn() };
});

vi.mock("maplibre-gl", () => ({
  Map: maplibre.FakeMap,
  addProtocol: maplibre.addProtocol,
  removeProtocol: maplibre.removeProtocol,
  setWorkerUrl: maplibre.setWorkerUrl,
}));

vi.mock("pmtiles", () => ({
  Protocol: class {
    readonly tile = () => ({ data: new ArrayBuffer(0) });
  },
}));

import { mountMapLibre } from "../../src/features/maplibre/maplibre-adapter";

const STYLE = { version: 8, sources: {}, layers: [] } satisfies StyleSpecification;

// v6 resolves its tile worker from a runtime `import.meta.url` expression that no
// bundler can emit, so an unset worker URL 404s and every sourced map stalls.
it("points MapLibre at the bundled tile worker before building a map", async () => {
  const handle = await mountMapLibre({ container: document.createElement("div"), onError: vi.fn(), style: STYLE });
  expect(maplibre.setWorkerUrl).toHaveBeenCalledWith(expect.stringContaining("maplibre-gl-worker"));
  handle.destroy();
});

it("registers the shared PMTiles protocol only once across repeated mounts", async () => {
  const options = { container: document.createElement("div"), onError: vi.fn(), registerPmtiles: true, style: STYLE };
  const first = await mountMapLibre(options);
  const second = await mountMapLibre(options);
  expect(maplibre.addProtocol).toHaveBeenCalledOnce();
  first.destroy();
  second.destroy();
  expect(maplibre.removeProtocol).not.toHaveBeenCalled();
});
