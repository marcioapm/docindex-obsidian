# Upstream delta

This plugin is forked from [`joybro/obsidian-similar-notes`](https://github.com/joybro/obsidian-similar-notes) (MIT).

- **Forked from:** `upstream/main` at `9c7e474` ("chore: bump version to 1.2.0")
- **Fork strategy:** after forking, the upstream local-indexing pipeline was stripped — the plugin is now a thin remote-only client against `docindex-server`. Upstream commit history is preserved (`git log` still shows both pre-fork commits and the upstream history).
- **`upstream` remote:** `https://github.com/joybro/obsidian-similar-notes.git`. Future upstream fixes only make sense if they touch the small surface we keep (settings plumbing, sidebar view-model, semantic-search modal UI).

## What the fork kept from upstream

Only the UI surface that makes sense for a remote-only client:

- `src/application/SettingsService.ts` — settings persistence. Still carries upstream legacy fields (modelProvider, modelId, openai*, gemini*, etc.) for backwards-compat with existing vault-side `data.json` files; none of them are read anywhere in the live code path anymore.
- `src/application/SimilarNoteCoordinator.ts` — drives the sidebar view-model. Rewritten to accept a `SimilarNoteFinderLike` interface (satisfied by the fork's `RemoteSearchService`) and to read the active file via `vault.cachedRead` instead of going through a `NoteRepository`.
- `src/components/SimilarNotesSidebarView.tsx` + `NoteBottomViewReact.tsx` — the sidebar and its React view.
- `src/components/SemanticSearchModal.tsx` — the Cmd/Ctrl+Shift+O modal (interface-swapped to talk to `RemoteSearchService`).
- `src/components/SimilarNotesSettingTab.tsx` — reduced to **Docindex** + **Debug** (log level) sections only.
- `src/commands/{Command,ShowSimilarNotesCommand,SemanticSearchCommand}.ts` — the two user-facing commands + base interface.
- `src/domain/model/{Note,SimilarNote}.ts` — the two plain domain types still used by the coordinator and the UI.
- `src/utils/{displayUtils,viewUtils}.ts` — rendering helpers.
- `src/__mocks__/obsidian.ts` — test mock. Extended by the fork with `requestUrl`, `RequestUrlParam`, `RequestUrlResponse`, `Platform`, `Setting`, `Modal`, `Notice`.

## What the fork added

Core `docindex-server` adapter:

- `src/adapter/docindex/DocindexClient.ts` — thin `requestUrl` wrapper with runtime response validation and narrowed error kinds (`network`, `unauthorized`, `server`, `malformed`, `not-configured`).
- `src/adapter/docindex/RemoteSearchService.ts` — the only search provider now. Implements `findSimilarNotes(note, limit)`, `findSimilarNotesFromText(text, limit)`, `checkTokenLimit(text)`. Owns its own `TextSearchResult` shape. Converts `DocindexHit` → `SimilarNote`, grouping multi-chunk hits per path (primary + `additionalChunks`).
- `src/adapter/docindex/types.ts` — wire types (snake_case) + domain types (camelCase) + `DocindexSettings` defaults. Includes optional `score_rrf` / `score_normalized` / `scoreRrf` / `scoreNormalized` hit fields for v0.3+ servers; `getDisplayScore()` helper falls back to `score` when absent so old servers keep working.
- `src/adapter/docindex/index.ts` — barrel.
- `src/adapter/docindex/__tests__/DocindexClient.test.ts` — 15 unit tests covering the full client surface, including the relevance-threshold filter + old-server fallback.
- `src/components/DocindexSettingsSection.tsx` — "docindex (remote search)" group in the settings tab (enabled toggle, backend URL, bearer token masked, result limit, **relevance threshold slider** (0..1, step 0.05, default 0.40), Test connection button calling `GET /health`).
- `src/__tests__/main.test.ts` — source-level smoke test asserting `main.ts` never re-imports a local-pipeline module.

## Scoring + UI deltas (2026-04)

End-to-end scoring overhaul in coordination with `docindex-server` v0.3:

- **`score_normalized`** — backend computes a query-independent 0..1 display score (`W_VEC·branch_norm(v_rank,K) + W_BM25·branch_norm(b_rank,K)` with default `K=10, W_VEC=0.55, W_BM25=0.45`); the plugin consumes it via `getDisplayScore(hit)` and filters hits below `settings.relevanceThreshold` (default `0.40`) in `DocindexClient.post()` before returning to callers. Old servers without the field fall back to `hit.score` so the threshold still does something useful.
- **`score_rrf`** — the raw RRF fusion score the server ranks on, plumbed through `DocindexHit.scoreRrf` for future diagnostics.
- **Sidebar fixes** (`NoteBottomViewReact.tsx`):
  - dedupe hits by path via `groupHitsByPath` in `RemoteSearchService`; extra chunks land in `SimilarNote.additionalChunks` and render as sub-rows under the expanded primary row.
  - clear rows on `workspace.on('active-leaf-change' | 'file-open')` so switching files never shows the previous note's hits attached to the new title.
  - race guard compares `TFile.path` (not object identity) to survive rename events that replace the TFile instance.
  - row click uses `openLinkText(path + "#" + deepestHeading, ...)` when `hit.headingPath` is non-empty — the opened note scrolls to the matched section.
- **Modal fixes** (`SemanticSearchModal.tsx`):
  - auto-scroll only on keyboard navigation (`selectionSource === "keyboard"`); new search results reset the source to `"reset"` so the viewport isn't yanked as the user keeps typing.
  - split the combined highlight into `.is-selected` (keyboard, what Enter acts on) and `.is-hovered` (mouse); hover no longer clobbers the keyboard selection.
  - row keys are now `SimilarNote.chunkId` (plumbed from `DocindexHit.chunkId`) so the same path across different queries gets a fresh DOM identity.

## What the fork deleted

Everything upstream had for on-device indexing:

**Embedding providers + adapters**
- `src/domain/service/EmbeddingProvider.ts`, `EmbeddingService.ts`
- `src/domain/service/{Gemini,Ollama,OpenAI,Transformers}EmbeddingProvider.ts`
- `src/domain/service/transformers.worker.ts`
- `src/domain/service/NoteChunkingService.ts`, `SimilarNoteFinder.ts`, `TextSearchService.ts`
- `src/adapter/{gemini,openai,ollama,huggingface,orama}/` (all five entire dirs, including `orama.worker.ts`)

**Local index + vault change pipeline**
- `src/infrastructure/` (entire dir): `IndexedDBChunkStorage`, `IndexedDBMTimeStorage`, `IndexedNoteMTimeStore`, `VaultNoteRepository`, `WorkerManager`, `LangchainNoteChunkingService`
- `src/services/noteChangeQueue.ts` (+ test)
- `src/utils/folderExclusion.ts` (+ test), `errorHandling.ts`, `environmentInfo.ts`

**Model / index UI**
- `src/components/{ModelSettingsSection,IndexSettingsSection,UsageStatsSection}.tsx`
- `src/components/{Gemini,OpenAI,Ollama,Builtin}SettingsSection.tsx`
- `src/components/{GPUSettingModal,LoadModelModal,StatusBarView,NoteBottomView}.ts(x)`
- `src/components/{modelChangesApplier,modelDescriptionBuilder,modelInfoCache}.ts`

**View manager + indexing lifecycle**
- `src/application/{LeafViewCoordinator,NoteBottomViewManager,BaseViewManager,ViewManager,NoteIndexingService}.ts`

**Commands tied to the local pipeline**
- `src/commands/{ReindexAllNotesCommand,ToggleInDocumentViewCommand}.ts`

**Domain types only used by the deleted layers**
- `src/domain/model/{NoteChunk,NoteChunkDTO}.ts`
- `src/domain/repository/{NoteRepository,NoteChunkRepository}.ts`

**Dropped runtime dependencies**
- `@huggingface/transformers`, `@langchain/core`, `@langchain/textsplitters`, `@orama/orama`, `@orama/plugin-data-persistence`, `comlink`, `picomatch`, `esbuild-plugin-polyfill-node`, `esbuild-plugin-inline-worker`, `fake-indexeddb`, `@types/picomatch`.

**Build config simplified**
- `esbuild.config.mjs` — dropped `workers-only` mode, inline-worker plugin, and node polyfill plugin. Just bundles `src/main.ts`.
- `package.json` — `test` script is plain `vitest run` (no worker pre-build).

## Design notes

**Why no dispatcher?** Earlier phases kept a `SearchDispatcher` to route between local and remote providers. With the local pipeline gone there's only one path, so routing is dead code — deleted.

**Settings legacy fields.** `SimilarNotesSettings` still declares upstream fields (`modelProvider`, `modelId`, `openai*`, `gemini*`, `useGPU`, etc.). They aren't read anywhere in the live code path, but keeping the field shape avoids wiping user `data.json` on upgrade. A follow-up commit can prune the interface once we're comfortable losing the migration surface.

**Runtime validation.** The client hand-rolls a guard against the server's JSON shape. On malformed input it raises one `Notice` and flips `disabledForSession = true` so subsequent queries short-circuit until settings change (`reset()`). We deliberately do not retry malformed responses.

**Bearer token handling.** Stored in settings, included only in the `Authorization: Bearer …` header, masked in the UI (`type="password"`). Never written to `log.*` or `console.*`.

**Mobile.** All network calls go through `obsidian.requestUrl` — `fetch` has CORS/TLS quirks on iOS/Android. No Node APIs are used. The manifest is `isDesktopOnly: false` (inherited from upstream and load-bearing for this fork).

## Deviations / TODO

- Prune legacy upstream fields from `SimilarNotesSettings` once a `data.json` migration is written.
- Prune the `SimilarNotesSidebarView` path if/when sidebar UI is rewritten to talk to `RemoteSearchService` directly (it currently still flows through `SimilarNoteCoordinator` — which is the right shape, but the indirection could be flattened).
