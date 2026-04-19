# Upstream delta

This plugin is forked from [`joybro/obsidian-similar-notes`](https://github.com/joybro/obsidian-similar-notes) (MIT).

- **Forked from:** `upstream/main` at `9c7e474` ("chore: bump version to 1.2.0")
- **Fork strategy:** `git merge upstream/main --allow-unrelated-histories`, keeping our `README.md`, `CLAUDE.md`, `.claude/`, and `.gitignore` on top of the upstream tree. All of upstream's commit history is preserved; `git log` shows both our pre-fork commits and the upstream history.
- **`upstream` remote:** `https://github.com/joybro/obsidian-similar-notes.git`. Cherry-pick future upstream fixes from there.

## Files added by the fork

Core docindex-server adapter (replaces embeddings + local index with remote calls when enabled):

- `src/adapter/docindex/DocindexClient.ts` — thin `requestUrl` wrapper with runtime response validation and narrowed error kinds (`network`, `unauthorized`, `server`, `malformed`, `not-configured`).
- `src/adapter/docindex/RemoteSearchService.ts` — implements the same public surface as `TextSearchService` and `SimilarNoteFinder`; converts `DocindexHit` → `SimilarNote`.
- `src/adapter/docindex/SearchDispatcher.ts` — routes each call to local or remote at call time, based on `settings.docindex.enabled` + client availability.
- `src/adapter/docindex/types.ts` — wire types (snake_case) + domain types (camelCase) + `DocindexSettings` defaults.
- `src/adapter/docindex/index.ts` — barrel.
- `src/adapter/docindex/__tests__/DocindexClient.test.ts` — 10 unit tests covering happy path, auth errors, server errors, network errors, malformed-response disable, URL normalization.
- `src/components/DocindexSettingsSection.tsx` — "docindex (remote search)" group in the settings tab (enabled toggle, backend URL, bearer token masked, result limit, Test connection button calling `GET /health`).

## Files changed by the fork

- `manifest.json` — `id`, `name`, `description`, `author` updated; `isDesktopOnly: false` preserved from upstream. Version reset to `0.1.0`.
- `package.json` — `name`, `version`, `description` updated.
- `README.md` — our install / Tailscale docs.
- `.gitignore` — adds `meta.json`, `public/`.
- `src/application/SettingsService.ts` — adds `docindex: DocindexSettings` field to `SimilarNotesSettings` (plus default and load-merge logic).
- `src/application/SimilarNoteCoordinator.ts` — constructor accepts a `SimilarNoteFinderLike` interface instead of the concrete `SimilarNoteFinder` class. Same runtime behavior; the interface lets us pass `SearchDispatcher`.
- `src/commands/SemanticSearchCommand.ts` — accepts `TextSearchServiceLike` interface.
- `src/components/SemanticSearchModal.tsx` — same interface swap.
- `src/components/SimilarNotesSettingTab.tsx` — optional `DocindexClient` injected; renders the docindex settings section when present.
- `src/main.ts` — instantiates `DocindexClient`, `RemoteSearchService`, `SearchDispatcher`; injects dispatcher into `SimilarNoteCoordinator` and `SemanticSearchCommand`.
- `src/__mocks__/obsidian.ts` — adds `requestUrl`, `RequestUrlParam`, `RequestUrlResponse`, `Platform` to the test mock.

## Files kept as-is from upstream

Everything not listed above. In particular:

- The full upstream indexing pipeline (`src/domain/**`, `src/infrastructure/**`, `src/adapter/{orama,openai,ollama,gemini,huggingface}/**`, `src/services/**`). This continues to work when `docindex.enabled` is `false` or the client is not configured.
- All upstream React components (`src/components/**`) other than the two surgical interface swaps listed above.
- `esbuild.config.mjs`, `tsconfig.json`, `vitest.config.ts` — unchanged.

## Design notes

**Why a dispatcher instead of replacing the providers wholesale?** The upstream local pipeline (embeddings, chunking, Orama vector store) is decoupled from search and has value on desktop. Keeping it in place lets desktop users stay on local inference while opting into the remote backend. The dispatcher is ~40 lines and picks per call, so settings changes take effect immediately.

**Why not expose the remote provider through the upstream `EmbeddingProvider` interface?** Because the backend does the full search pipeline (chunking + embedding + hybrid BM25 + semantic) server-side. The plugin doesn't have — and shouldn't have — local embeddings for the server's corpus. The dispatcher swap happens at the level above embeddings.

**Runtime validation.** The client hand-rolls a guard against the server's JSON shape. On malformed input it raises one `Notice` and flips `disabledForSession = true` so subsequent queries short-circuit until settings change (`reset()`). We deliberately do not retry malformed responses.

**Bearer token handling.** Stored in settings, included only in the `Authorization: Bearer …` header, masked in the UI (`type="password"`). Never written to `log.*` or `console.*`.

**Mobile.** All network calls go through `obsidian.requestUrl` — `fetch` has CORS/TLS quirks on iOS/Android. No Node APIs are used in the new adapter code. The manifest is `isDesktopOnly: false` (inherited from upstream).

## Deviations / TODO

None for Phase 3. Phase 4 (rerank controls, hybrid-weight tuning, UI polish, similar-notes side-pane direct-to-remote wiring) is explicitly out of scope.
