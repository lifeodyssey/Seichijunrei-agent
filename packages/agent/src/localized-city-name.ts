/**
 * City names in the reader's own language.
 *
 * Port of `apps/agent/src/animichi/agents/geo_names.py` and its data file
 * (`agents/data/city_names_jp.json`, 662 of the 747 Japanese cities the
 * reverse-geocoder emits, generated from GeoNames JP + alternateNames — copied
 * verbatim, not regenerated). The reverse geocoder names cities in English;
 * `apps/web` renders `row.city` as a cluster's heading
 * (`features/chat/search-copy.ts`), so without this a Japanese reader is shown
 * "Uji" where Python showed 宇治.
 *
 * An unknown city or an unknown locale falls back to the English name, which is
 * also what `en` gets: the table carries `ja` and `zh` only.
 */

import cityNames from "./city-names.json" with { type: "json" };

const LOCALIZED: Record<string, Record<string, string> | undefined> = cityNames;

// Both lookups go through `Object.hasOwn` because a JSON table is a plain
// object with `Object.prototype` behind it: `toString` is neither a city nor a
// locale, and an unguarded index would hand the reader a function where the
// type promises a string. Python's `dict.get` had no such back door.

/** The names this city carries of its own, or nothing. */
function localeTable(englishName: string): Record<string, string> | undefined {
  return Object.hasOwn(LOCALIZED, englishName) ? LOCALIZED[englishName] : undefined;
}

/** The name that table carries of its own for `locale`, or nothing. */
function nameIn(names: Record<string, string> | undefined, locale: string): string | undefined {
  if (!names) return undefined;
  return Object.hasOwn(names, locale) ? names[locale] : undefined;
}

/** The city's name in `locale`, or the English name when there is none. */
export function localizedCityName(englishName: string, locale: string): string {
  const localized = nameIn(localeTable(englishName), locale);
  // Python wrote `names.get(locale) or english_name`: a blank entry is no name
  // at all, so `??` would hand the reader an empty heading.
  return localized === undefined || localized === "" ? englishName : localized;
}
