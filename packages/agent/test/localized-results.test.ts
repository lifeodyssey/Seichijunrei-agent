import test from "node:test";
import assert from "node:assert/strict";
import { localizedCityName, looksLikeWrongVariant, normalizeTitle, proxiedScreenshotUrl, proxyScreenshots } from "@animichi/agent";
import type { Point } from "@animichi/contract";

void test("a known city uses the requested language", () => {
  assert.equal(localizedCityName("Uji", "ja"), "宇治");
  assert.equal(localizedCityName("Uji", "zh"), "宇治");
});

void test("unknown cities, locales and inherited object names use the supplied city", () => {
  assert.equal(localizedCityName("Uji", "en"), "Uji");
  assert.equal(localizedCityName("Unknown town", "ja"), "Unknown town");
  assert.equal(localizedCityName("toString", "ja"), "toString");
  assert.equal(localizedCityName("Uji", "toString"), "Uji");
});

void test("Anitabi screenshots use the gateway's public image route", () => {
  assert.equal(proxiedScreenshotUrl("http://image.anitabi.cn/a.jpg"), "/img/a.jpg");
  assert.equal(proxiedScreenshotUrl("https://image.anitabi.cn/a.jpg"), "/img/a.jpg");
  assert.equal(proxiedScreenshotUrl("screenshot/a.jpg"), "/img/screenshot/a.jpg");
  assert.equal(proxiedScreenshotUrl("https://example.com/a.jpg"), "https://example.com/a.jpg");
});

void test("rewriting screenshots keeps public Point data and leaves input rows untouched", () => {
  const point: Point = { id: "1", bangumi_id: "2", name: "橋", latitude: 34.89, longitude: 135.80, screenshot_url: "screenshot/bridge.jpg" };
  const empty = { ...point, id: "3", screenshot_url: "" };
  assert.deepEqual(proxyScreenshots([point, empty]), [{ ...point, screenshot_url: "/img/screenshot/bridge.jpg" }, empty]);
  assert.equal(point.screenshot_url, "screenshot/bridge.jpg");
});

void test("title matching folds width and punctuation and accepts an exact alias", () => {
  assert.equal(normalizeTitle(" ＨＡＲＵＨＩ ☆ ２ "), "haruhi2");
  assert.equal(looksLikeWrongVariant("Haruhi 2", ["Haruhi", "ＨＡＲＵＨＩ ２"]), false);
});

void test("a parent title or divergent season cannot stand in for the requested work", () => {
  assert.equal(looksLikeWrongVariant("Haruhi season two", ["Haruhi"]), true);
  assert.equal(looksLikeWrongVariant("Haruhi first", ["Haruhi second"]), true);
  assert.equal(looksLikeWrongVariant("Haruhi", [undefined, "", "Lucky Star"]), false);
  assert.equal(looksLikeWrongVariant("Haruhi", []), false);
});
