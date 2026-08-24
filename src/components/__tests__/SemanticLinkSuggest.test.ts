import { beforeEach, describe, expect, it, vi } from "vitest";
import { SimilarNote } from "@/domain/model/SimilarNote";
import type { TextSearchResult } from "@/adapter/docindex";

vi.mock("obsidian", async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual };
});

import { SemanticLinkSuggest, MIN_SEARCH_LENGTH } from "../SemanticLinkSuggest";

function makeSimilarNote(overrides: Partial<InstanceType<typeof SimilarNote>> = {}): SimilarNote {
    return new SimilarNote(
        overrides.title ?? "Test Note",
        overrides.path ?? "notes/test.md",
        overrides.similarity ?? 0.75,
        overrides.similarChunk ?? "",
        overrides.sourceChunk ?? "",
        overrides.additionalChunks ?? [],
        overrides.headingPath ?? [],
        overrides.chunkId ?? "abc:0"
    );
}

function makeSearchResult(notes: SimilarNote[]): TextSearchResult {
    return {
        similarNotes: notes,
        tokenCount: 0,
        maxTokens: 0,
        isOverLimit: false,
    };
}

function makeSettings(trigger = ";;") {
    return { get: () => ({ semanticLinkTrigger: trigger }) };
}

function makeSearchService(result: TextSearchResult | Error) {
    return {
        findSimilarNotesFromText: vi.fn().mockImplementation(() =>
            result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
        ),
    };
}

function makeSuggest(
    trigger = ";;",
    searchResult: TextSearchResult | Error = makeSearchResult([])
) {
    const app = {};
    const searchService = makeSearchService(searchResult);
    const settings = makeSettings(trigger);
    const suggest = new SemanticLinkSuggest(
        app as never,
        searchService as never,
        settings as never
    );
    return { suggest, searchService };
}

/** Build a minimal HTMLElement with Obsidian's createDiv/createSpan/addClass helpers. */
function makeEl(): HTMLElement {
    const el = document.createElement("div");

    const addObsidianHelpers = (node: HTMLElement) => {
        (node as never as Record<string, unknown>).addClass = (...cls: string[]) => {
            cls.forEach((c) => node.classList.add(c));
        };
        type CreateOpts = { cls: string; text?: string };
        (node as never as Record<string, unknown>).createDiv = (opts: CreateOpts) => {
            const div = document.createElement("div");
            div.className = opts.cls;
            if (opts.text) div.textContent = opts.text;
            node.appendChild(div);
            addObsidianHelpers(div);
            return div;
        };
        (node as never as Record<string, unknown>).createSpan = (opts: CreateOpts) => {
            const span = document.createElement("span");
            span.className = opts.cls;
            if (opts.text) span.textContent = opts.text;
            node.appendChild(span);
            addObsidianHelpers(span);
            return span;
        };
    };

    addObsidianHelpers(el);
    return el;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("SemanticLinkSuggest — getSuggestions", () => {
    it(`returns no suggestions when query is below MIN_SEARCH_LENGTH (${MIN_SEARCH_LENGTH} char)`, async () => {
        const { suggest } = makeSuggest();
        const context = { query: "", file: null, editor: null, start: null, end: null };
        const results = await suggest.getSuggestions(context as never);
        expect(results).toEqual([]);
    });

    it("maps search results to SimilarNote suggestions", async () => {
        const note = makeSimilarNote({ title: "Foo", path: "foo.md", similarity: 0.9 });
        const { suggest, searchService } = makeSuggest(";;", makeSearchResult([note]));

        const context = { query: "foo bar", file: null, editor: null, start: null, end: null };
        const results = await suggest.getSuggestions(context as never);

        expect(searchService.findSimilarNotesFromText).toHaveBeenCalledWith("foo bar");
        expect(results).toHaveLength(1);
        expect(results[0].path).toBe("foo.md");
        expect(results[0].similarity).toBe(0.9);
    });

    it("degrades to empty suggestions when the search service rejects", async () => {
        const { suggest } = makeSuggest(";;", new Error("network down"));
        const context = { query: "some query", file: null, editor: null, start: null, end: null };
        await expect(suggest.getSuggestions(context as never)).resolves.toEqual([]);
    });
});

describe("SemanticLinkSuggest — renderSuggestion", () => {
    it("renders title and percentage-formatted score", () => {
        const { suggest } = makeSuggest();
        const el = makeEl();

        const note = makeSimilarNote({ title: "My Note", similarity: 0.836 });
        suggest.renderSuggestion(note, el);

        expect(el.classList.contains("suggestion-item")).toBe(true);
        const titleEl = el.querySelector(".suggestion-title");
        expect(titleEl?.textContent).toBe("My Note");
        // Math.round(0.836 * 100) = 84
        const scoreEl = el.querySelector(".semantic-search-score");
        expect(scoreEl?.textContent).toBe("84%");
    });
});
