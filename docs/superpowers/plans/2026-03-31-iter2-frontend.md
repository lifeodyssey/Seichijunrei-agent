# Seichijunrei — Iter 2: Frontend Redesign Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Status (2026-04-03):** Landed in the codebase, but design tokens/palette have since evolved. Treat this as historical rationale; use `docs/ARCHITECTURE.md` + `frontend/app/globals.css` for current behavior/tokens.

**Goal:** Three-column layout (sidebar + chat-text-only + result panel). Generative UI renderer replaces hardcoded switch. ~~Always-dark Shippori Mincho theme.~~ *(SUPERSEDED: shipped as light theme — 京吹夏季 palette. See `frontend/app/globals.css` for current tokens.)* Chat panel anchors results — clicking `◈` activates the corresponding result in the right panel. English locale added.

**Architecture:** `AppShell` gains `activeMessageId` state + `ResultPanel` column. `MessageBubble` drops `IntentRenderer`; bot messages get a `◈ anchor card`. `GenerativeUIRenderer` (registry) replaces `IntentRenderer` (switch). Three generative components adapted for the large result panel. New `en.json` dictionary.

**Pre-flight:** Iter 1 backend complete + `make serve` running so E2E smoke tests work.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS v4, TypeScript

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| **Modify** | `frontend/app/globals.css` | Always-dark tokens, Shippori Mincho import, `@keyframes breathe` |
| **Modify** | `frontend/lib/types.ts` | Add `UIDescriptor` to `RuntimeResponse` |
| **Create** | `frontend/components/generative/registry.ts` | Component registry for Generative UI |
| **Create** | `frontend/components/generative/GenerativeUIRenderer.tsx` | Registry-based renderer |
| **Delete** | `frontend/components/generative/IntentRenderer.tsx` | Replaced by `GenerativeUIRenderer` |
| **Create** | `frontend/components/layout/ResultPanel.tsx` | Right column — renders active result |
| **Modify** | `frontend/components/layout/AppShell.tsx` | Three-column, `activeMessageId` state |
| **Modify** | `frontend/components/chat/MessageList.tsx` | Pass `onActivate` to `MessageBubble` |
| **Modify** | `frontend/components/chat/MessageBubble.tsx` | Remove IntentRenderer; add `◈` anchor |
| **Modify** | `frontend/components/generative/PilgrimageGrid.tsx` | 4-col grid, no raw intent badge |
| **Modify** | `frontend/components/generative/RouteVisualization.tsx` | Map fills panel, list overlay |
| **Modify** | `frontend/components/generative/NearbyMap.tsx` | 60/40 map/list split, no badge |
| **Create** | `frontend/app/[lang]/dictionaries/en.json` | English UI strings |

---

## Stream Note

Tasks 1–2 (CSS + types) can run in parallel.
Tasks 3–4 (registry + GenerativeUIRenderer) depend on Task 2.
Tasks 5–7 (ResultPanel + AppShell + MessageBubble) depend on Task 4.
Tasks 8–10 (component updates) can run in parallel after Task 4.
Task 11 (en.json) is independent throughout.

---

## Task 1: ~~Dark Theme~~ Theme Tokens — `frontend/app/globals.css`

> **SUPERSEDED:** This task originally specified a dark theme (`#0f0f11` bg, `#d4954a` primary). The shipped design uses a **light theme** (京吹夏季 / KyoAni summer palette: `oklch(98% 0.008 218)` bg, `oklch(60% 0.148 240)` primary). The tokens below are **historical** — see `frontend/app/globals.css` for current values.

**Files:**

- Modify: `frontend/app/globals.css`

- [x] **Step 1.1: Replace `:root` tokens and remove light/dark split** *(completed — shipped as light theme)*

Replace the entire `:root` block and `@media (prefers-color-scheme: dark)` block:

```css
@import "../node_modules/tailwindcss/index.css";

/* Google Fonts — Shippori Mincho B1 (display) */
@import url("https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@400;500;600;700&display=swap");

/* ── Always-dark design tokens ── */
:root {
  --app-font-sans: "Hiragino Sans", "Yu Gothic UI", "Noto Sans CJK JP", system-ui, sans-serif;
  --app-font-mono: "SFMono-Regular", "IBM Plex Mono", monospace;
  --app-font-display: "Shippori Mincho B1", "Hiragino Mincho ProN", Georgia, serif;

  /* Core */
  --color-bg:          #0f0f11;
  --color-fg:          #f0ece6;
  --color-card:        #17171a;
  --color-card-fg:     #f0ece6;
  --color-muted:       #1e1e22;
  --color-muted-fg:    #7a7270;
  --color-border:      #272729;
  --color-input:       #272729;

  /* Primary — 琥珀橙 */
  --color-primary:     #d4954a;
  --color-primary-fg:  #0f0f11;

  /* Secondary */
  --color-secondary:     #272729;
  --color-secondary-fg:  #f0ece6;

  /* Semantic */
  --color-info:         #1a2535;
  --color-info-fg:      #7dd3fc;
  --color-success:      #14331a;
  --color-success-fg:   #86efac;
  --color-warning:      #2a1f0a;
  --color-warning-fg:   #fbbf24;
  --color-error:        #2a0f0f;
  --color-error-fg:     #fca5a5;

  /* Sidebar */
  --color-sidebar:          #0d0d0f;
  --color-sidebar-fg:       #7a7270;
  --color-sidebar-border:   #1e1e22;
  --color-sidebar-accent:   #17171a;
  --color-sidebar-accent-fg: #f0ece6;
}

/* ── Loading animation for thinking dots ── */
@keyframes breathe {
  0%, 100% { opacity: 0.2; transform: scale(0.85); }
  50%       { opacity: 1;   transform: scale(1.1); }
}

/* ── Tailwind theme extension ── */
@theme inline {
  --font-display: var(--app-font-display);
  --font-sans: var(--app-font-sans);
  --font-mono: var(--app-font-mono);
}
```

- [ ] **Step 1.2: Start dev server and visual check**
```bash
cd frontend && npm run dev
# Open http://localhost:3000/ja/
# Expected: dark background (#0f0f11), amber primary (#d4954a), Shippori Mincho for headings
```

- [ ] **Step 1.3: Commit**
```bash
git add frontend/app/globals.css
git commit -m "feat(theme): always-dark tokens, Shippori Mincho B1 display font"
```

---

## Task 2: `frontend/lib/types.ts` — Add `UIDescriptor`

**Files:**

- Modify: `frontend/lib/types.ts`

- [ ] **Step 2.1: Add `UIDescriptor` interface and update `RuntimeResponse`**

Add after the `RouteHistoryRecord` interface:
```typescript
/** Generative UI descriptor — backend tells frontend which component to render. */
export interface UIDescriptor {
  component: string;              // e.g. "PilgrimageGrid"
  props: Record<string, unknown>; // additional props (currently unused; reserved)
}
```

Update `RuntimeResponse`:
```typescript
export interface RuntimeResponse {
  success: boolean;
  status: string;
  intent: Intent;
  session_id: string | null;
  message: string;
  data: SearchResultData | RouteData | QAData;
  session: {
    interaction_count: number;
    route_history_count: number;
    last_intent?: string | null;
    last_status?: string | null;
    last_message?: string;
  };
  route_history: RouteHistoryRecord[];
  errors: PublicAPIError[];
  debug?: Record<string, unknown> | null;
  ui?: UIDescriptor;              // NEW — optional Generative UI descriptor
}
```

Also update `PublicAPIRequest` to allow `"en"` locale:
```typescript
export interface RuntimeRequest {
  text: string;
  session_id?: string | null;
  locale?: "ja" | "zh" | "en";   // was: locale?: string
  model?: string | null;
  include_debug?: boolean;
}
```

- [ ] **Step 2.2: TypeScript check**
```bash
cd frontend && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 2.3: Commit**
```bash
git add frontend/lib/types.ts
git commit -m "feat(types): add UIDescriptor to RuntimeResponse, add 'en' locale"
```

---

## Task 3: `frontend/components/generative/registry.ts` — Component Registry

**Files:**

- Create: `frontend/components/generative/registry.ts`

- [ ] **Step 3.1: Create the registry**

```typescript
// frontend/components/generative/registry.ts
"use client";

import type { ComponentType } from "react";
import type { RuntimeResponse } from "../../lib/types";
import { isSearchData, isRouteData, isQAData } from "../../lib/types";

/** A renderer function: takes the full RuntimeResponse + optional onSuggest callback. */
export type ComponentRenderer = (
  response: RuntimeResponse,
  onSuggest?: (text: string) => void
) => React.ReactElement | null;

/** Registry mapping backend component names to renderer functions.
 *
 * Adding a new component = add one entry here. No routing logic changes.
 */
export const COMPONENT_REGISTRY: Record<string, ComponentRenderer> = {
  PilgrimageGrid: (r) => {
    if (!isSearchData(r.data)) return null;
    const PilgrimageGrid = require("./PilgrimageGrid").default as ComponentType<{ data: typeof r.data }>;
    return <PilgrimageGrid data={r.data} />;
  },
  NearbyMap: (r) => {
    if (!isSearchData(r.data)) return null;
    const NearbyMap = require("./NearbyMap").default as ComponentType<{ data: typeof r.data }>;
    return <NearbyMap data={r.data} />;
  },
  RouteVisualization: (r) => {
    if (!isRouteData(r.data)) return null;
    const RouteVisualization = require("./RouteVisualization").default as ComponentType<{ data: typeof r.data }>;
    return <RouteVisualization data={r.data} />;
  },
  GeneralAnswer: (r) => {
    if (!isQAData(r.data)) return null;
    const GeneralAnswer = require("./GeneralAnswer").default as ComponentType<{ data: typeof r.data }>;
    return <GeneralAnswer data={r.data} />;
  },
  Clarification: (r, onSuggest) => {
    const Clarification = require("./Clarification").default as ComponentType<{
      message: string;
      onSuggest?: (text: string) => void;
    }>;
    return <Clarification message={r.message} onSuggest={onSuggest} />;
  },
};
```

> Note: The `require()` calls avoid circular imports while keeping the registry file simple. If the project uses barrel imports (`index.ts`), use named imports instead.

- [ ] **Step 3.2: TypeScript check**
```bash
cd frontend && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 3.3: Commit**
```bash
git add frontend/components/generative/registry.ts
git commit -m "feat(generative): add component registry for Generative UI pattern"
```

---

## Task 4: `GenerativeUIRenderer.tsx` + Delete `IntentRenderer.tsx`

**Files:**

- Create: `frontend/components/generative/GenerativeUIRenderer.tsx`
- Delete: `frontend/components/generative/IntentRenderer.tsx`

- [ ] **Step 4.1: Create `GenerativeUIRenderer.tsx`**

```typescript
// frontend/components/generative/GenerativeUIRenderer.tsx
"use client";

import type { RuntimeResponse } from "../../lib/types";
import { isSearchData, isRouteData, isQAData } from "../../lib/types";
import { COMPONENT_REGISTRY } from "./registry";

interface GenerativeUIRendererProps {
  response: RuntimeResponse;
  onSuggest?: (text: string) => void;
}

/**
 * Renders a RuntimeResponse using the backend-supplied component name
 * (response.ui.component). Falls back to intent-based lookup if ui is absent
 * (backwards compatibility with API versions before Generative UI).
 */
export default function GenerativeUIRenderer({
  response,
  onSuggest,
}: GenerativeUIRendererProps) {
  // Primary: use backend-supplied component name
  const componentName = response.ui?.component ?? _intentToComponent(response.intent);
  const renderer = COMPONENT_REGISTRY[componentName];

  if (!renderer) {
    return (
      <p className="text-sm text-[var(--color-muted-fg)]">
        Unknown component: {componentName}
      </p>
    );
  }

  return renderer(response, onSuggest);
}

/** Fallback: map intent string to component name when ui field is absent. */
function _intentToComponent(intent: string): string {
  const map: Record<string, string> = {
    search_by_bangumi: "PilgrimageGrid",
    search_by_location: "NearbyMap",
    plan_route: "RouteVisualization",
    search_bangumi: "PilgrimageGrid",
    search_nearby: "NearbyMap",
    general_qa: "GeneralAnswer",
    answer_question: "GeneralAnswer",
    unclear: "Clarification",
  };
  return map[intent] ?? "Clarification";
}
```

- [ ] **Step 4.2: Delete `IntentRenderer.tsx`**
```bash
git rm frontend/components/generative/IntentRenderer.tsx
```

- [ ] **Step 4.3: Fix any remaining imports of `IntentRenderer`**
```bash
grep -rn "IntentRenderer" frontend/
# Should find 0 results after Step 4.2 (MessageBubble will be updated in Task 7)
# If MessageBubble still imports it, update the import to GenerativeUIRenderer now
```

- [ ] **Step 4.4: TypeScript check**
```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4.5: Commit**
```bash
git add frontend/components/generative/GenerativeUIRenderer.tsx
git commit -m "feat(generative): add GenerativeUIRenderer (registry), delete IntentRenderer (switch)"
```

---

## Task 5: `frontend/components/layout/ResultPanel.tsx` — New Right Column

**Files:**

- Create: `frontend/components/layout/ResultPanel.tsx`

- [ ] **Step 5.1: Create `ResultPanel.tsx`**

```typescript
// frontend/components/layout/ResultPanel.tsx
"use client";

import type { RuntimeResponse } from "../../lib/types";
import GenerativeUIRenderer from "../generative/GenerativeUIRenderer";

interface ResultPanelProps {
  /** The response to render. null = empty/welcome state. */
  activeResponse: RuntimeResponse | null;
  onSuggest?: (text: string) => void;
}

/**
 * Result Panel — the right column of the three-column layout.
 *
 * Renders the "active" RuntimeResponse (defaults to latest, can be any
 * historical response when user clicks a ◈ anchor in the chat).
 *
 * Empty state: dark decorative background with centered label.
 */
export default function ResultPanel({ activeResponse, onSuggest }: ResultPanelProps) {
  if (!activeResponse) {
    return (
      <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-[var(--color-bg)]">
        {/* Decorative grid background */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(var(--color-fg) 1px, transparent 1px), linear-gradient(90deg, var(--color-fg) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <p
          className="relative text-sm text-[var(--color-muted-fg)] font-[var(--app-font-display)]"
          style={{ letterSpacing: "0.15em" }}
        >
          聖地を探す
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
      <div className="flex-1 overflow-y-auto p-6">
        <GenerativeUIRenderer response={activeResponse} onSuggest={onSuggest} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5.2: TypeScript check**
```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5.3: Commit**
```bash
git add frontend/components/layout/ResultPanel.tsx
git commit -m "feat(layout): add ResultPanel — right column with empty state and GenerativeUIRenderer"
```

---

## Task 6: `frontend/components/layout/AppShell.tsx` — Three-Column Layout

**Files:**

- Modify: `frontend/components/layout/AppShell.tsx`

- [ ] **Step 6.1: Rewrite `AppShell.tsx`**

```typescript
// frontend/components/layout/AppShell.tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { useChat } from "../../hooks/useChat";
import { useLocale } from "../../lib/i18n-context";
import Sidebar from "./Sidebar";
import ChatHeader from "./ChatHeader";
import MessageList from "../chat/MessageList";
import ChatInput from "../chat/ChatInput";
import ResultPanel from "./ResultPanel";
import type { RouteHistoryRecord, RuntimeResponse } from "../../lib/types";

export default function AppShell() {
  const locale = useLocale();
  const { sessionId, setSessionId, clearSession } = useSession();
  const { messages, send, sending, clear } = useChat(sessionId, setSessionId, locale);

  /** ID of the message whose result is shown in the Result Panel.
   *  null = always show the latest response. */
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

  /** The RuntimeResponse currently displayed in the Result Panel. */
  const activeResponse = useMemo<RuntimeResponse | null>(() => {
    if (activeMessageId !== null) {
      const msg = messages.find((m) => m.id === activeMessageId);
      return msg?.response ?? null;
    }
    // Default: latest response
    return [...messages].reverse().find((m) => m.response)?.response ?? null;
  }, [messages, activeMessageId]);

  // When a new message with a response arrives, switch to showing the latest
  const latestResponseId = useMemo(() => {
    return [...messages].reverse().find((m) => m.response)?.id ?? null;
  }, [messages]);

  const handleActivate = useCallback((messageId: string) => {
    setActiveMessageId((prev) => (prev === messageId ? null : messageId));
  }, []);

  const routeHistory: RouteHistoryRecord[] =
    [...messages]
      .reverse()
      .find((m) => m.response?.route_history?.length)
      ?.response?.route_history ?? [];

  const handleNewChat = useCallback(() => {
    clear();
    clearSession();
    setActiveMessageId(null);
  }, [clear, clearSession]);

  const handleSend = useCallback(
    (text: string) => {
      setActiveMessageId(null); // auto-advance to latest on new send
      send(text);
    },
    [send],
  );

  const handleSuggest = useCallback(
    (text: string) => {
      handleSend(text);
    },
    [handleSend],
  );

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      {/* Column 1: Sidebar (240px) */}
      <Sidebar routeHistory={routeHistory} onNewChat={handleNewChat} />

      {/* Column 2: Chat (360px, text-only) */}
      <div className="flex w-[360px] shrink-0 flex-col border-r border-[var(--color-border)]">
        <ChatHeader />
        <MessageList
          messages={messages}
          onSuggest={handleSuggest}
          onActivate={handleActivate}
          activeMessageId={activeMessageId ?? latestResponseId}
        />
        <ChatInput onSend={handleSend} disabled={sending} prefill="" />
      </div>

      {/* Column 3: Result Panel (flex-1) */}
      <ResultPanel activeResponse={activeResponse} onSuggest={handleSuggest} />
    </div>
  );
}
```

- [ ] **Step 6.2: TypeScript check**
```bash
cd frontend && npx tsc --noEmit
# Will fail until MessageList accepts onActivate — fix in Task 7
```

- [ ] **Step 6.3: Commit after Task 7 passes TypeScript check**

---

## Task 7: `MessageList.tsx` + `MessageBubble.tsx` — ◈ Anchor Card

**Files:**

- Modify: `frontend/components/chat/MessageList.tsx`
- Modify: `frontend/components/chat/MessageBubble.tsx`

- [ ] **Step 7.1: Update `MessageList.tsx` to forward `onActivate`**

```typescript
// frontend/components/chat/MessageList.tsx
"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../lib/types";
import MessageBubble from "./MessageBubble";
import { useDict } from "../../lib/i18n-context";

interface MessageListProps {
  messages: ChatMessage[];
  onSuggest?: (text: string) => void;
  onActivate?: (messageId: string) => void;  // NEW
  activeMessageId?: string | null;           // NEW — which message is active in panel
}

export default function MessageList({
  messages,
  onSuggest,
  onActivate,
  activeMessageId,
}: MessageListProps) {
  const { chat: t } = useDict();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--color-muted-fg)]">
        <div className="text-center">
          <p className="text-lg font-medium font-[var(--app-font-display)]">
            {t.welcome_title}
          </p>
          <p className="mt-1 text-sm">{t.welcome_subtitle}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          onSuggest={onSuggest}
          onActivate={onActivate}
          isActive={msg.id === activeMessageId}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}
```

- [ ] **Step 7.2: Rewrite `MessageBubble.tsx` — remove `IntentRenderer`, add `◈` anchor**

```typescript
// frontend/components/chat/MessageBubble.tsx
"use client";

import { useState } from "react";
import type { ChatMessage, RuntimeResponse } from "../../lib/types";
import { submitFeedback } from "../../lib/api";
import { useDict } from "../../lib/i18n-context";

interface MessageBubbleProps {
  message: ChatMessage;
  onSuggest?: (text: string) => void;
  onActivate?: (messageId: string) => void;
  isActive?: boolean;
}

export default function MessageBubble({
  message,
  onSuggest,
  onActivate,
  isActive = false,
}: MessageBubbleProps) {
  const { chat: t } = useDict();

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-xl rounded-br-sm bg-[var(--color-primary)] px-3.5 py-2 text-sm text-[var(--color-primary-fg)]">
          {message.text}
        </div>
      </div>
    );
  }

  // Bot message
  return (
    <div className="flex gap-2.5">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[10px] font-semibold text-[var(--color-primary-fg)]">
        {t.bot_icon}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-[11px] font-medium text-[var(--color-muted-fg)]">{t.bot_name}</p>

        {message.loading ? (
          <ThinkingDots />
        ) : (
          <>
            {message.text && (
              <p className="text-sm leading-relaxed text-[var(--color-fg)]">
                {message.text}
              </p>
            )}

            {/* ◈ Anchor card — click to activate result in right panel */}
            {message.response && !message.loading && (
              <ResultAnchor
                response={message.response}
                messageId={message.id}
                isActive={isActive}
                onActivate={onActivate}
              />
            )}

            {message.response && !message.loading && (
              <FeedbackButtons message={message} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-[var(--color-muted-fg)]"
          style={{
            animation: "breathe 1.4s ease-in-out infinite",
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </div>
  );
}

interface ResultAnchorProps {
  response: RuntimeResponse;
  messageId: string;
  isActive: boolean;
  onActivate?: (id: string) => void;
}

function ResultAnchor({ response, messageId, isActive, onActivate }: ResultAnchorProps) {
  const label = _resultLabel(response);
  if (!label) return null;

  return (
    <button
      onClick={() => onActivate?.(messageId)}
      className={[
        "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-all",
        isActive
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
          : "border-[var(--color-border)] bg-[var(--color-muted)] text-[var(--color-muted-fg)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-primary)]",
      ].join(" ")}
    >
      <span className="flex items-center gap-1.5">
        <span className="opacity-70">◈</span>
        <span>{label}</span>
      </span>
      <span className="opacity-50">→</span>
    </button>
  );
}

/** Build a short human-readable label for the result anchor. */
function _resultLabel(response: RuntimeResponse): string | null {
  if (response.status === "error") return null;
  if (response.intent === "unclear") return null;

  // Use the message from backend (already localized, short)
  if (response.message) return response.message;

  // Fallback labels
  const map: Record<string, string> = {
    search_by_bangumi: "結果を見る",
    search_bangumi: "結果を見る",
    plan_route: "ルートを見る",
    search_by_location: "地図を見る",
    search_nearby: "地図を見る",
  };
  return map[response.intent] ?? "結果を見る";
}

// ── Feedback ────────────────────────────────────────────────────────────────

function FeedbackButtons({ message }: { message: ChatMessage }) {
  const { chat: t } = useDict();
  const [state, setState] = useState<"idle" | "commenting" | "submitted">("idle");
  const [comment, setComment] = useState("");

  async function handleFeedback(rating: "good" | "bad") {
    if (rating === "bad" && state === "idle") {
      setState("commenting");
      return;
    }
    try {
      await submitFeedback({
        session_id: message.response?.session_id,
        query_text: message.text,
        intent: message.response?.intent ?? "unknown",
        rating,
        comment: comment || undefined,
      });
      setState("submitted");
    } catch {
      // best-effort
    }
  }

  if (state === "submitted") {
    return <p className="text-[11px] text-[var(--color-muted-fg)]">{t.feedback_sent}</p>;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        {(["good", "bad"] as const).map((r) => (
          <button
            key={r}
            onClick={() => handleFeedback(r)}
            className="rounded px-2 py-0.5 text-xs text-[var(--color-muted-fg)] transition hover:bg-[var(--color-secondary)] hover:text-[var(--color-fg)]"
          >
            {r === "good" ? "👍" : "👎"}
          </button>
        ))}
      </div>
      {state === "commenting" && (
        <div className="flex gap-2">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t.feedback_placeholder}
            className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-muted)] px-2 py-1 text-xs outline-none"
          />
          <button
            onClick={() => handleFeedback("bad")}
            className="rounded bg-[var(--color-secondary)] px-3 py-1 text-xs font-medium"
          >
            {t.send}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7.3: TypeScript check**
```bash
cd frontend && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 7.4: Commit AppShell + MessageList + MessageBubble together**
```bash
git add frontend/components/layout/AppShell.tsx \
        frontend/components/chat/MessageList.tsx \
        frontend/components/chat/MessageBubble.tsx
git commit -m "feat(layout): three-column AppShell, ◈ anchor card in MessageBubble, ResultPanel wired"
```

---

## Task 8: `PilgrimageGrid.tsx` — 4-Column Result Panel Layout

**Files:**

- Modify: `frontend/components/generative/PilgrimageGrid.tsx`

- [ ] **Step 8.1: Rewrite `PilgrimageGrid.tsx`**

```typescript
// frontend/components/generative/PilgrimageGrid.tsx
"use client";

import type { SearchResultData } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";

interface PilgrimageGridProps {
  data: SearchResultData;
}

export default function PilgrimageGrid({ data }: PilgrimageGridProps) {
  const { grid: t } = useDict();
  const { results } = data;

  if (results.status === "empty" || results.rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted-fg)]">
        {t.no_results}
      </div>
    );
  }

  const animeTitle = results.rows[0]?.title_cn || results.rows[0]?.title || "";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-baseline gap-3">
        {animeTitle && (
          <h2 className="text-base font-semibold text-[var(--color-fg)] font-[var(--app-font-display)]">
            {animeTitle}
          </h2>
        )}
        <span className="text-xs text-[var(--color-muted-fg)]">
          {t.count.replace("{count}", String(results.row_count))}
        </span>
      </div>

      {/* 4-column grid — optimised for the wide result panel */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {results.rows.map((point) => (
          <div
            key={point.id}
            className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]"
          >
            <div className="relative aspect-[4/3] bg-[var(--color-muted)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={point.screenshot_url}
                alt={point.name_cn || point.name}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
            <div className="space-y-0.5 p-2.5">
              <p className="text-xs font-medium text-[var(--color-fg)] line-clamp-1">
                {point.name_cn || point.name}
              </p>
              {point.episode != null && point.episode !== 0 && (
                <p className="text-[10px] text-[var(--color-muted-fg)]">
                  {t.episode.replace("{ep}", String(point.episode))}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8.2: TypeScript check + visual check**
```bash
cd frontend && npx tsc --noEmit
npm run dev
# Send "吹响的圣地" in chat
# Expected: chat shows text + ◈ anchor; right panel shows 4-col grid
```

- [ ] **Step 8.3: Commit**
```bash
git add frontend/components/generative/PilgrimageGrid.tsx
git commit -m "feat(grid): 4-col layout for result panel, remove raw intent badge"
```

---

## Task 9: `RouteVisualization.tsx` — Map Fills Panel, List as Overlay

**Files:**

- Modify: `frontend/components/generative/RouteVisualization.tsx`

- [ ] **Step 9.1: Rewrite `RouteVisualization.tsx`**

```typescript
// frontend/components/generative/RouteVisualization.tsx
"use client";

import type { RouteData } from "../../lib/types";
import dynamic from "next/dynamic";
import { useDict } from "../../lib/i18n-context";

const PilgrimageMap = dynamic(() => import("../map/PilgrimageMap"), { ssr: false });

interface RouteVisualizationProps {
  data: RouteData;
}

export default function RouteVisualization({ data }: RouteVisualizationProps) {
  const { route: t } = useDict();
  const { route } = data;
  const points = route.ordered_points;

  if (route.status === "empty" || points.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted-fg)]">
        {t.no_results}
      </div>
    );
  }

  return (
    // Relative container — map fills, list overlays bottom-left
    <div className="relative h-full min-h-[400px] overflow-hidden rounded-lg border border-[var(--color-border)]">
      {/* Map — fills entire panel */}
      <PilgrimageMap points={points} route={points} height="100%" />

      {/* Route list — overlaid bottom-left, scrollable */}
      <div className="absolute bottom-4 left-4 max-h-[55%] w-60 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur-sm">
        <div className="px-3 py-2 border-b border-[var(--color-border)]">
          <p className="text-xs font-medium text-[var(--color-muted-fg)]">
            {t.spots.replace("{count}", String(route.point_count))}
          </p>
        </div>
        <div className="divide-y divide-[var(--color-border)]">
          {points.map((point, idx) => (
            <div key={point.id} className="flex items-center gap-2.5 px-3 py-2">
              <div
                className={[
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                  idx === 0
                    ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                    : "bg-[var(--color-muted)] text-[var(--color-fg)]",
                ].join(" ")}
              >
                {idx + 1}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-[var(--color-fg)]">
                  {point.name_cn || point.name}
                </p>
                <p className="text-[10px] text-[var(--color-muted-fg)]">
                  {t.episode.replace("{ep}", String(point.episode))}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

> Note: `PilgrimageMap` must accept `height="100%"`. If it currently takes only a number, update its `height` prop type to `number | string` in `frontend/components/map/PilgrimageMap.tsx`.

- [ ] **Step 9.2: Commit**
```bash
git add frontend/components/generative/RouteVisualization.tsx
git commit -m "feat(route): fullscreen map with overlay route list in result panel"
```

---

## Task 10: `NearbyMap.tsx` — 60/40 Map/List Split

**Files:**

- Modify: `frontend/components/generative/NearbyMap.tsx`

- [ ] **Step 10.1: Rewrite `NearbyMap.tsx`**

```typescript
// frontend/components/generative/NearbyMap.tsx
"use client";

import type { SearchResultData, PilgrimagePoint } from "../../lib/types";
import dynamic from "next/dynamic";
import { useDict } from "../../lib/i18n-context";

const PilgrimageMap = dynamic(() => import("../map/PilgrimageMap"), { ssr: false });

function formatDistance(meters?: number): string {
  if (meters == null) return "";
  return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`;
}

interface NearbyMapProps {
  data: SearchResultData;
}

export default function NearbyMap({ data }: NearbyMapProps) {
  const { map: t } = useDict();
  const { results } = data;
  const sorted = [...results.rows].sort(
    (a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity),
  );

  if (results.status === "empty" || sorted.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted-fg)]">
        {t.no_results}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Header */}
      <p className="text-xs text-[var(--color-muted-fg)]">
        {t.count.replace("{count}", String(results.row_count))}
      </p>

      {/* Map — 60% height */}
      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]" style={{ flex: "0 0 60%" }}>
        <PilgrimageMap points={sorted} height="100%" />
      </div>

      {/* List — 40% height, scrollable */}
      <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
        {sorted.map((point: PilgrimagePoint) => (
          <div key={point.id} className="flex items-center justify-between px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--color-fg)]">
                {point.name_cn || point.name}
              </p>
              <p className="text-xs text-[var(--color-muted-fg)]">
                {point.title_cn || point.title}
              </p>
            </div>
            {point.distance_m != null && (
              <span className="ml-3 shrink-0 text-xs font-medium text-[var(--color-primary)]">
                {formatDistance(point.distance_m)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 10.2: Commit**
```bash
git add frontend/components/generative/NearbyMap.tsx
git commit -m "feat(nearby): 60/40 map/list split in result panel, remove intent badge"
```

---

## Task 11: `en.json` — English Dictionary

**Files:**

- Create: `frontend/app/[lang]/dictionaries/en.json`

- [ ] **Step 11.1: Create `en.json`**

```json
{
  "meta": {
    "title": "Seichijunrei AI",
    "description": "Find anime pilgrimage spots and plan your route"
  },
  "auth": {
    "title": "Seichijunrei AI",
    "subtitle": "Internal beta",
    "tab_waitlist": "Join beta",
    "tab_login": "Log in",
    "email_label": "Email address",
    "email_placeholder": "you@example.com",
    "submitting": "Sending...",
    "btn_waitlist": "Request access",
    "btn_login": "Send login link",
    "loading": "Loading...",
    "already_registered": "This email is already registered.",
    "error": "Error: {message}",
    "waitlist_success": "Registered! We'll send your login link once approved.",
    "not_registered": "This email isn't registered for the beta. Please sign up first.",
    "pending_review": "Your application is under review. Please wait.",
    "magic_link_sent": "Login link sent — check your inbox."
  },
  "chat": {
    "placeholder": "Find pilgrimage spots or plan a route…",
    "send": "Send",
    "thinking": "Thinking…",
    "bot_name": "Seichijunrei AI",
    "bot_icon": "聖",
    "feedback_sent": "✓ Feedback sent",
    "feedback_placeholder": "What went wrong? (optional)",
    "welcome_title": "Seichijunrei AI",
    "welcome_subtitle": "Find anime filming locations and plan pilgrimage routes"
  },
  "sidebar": {
    "logo_icon": "聖",
    "logo_text": "Seichijunrei",
    "new_chat": "+ New chat",
    "recent": "Recent searches",
    "spots": "{count} spots",
    "footer": "Pilgrim"
  },
  "header": {
    "title": "Seichijunrei AI",
    "subtitle": "Find anime locations · Plan your route",
    "map_open": "Close map",
    "map_closed": "Map"
  },
  "map": {
    "no_results": "No pilgrimage spots found nearby.",
    "count": "{count} spots",
    "episode": "Ep. {ep}"
  },
  "grid": {
    "no_results": "No results found. Try a different anime title.",
    "count": "{count} spots",
    "episode": "Ep. {ep}"
  },
  "route": {
    "no_results": "Could not create a route.",
    "spots": "{count} stops",
    "no_coords": "⚠ {count} missing coordinates",
    "episode": "Ep. {ep}"
  },
  "clarification": {
    "examples_label": "For example:",
    "suggestions": [
      { "label": "Search by anime", "query": "Show me filming locations for Your Name" },
      { "label": "Search by location", "query": "What anime spots are near Uji Station" },
      { "label": "Plan a route", "query": "Plan a route for Hibike Euphonium spots from Kyoto" }
    ]
  }
}
```

- [ ] **Step 11.2: Verify the locale routing handles `en`**
```bash
grep -n "en\|ja\|zh\|locales" frontend/app/[lang]/layout.tsx frontend/middleware.ts 2>/dev/null | head -20
# Ensure "en" is in the supported locales list
```

If `en` is missing from locale config, add it wherever `ja` and `zh` are defined (typically `middleware.ts` or `next.config.ts`).

- [ ] **Step 11.3: Test English locale**
```bash
npm run dev
# Navigate to http://localhost:3000/en/
# Expected: all UI strings in English
```

- [ ] **Step 11.4: Commit**
```bash
git add frontend/app/[lang]/dictionaries/en.json
git commit -m "feat(i18n): add English dictionary (en.json)"
```

---

## Task 12: E2E Smoke Test + Final Check

- [ ] **Step 12.1: TypeScript check — clean**
```bash
cd frontend && npx tsc --noEmit
# Expected: zero errors
```

- [ ] **Step 12.2: Lint check**
```bash
cd frontend && npm run lint
# Expected: zero errors
```

- [ ] **Step 12.3: E2E smoke test (manual)**

With backend running (`make serve`) and frontend running (`npm run dev`):

1. Open `http://localhost:3000/ja/`
2. Send: `吹响の聖地はどこ`
   - Expected chat: text summary + amber `◈` anchor card
   - Expected right panel: 4-column PilgrimageGrid (spots for Hibike Euphonium)
3. Send: `宇治駅から回るルートを作って`
   - Expected chat: new message + ◈ anchor
   - Expected right panel: fullscreen map + overlay numbered list
4. Click the first `◈` anchor (吹响 search)
   - Expected right panel: switches back to PilgrimageGrid
5. Open `http://localhost:3000/en/`
   - Expected: English UI text + English response message ("Found N pilgrimage spots.")

- [ ] **Step 12.4: Tag**
```bash
git tag iter2-frontend-complete
```

---

## Task 13: Deploy — Fix CI/CD Frontend Pipeline + Full Deploy

**Goal:** The current `deploy.yml` only builds the Python container. It never runs `npm run build`, so `frontend/out` is never generated. Fix the pipeline, then deploy both backend and frontend together.

**Files:**

- Modify: `frontend/next.config.ts` — add `output: 'export'`
- Modify: `.github/workflows/deploy.yml` — add frontend build step
- Modify: `.github/workflows/ci.yml` — add frontend lint + build check

### Step 13.1: Enable static export in Next.js

`wrangler.toml` expects `frontend/out` (static assets for Cloudflare ASSETS binding). Next.js must produce this with `output: 'export'`.

In `frontend/next.config.ts`, add the `output` field:
```typescript
const nextConfig: NextConfig = {
  output: "export",           // ← add this line
  allowedDevOrigins: ["127.0.0.1"],
  trailingSlash: true,
  turbopack: {
    root: frontendRoot,
  },
};
```

**Important:** `output: 'export'` disables Next.js server-side features. Before enabling it, verify nothing in the app uses `getServerSideProps`, `next/headers`, `cookies()`, or Route Handlers that return dynamic responses. If any server-only API routes exist in `app/`, they must be removed — the backend API is handled by the Python container, not Next.js.

Verify the build produces the output directory:
```bash
cd frontend && npm run build
ls out/
# Expected: index.html and static asset folders
```

### Step 13.2: Add frontend build to `deploy.yml`

Add a `build-frontend` job that runs in parallel with `build-and-push`, then make `deploy` depend on both.

In `.github/workflows/deploy.yml`:
```yaml
  build-frontend:
    name: Build Frontend (Next.js static export)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        run: cd frontend && npm ci

      - name: Build static export
        run: cd frontend && npm run build
        env:
          NEXT_PUBLIC_API_BASE_URL: ""   # relative URLs — Worker proxies /v1/*

      - name: Upload frontend artifact
        uses: actions/upload-artifact@v4
        with:
          name: frontend-out
          path: frontend/out/
          retention-days: 1
```

Update the `deploy` job:
```yaml
  deploy:
    needs: [build-and-push, build-frontend]    # ← was: [build-and-push]

    steps:
      # Add after checkout:
      - name: Download frontend artifact
        uses: actions/download-artifact@v4
        with:
          name: frontend-out
          path: frontend/out/
      # ... rest of deploy steps unchanged
```

### Step 13.3: Add frontend checks to `ci.yml`

Add a `frontend` job to `ci.yml` (parallel with the existing `lint` job):
```yaml
  frontend:
    name: Frontend (lint + build)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        run: cd frontend && npm ci

      - name: Lint
        run: cd frontend && npm run lint

      - name: Type check
        run: cd frontend && npx tsc --noEmit

      - name: Build static export
        run: cd frontend && npm run build
        env:
          NEXT_PUBLIC_API_BASE_URL: ""
```

### Step 13.4: Commit CI/CD changes
```bash
git add frontend/next.config.ts \
        .github/workflows/deploy.yml \
        .github/workflows/ci.yml
git commit -m "ci: add frontend static export build to CI and deploy pipeline"
```

### Step 13.5: Trigger staging deploy
```bash
gh workflow run deploy.yml -f environment=staging
gh run watch
```

### Step 13.6: Smoke test staging (full stack)
```bash
STAGING_URL="https://seichijunrei-staging.your-workers.dev"

# Static frontend served from ASSETS
curl -sI "$STAGING_URL/ja/" | grep "HTTP\|content-type"
# Expected: 200 OK, text/html

# API proxy to Python container
curl -s -X POST "$STAGING_URL/v1/runtime" \
  -H "Content-Type: application/json" \
  -d '{"text":"吹響の聖地","locale":"ja"}' | python -m json.tool
# Expected: { "intent": "search_bangumi", "ui": {...}, "message": "..." }

# English locale
curl -sI "$STAGING_URL/en/" | grep "HTTP"
# Expected: 200 OK
```

### Step 13.7: (When ready) Trigger production deploy
```bash
gh workflow run deploy.yml -f environment=production
gh run watch
```

---

## Appendix: `PilgrimageMap` `height` prop fix (if needed)

If `PilgrimageMap` currently requires `height: number`, update it to accept a string:

```typescript
// frontend/components/map/PilgrimageMap.tsx — change the prop type
interface PilgrimageMapProps {
  points: PilgrimagePoint[];
  route?: PilgrimagePoint[];
  height: number | string;  // was: number
}
// Inside the component, pass height directly to the container div:
<div style={{ height: typeof height === "number" ? `${height}px` : height }}>
  ...map content...
</div>
```
