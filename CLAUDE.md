# obsidian-docindex — Agent Guide

> Obsidian plugin (desktop + mobile) that queries a remote [`docindex-server`](https://github.com/marcioapm/docindex-server) for semantic + BM25 search over your vault. Thin client — the index lives on a Tailscale-reachable backend; the plugin just queries and opens notes.

**Status:** Not yet forked. Deferred until the backend is stable. This guide describes how the plugin *will* be built when work begins.

## Origin

Fork of [`joybro/obsidian-similar-notes`](https://github.com/joybro/obsidian-similar-notes) (MIT). Keep the upstream UI and similar-notes modal. Add a new `remote` search provider that calls `docindex-server`. Flip `isDesktopOnly: false` in `manifest.json` so it works on iOS/Android.

## Architecture at a Glance

```
obsidian-docindex/
├── manifest.json             # Obsidian plugin manifest; isDesktopOnly: false
├── main.ts                   # Plugin entry point (lifecycle, settings, commands)
├── src/
│   ├── settings.ts           # Settings tab: backend URL, bearer token, limit
│   ├── providers/
│   │   ├── index.ts          # Provider interface (upstream)
│   │   ├── remote.ts         # NEW: calls docindex-server /search /similar
│   │   └── …                 # upstream providers kept for desktop users
│   ├── views/
│   │   ├── search-modal.ts   # Reuse upstream modal, pointing at the remote provider
│   │   └── similar-pane.ts   # Reuse upstream pane
│   └── types.ts              # Hit/QueryResult types aligned with backend JSON
├── esbuild.config.mjs        # Bundling
└── tests/                    # Vitest unit tests
```

Backend contract (see `docindex-server` `README.md`):

```
POST /search   { query, limit }   → { hits: [{ path, title, headingPath, snippet, score, chunkId }] }
POST /similar  { path,  limit }   → same shape
```

## Config (Settings tab)

- **Backend URL** — e.g. `http://100.x.y.z:7777` (Tailscale IP).
- **Bearer token** — sent as `Authorization: Bearer …`.
- **Result limit** — default 10.
- **Enabled on mobile** — checkbox (the whole point of this fork).

## Coding Standards

### TypeScript

- Strict mode on. No `any` — use `unknown` and narrow.
- Named exports over default exports.
- `interface` for object shapes, `type` for unions/intersections.
- Explicit return types on exported functions.
- No `console.log` in production paths — use Obsidian's `Notice` for user-visible messages and a debug logger gated on a setting.
- All network calls use `obsidian.requestUrl` (works on iOS/Android — `fetch` has quirks on mobile Obsidian).
- Runtime-validate backend responses (zod or a small hand-rolled guard) — the plugin must fail loud on unexpected shapes, not silently show nothing.

### Mobile-First

- **Never** access Node APIs (`fs`, `path`, `child_process`, `require('...')` of anything native). The plugin must work on iOS.
- Keep bundle small — Obsidian mobile is memory-constrained.
- No background polling; trigger queries only on user action (modal open, similar-pane refresh).

### Error Handling

- Network errors → `Notice` with a short message; full error in debug log.
- 401 / 403 → tell the user the bearer token is wrong or missing.
- 5xx / timeouts → tell the user the backend is unreachable; include the Tailscale hint.
- Never surface stack traces to the user.

### Testing

- Unit-test the remote provider with a mocked `requestUrl`.
- Unit-test settings validation (URL shape, bearer non-empty).
- Snapshot-test the modal result rendering.
- `npx vitest run` before every commit.

### Git

- Commit prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- Preserve upstream commit history when forking; add our changes on top.
- Keep a `docs/upstream-delta.md` summarizing every diff vs `joybro/obsidian-similar-notes` so we can re-base cleanly.

## Rules

- `isDesktopOnly: false` in `manifest.json` — this is load-bearing.
- No Node APIs.
- No silent failures — every network error is surfaced to the user.
- Bearer token never logged, never shown in UI beyond the settings field (masked).
- Update `README.md` + `CLAUDE.md` whenever a new backend endpoint is consumed.
- `npx vitest run` and `npm run build` must pass before every push.
