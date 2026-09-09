/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StyleSpecification } from "maplibre-gl";

const mapState = vi.hoisted(() => {
  type Listener = (...args: readonly unknown[]) => void;
  interface FakeMapInstance {
    emit: (type: string) => void;
    offCalls: number;
    removeCalls: number;
  }
  const state = { instances: [] as FakeMapInstance[], throwOnConstruct: false, throwOnRemove: false };
  class FakeMap {
    readonly listeners = new globalThis.Map<string, Listener[]>();
    removeCalls = 0;
    offCalls = 0;

    constructor(_options: unknown) {
      if (state.throwOnConstruct) throw new Error("WebGL context unavailable");
      state.instances.push(this);
    }

    on(type: string, listener: Listener): this {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
      return this;
    }

    off(type: string, listener: Listener): this {
      this.offCalls += 1;
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
      return this;
    }

    emit(type: string): void {
      for (const listener of [...(this.listeners.get(type) ?? [])]) listener({});
    }

    remove(): void {
      this.removeCalls += 1;
      if (state.throwOnRemove) throw new Error("Map removal failed");
    }
  }
  return { addProtocol: vi.fn(), FakeMap, removeProtocol: vi.fn(), setWorkerUrl: vi.fn(), state };
});

vi.mock("maplibre-gl", () => ({
  Map: mapState.FakeMap,
  addProtocol: mapState.addProtocol,
  removeProtocol: mapState.removeProtocol,
  setWorkerUrl: mapState.setWorkerUrl,
}));

vi.mock("pmtiles", () => ({
  Protocol: class {
    readonly tile = () => ({ data: new ArrayBuffer(0) });
  },
}));

import { attachMapLibre, mountMapLibre } from "../../src/features/maplibre/maplibre-adapter";

const STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#f8f8f0" } }],
} satisfies StyleSpecification;

const options = (onError: () => void, onReady: () => void, onLoad?: () => (() => void) | undefined) => ({
  container: document.createElement("div"),
  onError,
  onReady,
  onLoad,
  registerPmtiles: true,
  style: STYLE,
});

const firstMap = () => {
  expect(mapState.state.instances).toHaveLength(1);
  return mapState.state.instances.reduce((map) => map);
};

beforeEach(() => {
  mapState.state.instances.length = 0;
  mapState.state.throwOnConstruct = false;
  mapState.state.throwOnRemove = false;
  mapState.removeProtocol.mockClear();
});

describe("MapLibre v5 adapter lifecycle", () => {
  it("reports ready, removes listeners/resources, and makes destroy idempotent", async () => {
    const onError = vi.fn();
    const onReady = vi.fn();
    const cleanup = vi.fn();
    const handle = await mountMapLibre(options(onError, onReady, () => cleanup));
    const map = firstMap();

    map.emit("load");
    expect(onReady).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    handle.destroy();
    handle.destroy();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(map.offCalls).toBe(2);
    expect(map.removeCalls).toBe(1);
  });

  it("turns an error into one fallback and never reports ready after failure", async () => {
    const onError = vi.fn();
    const onReady = vi.fn();
    const handle = await mountMapLibre(options(onError, onReady));
    const map = firstMap();

    map.emit("error");
    map.emit("error");
    map.emit("load");

    expect(onError).toHaveBeenCalledOnce();
    expect(onReady).not.toHaveBeenCalled();
    expect(map.removeCalls).toBe(1);
    handle.destroy();
  });

  it("cleans a loaded map when the ready callback fails", async () => {
    const onError = vi.fn();
    const cleanup = vi.fn();
    const onReady = (): void => { throw new Error("ready callback failed"); };
    const onLoad = (): (() => void) => cleanup;
    const handle = await mountMapLibre(options(onError, onReady, onLoad));
    const map = firstMap();

    map.emit("load");

    expect(onError).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(map.removeCalls).toBe(1);
    handle.destroy();
  });
});

describe("MapLibre v5 teardown", () => {
  it("contains map teardown failures", async () => {
    mapState.state.throwOnRemove = true;
    const handle = await mountMapLibre(options(vi.fn(), vi.fn()));

    expect(() => { handle.destroy(); }).not.toThrow();
  });
});

it("handles duplicate load events once", async () => {
  const onLoad = vi.fn(() => undefined);
  const onReady = vi.fn();
  const handle = await mountMapLibre(options(vi.fn(), onReady, onLoad));
  const map = firstMap();
  map.emit("load");
  map.emit("load");
  expect(onLoad).toHaveBeenCalledOnce();
  expect(onReady).toHaveBeenCalledOnce();
  handle.destroy();
});

describe("MapLibre v5 adapter failure handling", () => {
  it("reports constructor failure through the attachment fallback path", async () => {
    mapState.state.throwOnConstruct = true;
    const onError = vi.fn();
    const detach = attachMapLibre(options(onError, vi.fn()));

    await vi.waitFor(() => { expect(onError).toHaveBeenCalledOnce(); });
    detach();
  });

  it("destroys a handle that resolves after React already detached", async () => {
    const detach = attachMapLibre(options(vi.fn(), vi.fn()));
    detach();

    await vi.waitFor(() => { expect(mapState.state.instances[0]?.removeCalls).toBe(1); });
    expect(mapState.state.instances[0]?.offCalls).toBe(2);
  });
});
