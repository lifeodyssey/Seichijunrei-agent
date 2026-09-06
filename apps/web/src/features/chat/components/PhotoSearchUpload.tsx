import type { ChatDataPart } from "@animichi/contract";
import { useCallback, useMemo, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { useChatActions } from "../ChatActions";
import type { ChatDict } from "../i18n";
import {
  PHOTO_CHALLENGED,
  isOversizedPhoto,
  isSupportedPhoto,
  postPhotoSearch,
} from "../photo-search";
import type {
  PhotoGuidance,
  PhotoSearchContext,
  PhotoSearchOutcome,
} from "../photo-search";
import { photoOfferPick } from "../selection/photo-offer-pick";
import type { PhotoOffer } from "../selection/photo-offer-pick";
import { ClarifyPickProvider, useClarifyPick } from "../selection/use-clarify-pick";
import { DataPartCard } from "./DataPartCard";

/** Photo-search upload (issue #260 AC4/AC5/AC7, AGENT-1 #952): the result
 * envelope renders through DataPartCard, sharing the text-search render
 * path; the result is scoped to the offer's own pick channel, so selecting a
 * candidate confirms the server-issued photo offer (AC11) instead of
 * answering a session clarification that was never asked (#1336);
 * failures show on-brand copy with a retry — never a stuck spinner. */

type UploadError = "unsupported" | "tooLarge" | "failed" | "challenge";

type UploadState =
  | { readonly kind: "idle" }
  | { readonly kind: "uploading" }
  | { readonly kind: "error"; readonly error: UploadError }
  | { readonly kind: "quota"; readonly guidance: PhotoGuidance }
  | { readonly kind: "done"; readonly part: ChatDataPart; readonly offerId: string };

type Props = Readonly<{
  dict: ChatDict;
  baseUrl: string;
  context: PhotoSearchContext;
  /** Direction-E composer: the trigger renders as the pill's camera icon
   * button instead of the labelled tray control. The flow is identical. */
  iconTrigger?: boolean;
  /** Placement override (direction-E composer): the caller positions the
   * camera trigger inside the composer pill and the outcome below it. */
  children?: (slots: Readonly<{ control: ReactNode; outcome: ReactNode }>) => ReactNode;
}>;

/** Mockup `.icon-btn`: the camera key at the composer's left edge. The ring
 * is focus-within: the focusable file input hides inside the label. */
const ICON_TRIGGER_CLASS = "grid size-11 flex-none cursor-pointer place-items-center rounded-full text-ground-ink transition-colors duration-100 focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-ground-ink hover:bg-gold-soft";

function CameraIcon() {
  return (
    <svg className="size-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function quotaCopy(dict: ChatDict, guidance: PhotoGuidance): string {
  if (guidance === "switch_vision_endpoint") return dict.photo.quotaByokNoVision;
  return dict.photo.quotaNoByok;
}

function errorCopy(dict: ChatDict, error: UploadError): string {
  if (error === "unsupported") return dict.photo.unsupported;
  if (error === "tooLarge") return dict.photo.tooLarge;
  if (error === "challenge") return dict.turnstile.failed;
  return dict.photo.failed;
}

type ErrorProps = Readonly<{ dict: ChatDict; error: UploadError; onRetry: () => void }>;

function UploadFailure({ dict, error, onRetry }: ErrorProps) {
  return (
    <p className="chat-photo__error" role="alert">
      {errorCopy(dict, error)}
      <button type="button" className="chat-photo__retry" onClick={onRetry}>{dict.photo.retry}</button>
    </p>
  );
}

type StatusProps = Readonly<{ dict: ChatDict; state: UploadState; onRetry: () => void }>;

function UploadStatus({ dict, state, onRetry }: StatusProps) {
  if (state.kind === "uploading") {
    return <p className="chat-photo__status" role="status" aria-busy="true">{dict.photo.uploading}</p>;
  }
  if (state.kind === "error") return <UploadFailure dict={dict} error={state.error} onRetry={onRetry} />;
  if (state.kind === "quota") return <p className="chat-photo__error" role="alert">{quotaCopy(dict, state.guidance)}</p>;
  return null;
}

type ResultProps = Readonly<{ dict: ChatDict; offer: PhotoOffer; part: ChatDataPart }>;

/** The result renders through the shared card path, but inside the offer's own
 * pick channel: a candidate chosen here belongs to the offer, not to the
 * session (AC11, #1336). The page's `sendable` rides along so the quota lock
 * and the in-flight gate still cover this pick. */
function PhotoResult({ dict, offer, part }: ResultProps) {
  const { send } = useChatActions();
  const { sendable } = useClarifyPick();
  return (
    <ClarifyPickProvider turn={photoOfferPick(offer, send, sendable)}>
      <DataPartCard data={part} dict={dict} />
    </ClarifyPickProvider>
  );
}

type SetUploadState = (state: UploadState) => void;

function settledState(outcome: PhotoSearchOutcome): UploadState {
  return outcome.kind === "quota" ? outcome : { kind: "done", part: outcome.part, offerId: outcome.offerId };
}

/** A rejected challenge reads as its own state so the visitor is told to
 * redo the check, not that their photo was bad (issue #447 review). */
function uploadErrorOf(cause: unknown): UploadError {
  return cause instanceof Error && cause.message === PHOTO_CHALLENGED ? "challenge" : "failed";
}

function runUpload(baseUrl: string, file: File, context: PhotoSearchContext, setState: SetUploadState): void {
  setState({ kind: "uploading" });
  postPhotoSearch(baseUrl, file, context)
    .then((outcome) => { setState(settledState(outcome)); })
    .catch((cause: unknown) => { setState({ kind: "error", error: uploadErrorOf(cause) }); });
}

function preflightError(file: File): UploadError | null {
  if (!isSupportedPhoto(file)) return "unsupported";
  if (isOversizedPhoto(file)) return "tooLarge";
  return null;
}

function makeUpload(baseUrl: string, context: PhotoSearchContext, setState: SetUploadState) {
  return (file: File) => {
    const error = preflightError(file);
    if (error !== null) {
      setState({ kind: "error", error });
      return;
    }
    runUpload(baseUrl, file, context, setState);
  };
}

function useUpload(baseUrl: string, context: PhotoSearchContext) {
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const upload = useMemo(() => makeUpload(baseUrl, context, setState), [baseUrl, context]);
  const reset = useCallback(() => { setState({ kind: "idle" }); }, []);
  return { state, upload, reset };
}

function makeFileChange(upload: (file: File) => void) {
  return (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) upload(file);
  };
}

function IconControl({ dict, onChange }: Readonly<{ dict: ChatDict; onChange: (event: ChangeEvent<HTMLInputElement>) => void }>) {
  const input = <input type="file" className="chat-photo__input" accept="image/jpeg,image/png,image/webp" aria-label={dict.photo.upload} onChange={onChange} />;
  return <label className={ICON_TRIGGER_CLASS} title={dict.photo.upload}><CameraIcon /><span className="sr-only">{dict.photo.upload}</span>{input}</label>;
}

function TrayControl({ dict, onChange }: Readonly<{ dict: ChatDict; onChange: (event: ChangeEvent<HTMLInputElement>) => void }>) {
  const input = <input type="file" className="chat-photo__input" accept="image/jpeg,image/png,image/webp" aria-label={dict.photo.upload} onChange={onChange} />;
  return <><label className="chat-photo__label">{dict.photo.upload}{input}</label><span className="chat-photo__note">{dict.photo.processedNote}</span></>;
}

function UploadControl({ dict, iconTrigger, onChange }: Readonly<{ dict: ChatDict; iconTrigger: boolean; onChange: (event: ChangeEvent<HTMLInputElement>) => void }>) {
  if (iconTrigger) return <IconControl dict={dict} onChange={onChange} />;
  return <TrayControl dict={dict} onChange={onChange} />;
}

function ResultGate({ dict, baseUrl, state, context }: Readonly<{ dict: ChatDict; baseUrl: string; state: UploadState; context: PhotoSearchContext }>) {
  if (state.kind !== "done") return null;
  return <PhotoResult dict={dict} offer={{ baseUrl, offerId: state.offerId, context }} part={state.part} />;
}

type OutcomeProps = Readonly<{ dict: ChatDict; baseUrl: string; state: UploadState; context: PhotoSearchContext; onRetry: () => void }>;

function UploadOutcome({ dict, baseUrl, state, context, onRetry }: OutcomeProps) {
  return (
    <>
      <UploadStatus dict={dict} state={state} onRetry={onRetry} />
      <ResultGate dict={dict} baseUrl={baseUrl} state={state} context={context} />
    </>
  );
}

export function PhotoSearchUpload({ dict, baseUrl, context, iconTrigger = false, children }: Props) {
  const { state, upload, reset } = useUpload(baseUrl, context);
  const control = <UploadControl dict={dict} iconTrigger={iconTrigger} onChange={makeFileChange(upload)} />;
  const outcome = <UploadOutcome dict={dict} baseUrl={baseUrl} state={state} context={context} onRetry={reset} />;
  if (children) return <>{children({ control, outcome })}</>;
  /* TrayControl already carries the processed note — adding it again here
   * printed it twice on the default path. */
  return <div className="chat-photo">{control}{outcome}</div>;
}
