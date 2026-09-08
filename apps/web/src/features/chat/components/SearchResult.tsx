import { useCallback, useState } from "react";
import { MAX_MAP_PINS, searchMapView, topSpots } from "../lib/spot-clusters";
import type { SearchSpot, SpotCluster } from "../lib/spot-clusters";
import { attachBasemap } from "../../bubble-map/bubble-map-controller";
import { episodeTag } from "../search-copy";
import { useSpotSelection } from "../selection/use-spot-selection";
import type { ChatDict } from "../i18n";
import { EnvelopeFallback } from "./ErrorStates/EnvelopeFallback";
import { SceneThumb } from "./ErrorStates/SceneThumb";
import { ClusterBubbleMap, StaticSpotMap } from "./SearchMap";
import type { AttachBasemap } from "./SearchMap";
import { useAutoFocus } from "./use-auto-focus";

type SpotProps = Readonly<{ spot: SearchSpot; dict: ChatDict }>;
type GridProps = Readonly<{ spots: readonly SearchSpot[]; dict: ChatDict }>;
type ClusterProps = Readonly<{ cluster: SpotCluster; dict: ChatDict; attach: AttachBasemap }>;

/** E2 (issue #273 S1.7): the pick is controlled by the shared spot selection. */
function SpotPick({ spot, dict }: SpotProps) {
  const { selected, toggle } = useSpotSelection();
  return (
    <label className="chat-spot-card__pick">
      <input type="checkbox" className="chat-spot-card__check" checked={selected.has(spot.id)} onChange={() => { toggle(spot.id); }} aria-label={`${dict.search.select}: ${spot.name}`} />
      <span className="chat-spot-card__name">{spot.name}</span>
    </label>
  );
}

/** C3a card: screenshot cover (D9-degrading) + episode tag + checkbox. */
function SpotCard({ spot, dict }: SpotProps) {
  const ep = episodeTag(dict, spot.ep);
  return (
    <li className="chat-spot-card">
      <SceneThumb src={spot.screenshotUrl} alt={spot.name} ep={spot.ep} dict={dict} />
      {ep ? <span className="chat-spot-card__ep">{ep}</span> : null}
      <SpotPick spot={spot} dict={dict} />
    </li>
  );
}

export function SpotCardGrid({ spots, dict }: GridProps) {
  return (
    <ul className="chat-spot-grid">
      {topSpots(spots).map((spot) => (
        <SpotCard key={spot.id} spot={spot} dict={dict} />
      ))}
    </ul>
  );
}

function SingleClusterView({ cluster, dict, attach }: ClusterProps) {
  return (
    <div className="chat-search-result">
      <SpotCardGrid spots={cluster.spots} dict={dict} />
      <StaticSpotMap spots={cluster.spots} dict={dict} attach={attach} maxPins={MAX_MAP_PINS} />
    </div>
  );
}

type DrillProps = ClusterProps & Readonly<{ onBack: () => void }>;

/** C3b→C3a keeps a way back to the 圏 overview, so the drill is not a dead end
 * (issue #437 item 2); the funnel in the S1.4 spec reads in both directions.
 * The chip also takes focus, since the view it replaced held it. */
function DrilledClusterView({ cluster, dict, attach, onBack }: DrillProps) {
  const ref = useAutoFocus<HTMLButtonElement>(true);
  return (
    <div className="chat-drill">
      <button ref={ref} type="button" className="chat-chip chat-drill__back" onClick={onBack}>{dict.search.backToOverview}</button>
      <SingleClusterView cluster={cluster} dict={dict} attach={attach} />
    </div>
  );
}

type Drill = Readonly<{ cluster: SpotCluster; index: number }>;

interface DrillNav {
  readonly drill: Drill | null;
  /** Set only while returning, so a fresh drill never steals focus back. */
  readonly refocusIndex: number | null;
  readonly select: (cluster: SpotCluster, index: number) => void;
  readonly back: () => void;
}

/** Primitive drill-reset key: the caller rebuilds the spots array per SSE chunk,
 * so identity would reset the drill on every chunk — key on the spot ids. */
function spotsKey(spots: readonly SearchSpot[]): string {
  return spots.map((spot) => spot.id).join("|");
}

function useDrillNav(spots: readonly SearchSpot[]): DrillNav {
  const [drill, setDrill] = useState<Drill | null>(null);
  const [refocusIndex, setRefocus] = useState<number | null>(null);
  const select = useCallback((cluster: SpotCluster, index: number) => { setRefocus(null); setDrill({ cluster, index }); }, []);
  const back = useCallback(() => { setRefocus(drill?.index ?? null); setDrill(null); }, [drill]);
  const key = spotsKey(spots);
  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) { setPrevKey(key); setDrill(null); setRefocus(null); }
  return { drill, refocusIndex, select, back };
}

/** No locatable spot: the D2 state (issue #272 S1.6), never a silently empty map. */
function EmptyMapState({ spots, dict }: GridProps) {
  return (
    <div className="chat-search-result">
      {spots.length > 0 ? <SpotCardGrid spots={spots} dict={dict} /> : null}
      <EnvelopeFallback state="D2" dict={dict} />
    </div>
  );
}

type SearchResultProps = Readonly<{ spots: readonly SearchSpot[]; dict: ChatDict; attach?: AttachBasemap }>;

/**
 * C3a/C3b search content shape (issue #261 S1.4): a single cluster renders the
 * top-6 spot cards + a static pinned map; a multi-cluster (or >50km) result
 * renders the bubble overview, and selecting a bubble drills into C3a.
 */
export function SearchResult({ spots, dict, attach = attachBasemap }: SearchResultProps) {
  const view = searchMapView(spots);
  const nav = useDrillNav(spots);
  if (view.kind === "empty") return <EmptyMapState spots={spots} dict={dict} />;
  if (view.kind === "single") return <SingleClusterView cluster={view.cluster} dict={dict} attach={attach} />;
  if (nav.drill !== null) return <DrilledClusterView cluster={nav.drill.cluster} dict={dict} attach={attach} onBack={nav.back} />;
  return <ClusterBubbleMap clusters={view.clusters} dict={dict} attach={attach} onSelect={nav.select} refocusIndex={nav.refocusIndex} />;
}
