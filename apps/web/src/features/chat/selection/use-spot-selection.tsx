import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

/** E2 spot selection (issue #273 S1.7): a Set keyed by result spot identity. */
export interface SpotSelection {
  readonly selected: ReadonlySet<string>;
  readonly toggle: (id: string) => void;
}

/** Outside a selection scope (history rows, bare card tests) checkboxes are inert. */
const DISABLED_SELECTION: SpotSelection = {
  selected: new Set<string>(),
  toggle: () => undefined,
};

const SpotSelectionContext = createContext<SpotSelection>(DISABLED_SELECTION);

function toggled(previous: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(previous);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** The live selection state; owned by ChatPage, shared through the provider. */
export function useSpotSelectionState(sessionKey?: string): SpotSelection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [prevKey, setPrevKey] = useState(sessionKey);
  if (prevKey !== sessionKey) { setPrevKey(sessionKey); setSelected(new Set()); }
  const toggle = useCallback((id: string) => { setSelected((previous) => toggled(previous, id)); }, []);
  return useMemo(() => ({ selected, toggle }), [selected, toggle]);
}

type ProviderProps = Readonly<{ selection: SpotSelection; children: ReactNode }>;

export function SpotSelectionProvider({ selection, children }: ProviderProps) {
  return <SpotSelectionContext.Provider value={selection}>{children}</SpotSelectionContext.Provider>;
}

export function useSpotSelection(): SpotSelection {
  return useContext(SpotSelectionContext);
}
