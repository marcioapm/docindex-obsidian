# docindex-obsidian

Fork of [Young Lee's `joybro/obsidian-similar-notes`](https://github.com/joybro/obsidian-similar-notes) (MIT). We kept its Obsidian UI and plugin structure, replaced the search backend with [`docindex-server`](https://github.com/marcioapm/docindex-server), and added mobile support. The upstream local embedding/indexing pipeline has been removed — this plugin is remote-only and requires a reachable `docindex-server` instance.

## Features

- **Similar notes sidebar** — on every `file-open`, sends the active note path to `POST /similar` and shows the top-N semantically similar notes in a sidebar panel.
- **Semantic search modal** (`Cmd/Ctrl + Shift + O`) — debounced free-text `POST /search` against the backend.
- **Semantic link suggestions** — type the configured trigger sequence (default `;;`) in any editor, and a suggester opens showing semantically similar notes. Select one to insert a `[[wikilink]]`.
- **Drag-to-link** — drag a sidebar result into the active editor to insert a wiki link.
- **Mobile** — all network calls use Obsidian's `requestUrl` (not `fetch`), which works on iOS and Android. `isDesktopOnly: false`.

## Install (manual)

1. `npm install && npm run build` — produces `main.js` in the repo root.
2. Create `<vault>/.obsidian/plugins/docindex-obsidian/`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
4. In Obsidian: **Settings → Community plugins → reload**, then enable **docindex**.

## Configuration

Open **Settings → docindex (remote search)**:

| Field | Description |
|---|---|
| Enable docindex remote search | Master toggle. |
| Backend URL | Tailscale IP or MagicDNS hostname, e.g. `http://myhost:7777`. No trailing slash. |
| Bearer token | `Authorization: Bearer <token>` header. Never logged. |
| Result limit | Results per query, 1–50 (default 10). |
| Relevance threshold | Drop results whose normalized score is below this value (0.0–1.0, default 0.40). |
| Semantic link trigger | Trigger sequence for the in-editor link suggester (default `;;`). Clear to disable. Must not start with `[`. |

After saving the URL and token, click **Test connection** to confirm `GET /health` reaches the backend.

## Tailscale and mobile

The plugin does not reach the backend unless Tailscale is active on the device. MagicDNS hostnames are recommended over raw Tailscale IPs (e.g. `http://myserver:7777` instead of `http://100.64.0.1:7777`).

- **iOS / Android** — install the Tailscale app, sign in to the same tailnet as the server. iOS can kill VPN connections in low-power mode; the Always-On VPN option prevents this.
- **Desktop** — run the Tailscale daemon.

If the plugin shows `docindex: backend unreachable (Tailscale?)`, Tailscale is likely not connected.

## How it works

- `DocindexClient` wraps `POST /search`, `POST /similar`, and `GET /health` via `obsidian.requestUrl`. Bearer token is sent only in the `Authorization` header and is never written to any log. Hits below `relevanceThreshold` are filtered client-side.
- `RemoteSearchService` converts `hits` into `SimilarNote` objects. Multiple chunks from the same note are grouped — the top-scoring chunk is the primary row; extra chunks are surfaced as expandable sub-rows.
- `SimilarNoteCoordinator` caches per-path results keyed on `mtime` and clears on result-count changes.
- `SemanticLinkSuggest` opens on the configured trigger, debounces the remote search call, and inserts a `[[wikilink]]` for the selected result.
- If the backend responds with an unexpected shape, the client surfaces a `Notice` and disables itself until settings change.

## Backend contract

```
POST /search   { query: string, limit?: number }
POST /similar  { path:  string, limit?: number }
→ { hits: [{ path, title, heading_path, snippet, score, score_rrf?, score_normalized?, chunk_id }] }

GET  /health   → { ok, indexed_chunks, last_reindex_ms, embedding_model, dim }
```

Non-health routes require `Authorization: Bearer <token>`. `score_normalized` (0..1 display score) and `score_rrf` are optional — pre-v0.3 servers that omit them fall back to `score`.

## Errors

| Notice | Cause |
|---|---|
| `docindex: backend unreachable (Tailscale?)` | Network error. Check Tailscale and the backend URL. |
| `docindex: bearer token missing or wrong` | 401/403 from the backend. |
| `docindex: server error <N>` | Backend returned an error. Check server logs. |
| `docindex: malformed response — provider disabled for this session` | Response shape mismatch. Changing a setting re-enables the provider. |

## Development

```bash
npm install
npm run dev        # esbuild watch
npm test           # vitest
npm run lint       # eslint
npm run build      # tsc type-check + production bundle
```

See `docs/upstream-delta.md` for the full list of changes vs upstream.

## License

MIT. See `LICENSE`. Original work copyright 2025 Young Lee. Modifications copyright 2026 Márcio Martins.
