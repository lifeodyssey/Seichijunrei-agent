/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatTurnRequest } from "@animichi/contract";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { chatTurnsAnswered } from "../../msw/chat-answered";
import {
  chatConflictHandler,
  chatStreamPatchedHandler,
  searchResultsPatch,
} from "../../msw/chat-handlers";
import { server } from "../../msw/node";
import { chatSearch, renderChatPage } from "./_chat-page";

// jsdom reports en-US, so UI copy renders from the en dict; candidate labels stay data-driven.
const en = chatDictFor("en");
const HARUHI_LABEL = "凉宫春日的忧郁(涼宮ハルヒの憂鬱)";

/** The clarify recording's envelope re-pointed at a bilingual pending selection. */
function clarifyCandidatesPatch(envelope: Record<string, unknown>): Record<string, unknown> {
  return {
    ...envelope,
    data: {
      reason: "anime_ambiguity",
      clarification_id: 4,
      candidates: [
        { id: "115908", title: "涼宮ハルヒの憂鬱", title_cn: "凉宫春日的忧郁" },
        { id: "117696", title: "長門有希ちゃんの消失" },
      ],
    },
  };
}

/** The pick's wire shape, taken directly from the contract's `ChatTurnRequest`
 * so this test cannot drift from what `/v1/chat` actually accepts. */
type PickBody = Pick<ChatTurnRequest, "selected_candidate_ids" | "clarification_id">;

interface SentTurn {
  readonly turnId: string | null;
  readonly body: Promise<PickBody>;
}

interface ReadTurn {
  readonly turnId: string | null;
  readonly body: PickBody;
}

function recordInto(sent: SentTurn[]) {
  return (request: Request) => {
    sent.push({ turnId: request.headers.get("x-turn-id"), body: request.clone().json() as Promise<PickBody> });
  };
}

/** The turns that left the browser, read back by the channel each rode — the
 * typed query or the structured pick — rather than by position, so a turn this
 * case never asked about cannot silently re-index its assertions (#1503). */
async function turnsByChannel(sent: readonly SentTurn[]) {
  const read: ReadTurn[] = await Promise.all(
    sent.map(async (turn) => ({ turnId: turn.turnId, body: await turn.body })),
  );
  return {
    typed: read.filter((turn) => turn.body.clarification_id === undefined),
    picks: read.filter((turn) => turn.body.clarification_id !== undefined),
  };
}

/** Press a control that starts a turn, and wait for that turn to be answered. */
async function pressAndAwaitTurn(control: HTMLElement): Promise<void> {
  const answered = chatTurnsAnswered();
  fireEvent.click(control);
  await answered;
}

async function openClarify(sent: SentTurn[]) {
  server.use(chatStreamPatchedHandler("clarify", clarifyCandidatesPatch, { spy: recordInto(sent) }));
  const answered = chatTurnsAnswered();
  renderChatPage(chatSearch({ q: "ハルヒ" }));
  await answered;
  return await screen.findByRole("button", { name: HARUHI_LABEL });
}

describe("clarify → pick → results (W1 #1220, MSW seam)", () => {
  it("sends the pick as a structured body under its own fresh turn key", async () => {
    const sent: SentTurn[] = [];
    const option = await openClarify(sent);
    server.use(chatStreamPatchedHandler("search", searchResultsPatch, { spy: recordInto(sent) }));
    await pressAndAwaitTurn(option);
    await screen.findByText("宇治橋");
    const { typed, picks } = await turnsByChannel(sent);
    expect(picks).toHaveLength(1);
    expect(picks[0]?.body.selected_candidate_ids).toEqual(["115908"]);
    expect(picks[0]?.body.clarification_id).toBe(4);
    expect(picks[0]?.turnId).toBeTruthy();
    expect(typed.map((turn) => turn.turnId)).not.toContain(picks[0]?.turnId);
    // The pick still reads as the visitor's own bubble (button + bubble).
    expect(screen.getAllByText(HARUHI_LABEL).length).toBeGreaterThan(1);
  });

  it("shows the honest in-flight copy on 409, re-arms the card, and retry resends the pick", async () => {
    const sent: SentTurn[] = [];
    const option = await openClarify(sent);
    server.use(chatStreamPatchedHandler("search", searchResultsPatch, { spy: recordInto(sent) }));
    server.use(chatConflictHandler("turn_in_flight", { once: true, spy: recordInto(sent) }));
    await pressAndAwaitTurn(option);
    await screen.findByText(en.errorStates.d15Message);
    expect(screen.queryByText(en.errorStates.d4Message)).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: HARUHI_LABEL }).getAttribute("data-state")).toBe("available");
    });
    await pressAndAwaitTurn(screen.getByRole("button", { name: en.errorStates.d15Retry }));
    await screen.findByText("宇治橋");
    const { picks } = await turnsByChannel(sent);
    expect(picks).toHaveLength(2);
    expect(picks[1]?.body.selected_candidate_ids).toEqual(["115908"]);
    expect(picks[1]?.body.clarification_id).toBe(4);
    expect(picks[1]?.turnId).toBe(picks[0]?.turnId);
  });

  it("shows the conflict copy on a stale-revision 409 and its retry re-reads state", async () => {
    const sent: SentTurn[] = [];
    const option = await openClarify(sent);
    server.use(chatStreamPatchedHandler("search", searchResultsPatch, { spy: recordInto(sent) }));
    server.use(chatConflictHandler("stale_revision", { once: true, spy: recordInto(sent) }));
    await pressAndAwaitTurn(option);
    await screen.findByText(en.errorStates.d16Message);
    expect(screen.queryByText(en.errorStates.d4Message)).toBeNull();
    // No persisted session in the recordings, so re-reading state degrades to
    // regenerating the turn — either way a THIRD request leaves the browser.
    await pressAndAwaitTurn(screen.getByRole("button", { name: en.errorStates.d16Retry }));
    expect(sent).toHaveLength(3);
  });
});
