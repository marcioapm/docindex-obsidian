/**
 * SemanticSearchModal extends Obsidian's Modal and mounts via createRoot on
 * a runtime-provided DOM element — that flow requires an Obsidian desktop
 * runtime and cannot be exercised here. `SearchResultItem` and
 * `useSemanticSearch` are both plain functions with no Obsidian
 * dependencies, so the media-label render path and the debounced-search
 * generation guard are testable directly.
 */
import "@testing-library/jest-dom/vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SearchResultItem, useSemanticSearch } from "../SemanticSearchModal";
import { SimilarNote } from "@/domain/model/SimilarNote";
import type { TFile } from "obsidian";
import type { TextSearchResult } from "@/adapter/docindex";

vi.mock("obsidian");

/** Minimal TFile stub. Only `path` is accessed in SearchResultItem. */
function makeFile(path: string): TFile {
    return { path, name: path, extension: "png", basename: path, stat: { mtime: 0, ctime: 0, size: 0 } } as unknown as TFile;
}

/** Props shared by all tests — only `note` and `file` vary per case. */
function baseProps(note: SimilarNote, file: TFile | null) {
    return {
        note,
        file,
        isSelected: false,
        isHovered: false,
        scrollOnSelect: false,
        noteDisplayMode: "title" as const,
        allFiles: file ? [file] : [],
        onHover: vi.fn(),
        onLeaveHover: vi.fn(),
        onOpen: vi.fn(),
        onInsertLink: vi.fn(),
    };
}

describe("SearchResultItem — media label rendering", () => {
    it("renders docindex-media-type element for a PDF hit with a page range", () => {
        const note = new SimilarNote(
            "Annual Report",
            "reports/annual.pdf",
            0.9,
            "snippet",
            "source",
            [],
            [],
            "pdf:0",
            "pdf",
            0,      // mediaStart: 0-based → display page 1
            3,      // mediaEnd: exclusive → display page 3
            false
        );
        render(<SearchResultItem {...baseProps(note, makeFile("reports/annual.pdf"))} />);
        // mediaStart=0, mediaEnd=3 → "📄 PDF pages 1–3"
        expect(screen.getByText("📄 PDF pages 1–3")).toBeInTheDocument();
        expect(screen.getByText("📄 PDF pages 1–3").className).toContain("docindex-media-type");
    });

    it("renders docindex-media-type element for an image hit", () => {
        const note = new SimilarNote(
            "Vacation Photo",
            "photos/beach.png",
            0.75,
            "Image snippet",
            "source",
            [],
            [],
            "img:0",
            "image",
            null,
            null,
            true   // truncated
        );
        render(<SearchResultItem {...baseProps(note, makeFile("photos/beach.png"))} />);
        expect(screen.getByText("🖼 Image (truncated)")).toBeInTheDocument();
        expect(screen.getByText("🖼 Image (truncated)").className).toContain("docindex-media-type");
    });

    it("renders no docindex-media-type element for a text hit", () => {
        const note = new SimilarNote(
            "Plain Note",
            "notes/plain.md",
            0.8,
            "Text snippet",
            "source",
            [],
            [],
            "txt:0",
            "text",
            null,
            null,
            false
        );
        render(<SearchResultItem {...baseProps(note, makeFile("notes/plain.md"))} />);
        expect(screen.getByText("Plain Note")).toBeInTheDocument();
        expect(document.querySelector(".docindex-media-type")).not.toBeInTheDocument();
    });
});

function makeResult(paths: string[]): TextSearchResult {
    return {
        similarNotes: paths.map(
            (path) => new SimilarNote(path, path, 0.5, "snippet", "source", [], [], path)
        ),
        tokenCount: 0,
        maxTokens: 0,
        isOverLimit: false,
    };
}

/** Deferred promise so a test can control exactly when a search resolves. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("useSemanticSearch — out-of-order request guard", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("does not let a slower older query overwrite a faster newer query's results", async () => {
        const first = deferred<TextSearchResult>();
        const second = deferred<TextSearchResult>();
        const findSimilarNotesFromText = vi
            .fn()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const service = { findSimilarNotesFromText };

        const { result } = renderHook(() => useSemanticSearch(service));

        act(() => result.current.setQuery("first query"));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });

        act(() => result.current.setQuery("second query"));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });

        expect(findSimilarNotesFromText).toHaveBeenCalledTimes(2);

        // Newer request (query B) resolves first.
        await act(async () => {
            second.resolve(makeResult(["b.md"]));
            await Promise.resolve();
        });
        expect(result.current.results.map((n) => n.path)).toEqual(["b.md"]);

        // Older request (query A) resolves after — must not overwrite.
        await act(async () => {
            first.resolve(makeResult(["a.md"]));
            await Promise.resolve();
        });
        expect(result.current.results.map((n) => n.path)).toEqual(["b.md"]);
    });

    it("does not clear the spinner from a stale request's finally while a newer request is in flight", async () => {
        const first = deferred<TextSearchResult>();
        const second = deferred<TextSearchResult>();
        const findSimilarNotesFromText = vi
            .fn()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const service = { findSimilarNotesFromText };

        const { result } = renderHook(() => useSemanticSearch(service));

        act(() => result.current.setQuery("first query"));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });
        act(() => result.current.setQuery("second query"));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });

        expect(result.current.isSearching).toBe(true);

        // The stale (first) request settles while the second is still pending —
        // its `finally` must not clear the spinner.
        await act(async () => {
            first.resolve(makeResult(["a.md"]));
            await Promise.resolve();
        });
        expect(result.current.isSearching).toBe(true);

        await act(async () => {
            second.resolve(makeResult(["b.md"]));
            await Promise.resolve();
        });
        expect(result.current.isSearching).toBe(false);
    });

    it("invalidates the in-flight request generation when the query is shortened below MIN_SEARCH_LENGTH", async () => {
        const first = deferred<TextSearchResult>();
        const findSimilarNotesFromText = vi.fn().mockReturnValueOnce(first.promise);
        const service = { findSimilarNotesFromText };

        const { result } = renderHook(() => useSemanticSearch(service));

        act(() => result.current.setQuery("first query"));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });

        // Shorten below MIN_SEARCH_LENGTH — the short-query branch runs
        // synchronously and must bump the generation counter too.
        act(() => result.current.setQuery("a"));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });
        expect(result.current.results).toEqual([]);

        // The stale in-flight request from "first query" resolving now must
        // not repopulate results after the user shortened the query.
        await act(async () => {
            first.resolve(makeResult(["a.md"]));
            await Promise.resolve();
        });
        expect(result.current.results).toEqual([]);
    });
});
