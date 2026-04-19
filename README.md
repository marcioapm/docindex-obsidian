# obsidian-docindex

Obsidian plugin (desktop + mobile) that routes semantic + BM25 search through a remote [`docindex-server`](https://github.com/marcioapm/docindex-server) over Tailscale. Fork of [`joybro/obsidian-similar-notes`](https://github.com/joybro/obsidian-similar-notes) (MIT) — the upstream local-inference pipeline is still there; this fork adds a `docindex` provider that you opt into from settings.

## Status

Phase 3 in place: the plugin forks cleanly, builds, and has the remote provider wired into the upstream semantic-search modal and similar-notes coordinator. When `docindex` is enabled in settings, every search / similar-notes call goes to the backend instead of the local Orama index.

## Install (manual, until a release workflow is wired up)

1. `npm install && npm run build` — produces `main.js` in the repo root.
2. Create `<your vault>/.obsidian/plugins/obsidian-docindex/`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
4. In Obsidian: **Settings → Community plugins → reload the list**, then toggle **docindex** on.
5. Open the plugin's settings tab and configure the `docindex (remote search)` section:
   - **Backend URL** — e.g. `http://100.83.46.59:7777` (Tailscale IP or MagicDNS hostname).
   - **Bearer token** — issued by your `docindex-server` deployment.
   - **Result limit** — 1..50 (default 10).
   - **Enable docindex remote search** — master toggle.
6. Click **Test connection** to confirm the backend is reachable.

## Tailscale setup (required on mobile)

The backend is Tailscale-only. The plugin will not reach `100.x.y.z:7777` unless Tailscale is active on the device:

- **iOS / Android** — install the Tailscale app, sign in to the same tailnet as the server, and keep it running in the background. iOS can aggressively kill VPNs in low-power mode; the Always-On VPN option is recommended.
- **Desktop** — have the Tailscale daemon running.

If the plugin shows `docindex: backend unreachable (Tailscale?)`, that's almost always Tailscale not being up.

## How it works

- `DocindexClient` wraps `POST /search` / `POST /similar` / `GET /health` using Obsidian's `requestUrl` (NOT `fetch` — `fetch` has CORS/TLS quirks on iOS/Android). Bearer token is sent as `Authorization: Bearer …` and is never logged.
- `RemoteSearchService` turns backend `hits` into the same `SimilarNote` shape the upstream UI renders.
- `SearchDispatcher` checks `settings.docindex.enabled` + `client.isAvailable()` on every call and picks the remote or local provider. This means toggling the setting takes effect immediately — no reload.
- Runtime validation: if the backend responds with something we don't expect, the client surfaces a single `Notice` and disables itself for the rest of the session (until you change settings).

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
POST /search   { query: string, limit?: number } → { hits: [{ path, title, heading_path, snippet, score, chunk_id }] }
POST /similar  { path:  string, limit?: number } → same shape
GET  /health                                      → { ok, indexed_chunks, last_reindex_ms, embedding_model, dim }
```

All non-health routes require `Authorization: Bearer <token>`.

## Development

```bash
npm install
npm run dev         # esbuild in watch mode
npm test            # vitest (includes the 10 docindex client tests)
npm run build       # tsc type-check + production esbuild bundle
```

Tests for the docindex client live at `src/adapter/docindex/__tests__/DocindexClient.test.ts`. They mock Obsidian's `requestUrl` and cover the happy path, 401/403, 5xx, network failure, malformed JSON, URL normalization, and the session-disable behavior.

See `docs/upstream-delta.md` for the exact set of files we added vs kept from upstream, and the rationale for the `SearchDispatcher` approach.

## License

Upstream plugin is MIT (see `LICENSE`). Fork-specific code (the `src/adapter/docindex/**` tree and the small surgical wirings in `src/main.ts`, settings tab, and similar-note coordinator) is for personal use.
