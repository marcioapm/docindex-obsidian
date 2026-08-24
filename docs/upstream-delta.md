# Upstream delta

This plugin is forked from [`joybro/obsidian-similar-notes`](https://github.com/joybro/obsidian-similar-notes) (MIT).

- **Forked from:** `upstream/main` at `9c7e474` ("chore: bump version to 1.2.0")
- **Fork goal:** replace the local embedding/indexing pipeline with a thin remote-only client against [`docindex-server`](https://github.com/marcioapm/docindex-server). Upstream commit history is preserved.
- **`upstream` remote:** `https://github.com/joybro/obsidian-similar-notes.git`.

## What the fork kept

Only the UI surface that applies to a remote-only client:

- `src/application/SettingsService.ts` — settings persistence. Upstream legacy fields (`modelProvider`, `modelId`, `openai*`, `gemini*`, etc.) are retained so existing vault-side `data.json` files survive upgrades without data loss; none of them are read in any live code path.
- `src/application/SimilarNoteCoordinator.ts` — drives the sidebar view-model. Rewritten to accept a `SimilarNoteFinderLike` interface (satisfied by `RemoteSearchService`) and to read the active file via `vault.cachedRead`.
- `src/components/SimilarNotesSidebarView.tsx` + `NoteBottomViewReact.tsx` — sidebar and its React view.
- `src/components/SemanticSearchModal.tsx` — the Cmd/Ctrl+Shift+O modal, adapted to `RemoteSearchService`.
- `src/components/SimilarNotesSettingTab.tsx` — reduced to Docindex + Debug sections.
- `src/commands/{Command,ShowSimilarNotesCommand,SemanticSearchCommand}.ts`.
- `src/domain/model/{Note,SimilarNote}.ts`.
- `src/utils/{displayUtils,viewUtils}.ts`.
- `src/__mocks__/obsidian.ts` — test mock; extended with `requestUrl`, `EditorSuggest`, `debounce`, `Platform`, `Setting`, `Modal`, `Notice`.

## What the fork added

**Remote adapter:**

- `src/adapter/docindex/DocindexClient.ts` — `requestUrl` wrapper with runtime response validation and error kinds (`network`, `unauthorized`, `server`, `malformed`, `not-configured`).
- `src/adapter/docindex/RemoteSearchService.ts` — single search provider. Implements `findSimilarNotes`, `findSimilarNotesFromText`, `checkTokenLimit`. Groups multi-chunk hits per path.
- `src/adapter/docindex/types.ts` — wire types (snake_case) + domain types (camelCase). Includes optional `score_rrf`/`score_normalized` for v0.3+ servers; falls back to `score` for older servers.
- `src/adapter/docindex/index.ts` — barrel.

**Settings:**

- `src/components/DocindexSettingsSection.tsx` — enabled toggle, backend URL, bearer token (masked), result limit, relevance threshold slider (0..1, step 0.05, default 0.40), semantic link trigger field, Test connection button.
- `SimilarNotesSettings.semanticLinkTrigger` — default `";;"`, persisted via the existing settings mechanism.

**Semantic link suggestion (ported from upstream with adaptations):**

- `src/components/semanticLinkTrigger.ts` — pure `parseTrigger(lineUpToCursor, trigger)`. Last occurrence on the line wins; triggers starting with `[` are rejected to avoid colliding with Obsidian's built-in `[[` suggester.
- `src/components/SemanticLinkSuggest.ts` — `EditorSuggest` subclass. Depends on `TextSearchServiceLike` (satisfied by `RemoteSearchService`). Score rendered as `Math.round(similarity * 100)%` (percentage, matching `SemanticSearchModal`). Wired in `src/main.ts` via `registerEditorSuggest`.
- `src/utils/wikilinkUtils.ts` — `resolveWikilink(app, notePath, sourcePath)` ported from `src/components/semanticSearchActions.ts` upstream.

**Tests:**

- `src/adapter/docindex/__tests__/DocindexClient.test.ts` — 17 unit tests split across four `describe` blocks: request shape, auth failures, server errors, malformed responses, URL handling + threshold filter.
- `src/components/__tests__/semanticLinkTrigger.test.ts` — 9 tests for `parseTrigger`.
- `src/components/__tests__/SemanticLinkSuggest.test.ts` — 9 tests covering getSuggestions (below-min, success, rejection), renderSuggestion (percentage formatting), selectSuggestion (resolve + missing path), and onTrigger (match, absent, disabled).
- `src/__tests__/main.test.ts` — source-level smoke test asserting `main.ts` does not import any deleted local-pipeline module; extended to assert the new suggester import.

**UI fixes (from fork history):**

- Score display changed from `toFixed(2)` raw float to `Math.round(similarity * 100)%` percentage across the sidebar, modal, and suggester.
- `SemanticSearchModal`: hover tracked by row key (chunkId/path) instead of index so hover state resets implicitly on result changes without a cascading `setState` in an effect; auto-scroll only on keyboard nav; stable row keys via `chunkId`.
- `NoteBottomViewReact`: rows cleared on `active-leaf-change`/`file-open`; race guard on path (not object identity); heading-path-aware `openLinkText` scroll.

## What the fork deleted

**Embedding providers + adapters:**

- `src/domain/service/EmbeddingProvider.ts`, `EmbeddingService.ts`
- `src/domain/service/{Gemini,Ollama,OpenAI,Transformers}EmbeddingProvider.ts`
- `src/domain/service/transformers.worker.ts`
- `src/domain/service/NoteChunkingService.ts`, `SimilarNoteFinder.ts`, `TextSearchService.ts`
- `src/adapter/{gemini,openai,ollama,huggingface,orama}/` (all five dirs)

**Local index + vault change pipeline:**

- `src/infrastructure/` — `IndexedDBChunkStorage`, `IndexedDBMTimeStorage`, `IndexedNoteMTimeStore`, `VaultNoteRepository`, `WorkerManager`, `LangchainNoteChunkingService`
- `src/services/noteChangeQueue.ts`
- `src/utils/folderExclusion.ts`, `errorHandling.ts`, `environmentInfo.ts`

**Model/index UI:**

- `src/components/{ModelSettingsSection,IndexSettingsSection,UsageStatsSection}.tsx`
- `src/components/{Gemini,OpenAI,Ollama,Builtin}SettingsSection.tsx`
- `src/components/{GPUSettingModal,LoadModelModal,StatusBarView,NoteBottomView}.ts(x)`
- `src/components/{modelChangesApplier,modelDescriptionBuilder,modelInfoCache}.ts`

**Application layer tied to local pipeline:**

- `src/application/{LeafViewCoordinator,NoteBottomViewManager,BaseViewManager,ViewManager,NoteIndexingService}.ts`
- `src/commands/{ReindexAllNotesCommand,ToggleInDocumentViewCommand}.ts`

**Domain types only used by deleted layers:**

- `src/domain/model/{NoteChunk,NoteChunkDTO}.ts`
- `src/domain/repository/{NoteRepository,NoteChunkRepository}.ts`

**Dropped runtime dependencies:**

- `@huggingface/transformers`, `@langchain/core`, `@langchain/textsplitters`, `@orama/orama`, `@orama/plugin-data-persistence`, `comlink`, `picomatch`, `esbuild-plugin-polyfill-node`, `esbuild-plugin-inline-worker`, `fake-indexeddb`, `@types/picomatch`.

## Design notes

**Why no dispatcher?** The `SearchDispatcher` that earlier phases used to route between local and remote providers is dead code with the local pipeline gone — deleted.

**Settings legacy fields.** Upstream fields like `modelProvider`, `modelId`, `openai*` remain in `SimilarNotesSettings` solely to avoid wiping user `data.json` on upgrade.

**Runtime validation.** The client hand-rolls a type guard against the server's JSON shape. On malformed input: one `Notice`, `disabledForSession = true`. Resets on settings change via `reset()`.

**Bearer token.** Stored in settings, sent only in `Authorization: Bearer …`, masked in UI, never written to any log.

**Mobile.** All network calls via `obsidian.requestUrl`. No Node APIs anywhere in the codebase. `manifest.json` has `isDesktopOnly: false`.

## Deviations / TODO

- Prune legacy upstream fields from `SimilarNotesSettings` once a `data.json` migration is written.
- Flatten `SimilarNoteCoordinator` if/when the sidebar is rewritten to call `RemoteSearchService` directly.
