import type { ChatAppBarDict } from "./appbar-i18n";
import type { ChatByokDict } from "./byok-i18n";
import type {
  ChatClarifyDict,
  ChatDepartureDict,
  ChatLocationDict,
  ChatPhotoDict,
} from "./clarify-i18n";
import type { ChatErrorStatesDict } from "./error-states-i18n";
import type { ChatRouteDict } from "./route-i18n";
import type { ChatSearchDict } from "./search-i18n";
import type { ChatToolStepsDict } from "./tool-steps-i18n";
import type { ChatTurnstileDict } from "./turnstile-i18n";

/**
 * What a cold-start chip IS, which is what the design colours it by: an
 * `example` demonstrates how to ask and is drawn as plain paper, because its
 * content is a sample sentence rather than a feature; `nearbySearch` is a door
 * into a capability and wears that capability's tone. Kind travels with the
 * copy so the tone can never drift away from the meaning again.
 */
export type ChatChipKind = "example" | "nearbySearch";

export interface ChatChip {
  readonly text: string;
  readonly kind: ChatChipKind;
}

/** Chat-page copy, kept feature-local to avoid the shared dictionary hot file. */
export interface ChatDict {
  readonly chips: readonly [ChatChip, ChatChip, ChatChip];
  /** The composer's invitation (direction-E pill, mockup `.input-wrap input`). */
  readonly inputPlaceholder: string;
  /** G4: the placeholder while a turn is running — the field stays open. */
  readonly busyPlaceholder: string;
  readonly send: string;
  /** Mockup `.hint` left side: the Enter key sends. */
  readonly hintSend: string;
  /** Mockup `.hint` right side: what the camera button is for. */
  readonly hintCamera: string;
  /** Sidebar brand tagline under the wordmark ("walk your fandom"). */
  readonly brandTagline: string;
  /** The gold pill that starts a fresh conversation. */
  readonly newJourney: string;
  /** Sidebar section label above the past-conversation rows. */
  readonly recentLabel: string;
  /** In-panel header breadcrumb above the journey title. */
  readonly crumbJourneys: string;
  /** In-panel header title for a fresh journey. */
  readonly titleNewJourney: string;
  /** In-panel header pill: the journey saves itself. */
  readonly autosaved: string;
  /** A1 cold-start headline (mockup `.start h1`). */
  readonly coldStartHeading: string;
  /** A1 cold-start one-line sub under the headline. */
  readonly coldStartSub: string;
  /** A1 entry card 1: begin from a work (teal-tinted in the mockup). */
  readonly entryAnimeTitle: string;
  /** A1 entry card 2: begin from a place. */
  readonly entryCityTitle: string;
  /** A1 entry card 3: no plan, open conversation. */
  readonly entryChatTitle: string;
  /** What entry card 1 sends down the existing send path. */
  readonly entryAnimePrompt: string;
  /** What entry card 2 sends down the existing send path. */
  readonly entryCityPrompt: string;
  /** What entry card 3 sends down the existing send path. */
  readonly entryChatPrompt: string;
  /** A1 teal link under the entry cards (mockup `.sample-link`). */
  readonly sampleLink: string;
  /** What the sample link sends down the existing send path. */
  readonly samplePrompt: string;
  readonly errorBanner: string;
  readonly retry: string;
  readonly historyFootprint: string;
  readonly fallbackCard: string;
  readonly historyError: string;
  readonly preparing: string;
  readonly thinking: string;
  readonly waitingSubtitle: string;
  readonly footprintDetails: string;
  /** E1 badge on a superseded living-document card (issues #271/#273). */
  readonly previousVersion: string;
  readonly appbar: ChatAppBarDict;
  readonly errorStates: ChatErrorStatesDict;
  readonly toolSteps: ChatToolStepsDict;
  readonly search: ChatSearchDict;
  readonly turnstile: ChatTurnstileDict;
  readonly route: ChatRouteDict;
  readonly clarify: ChatClarifyDict;
  readonly departure: ChatDepartureDict;
  readonly location: ChatLocationDict;
  readonly photo: ChatPhotoDict;
  readonly byok: ChatByokDict;
}
