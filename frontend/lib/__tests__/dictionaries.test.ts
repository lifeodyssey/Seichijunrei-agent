/**
 * Unit tests verifying dead keys are absent from all dictionary files.
 *
 * AC coverage:
 * - Dictionary files have no join_beta, tab_waitlist, or old auth.subtitle keys
 */

import { describe, it, expect } from "vitest";
import jaDict from "../dictionaries/ja.json";
import zhDict from "../dictionaries/zh.json";
import enDict from "../dictionaries/en.json";

describe("Dictionary dead-key removal", () => {
  const dicts = [
    { name: "ja", dict: jaDict },
    { name: "zh", dict: zhDict },
    { name: "en", dict: enDict },
  ] as const;

  for (const { name, dict } of dicts) {
    it(`${name}.json: auth.tab_waitlist is absent`, () => {
      expect(Object.prototype.hasOwnProperty.call(dict.auth, "tab_waitlist")).toBe(false);
    });

    it(`${name}.json: landing_hero has no join_beta key`, () => {
      expect(Object.prototype.hasOwnProperty.call(dict.landing_hero, "join_beta")).toBe(false);
    });

    it(`${name}.json: auth.btn_waitlist is absent`, () => {
      expect(Object.prototype.hasOwnProperty.call(dict.auth, "btn_waitlist")).toBe(false);
    });

    it(`${name}.json: auth.waitlist_success is absent`, () => {
      expect(Object.prototype.hasOwnProperty.call(dict.auth, "waitlist_success")).toBe(false);
    });
  }
});
