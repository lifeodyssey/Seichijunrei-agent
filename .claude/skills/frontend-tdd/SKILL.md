# Frontend TDD Coding Skill

Invoke before writing any frontend React/TypeScript code. Enforces component-driven TDD with project-specific constraints.

## TDD Cycle

### 1. RED — Write failing test first

```bash
cd frontend && npx vitest run tests/<component>.test.tsx --reporter verbose
```

- Test name: `"<verb>s <what> when <condition>"` (e.g., `"renders welcome screen when no messages"`)
- Test user-visible behavior, not implementation details
- Query by role/label/text, not by CSS class or data-testid

### 2. GREEN — Minimal code to pass

Write the smallest component code that makes the test green.

```bash
cd frontend && npx vitest run tests/<component>.test.tsx --reporter verbose
```

### 3. REFACTOR — Clean up with tests green

Apply the constraints below:

```bash
cd frontend && npx tsc --noEmit && npx next build
```

## Code Constraints

### Component Size
- Max 100 lines per component (excluding imports/types). Extract sub-components.
- Max 1 responsibility per component. If it manages state AND renders AND fetches, split it.
- Max 5 props. More than 5 → group into a config object or use context.

### Single Responsibility Split Pattern
```
GodComponent (DON'T)     →    Container + Presenter (DO)
├─ auth state                  AuthProvider (context)
├─ landing layout              LandingPage (component)
├─ modal state                 AuthModal (component)
├─ form logic                  LoginForm (component)
└─ animations                  useScrollReveal (hook)
```

### Styling — Design System Only
- Use CSS variables from `globals.css`: `bg-[var(--color-bg)]`, not `bg-white`
- Use `bg-[var(--color-muted)]` for disabled/skeleton states, not `bg-gray-200`
- Inline `style={}` only for truly dynamic values (animation delays, computed positions)
- Use `cn()` from `lib/utils` for conditional classes

### State Management
- Props for 1-2 levels of passing. Context for 3+.
- Extract complex state into custom hooks: `useChat`, `useSession`, `usePointSelection`
- Callbacks passed through 3+ levels → create a context instead

### Imports
- Relative paths for project files: `../../lib/types`
- `@/lib/utils` only for shadcn utilities (`cn`)
- Consistent spacing in braces: `{ useState }`, not `{useState}`

### Naming
- Components: PascalCase (`ChatPanel`)
- Hooks: `use` prefix (`useMediaQuery`)
- Event handlers: `handle` prefix in component, `on` prefix in props
- Boolean props: `is`/`has`/`should` prefix (`isMobile`, `hasMessages`)

## Test Constraints

### Query Priority (from Testing Library best practices)
1. `getByRole` — accessible roles (button, heading, textbox)
2. `getByLabelText` — form elements
3. `getByText` — visible text content
4. `getByTestId` — LAST resort only

### DO NOT test implementation
- DO NOT assert on CSS classes: `className.includes("bg-primary")` is fragile
- DO NOT assert on internal state: test what the user sees, not React internals
- DO NOT assert on component hierarchy: test behavior, not DOM structure
- DO assert on: visible text, accessible roles, user interactions, callback invocations

### Interactions
- Every component with buttons/inputs MUST have interaction tests
- Use `fireEvent.click()` or `userEvent.click()` to test callbacks
- Verify callback was called with expected args: `expect(onSend).toHaveBeenCalledWith("query")`

### Mocking
- Mock API calls with MSW (`server.use(...)`)
- Mock hooks only when testing a component that USES the hook, not the hook itself
- If you mock more than 5 things, the component is too coupled — refactor first
- NEVER mock all children — that tests nothing

### Assertions
- Use `toBeInTheDocument()` not `.not.toBeNull()`
- Use `toHaveTextContent("expected")` not `textContent.includes("expected")`
- Use `toHaveBeenCalledWith(args)` not `toHaveBeenCalled()`
- Include failure context in custom matchers

### Organization
- One test file per component file
- Max 200 lines per test file
- Use `describe` blocks to group by feature, not by method
- Use `it.each()` for parameterized tests, not copy-paste
- Factory helpers for test data: `makePoint()`, `makeMessage()`, `makeResponse()`

## Anti-Patterns (from audit — DO NOT introduce)

| Anti-Pattern | Example | Fix |
|---|---|---|
| God component | AuthGate at 465 lines | Split into AuthProvider + LandingPage + AuthModal |
| Duplicated JSX | Timeline rendered twice (desktop + mobile) | Extract TimelineView component |
| Prop drilling | onSuggest through 3 levels | Create SuggestContext |
| Excessive mocking | 12 mocks in one test | Refactor component to be testable with fewer deps |
| CSS class assertion | `className.includes("bg-primary")` | Test visible state: `toHaveAttribute("aria-pressed")` |
| Missing interactions | Only render tests, no click/type tests | Add fireEvent/userEvent tests |
| Hardcoded i18n | `TOOL_LABELS` in English only | Use `useDict()` hook |
| Magic Tailwind colors | `bg-blue-500` in CHIP_COLORS | Use `bg-[var(--color-primary)]` |
| Conditional test logic | `if (img) { fireEvent... }` | Assert img exists, then interact |
| Nested ternaries in JSX | `locale === "ja" ? ... : locale === "zh" ? ...` | Extract to helper function |
