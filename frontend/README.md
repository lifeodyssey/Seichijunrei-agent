# Seichijunrei Frontend

Next.js App Router frontend for the Seichijunrei runtime.

UI model:

- Three-column shell (`AppShell`): sidebar + chat + result panel
- Bot responses stay text-first in chat; visual results render in the right panel via Generative UI registry
- Mobile uses a bottom-sheet drawer (`vaul`) for the result panel

See `frontend/AGENTS.md` and `docs/ARCHITECTURE.md` for the current architecture rules.

## Environment

Copy the example env file:

```bash
cp .env.local.example .env.local
```

Required (for auth + waitlist):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Optional (local dev only; leave blank on Cloudflare so it calls the same Worker origin):

- `NEXT_PUBLIC_RUNTIME_URL=http://localhost:8080`

## Local Development

Run the backend runtime (from repo root):

```bash
make dev
make serve
```

Run the frontend dev server:

```bash
cd frontend
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Build (Static Export)

This project uses `output: "export"` and builds to `frontend/out/`:

```bash
cd frontend
npm run build
```

The Cloudflare Worker serves `frontend/out/` via the `ASSETS` binding (see `wrangler.toml` and `DEPLOYMENT.md`).
