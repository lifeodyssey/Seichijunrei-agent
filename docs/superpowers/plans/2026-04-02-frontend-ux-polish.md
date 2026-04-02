# Frontend UX Polish Implementation Plan

> **Status:** Plan only — not yet executed. Save to `docs/superpowers/plans/2026-04-02-frontend-ux-polish.md` and commit before starting implementation.
> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two confirmed layout bugs (non-visual responses trigger right panel; stale data shown during loading) and address all UX issues found in systematic review: missing onboarding, raw database IDs in sidebar, intrusive feedback buttons, missing loading indicators, broken abort, vestigial dead code.

**Architecture:** Option A — only visual components (PilgrimageGrid, NearbyMap, RouteVisualization) open the right panel; text responses (GeneralAnswer, Clarification) stay inline in chat. `registry.ts` becomes the single source of truth for which components are "visual" via an exported `isVisualResponse()` helper. All other changes consume that helper.

**Tech Stack:** Next.js (static export), React 18, TypeScript, Tailwind v4 (CSS vars), vaul (mobile drawer), aiohttp backend.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `frontend/components/generative/registry.ts` | Modify | Add `VISUAL_COMPONENTS`, `isVisualResponse`; simplify renderers |
| `frontend/lib/types.ts` | Modify | Sync `Intent` type with backend actual values |
| `frontend/app/globals.css` | Modify | Add `panel-slide-in` + `pulse-skeleton` keyframes |
| `frontend/lib/api.ts` | Modify | Add `signal?: AbortSignal` param to `sendMessage` |
| `frontend/hooks/useChat.ts` | Modify | Wire AbortController signal; handle AbortError cleanly |
| `frontend/components/layout/AppShell.tsx` | Modify | Core bug fixes: hasVisualResponse, stale loading, smooth transition, bangumiTitleMap |
| `frontend/components/layout/ResultPanel.tsx` | Modify | Add `loading` prop; show skeleton instead of welcome state during loading |
| `frontend/components/layout/ResultDrawer.tsx` | Modify | Thread `loading` prop to ResultPanel |
| `frontend/components/layout/Sidebar.tsx` | Modify | Accept `bangumiTitleMap`; display anime title instead of raw ID |
| `frontend/components/chat/MessageBubble.tsx` | Modify | `canShowAnchor` → visual only; feedback buttons hover-reveal |
| `frontend/components/chat/MessageList.tsx` | Modify | Empty state shows example queries (onboarding) |
| `frontend/components/chat/ChatInput.tsx` | Modify | Auto-grow textarea; remove `prefill` prop; loading dots in send button |
| `frontend/components/generative/PilgrimageGrid.tsx` | Modify | Image fallback placeholder instead of invisible element |
| `frontend/AGENTS.md` | Modify | Update design system docs to match current light theme |

---

## Task 1: Add `isVisualResponse` to `registry.ts` + simplify renderers

**Files:**
- Modify: `frontend/components/generative/registry.ts`

- [ ] **Step 1.1: Add `VISUAL_COMPONENTS` set and `isVisualResponse` helper**

After the closing `}` of `intentToComponent` function (around line 82), append:

```ts
export const VISUAL_COMPONENTS = new Set([
  "PilgrimageGrid",
  "NearbyMap",
  "RouteVisualization",
]);

export function isVisualResponse(response: RuntimeResponse | null): boolean {
  if (!response) return false;
  return VISUAL_COMPONENTS.has(
    response.ui?.component ?? intentToComponent(response.intent),
  );
}
```

- [ ] **Step 1.2: Simplify `COMPONENT_REGISTRY` — remove dead `ui?.props?.data` fallback**

Replace the entire `COMPONENT_REGISTRY` object (lines 15–63) with:

```ts
export const COMPONENT_REGISTRY: Record<string, ComponentRenderer> = {
  PilgrimageGrid: (response) =>
    isSearchData(response.data)
      ? createElement(PilgrimageGrid, { data: response.data })
      : null,
  NearbyMap: (response) =>
    isSearchData(response.data)
      ? createElement(NearbyMap, { data: response.data })
      : null,
  RouteVisualization: (response) =>
    isRouteData(response.data)
      ? createElement(RouteVisualization, { data: response.data })
      : null,
  GeneralAnswer: (response) =>
    isQAData(response.data)
      ? createElement(GeneralAnswer, { data: response.data })
      : null,
  Clarification: (response, onSuggest) =>
    createElement(Clarification, { message: response.message, onSuggest }),
};
```

- [ ] **Step 1.3: Verify TypeScript builds cleanly**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully` (or `export` success with no type errors).

- [ ] **Step 1.4: Commit**

```bash
git add frontend/components/generative/registry.ts
git commit -m "refactor(registry): add isVisualResponse helper; remove dead ui.props fallback"
```

---

## Task 2: Sync `Intent` type with backend

**Files:**
- Modify: `frontend/lib/types.ts`

- [ ] **Step 2.1: Update Intent union (lines 9–14)**

```ts
// Before:
export type Intent =
  | "search_by_bangumi"
  | "search_by_location"
  | "plan_route"
  | "general_qa"
  | "unclear";

// After:
export type Intent =
  | "search_bangumi"
  | "search_nearby"
  | "plan_route"
  | "general_qa"
  | "unclear";
```

- [ ] **Step 2.2: Verify build — TS will catch any callers using old intent strings**

```bash
cd frontend && npm run build 2>&1 | grep -E "error|warning" | head -20
```

Expected: no new errors. The `intentToComponent` backward-compat aliases (`search_by_bangumi`, `search_by_location`) remain in `registry.ts` to handle any old cached responses — do not remove them.

- [ ] **Step 2.3: Commit**

```bash
git add frontend/lib/types.ts
git commit -m "fix(types): sync Intent type with backend actual values"
```

---

## Task 3: Add CSS keyframes

**Files:**
- Modify: `frontend/app/globals.css`

- [ ] **Step 3.1: Add keyframes after the existing `slide-up-fade` block (after line 74)**

```css
@keyframes panel-slide-in {
  from { opacity: 0; transform: translateX(16px); }
  to   { opacity: 1; transform: translateX(0); }
}

@keyframes pulse-skeleton {
  0%, 100% { opacity: 0.4; }
  50%       { opacity: 1;   }
}
```

- [ ] **Step 3.2: Commit**

```bash
git add frontend/app/globals.css
git commit -m "style: add panel-slide-in and pulse-skeleton keyframes"
```

---

## Task 4: Thread `AbortSignal` through api → useChat

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/hooks/useChat.ts`

- [ ] **Step 4.1: Add `signal` param to `sendMessage` in `api.ts`**

Change the `sendMessage` signature and add `signal` to the fetch call:

```ts
export async function sendMessage(
  text: string,
  sessionId?: string | null,
  locale?: RuntimeRequest["locale"],
  signal?: AbortSignal,
): Promise<RuntimeResponse> {
  const body: RuntimeRequest = { text };
  if (sessionId) body.session_id = sessionId;
  if (locale) body.locale = locale;

  const res = await fetch(`${RUNTIME_URL}/v1/runtime`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(
      errBody?.error?.message ?? `Runtime error (${res.status})`,
    );
  }

  return res.json() as Promise<RuntimeResponse>;
}
```

- [ ] **Step 4.2: Wire signal + handle AbortError in `useChat.ts`**

In the `send` callback, pass the signal (the `abortRef.current` is already created but was never used):

```ts
const response: RuntimeResponse = await sendMessage(
  text.trim(),
  sessionId,
  locale,
  abortRef.current.signal,   // ← was missing
);
```

Replace the entire `catch` block:

```ts
} catch (err) {
  if (err instanceof Error && err.name === "AbortError") {
    // User cancelled — remove placeholder silently
    setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
    return;
  }
  const errorText = err instanceof Error ? err.message : "Unknown error";
  setMessages((prev) =>
    prev.map((m) =>
      m.id === placeholderId
        ? { ...m, text: `Error: ${errorText}`, loading: false }
        : m,
    ),
  );
}
```

- [ ] **Step 4.3: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

- [ ] **Step 4.4: Commit**

```bash
git add frontend/lib/api.ts frontend/hooks/useChat.ts
git commit -m "fix(useChat): wire AbortController signal; handle AbortError cleanly"
```

---

## Task 5: Core AppShell layout fixes

**Files:**
- Modify: `frontend/components/layout/AppShell.tsx`

This task fixes Bug 1 (wrong `hasResponse`), Bug 2 (stale loading data), adds smooth transition, and wires bangumiTitleMap + onSuggest.

- [ ] **Step 5.1: Update imports**

At the top of `AppShell.tsx`, add:

```ts
import { isVisualResponse } from "../generative/registry";
import { isSearchData, isRouteData } from "../../lib/types";
```

(Keep all existing imports — only add these two lines.)

- [ ] **Step 5.2: Replace `latestResponseMessage` / `hasResponse` with visual-aware equivalents**

Remove:
```ts
const latestResponseMessage = useMemo(
  () => [...messages].reverse().find((m) => m.response) ?? null,
  [messages],
);
const hasResponse = latestResponseMessage !== null;
```

Add:
```ts
const latestVisualResponseMessage = useMemo(
  () =>
    [...messages].reverse().find((m) => m.response && isVisualResponse(m.response)) ?? null,
  [messages],
);
const hasVisualResponse = latestVisualResponseMessage !== null;
```

- [ ] **Step 5.3: Fix `activeMessage` — suppress stale panel during loading (Bug 2)**

Replace:
```ts
const activeMessage = activeMessageId
  ? messages.find((message) => message.id === activeMessageId) ?? null
  : latestResponseMessage;
```

With:
```ts
const activeMessage = activeMessageId
  ? messages.find((message) => message.id === activeMessageId) ?? null
  : sending
    ? null                         // suppress stale visual during new request
    : latestVisualResponseMessage;
```

- [ ] **Step 5.4: Add `bangumiTitleMap` memo**

After the `hasVisualResponse` line, add:

```ts
const bangumiTitleMap = useMemo(() => {
  const map = new Map<string, string>();
  messages.forEach((m) => {
    if (!m.response) return;
    const rows = isSearchData(m.response.data)
      ? m.response.data.results.rows
      : isRouteData(m.response.data)
        ? m.response.data.route.ordered_points
        : [];
    rows.forEach((r) => {
      if (r.bangumi_id && (r.title_cn || r.title)) {
        map.set(r.bangumi_id, r.title_cn || r.title);
      }
    });
  });
  return map;
}, [messages]);
```

- [ ] **Step 5.5: Update JSX — replace `hasResponse` → `hasVisualResponse`**

In the `<main>` element className (line ~97):
```tsx
// Before:
!isMobile && hasResponse
  ? "shrink-0 border-r border-[var(--color-border)]"
  : "flex-1"

// After:
!isMobile && hasVisualResponse
  ? "shrink-0 border-r border-[var(--color-border)]"
  : "flex-1"
```

In the `<main>` style (line ~101):
```tsx
// Before:
style={!isMobile && hasResponse ? { width: chatWidth } : undefined}

// After:
style={
  !isMobile && hasVisualResponse
    ? {
        width: chatWidth,
        transition: `width var(--duration-base) var(--ease-out-expo)`,
      }
    : undefined
}
```

- [ ] **Step 5.6: Update panel conditional — add slide-in animation, pass `loading` prop**

Replace:
```tsx
{isMobile ? (
  <ResultDrawer
    response={activeResponse}
    open={drawerOpen}
    onClose={() => setDrawerOpen(false)}
    onSuggest={handleSend}
  />
) : hasResponse && (
  <>
    <div
      onPointerDown={handleDividerPointerDown}
      onPointerMove={handleDividerPointerMove}
      onPointerUp={handleDividerPointerUp}
      className="w-1 shrink-0 cursor-col-resize bg-[var(--color-border)] transition-colors hover:bg-[var(--color-primary)]"
      style={{ transitionDuration: "var(--duration-fast)" }}
    />
    <ResultPanel activeResponse={activeResponse} onSuggest={handleSend} />
  </>
)}
```

With:
```tsx
{isMobile ? (
  <ResultDrawer
    response={activeResponse}
    open={drawerOpen}
    onClose={() => setDrawerOpen(false)}
    onSuggest={handleSend}
    loading={sending}
  />
) : hasVisualResponse && (
  <div
    className="contents"
    style={{ animation: "panel-slide-in var(--duration-base) var(--ease-out-expo) both" }}
  >
    <div
      onPointerDown={handleDividerPointerDown}
      onPointerMove={handleDividerPointerMove}
      onPointerUp={handleDividerPointerUp}
      className="w-1 shrink-0 cursor-col-resize bg-[var(--color-border)] transition-colors hover:bg-[var(--color-primary)]"
      style={{ transitionDuration: "var(--duration-fast)" }}
    />
    <ResultPanel activeResponse={activeResponse} onSuggest={handleSend} loading={sending} />
  </div>
)}
```

- [ ] **Step 5.7: Pass `bangumiTitleMap` to Sidebar and `onSuggest` to MessageList**

```tsx
// Sidebar call (line ~93):
{!isMobile && (
  <Sidebar
    routeHistory={routeHistory}
    bangumiTitleMap={bangumiTitleMap}
    onNewChat={handleNewChat}
  />
)}

// MessageList call (line ~105):
<MessageList
  messages={messages}
  onActivate={handleActivate}
  activeMessageId={activeResultMessageId}
  onOpenDrawer={isMobile ? handleOpenDrawer : undefined}
  onSuggest={handleSend}
/>
```

- [ ] **Step 5.8: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -15
```

Expected: no errors. If TS complains about `bangumiTitleMap` prop not existing on Sidebar, that's expected — it will be fixed in Task 8.

- [ ] **Step 5.9: Commit (even if Sidebar type error exists — will fix in Task 8)**

```bash
git add frontend/components/layout/AppShell.tsx
git commit -m "fix(AppShell): hasVisualResponse; suppress stale panel during loading; smooth transition; bangumiTitleMap"
```

---

## Task 6: ResultPanel loading skeleton

**Files:**
- Modify: `frontend/components/layout/ResultPanel.tsx`

- [ ] **Step 6.1: Add `loading` prop and skeleton branch**

Update the interface and function signature:
```tsx
interface ResultPanelProps {
  activeResponse: RuntimeResponse | null;
  onSuggest?: (text: string) => void;
  loading?: boolean;
}

export default function ResultPanel({ activeResponse, onSuggest, loading }: ResultPanelProps) {
```

Insert the skeleton branch **before** the existing `if (!activeResponse)` block:
```tsx
if (!activeResponse) {
  if (loading) {
    return (
      <section className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--color-bg)]">
        <div className="flex w-full flex-col gap-4 p-6">
          {[80, 55, 65].map((w) => (
            <div
              key={w}
              className="h-3 rounded-sm bg-[var(--color-muted)]"
              style={{
                width: `${w}%`,
                animation: "pulse-skeleton 1.6s ease-in-out infinite",
              }}
            />
          ))}
          <div
            className="mt-2 h-32 w-full rounded-sm bg-[var(--color-muted)]"
            style={{ animation: "pulse-skeleton 1.6s ease-in-out infinite 0.2s" }}
          />
        </div>
      </section>
    );
  }

  // existing welcome state begins here (return with the ghost typography)
  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--color-bg)]">
      {/* ... rest of existing welcome state unchanged ... */}
    </section>
  );
}
```

(Do not change the welcome state content — only wrap it in the `if (!loading)` branch.)

- [ ] **Step 6.2: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

- [ ] **Step 6.3: Commit**

```bash
git add frontend/components/layout/ResultPanel.tsx
git commit -m "feat(ResultPanel): loading skeleton state via loading prop"
```

---

## Task 7: ResultDrawer — thread `loading` prop

**Files:**
- Modify: `frontend/components/layout/ResultDrawer.tsx`

- [ ] **Step 7.1: Add `loading` prop and pass to ResultPanel**

```tsx
interface ResultDrawerProps {
  response: RuntimeResponse | null;
  open: boolean;
  onClose: () => void;
  onSuggest?: (text: string) => void;
  loading?: boolean;
}

export default function ResultDrawer({
  response,
  open,
  onClose,
  onSuggest,
  loading,
}: ResultDrawerProps) {
  // ...existing Drawer.Root/Portal/Content structure unchanged...
  // Only change: add loading to ResultPanel call:
  <ResultPanel activeResponse={response} onSuggest={onSuggest} loading={loading} />
}
```

- [ ] **Step 7.2: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

- [ ] **Step 7.3: Commit**

```bash
git add frontend/components/layout/ResultDrawer.tsx
git commit -m "feat(ResultDrawer): thread loading prop to ResultPanel"
```

---

## Task 8: Sidebar — show anime title instead of bangumi_id

**Files:**
- Modify: `frontend/components/layout/Sidebar.tsx`

- [ ] **Step 8.1: Add `bangumiTitleMap` to props and update route history render**

Update interface:
```tsx
interface SidebarProps {
  routeHistory: RouteHistoryRecord[];
  bangumiTitleMap?: Map<string, string>;
  onNewChat: () => void;
}

export default function Sidebar({ routeHistory, bangumiTitleMap, onNewChat }: SidebarProps) {
```

In the route history item (around line 62–68), change:
```tsx
// Before:
<p className="truncate text-xs font-light text-[var(--color-sidebar-accent-fg)]">
  {record.bangumi_id}
</p>

// After:
<p className="truncate text-xs font-light text-[var(--color-sidebar-accent-fg)]">
  {bangumiTitleMap?.get(record.bangumi_id) ?? record.bangumi_id}
</p>
```

- [ ] **Step 8.2: Verify build — this should now resolve the TS error from Task 5**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

- [ ] **Step 8.3: Commit**

```bash
git add frontend/components/layout/Sidebar.tsx
git commit -m "fix(Sidebar): show anime title from bangumiTitleMap instead of raw bangumi_id"
```

---

## Task 9: MessageBubble — visual-only anchor + hover feedback buttons

**Files:**
- Modify: `frontend/components/chat/MessageBubble.tsx`

- [ ] **Step 9.1: Import `isVisualResponse` and fix `canShowAnchor`**

Add import at top:
```tsx
import { isVisualResponse } from "../../generative/registry";
```

Replace `canShowAnchor` function (around line 93–95):
```tsx
// Before:
function canShowAnchor(response: RuntimeResponse): boolean {
  return response.intent !== "unclear" && response.ui?.component !== "Clarification";
}

// After:
function canShowAnchor(response: RuntimeResponse): boolean {
  return isVisualResponse(response);
}
```

- [ ] **Step 9.2: Add `group` class to outer bot message div and update FeedbackButtons to hover-reveal**

In the bot message `return` (around line 39), update the outer `<div>`:
```tsx
// Before:
<div
  className="flex flex-col gap-2.5"
  style={{ animation: "slide-up-fade 300ms var(--ease-out-quint) both" }}
>

// After:
<div
  className="group flex flex-col gap-2.5"
  style={{ animation: "slide-up-fade 300ms var(--ease-out-quint) both" }}
>
```

In `FeedbackButtons`, update the buttons container div (around line 176):
```tsx
// Before:
<div className="flex gap-0.5 opacity-40 hover:opacity-100 transition-opacity" style={...}>

// After:
<div
  className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-50 hover:!opacity-100"
  style={{ transitionDuration: "var(--duration-fast)" }}
>
```

- [ ] **Step 9.3: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

- [ ] **Step 9.4: Commit**

```bash
git add frontend/components/chat/MessageBubble.tsx
git commit -m "fix(MessageBubble): anchor only for visual responses; feedback buttons hover-reveal"
```

---

## Task 10: MessageList — empty state onboarding

**Files:**
- Modify: `frontend/components/chat/MessageList.tsx`

- [ ] **Step 10.1: Add `onSuggest` prop and update empty state**

Update interface:
```tsx
interface MessageListProps {
  messages: ChatMessage[];
  onActivate?: (messageId: string) => void;
  activeMessageId?: string | null;
  onOpenDrawer?: () => void;
  onSuggest?: (text: string) => void;
}

export default function MessageList({
  messages,
  onActivate,
  activeMessageId,
  onOpenDrawer,
  onSuggest,
}: MessageListProps) {
  const { chat: t, clarification } = useDict();
```

Replace the empty state branch (lines 28–35):
```tsx
if (messages.length === 0) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6">
      <p className="text-xs font-light text-[var(--color-muted-fg)] opacity-50">
        {t.placeholder}
      </p>
      <div className="flex flex-col items-center gap-2">
        {clarification.suggestions.map((s) => (
          <button
            key={s.label}
            onClick={() => onSuggest?.(s.query)}
            className="text-xs font-light text-[var(--color-muted-fg)] transition-colors hover:text-[var(--color-primary)]"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            {s.label} →
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 10.2: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

- [ ] **Step 10.3: Commit**

```bash
git add frontend/components/chat/MessageList.tsx
git commit -m "feat(MessageList): show example queries in empty state for onboarding"
```

---

## Task 11: ChatInput — auto-grow, remove prefill, loading dots

**Files:**
- Modify: `frontend/components/chat/ChatInput.tsx`

- [ ] **Step 11.1: Rewrite ChatInput with all three improvements**

Replace the entire file content:

```tsx
"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import { useDict } from "../../lib/i18n-context";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const { chat: t } = useDict();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  function handleSubmit() {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="border-t border-[var(--color-border)] px-4 py-4">
      <div
        className="mx-auto flex w-full max-w-2xl items-end gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 shadow-sm transition focus-within:border-[var(--color-primary)]"
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        <textarea
          ref={textareaRef}
          aria-label={t.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.placeholder}
          rows={1}
          disabled={disabled}
          className="flex-1 overflow-hidden resize-none bg-transparent text-sm font-light outline-none placeholder:text-[var(--color-muted-fg)] disabled:opacity-50"
          style={{ maxHeight: "8rem" }}
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !text.trim()}
          className="shrink-0 rounded-lg bg-[var(--color-primary)] px-4 py-1.5 text-xs font-medium uppercase tracking-wider text-[var(--color-primary-fg)] transition hover:opacity-90 disabled:opacity-30"
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          {disabled ? (
            <span className="flex items-center gap-0.5">
              {([0, 0.2, 0.4] as const).map((delay) => (
                <span
                  key={delay}
                  className="inline-block h-1 w-1 rounded-full bg-current"
                  style={{
                    animation: "breathe 1.2s ease-in-out infinite",
                    animationDelay: `${delay}s`,
                  }}
                />
              ))}
            </span>
          ) : (
            t.send
          )}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 11.2: Remove `prefill=""` from AppShell.tsx**

In `AppShell.tsx`, find the `<ChatInput>` call and remove the `prefill` prop:
```tsx
// Before:
<ChatInput onSend={handleSend} disabled={sending} prefill="" />

// After:
<ChatInput onSend={handleSend} disabled={sending} />
```

- [ ] **Step 11.3: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

- [ ] **Step 11.4: Commit**

```bash
git add frontend/components/chat/ChatInput.tsx frontend/components/layout/AppShell.tsx
git commit -m "feat(ChatInput): auto-grow textarea; loading dots; remove vestigial prefill prop"
```

---

## Task 12: PilgrimageGrid — image fallback placeholder

**Files:**
- Modify: `frontend/components/generative/PilgrimageGrid.tsx`

- [ ] **Step 12.1: Extract `PilgrimageCard` sub-component with `imgError` state**

Add `useState` to the import line:
```tsx
import { useState } from "react";
import type { SearchResultData, PilgrimagePoint } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
```

Add the `PilgrimageCard` sub-component **before** the `PilgrimageGrid` export:

```tsx
function PilgrimageCard({
  point,
  idx,
  episodeLabel,
}: {
  point: PilgrimagePoint;
  idx: number;
  episodeLabel: string;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <div
      className={`relative overflow-hidden rounded-sm bg-[var(--color-muted)] ${
        idx === 0 ? "col-span-2" : ""
      }`}
    >
      <div
        className={`relative bg-[var(--color-muted)] ${
          idx === 0 ? "aspect-video" : "aspect-[4/3]"
        }`}
      >
        {point.screenshot_url && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={point.screenshot_url}
            alt={point.name_cn || point.name}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span
              className="select-none font-[family-name:var(--app-font-display)] text-2xl"
              style={{
                color: "color-mix(in oklch, var(--color-fg) 12%, transparent)",
              }}
            >
              聖
            </span>
          </div>
        )}
      </div>

      {point.episode != null && point.episode !== 0 && (
        <span className="absolute bottom-2 left-2 rounded-sm bg-black/60 px-1.5 py-0.5 text-[10px] text-white/80">
          {episodeLabel.replace("{ep}", String(point.episode))}
        </span>
      )}

      <div className="pb-2 pt-1.5">
        <p className="truncate text-xs font-light text-[var(--color-fg)]">
          {point.name_cn || point.name}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 12.2: Update the grid `.map()` in `PilgrimageGrid` to use `PilgrimageCard`**

Replace the existing grid map (the `{results.rows.map(...)}` block inside the `grid` div):

```tsx
<div className="grid grid-cols-2 gap-2 md:grid-cols-4">
  {results.rows.map((point, idx) => (
    <PilgrimageCard
      key={point.id}
      point={point}
      idx={idx}
      episodeLabel={t.episode}
    />
  ))}
</div>
```

- [ ] **Step 12.3: Verify build**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

- [ ] **Step 12.4: Commit**

```bash
git add frontend/components/generative/PilgrimageGrid.tsx
git commit -m "fix(PilgrimageGrid): show 聖 placeholder when screenshot fails to load"
```

---

## Task 13: Update AGENTS.md

**Files:**
- Modify: `frontend/AGENTS.md`

- [ ] **Step 13.1: Update the Design System section**

Find the "## Design System" section and replace it:

```markdown
## Design System

Light theme — no dark mode toggle. Palette is 京吹夏季 (Kyoto summer, KyoAni-inspired).

CSS variables (defined in `app/globals.css`):
\`\`\`css
--color-bg:        oklch(98% 0.008 218)   /* near-white */
--color-fg:        oklch(20% 0.025 238)   /* near-black */
--color-card:      oklch(95% 0.012 215)
--color-muted:     oklch(91% 0.016 218)
--color-muted-fg:  oklch(54% 0.032 228)
--color-border:    oklch(85% 0.022 222)
--color-primary:   oklch(60% 0.148 240)   /* cornflower blue */
--font-display:    "Shippori Mincho B1", Georgia, serif
--font-body:       "Outfit", system-ui, sans-serif
\`\`\`

Use CSS variables, not Tailwind color classes, for brand colors.
```

- [ ] **Step 13.2: Commit**

```bash
git add frontend/AGENTS.md
git commit -m "docs(AGENTS.md): update design system to match current light theme"
```

---

## Verification Checklist

Run `cd frontend && npm run dev`, then test:

- [ ] **Bug 1**: Send "什么是圣地巡礼" (general question) → response appears inline in chat, right panel does **not** appear, layout stays single-column.
- [ ] **Bug 2**: Send "響け！ユーフォニアム の聖地を見せて" → wait for grid to appear. Send another query immediately. Right panel shows **skeleton** (pulsing bars), not old grid.
- [ ] **Panel transition**: Send anime search → right panel slides in from right smoothly. Send general question → panel slides out. No layout jump.
- [ ] **Sidebar title**: After an anime search, route history in sidebar shows anime title (e.g. "響け！ユーフォニアム"), not "253".
- [ ] **Textarea**: Type 5+ lines of text → textarea expands, capped at ~5 lines.
- [ ] **Loading dots**: While request is in flight, send button shows three breathing dots instead of "送信".
- [ ] **Feedback buttons**: Hover a bot message → feedback buttons appear. Move mouse away → buttons disappear.
- [ ] **Empty chat**: On first load (no messages), example query buttons are visible and clickable.
- [ ] **Image fallback**: If a screenshot URL 404s, card shows "聖" glyph placeholder, not blank box.
- [ ] **Build**: `npm run build` exits 0 with no TypeScript errors.
