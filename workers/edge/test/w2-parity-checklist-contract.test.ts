import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

/**
 * #1304 (W2 exit) — the parity checklist is a document, so the document is the
 * artifact under test. Spec §五 gives W2 one exit criterion and it is a manual
 * one ("功能对等清单逐项勾"), which means nothing else in the repo notices when a
 * row starts pointing at a test that no longer exists, at an issue nobody
 * opened, or at no proof at all. This file is that notice.
 *
 * The properties: every path a row cites resolves — the Python column down to
 * the line number, the TS column and the proof column down to the file — the
 * issues are the ones this campaign actually opened, the tables keep their
 * shape and their row counts, and a row without automated proof says why in the
 * divergence column instead of leaving the gap silent.
 *
 * A cell with no path has to say so in words: `unsourced …` when no Python line
 * states the behaviour, `not …` when the tier has no counterpart at all. That
 * literal marker is the exemption, so a row cannot go quiet by deleting a
 * reference.
 *
 * test-type: unit (reads checked-in files; no network, no clock).
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DOC_PATH = "docs/ops/w2-parity-checklist.md";
const DOC = readFileSync(ROOT + DOC_PATH, "utf8");
const LINES = DOC.split("\n");

const COLUMNS: readonly string[] = [
  "item",
  "Python behaviour (file:line)",
  "TS behaviour (file)",
  "automated proof (test file / lane)",
  "manual staging step",
  "divergence / decision (issue)",
  "☐ ticked (owner)",
];

const AREA_COUNT = 6;
/** Signed off at these counts; a deleted or invented row moves one of them. */
const AREA_ROWS: readonly number[] = [14, 15, 8, 16, 15, 14];
const TOTAL_ROWS = 82;
const PYTHON_COLUMN = 1;
const TS_COLUMN = 2;
const PROOF_COLUMN = 3;
const DIVERGENCE_COLUMN = 5;
const NO_PROOF = "—";

/** The Python tier this rewrite is measured against; paths are relative to it. */
const PY_ROOT = "apps/agent/src/animichi/";
/** TS cells are relative to the edge source, except the few that name a package. */
const TS_ROOTS: readonly string[] = ["", "workers/edge/src/"];
/** A cell with no path must open with one of these words to be exempt. */
const EXEMPT = /^(?:unsourced|not )/;

// Every issue the checklist may cite: the epic, the umbrella, this card, the
// W1/W2 cards whose PRs the rows are sourced from, the open decision and
// follow-up issues, and #1369, which replaced the staging credential one row
// tells an operator to export. Listed here rather than fetched so the gate stays
// offline.
const KNOWN_ISSUES: ReadonlySet<number> = new Set([
  1243, 1251, 1253, 1257, 1277, 1278, 1279, 1280, 1281, 1282, 1283, 1284, 1285,
  1286, 1287, 1288, 1289, 1291, 1292, 1293, 1295, 1296, 1297, 1298, 1304, 1369,
]);

interface Row {
  readonly cells: readonly string[];
  readonly line: number;
}

interface Table {
  readonly header: readonly string[];
  readonly rows: readonly Row[];
}

function cellsOf(line: string): readonly string[] {
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function isTableLine(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|");
}

function headerIndices(): readonly number[] {
  return LINES.map((line, index) => (line.startsWith("| item |") ? index : -1)).filter(
    (index) => index >= 0,
  );
}

/** Rows start two lines below the header: the header itself, then `|---|`. */
function rowsAfter(header: number): readonly Row[] {
  const rows: Row[] = [];
  for (let at = header + 2; at < LINES.length && isTableLine(LINES[at] ?? ""); at += 1) {
    rows.push({ cells: cellsOf(LINES[at] ?? ""), line: at + 1 });
  }
  return rows;
}

const TABLES: readonly Table[] = headerIndices().map((index) => ({
  header: cellsOf(LINES[index] ?? ""),
  rows: rowsAfter(index),
}));

const ROWS: readonly Row[] = TABLES.flatMap((table) => table.rows);

function backticked(text: string): readonly string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
}

function testPathsIn(text: string): readonly string[] {
  return backticked(text).filter((value) => value.endsWith("test.ts"));
}

function missingPaths(paths: readonly string[], where: string): readonly string[] {
  return paths
    .filter((path) => !existsSync(ROOT + path))
    .map((path) => `${where} → missing ${path}`);
}

function proofPaths(row: Row): readonly string[] {
  return testPathsIn(row.cells[PROOF_COLUMN] ?? "");
}

function at(row: Row): string {
  return `${DOC_PATH}:${String(row.line)}`;
}

function unproved(row: Row): readonly string[] {
  const cell = row.cells[PROOF_COLUMN] ?? "";
  const named = cell === NO_PROOF || proofPaths(row).length > 0;
  return named ? [] : [`${at(row)} names no test path`];
}

function rowProofViolations(row: Row): readonly string[] {
  return [...unproved(row), ...missingPaths(proofPaths(row), at(row))];
}

function proofViolations(): readonly string[] {
  const perRow = ROWS.flatMap(rowProofViolations);
  const docWide = missingPaths(testPathsIn(DOC), DOC_PATH);
  return [...new Set([...perRow, ...docWide])].sort();
}

interface PyRef {
  readonly file: string;
  readonly lines: readonly number[];
}

const PY_TOKEN = /^([A-Za-z0-9_./-]*\.py)?(?::(\d+)(?:-(\d+))?)?$/;

function exempted(cell: string): boolean {
  return EXEMPT.test(cell);
}

/** `:89` continues the file named earlier in the same cell, as the rows read. */
function pyToken(token: string, carried: string): PyRef | null {
  const match = PY_TOKEN.exec(token);
  const file = match?.[1] ?? carried;
  const lines = [match?.[2], match?.[3]].filter((line) => line !== undefined).map(Number);
  const named = match !== null && (match[1] !== undefined || lines.length > 0);
  return named && file !== "" ? { file, lines } : null;
}

function pyRefs(cell: string): readonly PyRef[] {
  const found: PyRef[] = [];
  let carried = "";
  for (const token of backticked(cell)) {
    const parsed = pyToken(token, carried);
    if (parsed === null) continue;
    carried = parsed.file;
    found.push(parsed);
  }
  return found;
}

function lineCount(path: string): number {
  return readFileSync(ROOT + path, "utf8").split("\n").length;
}

function pyRefViolations(row: Row, ref: PyRef): readonly string[] {
  const path = PY_ROOT + ref.file;
  if (!existsSync(ROOT + path)) return [`${at(row)} → missing ${path}`];
  const total = lineCount(path);
  return ref.lines
    .filter((line) => line < 1 || line > total)
    .map((line) => `${at(row)} → ${path}:${String(line)} is past line ${String(total)}`);
}

function pyViolations(row: Row): readonly string[] {
  const cell = row.cells[PYTHON_COLUMN] ?? "";
  const refs = pyRefs(cell);
  const unmarked = exempted(cell) ? [] : [`${at(row)} Python column cites nothing`];
  if (refs.length === 0) return unmarked;
  return refs.flatMap((ref) => pyRefViolations(row, ref));
}

function tsResolves(token: string): boolean {
  return TS_ROOTS.some((root) => existsSync(ROOT + root + token));
}

function tsViolations(row: Row): readonly string[] {
  const cell = row.cells[TS_COLUMN] ?? "";
  const refs = backticked(cell).filter((token) => token.endsWith(".ts"));
  const unmarked = exempted(cell) ? [] : [`${at(row)} TS column cites nothing`];
  if (refs.length === 0) return unmarked;
  return refs.filter((token) => !tsResolves(token)).map((token) => `${at(row)} → missing ${token}`);
}

function shortRows(): readonly string[] {
  return ROWS.filter((row) => row.cells.length !== COLUMNS.length).map(
    (row) => `${at(row)} has ${String(row.cells.length)} cells`,
  );
}

function unknownIssues(): readonly number[] {
  const cited = [...DOC.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
  return [...new Set(cited)].filter((issue) => !KNOWN_ISSUES.has(issue)).sort();
}

function headerViolations(): readonly string[] {
  return TABLES.map((table) => table.header.join(" · ")).filter(
    (header) => header !== COLUMNS.join(" · "),
  );
}

function citesIssue(row: Row): boolean {
  return /#\d+/.test(row.cells[DIVERGENCE_COLUMN] ?? "");
}

function unexplainedGaps(): readonly string[] {
  return ROWS.filter((row) => (row.cells[PROOF_COLUMN] ?? "") === NO_PROOF)
    .filter((row) => !citesIssue(row))
    .map((row) => `${at(row)} ${row.cells[0] ?? ""}`);
}

void test("every automated-proof cell names a test file that exists", () => {
  assert.deepEqual(proofViolations(), []);
});

void test("every Python reference resolves to a file and a line that exists", () => {
  assert.deepEqual(ROWS.flatMap(pyViolations), []);
});

void test("every TS reference resolves to a file that exists", () => {
  assert.deepEqual(ROWS.flatMap(tsViolations), []);
});

void test("every issue the checklist cites belongs to this campaign", () => {
  assert.deepEqual(unknownIssues(), []);
});

void test("every area table carries the seven columns the card specified", () => {
  assert.equal(TABLES.length, AREA_COUNT);
  assert.deepEqual(headerViolations(), []);
});

void test("each area keeps the row count the checklist was signed off at", () => {
  assert.deepEqual(
    TABLES.map((table) => table.rows.length),
    AREA_ROWS,
  );
  assert.equal(ROWS.length, TOTAL_ROWS);
});

void test("every row fills all seven columns", () => {
  assert.deepEqual(shortRows(), []);
});

void test("a row with no automated proof explains itself with an issue", () => {
  assert.deepEqual(unexplainedGaps(), []);
});
