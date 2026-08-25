import { getNoteDisplayText, formatSimilarityPercent } from "@/utils/displayUtils";
import { sanitizeErrorForLog } from "@/utils/errorSanitizer";
import type { App } from "obsidian";
import { MarkdownView, Modal, TFile } from "obsidian";
import log from "loglevel";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SimilarNote } from "@/domain/model/SimilarNote";
import type { TextSearchResult } from "@/adapter/docindex";
import { formatMediaLabel } from "@/adapter/docindex";

/**
 * Minimal structural surface the modal depends on. Satisfied by
 * `RemoteSearchService`.
 */
interface TextSearchServiceLike {
    findSimilarNotesFromText(text: string, limit?: number): Promise<TextSearchResult>;
}

export const MIN_SEARCH_LENGTH = 3;
export const DEBOUNCE_MS = 300;

// Platform-specific modifier keys
const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");
const MOD_KEY = isMac ? "\u2318" : "Ctrl";
const SHIFT_KEY = isMac ? "\u21E7" : "Shift";

const SearchInstructions: React.FC = () => (
    <div className="prompt-instructions">
        <div className="prompt-instruction">
            <span className="prompt-instruction-command">↑↓</span>
            <span>to navigate</span>
        </div>
        <div className="prompt-instruction">
            <span className="prompt-instruction-command">↵</span>
            <span>to open</span>
        </div>
        <div className="prompt-instruction">
            <span className="prompt-instruction-command">{MOD_KEY} ↵</span>
            <span>to open in new tab</span>
        </div>
        <div className="prompt-instruction">
            <span className="prompt-instruction-command">{SHIFT_KEY} ↵</span>
            <span>to insert as link</span>
        </div>
        <div className="prompt-instruction">
            <span className="prompt-instruction-command">esc</span>
            <span>to dismiss</span>
        </div>
    </div>
);

interface SearchResultItemProps {
    note: SimilarNote;
    file: TFile | null;
    isSelected: boolean;
    isHovered: boolean;
    scrollOnSelect: boolean;
    noteDisplayMode: "title" | "path" | "smart";
    allFiles: TFile[];
    onHover: () => void;
    onLeaveHover: () => void;
    onOpen: (newTab: boolean) => void;
    onInsertLink: () => void;
}

export const SearchResultItem: React.FC<SearchResultItemProps> = ({
    note,
    file,
    isSelected,
    isHovered,
    scrollOnSelect,
    noteDisplayMode,
    allFiles,
    onHover,
    onLeaveHover,
    onOpen,
    onInsertLink,
}) => {
    const itemRef = useRef<HTMLDivElement>(null);

    // Only auto-scroll when the parent says the selection change came from
    // keyboard navigation. Scrolling on initial render or when the user is
    // still typing yanks the viewport out from under them.
    useEffect(() => {
        if (isSelected && scrollOnSelect && itemRef.current) {
            itemRef.current.scrollIntoView({ block: "nearest" });
        }
    }, [isSelected, scrollOnSelect]);

    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        if (e.shiftKey) {
            onInsertLink();
        } else {
            onOpen(e.metaKey || e.ctrlKey);
        }
    };

    const displayText = file
        ? getNoteDisplayText(file, note.title, { noteDisplayMode }, allFiles)
        : note.title;

    const mediaLabel = formatMediaLabel({
        mediaType: note.mediaType,
        mediaStart: note.mediaStart,
        mediaEnd: note.mediaEnd,
        truncated: note.truncated,
    });

    // `.is-selected` tracks keyboard focus; `.is-hovered` tracks the mouse cursor.
    // Separate classes prevent a stale hover highlight when the keyboard selection
    // and mouse position differ.
    const classes = ["suggestion-item", "mod-complex"];
    if (isSelected) classes.push("is-selected");
    if (isHovered) classes.push("is-hovered");

    return (
        <div
            ref={itemRef}
            className={classes.join(" ")}
            onClick={handleClick}
            onMouseMove={onHover}
            onMouseLeave={onLeaveHover}
        >
            <div className="suggestion-content">
                <div className="suggestion-title">{displayText}</div>
                {mediaLabel && (
                    <div className="docindex-media-type">{mediaLabel}</div>
                )}
            </div>
            <div className="suggestion-aux">
                {formatSimilarityPercent(note.similarity) && (
                    <span className="suggestion-flair semantic-search-score">
                        {formatSimilarityPercent(note.similarity)}
                    </span>
                )}
            </div>
        </div>
    );
};

interface SemanticSearchContentProps {
    app: App;
    textSearchService: TextSearchServiceLike;
    noteDisplayMode: "title" | "path" | "smart";
    onClose: () => void;
}

/**
 * Debounced remote search with a request-generation guard against
 * out-of-order completions. Exported for direct hook testing — the
 * generation guard is otherwise unobservable through the DOM alone.
 */
export function useSemanticSearch(textSearchService: TextSearchServiceLike) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<SimilarNote[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isSearching, setIsSearching] = useState(false);
    const [tokenWarning, setTokenWarning] = useState<string | null>(null);
    // Tracks the source of the last selectedIndex change. Only "keyboard"
    // triggers auto-scroll — initial render and new search results ("reset")
    // must never pull the viewport around.
    const [selectionSource, setSelectionSource] =
        useState<"keyboard" | "reset">("reset");
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Bumped synchronously on every query change (short-query path included)
    // and on unmount, before any request is scheduled. A request applies its
    // result only if this counter still matches the value it captured at
    // scheduling time — otherwise a slower older request would overwrite a
    // newer one's results, resurrect stale results/warnings, or clear the
    // spinner while a newer request is still in flight or debouncing.
    const generationRef = useRef(0);

    const selectByKeyboard = useCallback((updater: (prev: number) => number) => {
        setSelectionSource("keyboard");
        setSelectedIndex(updater);
    }, []);

    const performSearch = useCallback(
        async (searchQuery: string, generation: number) => {
            setIsSearching(true);
            try {
                const searchResult =
                    await textSearchService.findSimilarNotesFromText(searchQuery);
                if (generationRef.current !== generation) return;

                if (searchResult.isOverLimit) {
                    setTokenWarning(
                        `Text truncated: ${searchResult.tokenCount}→${searchResult.maxTokens} tokens`
                    );
                } else {
                    setTokenWarning(null);
                }
                setResults(searchResult.similarNotes);
                setSelectionSource("reset");
                setSelectedIndex(0);
            } catch (error) {
                if (generationRef.current !== generation) return;
                log.error(`[SemanticSearchModal] search failed: ${sanitizeErrorForLog(error)}`);
                setResults([]);
            } finally {
                if (generationRef.current === generation) setIsSearching(false);
            }
        },
        [textSearchService]
    );

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        // Invalidate the previous request immediately — not after the debounce
        // fires — so a change to `query` cannot be overtaken by an in-flight
        // request that was still current under the old query.
        const generation = ++generationRef.current;

        if (query.length < MIN_SEARCH_LENGTH) {
            setResults([]);
            setTokenWarning(null);
            return;
        }

        debounceRef.current = setTimeout(() => {
            void performSearch(query, generation);
        }, DEBOUNCE_MS);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, performSearch]);

    // Invalidate any in-flight request on unmount so its resolution can't
    // apply state to a component that's gone.
    useEffect(() => {
        return () => {
            generationRef.current++;
        };
    }, []);

    return {
        query,
        setQuery,
        results,
        selectedIndex,
        selectByKeyboard,
        selectionSource,
        isSearching,
        tokenWarning,
    };
}

const SemanticSearchContent: React.FC<SemanticSearchContentProps> = ({
    app,
    textSearchService,
    noteDisplayMode,
    onClose,
}) => {
    const {
        query,
        setQuery,
        results,
        selectedIndex,
        selectByKeyboard,
        selectionSource,
        isSearching,
        tokenWarning,
    } = useSemanticSearch(textSearchService);
    const inputRef = useRef<HTMLInputElement>(null);
    // Hover is UI-only state, separate from keyboard selection. Tracked by
    // row key (chunkId || path) so it implicitly resets on every new result
    // set — a key from a previous query won't match any row in the new list.
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const resultFiles = useMemo(() => {
        return results.map((note) => {
            const file = app.vault.getAbstractFileByPath(note.path);
            return file instanceof TFile ? file : null;
        });
    }, [results, app.vault]);

    const allFiles = useMemo(() => {
        return resultFiles.filter((f): f is TFile => f !== null);
    }, [resultFiles]);

    const openNote = useCallback(
        (index: number, newTab: boolean) => {
            const note = results[index];
            if (!note) return;

            app.workspace.openLinkText(note.path, "", newTab);
            onClose();
        },
        [results, app.workspace, onClose]
    );

    const insertLink = useCallback(
        (index: number) => {
            const note = results[index];
            if (!note) return;

            const view = app.workspace.getActiveViewOfType(MarkdownView);
            if (!view?.editor) return;

            const file = app.vault.getAbstractFileByPath(note.path) as TFile | null;
            if (!file) return;

            const sourcePath = view.file?.path ?? "";
            const linktext = app.metadataCache.fileToLinktext(file, sourcePath);
            view.editor.replaceSelection(`[[${linktext}]]`);
            onClose();
        },
        [results, app, onClose]
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    selectByKeyboard((prev) =>
                        prev < results.length - 1 ? prev + 1 : prev
                    );
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    selectByKeyboard((prev) => (prev > 0 ? prev - 1 : prev));
                    break;
                case "Enter":
                    e.preventDefault();
                    if (results.length > 0) {
                        if (e.shiftKey) {
                            insertLink(selectedIndex);
                        } else {
                            openNote(selectedIndex, e.metaKey || e.ctrlKey);
                        }
                    }
                    break;
                case "Escape":
                    e.preventDefault();
                    onClose();
                    break;
            }
        },
        [selectByKeyboard, results, selectedIndex, openNote, insertLink, onClose]
    );

    return (
        <div className="semantic-search-wrapper" onKeyDown={handleKeyDown}>
            <div className="prompt-input-container">
                <input
                    ref={inputRef}
                    type="text"
                    className="prompt-input"
                    placeholder="Search by semantic similarity..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                {isSearching && <div className="semantic-search-spinner" />}
            </div>

            {tokenWarning && (
                <div className="semantic-search-warning">{tokenWarning}</div>
            )}

            <div className="prompt-results">
                {query.length > 0 && query.length < MIN_SEARCH_LENGTH && (
                    <div className="prompt-empty-state">
                        Type at least {MIN_SEARCH_LENGTH} characters to search
                    </div>
                )}
                {query.length >= MIN_SEARCH_LENGTH &&
                    !isSearching &&
                    results.length === 0 && (
                    <div className="prompt-empty-state">No similar notes found</div>
                )}
                {results.map((note, index) => {
                    // resultFiles is co-indexed with results; avoids a per-row vault lookup.
                    const file = resultFiles[index] ?? null;
                    // Prefer chunkId (unique per hit) so same-path re-queries get fresh DOM.
                    const rowKey = note.chunkId || note.path;
                    return (
                        <SearchResultItem
                            key={rowKey}
                            note={note}
                            file={file}
                            isSelected={index === selectedIndex}
                            isHovered={rowKey === hoveredKey}
                            scrollOnSelect={selectionSource === "keyboard"}
                            noteDisplayMode={noteDisplayMode}
                            allFiles={allFiles}
                            onHover={() => setHoveredKey(rowKey)}
                            onLeaveHover={() => setHoveredKey((k) => (k === rowKey ? null : k))}
                            onOpen={(newTab) => openNote(index, newTab)}
                            onInsertLink={() => insertLink(index)}
                        />
                    );
                })}
            </div>

            <SearchInstructions />
        </div>
    );
};

export class SemanticSearchModal extends Modal {
    private root: Root | null = null;

    constructor(
        app: App,
        private readonly textSearchService: TextSearchServiceLike,
        private readonly noteDisplayMode: "title" | "path" | "smart"
    ) {
        super(app);
    }

    onOpen() {
        const { modalEl } = this;

        // Style the modal as a Quick Switcher-style prompt.
        modalEl.removeClass("modal");
        modalEl.addClass("prompt");
        modalEl.addClass("semantic-search-modal");

        modalEl.querySelector(".modal-close-button")?.remove();
        modalEl.querySelector(".modal-header")?.remove();
        modalEl.querySelector(".modal-content")?.remove();

        this.root = createRoot(modalEl);
        this.root.render(
            <SemanticSearchContent
                app={this.app}
                textSearchService={this.textSearchService}
                noteDisplayMode={this.noteDisplayMode}
                onClose={() => this.close()}
            />
        );
    }

    onClose() {
        if (this.root) {
            this.root.unmount();
            this.root = null;
        }
        const { contentEl } = this;
        contentEl.empty();
    }
}
