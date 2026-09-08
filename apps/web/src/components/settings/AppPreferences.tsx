import { LanguageSelect } from "./LanguageSelect";
// Night mode is paused (2026-09, night palette undecided): the switch stays
// commented out until the night design tokens are chosen. ThemeSwitch,
// use-theme and the storage adapter stay intact, so re-enabling is this import
// plus the JSX line below.
// import { ThemeSwitch } from "./ThemeSwitch";

/**
 * App-level preferences on the dedicated settings page: language, with
 * day/night paused (see the note above).
 *
 * These are set-once controls, so the chat bar links to them instead of
 * carrying them on every screen. The page owns the copy and layout while the
 * controls keep their existing storage adapters as the single state owners.
 */
export function AppPreferences() {
  return (
    <div className="app-preferences" role="group">
      {/* <ThemeSwitch /> — night mode paused, see the note above. */}
      <LanguageSelect />
    </div>
  );
}
