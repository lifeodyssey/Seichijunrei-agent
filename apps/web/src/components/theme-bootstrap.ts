/**
 * Pre-hydration theme init, shipped as an inline <head> script from the root
 * route so EVERY page honors the stored day/night preference before first
 * paint, rather than flashing the day default and correcting on hydration.
 *
 * The script must be self-contained (it runs before any module loads), so its
 * `localStorage` reference lives inside the emitted string. That is the one
 * documented storage exception outside the adapter allowlist: the key itself
 * is owned by `features/config/lib/theme-storage.ts`, and every real read and
 * write goes through that adapter.
 *
 * Night mode is paused (2026-09, night palette undecided): only "day" is
 * honored. A stale stored "night" must not be applied — the settings switch is
 * commented out, so a page booted into night would offer no UI way back. The
 * use-theme effect rewrites that stale value to "day" on first load.
 */

import { THEME_STORAGE_KEY } from "../features/config/lib/theme-storage";

export const THEME_BOOTSTRAP_SCRIPT =
  `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");` +
  `if(t==="day"){document.documentElement.dataset.theme=t;}}catch(e){}})();`;
