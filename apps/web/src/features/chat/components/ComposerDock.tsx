import type { ReactNode } from "react";
import type { ChatDict } from "../i18n";
import type { PhotoSearchContext } from "../photo-search";
import { ChatInput } from "./ChatInput";
import { PhotoSearchUpload } from "./PhotoSearchUpload";

/** What the composer is allowed to do this render (spec group G): A5 and the
 * A3 history gate take the field away, a running turn only takes the send key,
 * and a failed turn owes the visitor their words back. */
export type ComposerGate = Readonly<{ locked: boolean; busy: boolean; failed: boolean }>;

type Props = Readonly<{
  dict: ChatDict;
  baseUrl: string;
  photo: PhotoSearchContext;
  gate: ComposerGate;
  quotaLocked: boolean;
  onSend: (text: string) => void;
}>;

/** Mockup `.dock`: the composer region at the panel's foot — the pill, then
 * the two-sided hint line. */
const DOCK_CLASS = "px-7 pb-[var(--chat-gutter)] max-lg:px-4 max-lg:pb-4";
/** Mockup caps the composer at 860px and centers it inside the panel, like
 * the cold-start column above it. */
const STACK_CLASS = "mx-auto grid w-full max-w-[860px] gap-2.5";
const HINT_CLASS = "flex justify-between text-[12.5px] font-bold opacity-70 max-lg:text-[11.5px]";

function ComposerHint({ dict }: Readonly<{ dict: ChatDict }>) {
  return <div className={HINT_CLASS}><span>{dict.hintSend}</span><span>{dict.hintCamera}</span></div>;
}

type PartsProps = Readonly<{
  dict: ChatDict;
  gate: ComposerGate;
  quotaLocked: boolean;
  onSend: (text: string) => void;
  control: ReactNode;
  outcome: ReactNode;
}>;

/** The pill (with the camera key in its left edge), the upload outcome under
 * it, and the hint line under both. */
function ComposerParts({ dict, gate, quotaLocked, onSend, control, outcome }: PartsProps) {
  const input = (
    <ChatInput dict={dict} disabled={gate.locked} busy={gate.busy} quotaLocked={quotaLocked} sendFailed={gate.failed} leading={control} onSend={onSend} />
  );
  return <>{input}{outcome}<ComposerHint dict={dict} /></>;
}

/** The direction-E composer: the photo-search camera key inside the pill (the
 * same file-picker flow as the tray control), the gold send disc, and the
 * hint line under both. Upload outcomes render under the pill, where the tray
 * used to sit. */
export function ComposerDock({ dict, baseUrl, photo, gate, quotaLocked, onSend }: Props) {
  const parts = (slots: Readonly<{ control: ReactNode; outcome: ReactNode }>) => (
    <ComposerParts dict={dict} gate={gate} quotaLocked={quotaLocked} onSend={onSend} control={slots.control} outcome={slots.outcome} />
  );
  return (
    <div className={DOCK_CLASS}><div className={STACK_CLASS}><PhotoSearchUpload dict={dict} baseUrl={baseUrl} context={photo} iconTrigger>{parts}</PhotoSearchUpload></div></div>
  );
}
