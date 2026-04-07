# Frontend Cleanup — Component & Hook Hygiene

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split monolithic `api.ts` and `types.ts` into focused modules, add barrel exports to all component directories, audit hooks for dead code, and establish clean import conventions — all while keeping `npm run build` green.

**Architecture:** Frontend is a Next.js static export (`output: 'export'`). Components live in `frontend/components/` organized by domain. This plan restructures `lib/` from flat files to module directories with barrel exports.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Supabase client.

---

## Context

Read these files before starting:

| File | Lines | Role |
|---|---|---|
| `frontend/lib/api.ts` | 347 | All API calls in one file |
| `frontend/lib/types.ts` | 236 | All TypeScript types in one file |
| `frontend/lib/api-keys.ts` | ~60 | API key management |
| `frontend/lib/supabase.ts` | ~30 | Supabase client singleton |
| `frontend/components/generative/registry.ts` | 83 | Component registry |
| `frontend/hooks/useChat.ts` | ~120 | Chat hook |
| `frontend/hooks/useConversationHistory.ts` | ~80 | Conversation history hook |
| `frontend/lib/conversation-history.ts` | ~100 | Conversation history API calls |

---

### Task 1: Split `lib/api.ts` into `lib/api/` module

**Files:**
- Create: `frontend/lib/api/client.ts`
- Create: `frontend/lib/api/runtime.ts`
- Create: `frontend/lib/api/conversations.ts`
- Create: `frontend/lib/api/routes.ts`
- Create: `frontend/lib/api/index.ts`
- Delete: `frontend/lib/api.ts`
- Delete: `frontend/lib/api-keys.ts` (move into api/)

- [ ] **Step 1: Create `frontend/lib/api/client.ts`**

```typescript
import { getSupabaseClient } from "../supabase";

export const RUNTIME_URL =
  (process.env.NEXT_PUBLIC_RUNTIME_URL ?? "").replace(/\/$/, "");

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  if (!supabase) return {};

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}
```

- [ ] **Step 2: Create `frontend/lib/api/runtime.ts`**

Move `sendMessage()` and `sendMessageStream()` from `api.ts`. Update imports:

```typescript
import type { RuntimeRequest, RuntimeResponse, RuntimeStreamEvent } from "../types";
import { getAuthHeaders, RUNTIME_URL } from "./client";

export async function sendMessage(
  text: string,
  sessionId?: string | null,
  locale?: RuntimeRequest["locale"],
  signal?: AbortSignal,
): Promise<RuntimeResponse> {
  // ... exact body from api.ts sendMessage()
}

export async function sendMessageStream(
  text: string,
  sessionId?: string | null,
  locale?: RuntimeRequest["locale"],
  onEvent?: (event: RuntimeStreamEvent) => void,
  signal?: AbortSignal,
): Promise<RuntimeResponse> {
  // ... exact body from api.ts sendMessageStream()
}

export { SELECTED_ROUTE_ACTION_TEXT } from "./client";
```

Copy the full function bodies verbatim from the existing `api.ts`. Only change the import paths.

- [ ] **Step 3: Create `frontend/lib/api/conversations.ts`**

Move conversation-related functions from `api.ts`:

```typescript
import type { ConversationRecord } from "../types";
import { getAuthHeaders, RUNTIME_URL } from "./client";

export async function fetchConversations(): Promise<ConversationRecord[]> {
  // ... exact body from api.ts
}

export async function updateConversationTitle(
  sessionId: string,
  title: string,
): Promise<void> {
  // ... exact body from api.ts
}

export async function fetchMessages(
  sessionId: string,
): Promise<{ messages: Array<{ role: string; content: string; metadata?: unknown; created_at?: string }> }> {
  // ... exact body from api.ts
}
```

- [ ] **Step 4: Create `frontend/lib/api/routes.ts`**

```typescript
import { getAuthHeaders, RUNTIME_URL } from "./client";

export async function fetchUserRoutes(): Promise<{ routes: unknown[] }> {
  // ... exact body from api.ts
}
```

- [ ] **Step 5: Create `frontend/lib/api/index.ts`**

```typescript
export { getAuthHeaders, RUNTIME_URL } from "./client";
export { sendMessage, sendMessageStream } from "./runtime";
export { fetchConversations, updateConversationTitle, fetchMessages } from "./conversations";
export { fetchUserRoutes } from "./routes";
```

- [ ] **Step 6: Update all component imports**

Search for `from "../../lib/api"` or `from "../lib/api"` across all `.tsx`/`.ts` files and update to the same path (barrel export keeps the import path the same length).

Since the barrel is at `lib/api/index.ts`, imports like:
```typescript
import { sendMessage } from "../../lib/api";
```
...still resolve correctly because `lib/api/index.ts` replaces what `lib/api.ts` was.

Verify no file imports `api-keys.ts` separately. If so, move that content into `api/` and re-export.

- [ ] **Step 7: Delete `frontend/lib/api.ts`**

```bash
rm frontend/lib/api.ts
```

- [ ] **Step 8: Build check**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent/frontend && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/lib/api/ && git rm frontend/lib/api.ts
git commit -m "refactor(frontend): split api.ts into api/ module with barrel export"
```

---

### Task 2: Split `lib/types.ts` into `lib/types/` module

**Files:**
- Create: `frontend/lib/types/api.ts`
- Create: `frontend/lib/types/domain.ts`
- Create: `frontend/lib/types/index.ts`
- Delete: `frontend/lib/types.ts`

- [ ] **Step 1: Create `frontend/lib/types/domain.ts`**

Move entity/domain types: `PilgrimagePoint`, `ResultsMeta`, `SearchResultData`, `RouteData`, `QAData`, `TimedItinerary`, and related interfaces.

```typescript
/** Single pilgrimage point returned by SQL/PostGIS queries. */
export interface PilgrimagePoint {
  id: string;
  name: string;
  name_cn: string | null;
  episode: number | null;
  time_seconds: number | null;
  screenshot_url: string | null;
  address?: string | null;
  bangumi_id: string | null;
  latitude: number;
  longitude: number;
  title?: string | null;
  title_cn?: string | null;
  distance_m?: number | null;
  origin?: string | null;
}

// ... copy all domain types from types.ts
```

- [ ] **Step 2: Create `frontend/lib/types/api.ts`**

Move request/response types: `RuntimeRequest`, `RuntimeResponse`, `RuntimeStreamEvent`, `ConversationRecord`, `Intent`.

```typescript
import type { PilgrimagePoint } from "./domain";

export type Intent = /* ... copy from types.ts */;

export interface RuntimeRequest { /* ... */ }
export interface RuntimeResponse { /* ... */ }
export interface RuntimeStreamEvent { /* ... */ }
export interface ConversationRecord { /* ... */ }
```

- [ ] **Step 3: Create `frontend/lib/types/index.ts`**

```typescript
export type { Intent, RuntimeRequest, RuntimeResponse, RuntimeStreamEvent, ConversationRecord } from "./api";
export type { PilgrimagePoint, ResultsMeta, SearchResultData, RouteData, QAData, TimedItinerary } from "./domain";

// Type guards — keep here for convenience
export function isSearchData(data: unknown): data is import("./domain").SearchResultData {
  // ... copy from types.ts
}
export function isRouteData(data: unknown): data is import("./domain").RouteData {
  // ... copy from types.ts
}
export function isQAData(data: unknown): data is import("./domain").QAData {
  // ... copy from types.ts
}
```

- [ ] **Step 4: Delete `frontend/lib/types.ts`**

```bash
rm frontend/lib/types.ts
```

Imports like `from "../lib/types"` still resolve to `lib/types/index.ts`.

- [ ] **Step 5: Build check**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent/frontend && npm run build
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/types/ && git rm frontend/lib/types.ts
git commit -m "refactor(frontend): split types.ts into types/ module with barrel export"
```

---

### Task 3: Add barrel exports to component directories

**Files:**
- Create: `frontend/components/layout/index.ts`
- Create: `frontend/components/chat/index.ts`
- Create: `frontend/components/generative/index.ts`
- Create: `frontend/components/auth/index.ts`
- Create: `frontend/components/map/index.ts`
- Create: `frontend/components/settings/index.ts`

- [ ] **Step 1: Create barrel for `layout/`**

```typescript
export { default as AppShell } from "./AppShell";
export { default as ResultPanel } from "./ResultPanel";
export { default as ResultDrawer } from "./ResultDrawer";
export { default as Sidebar } from "./Sidebar";
```

Adjust exports based on actual files in the directory — check each directory first.

- [ ] **Step 2: Create barrel for `chat/`**

```typescript
export { default as MessageBubble } from "./MessageBubble";
export { default as MessageList } from "./MessageList";
export { default as ChatInput } from "./ChatInput";
export { default as ThinkingProcess } from "./ThinkingProcess";
```

- [ ] **Step 3: Create barrel for `generative/`**

```typescript
export { default as GenerativeUIRenderer } from "./GenerativeUIRenderer";
export { default as PilgrimageGrid } from "./PilgrimageGrid";
export { default as NearbyMap } from "./NearbyMap";
export { default as RouteVisualization } from "./RouteVisualization";
export { default as RoutePlannerWizard } from "./RoutePlannerWizard";
export { default as GeneralAnswer } from "./GeneralAnswer";
export { default as Clarification } from "./Clarification";
export { default as SelectionBar } from "./SelectionBar";
export { COMPONENT_REGISTRY, intentToComponent, isVisualResponse } from "./registry";
```

- [ ] **Step 4: Create barrels for `auth/`, `map/`, `settings/`**

Same pattern — export default components from each directory.

- [ ] **Step 5: Build check**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent/frontend && npm run build
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/*/index.ts
git commit -m "refactor(frontend): add barrel exports to all component directories"
```

---

### Task 4: Hook naming & dead code audit

**Files:**
- Possibly modify: `frontend/hooks/useConversationHistory.ts`
- Possibly modify: `frontend/lib/conversation-history.ts`
- Possibly delete: `frontend/lib/japanRegions.ts`
- Possibly delete: `frontend/lib/utils.ts`

- [ ] **Step 1: Check `japanRegions.ts` usage**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent/frontend && grep -r "japanRegions" --include="*.ts" --include="*.tsx" .
```

If no imports outside the file itself → delete it.

- [ ] **Step 2: Check `utils.ts` usage**

```bash
grep -r "from.*utils" --include="*.ts" --include="*.tsx" .
```

If only one or two references → inline them. If none → delete.

- [ ] **Step 3: Check `conversation-history.ts` vs `useConversationHistory.ts` overlap**

Read both files. If `conversation-history.ts` contains API functions that `useConversationHistory.ts` wraps, consolidate the API functions into `lib/api/conversations.ts` (from Task 1) and have the hook import from there.

- [ ] **Step 4: Verify all hooks use `use` prefix**

```bash
ls frontend/hooks/
```

Confirm: `useChat.ts`, `useConversationHistory.ts`, `useMediaQuery.ts`, `usePointSelection.ts`, `useSession.ts` — all correct.

- [ ] **Step 5: Build check**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent/frontend && npm run build
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/
git commit -m "chore(frontend): remove dead code, consolidate conversation history"
```
