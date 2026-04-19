import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Smoke test for the remote-only invariant.
 *
 * We don't boot the full Obsidian Plugin lifecycle here — instead we check
 * the static import list of `src/main.ts`. The remote-only build must not
 * import anything from the deleted local pipeline (embedding providers,
 * IndexedDB, model UI, orama, langchain, transformers, comlink, etc.).
 *
 * Future regressions that try to re-introduce a local pipeline under
 * `main.ts` will light this up immediately.
 */
describe("main.ts — remote-only import surface", () => {
    const source = readFileSync(
        resolve(__dirname, "../main.ts"),
        "utf-8"
    );

    const forbiddenImports = [
        "@huggingface/transformers",
        "@orama/orama",
        "@orama/plugin-data-persistence",
        "@langchain/core",
        "@langchain/textsplitters",
        "comlink",
        "picomatch",
        "fake-indexeddb",
        "@/domain/service/EmbeddingService",
        "@/domain/service/EmbeddingProvider",
        "@/domain/service/NoteChunkingService",
        "@/domain/service/SimilarNoteFinder",
        "@/domain/service/TextSearchService",
        "@/adapter/gemini",
        "@/adapter/openai",
        "@/adapter/ollama",
        "@/adapter/huggingface",
        "@/adapter/orama",
        "@/infrastructure/IndexedDBChunkStorage",
        "@/infrastructure/VaultNoteRepository",
        "@/infrastructure/WorkerManager",
        "@/application/NoteIndexingService",
        "@/application/LeafViewCoordinator",
        "@/services/noteChangeQueue",
    ];

    it.each(forbiddenImports)(
        "does not import %s",
        (specifier) => {
            expect(source).not.toContain(`"${specifier}"`);
        }
    );

    it("imports the remote docindex adapter", () => {
        expect(source).toContain("./adapter/docindex");
    });

    it("imports the remote search coordinator", () => {
        expect(source).toContain("./application/SimilarNoteCoordinator");
    });
});
