import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerActiveNoteStartup } from "@/application/registerActiveNoteStartup";
import type { TFile } from "obsidian";

/**
 * Smoke test for the remote-only invariant: checks the static import list
 * of `src/main.ts` for forbidden specifiers rather than booting the full
 * Obsidian Plugin lifecycle.
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

    it("imports SemanticLinkSuggest for the editor suggester", () => {
        expect(source).toContain("./components/SemanticLinkSuggest");
    });

    it("wires registerActiveNoteStartup into onload with the workspace and coordinator", () => {
        expect(source).toContain(
            "registerActiveNoteStartup(this.app.workspace, this.similarNoteCoordinator)"
        );
    });
});

describe("registerActiveNoteStartup", () => {
    /** Captures the callback passed to onLayoutReady instead of invoking it,
     * so the test controls exactly when startup runs. */
    function makeWorkspace(activeFile: TFile | null) {
        let layoutReadyCallback: (() => void) | null = null;
        return {
            workspace: {
                onLayoutReady: (cb: () => void) => {
                    layoutReadyCallback = cb;
                },
                getActiveFile: () => activeFile,
            },
            runLayoutReady: () => layoutReadyCallback?.(),
        };
    }

    it("calls onFileOpen with the active file once the layout is ready", async () => {
        const activeFile = { path: "current.md" } as TFile;
        const { workspace, runLayoutReady } = makeWorkspace(activeFile);
        const onFileOpen = vi.fn().mockResolvedValue(undefined);

        registerActiveNoteStartup(workspace, { onFileOpen });
        expect(onFileOpen).not.toHaveBeenCalled();

        runLayoutReady();
        expect(onFileOpen).toHaveBeenCalledWith(activeFile);
    });

    it("calls onFileOpen with null when no note is active at startup", () => {
        const { workspace, runLayoutReady } = makeWorkspace(null);
        const onFileOpen = vi.fn().mockResolvedValue(undefined);

        registerActiveNoteStartup(workspace, { onFileOpen });
        runLayoutReady();
        expect(onFileOpen).toHaveBeenCalledWith(null);
    });

    it("does not throw when the startup onFileOpen call rejects", async () => {
        const { workspace, runLayoutReady } = makeWorkspace({ path: "current.md" } as TFile);
        const onFileOpen = vi.fn().mockRejectedValue(new Error("backend unreachable"));

        registerActiveNoteStartup(workspace, { onFileOpen });
        expect(() => runLayoutReady()).not.toThrow();

        // Let the rejected promise's .catch handler run before the test ends.
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
});
