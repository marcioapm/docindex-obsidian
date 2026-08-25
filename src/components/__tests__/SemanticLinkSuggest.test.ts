import { beforeEach, describe, expect, it, vi } from "vitest";
import log from "loglevel";
import { SimilarNote } from "@/domain/model/SimilarNote";
import type { TextSearchResult } from "@/adapter/docindex";

// Capture Notice calls for assertions.
const noticeMessages: string[] = [];
vi.mock("obsidian", async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        Notice: class {
            constructor(msg: string) {
                noticeMessages.push(msg);
            }
        },
    };
});

import { SemanticLinkSuggest, MIN_SEARCH_LENGTH } from "../SemanticLinkSuggest";
import { TFile } from "obsidian";

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

/**
 * Build a minimal app stub that satisfies resolveWikilink's requirements.
 * `resolvable` controls whether getAbstractFileByPath returns a TFile or null.
 */
function makeApp(resolvable: boolean, notePath = "notes/test.md") {
    const file = resolvable ? new TFile(notePath) : null;
    return {
        vault: {
            getAbstractFileByPath: vi.fn().mockReturnValue(file),
        },
        metadataCache: {
            // Return a shortened link text (basename without extension).
            fileToLinktext: vi.fn().mockReturnValue("test"),
        },
    };
}

function makeSuggest(
    trigger = ";;",
    searchResult: TextSearchResult | Error = makeSearchResult([]),
    appOverride?: ReturnType<typeof makeApp>
) {
    const app = appOverride ?? {};
    const searchService = makeSearchService(searchResult);
    const settings = makeSettings(trigger);
    const suggest = new SemanticLinkSuggest(
        app as never,
        searchService as never,
        settings as never
    );
    return { suggest, searchService, app };
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

/** Build a minimal editor mock with stubbed replaceRange and setCursor. */
function makeEditor(line = ";;hello") {
    return {
        getLine: vi.fn().mockReturnValue(line),
        replaceRange: vi.fn(),
        setCursor: vi.fn(),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    noticeMessages.length = 0;
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

    it("does not pass a token embedded in a rejected search error to any loglevel call", async () => {
        const errorSpy = vi.spyOn(log, "error");
        const secret = "suggest-secret-token";
        const { suggest } = makeSuggest(
            ";;",
            new Error(`request failed: Authorization: Bearer ${secret}`)
        );
        const context = { query: "some query", file: null, editor: null, start: null, end: null };

        await suggest.getSuggestions(context as never);

        for (const call of errorSpy.mock.calls) {
            for (const arg of call) {
                const serialized = typeof arg === "string" ? arg : JSON.stringify(arg);
                expect(serialized).not.toContain(secret);
            }
        }
        errorSpy.mockRestore();
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

describe("SemanticLinkSuggest — selectSuggestion", () => {
    it("inserts [[wikilink]] over the trigger range and advances the cursor when the path resolves", () => {
        const note = makeSimilarNote({ path: "notes/test.md" });
        const app = makeApp(true, "notes/test.md");
        const { suggest } = makeSuggest(";;", makeSearchResult([note]), app);

        const editor = makeEditor();
        // Simulate a context where the trigger started at ch=0 on line 0.
        const start = { line: 0, ch: 0 };
        const end = { line: 0, ch: 7 }; // ";;hello"
        (suggest as never as { context: unknown }).context = {
            editor,
            file: null,
            start,
            end,
        };

        suggest.selectSuggestion(note, new MouseEvent("click") as never);

        // [[test]] + trailing space = "[[test]] "
        expect(editor.replaceRange).toHaveBeenCalledWith("[[test]] ", start, end);
        expect(editor.setCursor).toHaveBeenCalledWith({
            line: 0,
            ch: "[[test]] ".length,
        });
        expect(noticeMessages).toHaveLength(0);
    });

    it("fires a Notice and does not mutate the editor when the path does not resolve", () => {
        const note = makeSimilarNote({ path: "notes/missing.md" });
        const app = makeApp(false, "notes/missing.md");
        const { suggest } = makeSuggest(";;", makeSearchResult([note]), app);

        const editor = makeEditor();
        (suggest as never as { context: unknown }).context = {
            editor,
            file: null,
            start: { line: 0, ch: 0 },
            end: { line: 0, ch: 7 },
        };

        suggest.selectSuggestion(note, new MouseEvent("click") as never);

        expect(editor.replaceRange).not.toHaveBeenCalled();
        expect(editor.setCursor).not.toHaveBeenCalled();
        expect(noticeMessages.some((m) => m.includes("notes/missing.md"))).toBe(true);
    });
});

describe("SemanticLinkSuggest — onTrigger", () => {
    it("returns trigger info with correct start offset and query when trigger is present mid-line", () => {
        const { suggest } = makeSuggest(";;");
        // Line: "some text;;foo" — trigger at ch=9, query="foo", cursor at end
        const cursor = { line: 2, ch: 14 };
        const editor = makeEditor("some text;;foo");
        const result = suggest.onTrigger(cursor as never, editor as never, null);

        expect(result).not.toBeNull();
        expect(result?.start).toEqual({ line: 2, ch: 9 });
        expect(result?.end).toEqual(cursor);
        expect(result?.query).toBe("foo");
    });

    it("returns null when the trigger is absent from the line", () => {
        const { suggest } = makeSuggest(";;");
        const cursor = { line: 0, ch: 5 };
        const editor = makeEditor("hello");
        expect(suggest.onTrigger(cursor as never, editor as never, null)).toBeNull();
    });

    it("returns null when the settings trigger is empty (feature disabled)", () => {
        const { suggest } = makeSuggest("");
        const cursor = { line: 0, ch: 5 };
        // Even though ";;" appears in the line, empty trigger disables the feature.
        const editor = makeEditor(";;foo");
        expect(suggest.onTrigger(cursor as never, editor as never, null)).toBeNull();
    });
});
