import type { ChatStatus, UIMessage } from "ai";
import { memo, useMemo, useRef } from "react";
import { routeDocumentKey, supersededFlags } from "../lib/supersession";
import { HIDDEN_TOOL_STEPS } from "../i18n";
import type { ChatDict } from "../i18n";
import { formatElapsed } from "../telemetry";
import { statusedSteps } from "../tool-steps";
import { DataPartCard } from "./DataPartCard";
import { SettledFootprint } from "./SettledFootprint";
import { ToolStepBadge } from "./ToolStepBadge";

type Part = UIMessage["parts"][number];
type ToolPart = Extract<Part, { toolCallId: string }>;
type PartProps = Readonly<{ part: Part; dict: ChatDict; superseded: boolean; settled: boolean }>;

function isToolPart(part: Part): part is ToolPart {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

function nonToolParts(message: UIMessage): readonly Part[] {
  return message.parts.filter((part) => !isToolPart(part));
}

function MessagePart({ part, dict, superseded, settled }: PartProps) {
  if (part.type === "text") return <p className="chat-bubble">{part.text}</p>;
  if (part.type === "data-response") return <DataPartCard data={part.data} dict={dict} superseded={superseded} pending={!settled} />;
  return null;
}

function partKey(messageId: string, part: Part, index: number): string {
  return `${messageId}:${part.type}:${String(index)}`;
}

interface DataPartRef {
  readonly key: string;
  readonly data: unknown;
}

function messageDataParts(message: UIMessage): readonly DataPartRef[] {
  const refs: DataPartRef[] = [];
  for (const [index, part] of nonToolParts(message).entries()) {
    if (part.type === "data-response") refs.push({ key: partKey(message.id, part, index), data: part.data });
  }
  return refs;
}

/**
 * E1 living-document pass (issue #271, generalized for #273): collect every
 * streamed data part in conversation order and flag the ones a newer card of
 * the same document supersedes. Route cards are the first keyed document.
 */
function supersededKeysFrom(refs: readonly DataPartRef[]): ReadonlySet<string> {
  const flags = supersededFlags(refs.map((ref) => routeDocumentKey(ref.data)));
  return new Set(refs.filter((_, index) => flags[index] === true).map((ref) => ref.key));
}

/** Supersession reads only the data parts' document keys, so the set keeps a
 * stable identity while text chunks stream (same pattern as useStablePoints in
 * SearchMap) — memoized rows then skip every SSE chunk that adds no data part. */
function useSupersededKeys(visible: readonly UIMessage[]): ReadonlySet<string> {
  const refs = useMemo(() => visible.flatMap(messageDataParts), [visible]);
  const key = refs.map((ref) => `${ref.key}:${routeDocumentKey(ref.data) ?? ""}`).join("|");
  const held = useRef({ key, set: supersededKeysFrom(refs) });
  if (held.current.key !== key) held.current = { key, set: supersededKeysFrom(refs) };
  return held.current.set;
}

function ToolBadges({ parts, dict }: Readonly<{ parts: readonly ToolPart[]; dict: ChatDict }>) {
  const badges = statusedSteps(parts).flatMap(({ step, status }) => {
    if (HIDDEN_TOOL_STEPS.has(step.type.replace(/^tool-/, ""))) return [];
    return [<ToolStepBadge key={step.toolCallId} type={step.type} status={status} dict={dict} />];
  });
  return badges;
}

type PipelineProps = Readonly<{
  parts: readonly ToolPart[];
  settled: boolean;
  elapsedLabel?: string;
  dict: ChatDict;
}>;

function Pipeline({ parts, settled, elapsedLabel, dict }: PipelineProps) {
  if (parts.length === 0) return null;
  const badges = <ToolBadges parts={parts} dict={dict} />;
  if (!settled) return badges;
  return <SettledFootprint elapsedLabel={elapsedLabel} dict={dict}>{badges}</SettledFootprint>;
}

type RailProps = Readonly<{ message: UIMessage; settled: boolean; elapsedLabel?: string; dict: ChatDict }>;

/** The turn's progress rail: tool badges for every turn — selection turns
 * stream their `plan_selected` step like any other (TURN-4 #955, bypass
 * detection deleted). */
function MessageRail({ message, settled, elapsedLabel, dict }: RailProps) {
  return <Pipeline parts={message.parts.filter(isToolPart)} settled={settled} elapsedLabel={elapsedLabel} dict={dict} />;
}

type BodyProps = Readonly<{
  parts: readonly Part[];
  messageId: string;
  dict: ChatDict;
  settled: boolean;
  supersededKeys: ReadonlySet<string>;
}>;

function MessageBody({ parts, messageId, dict, settled, supersededKeys }: BodyProps) {
  return parts.map((part, index) => {
    const key = partKey(messageId, part, index);
    return <MessagePart key={key} part={part} dict={dict} settled={settled} superseded={supersededKeys.has(key)} />;
  });
}

type ItemProps = Readonly<{
  message: UIMessage;
  dict: ChatDict;
  settled: boolean;
  elapsedLabel?: string;
  supersededKeys: ReadonlySet<string>;
}>;

/** Memoized so a streaming SSE chunk re-renders only the row whose message
 * actually changed; every prop is a primitive or a stable reference. */
const MessageItem = memo(function MessageItem({ message, dict, settled, elapsedLabel, supersededKeys }: ItemProps) {
  return (
    <li className={`chat-message chat-message--${message.role}`}>
      <MessageRail message={message} settled={settled} elapsedLabel={elapsedLabel} dict={dict} />
      <MessageBody parts={nonToolParts(message)} messageId={message.id} dict={dict} settled={settled} supersededKeys={supersededKeys} />
    </li>
  );
});

function isActive(status: ChatStatus): boolean {
  return status === "submitted" || status === "streaming";
}

function elapsedFor(isLast: boolean, settledDurationMs?: number): string | undefined {
  if (!isLast || settledDurationMs === undefined) return undefined;
  return formatElapsed(settledDurationMs);
}

type RowProps = Readonly<{
  message: UIMessage;
  isLast: boolean;
  dict: ChatDict;
  status: ChatStatus;
  settledDurationMs?: number;
  supersededKeys: ReadonlySet<string>;
}>;

function MessageRow({ message, isLast, dict, status, settledDurationMs, supersededKeys }: RowProps) {
  const settled = !(isLast && isActive(status));
  return (
    <MessageItem message={message} dict={dict} settled={settled} elapsedLabel={elapsedFor(isLast, settledDurationMs)} supersededKeys={supersededKeys} />
  );
}

type ListProps = Readonly<{
  messages: readonly UIMessage[];
  dict: ChatDict;
  status: ChatStatus;
  settledDurationMs?: number;
}>;

/** Part-less messages are recompute turn boundaries, never rendered rows. */
function visibleMessages(messages: readonly UIMessage[]): readonly UIMessage[] {
  return messages.filter((message) => message.parts.length > 0);
}

export function MessageList({ messages, dict, status, settledDurationMs }: ListProps) {
  const visible = useMemo(() => visibleMessages(messages), [messages]);
  const supersededKeys = useSupersededKeys(visible);
  if (visible.length === 0) return null;
  const lastId = messages.at(-1)?.id;
  const items = visible.map((message) => (
    <MessageRow key={message.id} message={message} isLast={message.id === lastId} dict={dict} status={status} settledDurationMs={settledDurationMs} supersededKeys={supersededKeys} />
  ));
  return <ol className="chat-messages">{items}</ol>;
}
