# obsidian-docindex

Obsidian plugin (desktop + mobile) that routes semantic + BM25 search through a remote [`docindex-server`](https://github.com/marcioapm/docindex-server) over Tailscale. Fork of [`joybro/obsidian-similar-notes`](https://github.com/joybro/obsidian-similar-notes) (MIT).

**This is a thin remote-only client.** The plugin no longer runs any embedding, chunking, or vector-indexing locally — the upstream local pipeline has been stripped. `docindex-server` does the work on a Tailscale-reachable backend; the plugin just queries it and renders results.

## What it does

- **Similar notes sidebar** — on every `file-open`, sends the active note to `POST /similar` and shows the top-N most semantically similar notes.
- **Semantic search modal** (`Cmd/Ctrl + Shift + O`) — debounced free-text `POST /search` against the backend.
- **Drag-to-link** — drag a sidebar result into the editor to insert an Obsidian wiki link.

No local embeddings, no local vector store, no IndexedDB, no workers. The bundle is ~180 KB (rxjs + react).

## Install (manual, until a release workflow is wired up)

1. `npm install && npm run build` — produces `main.js` in the repo root.
2. Create `<your vault>/.obsidian/plugins/obsidian-docindex/`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
4. In Obsidian: **Settings → Community plugins → reload the list**, then toggle **docindex** on.
5. Open the plugin's settings tab and configure the `docindex (remote search)` section:
   - **Backend URL** — e.g. `http://100.83.46.59:7777` (Tailscale IP or MagicDNS hostname).
   - **Bearer token** — issued by your `docindex-server` deployment.
   - **Result limit** — 1..50 (default 10).
   - **Relevance threshold** — 0.0..1.0 slider (default 0.40). Hits whose
     normalized display score falls below this value are dropped from both
     the sidebar and the search modal. `0` shows everything the server
     ranked; `0.60+` keeps only decisively-relevant results. Works against
     older servers too — they don't emit `score_normalized`, so the client
     falls back to `score` (the RRF value). Tune per vault.
   - **Enable docindex remote search** — master toggle.
6. Click **Test connection** to confirm the backend is reachable.

## Tailscale setup (required on mobile)

The backend is Tailscale-only. The plugin will not reach `100.x.y.z:7777` unless Tailscale is active on the device:

- **iOS / Android** — install the Tailscale app, sign in to the same tailnet as the server, and keep it running in the background. iOS can aggressively kill VPNs in low-power mode; the Always-On VPN option is recommended.
- **Desktop** — have the Tailscale daemon running.

If the plugin shows `docindex: backend unreachable (Tailscale?)`, that's almost always Tailscale not being up.

## How it works

- `DocindexClient` wraps `POST /search` / `POST /similar` / `GET /health` using Obsidian's `requestUrl` (NOT `fetch` — `fetch` has CORS/TLS quirks on iOS/Android). Bearer token is sent as `Authorization: Bearer …` and is never logged. Hits below `settings.relevanceThreshold` are dropped client-side before returning to callers.
- `RemoteSearchService` turns backend `hits` into the `SimilarNote` shape the UI renders. Chunks are grouped by path — the top-scoring chunk becomes the primary row; extra chunks land in `additionalChunks` and render as expandable sub-rows under it, so a multi-chunk match shows as one note entry instead of repeats.
- `SimilarNoteCoordinator` reads the active note's content with `vault.cachedRead`, hands it to `RemoteSearchService.findSimilarNotes`, and emits the resulting view-model. Per-path cache keyed on `file.stat.mtime`; cleared when result-count settings change.
- `NoteBottomViewReact` clears rows on `active-leaf-change` / `file-open` so a new note never shows the previous note's hits, then waits for the next view-model emit. The row click uses `openLinkText(path + "#" + deepestHeading)` when the hit carries a heading path, so the opened note scrolls to the matched section instead of the top.
- `SemanticSearchModal` uses `chunk_id` as row identity (stable across re-queries), auto-scrolls only for keyboard nav (never on typing or hover), and tracks mouse hover in a separate `.is-hovered` class so arrow-key selection and mouse hover can't fight for a single highlight.
- Runtime validation: if the backend responds with an unexpected shape, the client surfaces a single `Notice` and disables itself for the rest of the session (until settings change).

## Errors you might see

| Notice | Meaning |
| --- | --- |
| `docindex: backend unreachable (Tailscale?)` | Network error. Check Tailscale, then the backend URL. |
| `docindex: bearer token missing or wrong` | 401/403 from the backend. Check the token. |
| `docindex: server error 5xx` | Backend returned an error. Check the server logs. |
| `docindex: malformed response — provider disabled for this session` | Response didn't match the expected shape. Change a setting to re-enable. |

## Backend contract

The plugin assumes `docindex-server` exposes:

```
POST /search   { query: string, limit?: number } → { hits: [{ path, title, heading_path, snippet, score, score_rrf?, score_normalized?, chunk_id }] }
POST /similar  { path:  string, limit?: number } → same shape
GET  /health                                      → { ok, indexed_chunks, last_reindex_ms, embedding_model, dim }
```

All non-health routes require `Authorization: Bearer <token>`.

`score_rrf` (the raw RRF fusion score the server ranks on) and
`score_normalized` (query-independent 0..1 display score) are optional on
the wire so the client remains compatible with pre-v0.3 backends — it
falls back to `score` for the relevance-threshold filter when those
fields are missing.

## Development

```bash
npm install
npm run dev         # esbuild in watch mode
npm test            # vitest — docindex client + main.ts import-surface smoke test
npm run build       # tsc type-check + production esbuild bundle
```

Tests live at `src/adapter/docindex/__tests__/DocindexClient.test.ts` (happy path, 401/403, 5xx, network failure, malformed JSON, URL normalization, session-disable) and `src/__tests__/main.test.ts` (source-level guard against re-introducing the local pipeline).

See `docs/upstream-delta.md` for the exact delta vs upstream — including the full list of modules we deleted in the remote-only strip.

## License

Upstream plugin is MIT (see `LICENSE`). Fork-specific code (the `src/adapter/docindex/**` tree and the remote-only wirings in `src/main.ts`, settings tab, and similar-note coordinator) is for personal use.
