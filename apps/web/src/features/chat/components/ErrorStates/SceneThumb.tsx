import { useState } from "react";
import type { ChatDict } from "../../i18n";

type Props = Readonly<{ src?: string; alt: string; ep?: number; dict: ChatDict }>;

function episodeLabel(dict: ChatDict, ep?: number): string | undefined {
  if (ep === undefined) return undefined;
  return dict.errorStates.d9Episode.replace("{ep}", String(ep));
}

function ScenePlaceholder({ alt, label }: Readonly<{ alt: string; label?: string }>) {
  return (
    <span className="chat-scene-thumb chat-scene-thumb--fallback" role="img" aria-label={alt}>
      {label}
    </span>
  );
}

/** D9: a scene still that degrades to a gradient placeholder + episode label. */
export function SceneThumb({ src, alt, ep, dict }: Props) {
  const [failed, setFailed] = useState(false);
  const [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) { setPrevSrc(src); setFailed(false); }
  if (src === undefined || failed) return <ScenePlaceholder alt={alt} label={episodeLabel(dict, ep)} />;
  return (
    <img className="chat-scene-thumb" src={src} alt={alt} loading="lazy" onError={() => { setFailed(true); }} />
  );
}
