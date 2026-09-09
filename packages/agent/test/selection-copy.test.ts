import test from "node:test";
import assert from "node:assert/strict";
import { CATALOG_ROUTE_UNAVAILABLE, NO_CATALOG_ROUTE_DATA, PLACE_SELECTION_EXPIRED, SELECTION_EXPIRED, SELECTION_WRONG_MODE, multiMessage, placeMessage, selectedRouteMessage } from "@animichi/agent";

void test("selected routes report the actual stop count in the visitor's language", () => {
  assert.equal(selectedRouteMessage("ja", 3), "3件の選択スポットでルートを作成しました。");
  assert.equal(selectedRouteMessage("en", 2), "Created a route with 2 selected stops.");
  assert.equal(selectedRouteMessage("unknown", 2), "Created a route with 2 selected stops.");
});

void test("a multi-work result discloses omitted work identities in order", () => {
  assert.equal(multiMessage("en", "ok", ["485", "1"]), "Selected works were merged and routed. Omitted works: 485, 1.");
  assert.equal(multiMessage("zh", "empty"), "所选作品暂时没有收录地点，请改选其他作品。");
});

void test("a place result and deterministic refusals preserve their public copy", () => {
  assert.equal(placeMessage("ja", "empty"), "その場所の周辺には聖地が見つかりませんでした。");
  assert.equal(placeMessage("unknown", "ok"), "Nearby search complete.");
  assert.equal(SELECTION_EXPIRED, "This choice expired; please try again.");
  assert.equal(SELECTION_WRONG_MODE, "This clarification requires a different response mode.");
  assert.equal(PLACE_SELECTION_EXPIRED, "This place choice expired; please try again.");
  assert.equal(CATALOG_ROUTE_UNAVAILABLE, "Catalog route unavailable");
  assert.equal(NO_CATALOG_ROUTE_DATA, "No catalog route data");
});
