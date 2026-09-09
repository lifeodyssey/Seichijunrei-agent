/** @vitest-environment jsdom */
import { fireEvent, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { chatTurnsAnswered } from "../../msw/chat-answered";
import { chatStreamHandler } from "../../msw/chat-handlers";
import { drainInFlightRequests } from "../../msw/in-flight-requests";
import { server } from "../../msw/node";
import { renderChatPage } from "./_chat-page";

it("finishes a cold chat turn before replacing the case's request handlers", async () => {
  const answered = chatTurnsAnswered();
  server.use(chatStreamHandler("search"));
  renderChatPage();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "cold turn" } });
  fireEvent.click(screen.getByRole("button", { name: chatDictFor("en").send }));
  await screen.findByText("cold turn");
  const outcome = await drainInFlightRequests();
  server.resetHandlers();
  const nextCase: string[] = [];
  server.use(chatStreamHandler("search", { spy: () => { nextCase.push("previous turn"); } }));
  await answered;
  expect(outcome.timedOut).toBe(false);
  expect(nextCase).toEqual([]);
});
