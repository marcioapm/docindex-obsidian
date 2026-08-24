import {
    debounce,
    EditorSuggest,
    Notice,
    type App,
    type Editor,
    type EditorPosition,
    type EditorSuggestContext,
    type EditorSuggestTriggerInfo,
    type TFile,
} from "obsidian";
import log from "loglevel";
import type { SettingsService } from "@/application/SettingsService";
import type { SimilarNote } from "@/domain/model/SimilarNote";
import type { TextSearchResult } from "@/adapter/docindex";
import { parseTrigger } from "./semanticLinkTrigger";
import { resolveWikilink } from "@/utils/wikilinkUtils";

/**
 * Minimal structural surface the suggester depends on. Satisfied by
 * `RemoteSearchService` — no concrete import needed.
 */
export interface TextSearchServiceLike {
    findSimilarNotesFromText(text: string, limit?: number): Promise<TextSearchResult>;
}

// 1 char is the smallest meaningful semantic query.
export const MIN_SEARCH_LENGTH = 1;
export const DEBOUNCE_MS = 300;

/**
 * Editor suggester that opens on a configurable trigger (default `;;`), runs a
 * semantic search against docindex-server, and inserts a `[[wikilink]]` to the
 * selected note.
 *
 * A non-`[[` trigger is used on purpose: Obsidian's built-in link suggester is
 * index 0 of `editorSuggest.suggests` and always wins on `[[`.
 */
export class SemanticLinkSuggest extends EditorSuggest<SimilarNote> {
    /**
     * Trailing debounce over the remote search call. Each keystroke resets the
     * timer; only the last invocation's callback fires. A superseded call's
     * `resolve` is never invoked, so its promise stays pending — returning `[]`
     * would cause Obsidian to close the popup during fast typing.
     */
    private readonly debouncedSearch: (
        context: EditorSuggestContext,
        cb: (suggestions: SimilarNote[]) => void
    ) => void;

    constructor(
        app: App,
        private readonly textSearchService: TextSearchServiceLike,
        private readonly settingsService: SettingsService
    ) {
        super(app);
        this.debouncedSearch = debounce(
            (context: EditorSuggestContext, cb: (suggestions: SimilarNote[]) => void) => {
                this.textSearchService
                    .findSimilarNotesFromText(context.query)
                    .then((r) => r.similarNotes)
                    .catch((err: unknown) => {
                        log.error("[SemanticLinkSuggest] search failed", err);
                        return [] as SimilarNote[];
                    })
                    .then(cb);
            },
            DEBOUNCE_MS,
            true
        );
    }

    onTrigger(
        cursor: EditorPosition,
        editor: Editor,
        _file: TFile | null
    ): EditorSuggestTriggerInfo | null {
        const trigger = this.settingsService.get().semanticLinkTrigger;
        const lineUpToCursor = editor.getLine(cursor.line).slice(0, cursor.ch);

        const match = parseTrigger(lineUpToCursor, trigger);
        if (!match) return null;

        return {
            start: { line: cursor.line, ch: match.startCh },
            end: cursor,
            query: match.query,
        };
    }

    getSuggestions(context: EditorSuggestContext): Promise<SimilarNote[]> {
        if (context.query.length < MIN_SEARCH_LENGTH) {
            return Promise.resolve([]);
        }
        return new Promise((resolve) => {
            this.debouncedSearch(context, resolve);
        });
    }

    renderSuggestion(note: SimilarNote, el: HTMLElement): void {
        el.addClass("suggestion-item", "mod-complex");
        const content = el.createDiv({ cls: "suggestion-content" });
        content.createDiv({ cls: "suggestion-title", text: note.title });
        const aux = el.createDiv({ cls: "suggestion-aux" });
        aux.createSpan({
            cls: "suggestion-flair semantic-search-score",
            text: `${Math.round(note.similarity * 100)}%`,
        });
    }

    selectSuggestion(note: SimilarNote, _evt: MouseEvent | KeyboardEvent): void {
        const context = this.context;
        if (!context) return;

        const sourcePath = context.file?.path ?? "";
        const wikilink = resolveWikilink(this.app, note.path, sourcePath);
        if (!wikilink) {
            new Notice(`docindex: note not found in this vault — "${note.path}"`);
            return;
        }

        const inserted = `${wikilink} `;
        context.editor.replaceRange(inserted, context.start, context.end);
        context.editor.setCursor({
            line: context.start.line,
            ch: context.start.ch + inserted.length,
        });
    }
}
