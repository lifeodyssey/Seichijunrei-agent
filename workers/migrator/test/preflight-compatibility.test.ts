import { expect, it } from "vitest";
import { compareMigrationPrefix } from "../src/preflight-compatibility";
import { parsePreflightMetadata } from "../src/preflight-metadata";
import { metadata, revision } from "./preflight-fixtures";

function decodedMetadata() {
  const decoded = parsePreflightMetadata(JSON.stringify(metadata));
  if (!decoded) throw new Error("Invalid native Atlas fixture");
  return decoded;
}

it.each([null, {}, [null], [revision({ type: undefined })], [{ version: "20260101000000" }]])(
  "refuses malformed snapshot %#", (snapshot) => {
    expect(compareMigrationPrefix(decodedMetadata(), snapshot)).toEqual({ compatible: false, error: "malformed_ledger" });
  },
);

it("refuses a missing interior row even when the final head matches", () => {
  const decoded = decodedMetadata();
  const third = { version: "20260103000000", description: "third", hash: revision().hash };
  const selected = { ...decoded, entries: [...decoded.entries, third], expectedHead: "20260103000000_third" };
  expect(compareMigrationPrefix(selected, [revision(), revision(third)])).toEqual({ compatible: false, error: "divergent_history" });
});
