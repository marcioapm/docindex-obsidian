import { getNoteDisplayText, formatSimilarityPercent } from "@/utils/displayUtils";
import type { MarkdownView, TFile, Workspace } from "obsidian";
import { Menu } from "obsidian";
import { useEffect, useLayoutEffect, useState } from "react";
import type { Observable } from "rxjs";
import { formatMediaLabel } from "@/adapter/docindex";
import type { MediaType } from "@/adapter/docindex";

export interface SimilarNoteEntry {
    file: TFile;
    title: string;
    /** 0..1 relevance score, or `undefined` when none is available to display. */
    similarity: number | undefined;
    preview: string;
    sourceChunk?: string;
    /**
     * Extra chunk snippets from the same note. When non-empty, the
     * expanded preview shows them beneath the primary snippet so the
     * user can see everywhere the note matched.
     */
    additionalChunks?: string[];
    /**
     * Heading chain of the top-scoring chunk (root → deepest). When
     * present, clicking the row opens the note scrolled to the deepest
     * heading; otherwise the note opens at the top.
     */
    headingPath?: string[];
    /** Content category of the top-scoring chunk. Defaults to "text". */
    mediaType?: MediaType;
    /** 0-based start page of the embedded range (PDFs). Null = not paginated. */
    mediaStart?: number | null;
    /** 0-based exclusive end page of the embedded range (PDFs). Null = not paginated. */
    mediaEnd?: number | null;
    /** True when the embedding covers only part of the source. */
    truncated?: boolean;
}

export interface NoteBottomViewModel {
    currentFile: TFile | null;
    similarNoteEntries: SimilarNoteEntry[];
    noteDisplayMode: "title" | "path" | "smart";
    sidebarResultCount: number;
    bottomResultCount: number;
}

interface SimilarNotesHeaderProps {
    collapsed: boolean;
    onToggleCollapse: () => void;
}

export type ViewType = "sidebar" | "bottom";

interface NoteBottomViewProps {
    workspace: Workspace;
    vaultName: string;
    leaf: MarkdownView;
    bottomViewModelSubject$: Observable<NoteBottomViewModel>;
    viewType: ViewType;
}

// Header Component
const SimilarNotesHeader: React.FC<SimilarNotesHeaderProps> = ({
    collapsed,
    onToggleCollapse,
}) => {
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            onToggleCollapse();
            e.preventDefault();
        }
    };

    return (
        <div
            className="tree-item-self is-clickable"
            onClick={onToggleCollapse}
            onKeyDown={handleKeyDown}
        >
            <div
                className={`similar-notes-title tree-item-itself is-clickable ${
                    collapsed ? "is-collapsed" : ""
                }`}
            >
                <div className="tree-item-inner">Similar notes</div>
            </div>
        </div>
    );
};

const SearchResultPreview = ({
    preview,
    sourceChunk,
    additionalChunks,
    isOpen,
}: {
    preview: string;
    sourceChunk?: string;
    additionalChunks?: string[];
    isOpen: boolean;
}) => {
    // CSS-only animation approach, no need for React Transition Group
    return (
        <div
            className={`search-result-file-matches ${
                !isOpen ? "is-collapsed" : ""
            }`}
        >
            <div className="search-result-file-match tappable">{preview}</div>
            {additionalChunks?.map((chunk, idx) => (
                <div
                    key={`chunk-${idx}`}
                    className="search-result-file-match tappable"
                >
                    {chunk}
                </div>
            ))}
            {sourceChunk && (
                <div className="search-result-file-match tappable">
                    <div style={{ fontWeight: "bold", textAlign: "center" }}>
                        Source
                    </div>
                    <div style={{ textAlign: "left" }}>{sourceChunk}</div>
                </div>
            )}
        </div>
    );
};

const SearchResult = ({
    note,
    onNoteClick,
    onContextMenu,
    noteDisplayMode,
    allSimilarNotes,
}: {
    note: SimilarNoteEntry;
    onNoteClick: (e: React.MouseEvent, note: SimilarNoteEntry) => void;
    onContextMenu: (e: React.MouseEvent, note: SimilarNoteEntry) => void;
    noteDisplayMode: "title" | "path" | "smart";
    allSimilarNotes: SimilarNoteEntry[];
}) => {
    const [isCollapsed, setIsCollapsed] = useState(true);
    // Separate state to control whether the component is rendered in the DOM
    const [shouldRender, setShouldRender] = useState(false);
    // Additional state for animation when expanding
    const [isAnimating, setIsAnimating] = useState(false);

    // Animation duration (must match the value in styles.css)
    const animationDuration = 200;

    // Execute when isCollapsed state changes
    // Using useLayoutEffect to synchronize animation states before paint
    // This pattern is intentional for animation synchronization
    useLayoutEffect(() => {
        if (isCollapsed) {
            // When collapsing: Start the animation
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setIsAnimating(true);

            // Remove from DOM after animation completes
            const timer = setTimeout(() => {
                setShouldRender(false);
                setIsAnimating(false);
            }, animationDuration);
            return () => clearTimeout(timer);
        }
        // When expanding:
        // 1. First render in collapsed state
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShouldRender(true);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsAnimating(true);

        // 2. Start animation in the next frame
        const timer = setTimeout(() => {
            setIsAnimating(false);
        }, 20); // Short delay to ensure browser has time to render the collapsed state
        return () => clearTimeout(timer);
    }, [isCollapsed]);

    const toggleCollapse = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsCollapsed((prev) => !prev);
    };

    const handleDragStart = (e: React.DragEvent) => {
        // Set full path (with .md) so the drop handler can resolve the file
        // and compute the proper link text via fileToLinktext
        const linkText = `[[${note.file.path}]]`;
        e.dataTransfer.setData("text/plain", linkText);
        e.dataTransfer.setData("text/html", `<a href="${note.file.path}">${linkText}</a>`);

        e.dataTransfer.effectAllowed = "all";
    };

    const mediaLabel = formatMediaLabel({
        mediaType: note.mediaType ?? "text",
        mediaStart: note.mediaStart ?? null,
        mediaEnd: note.mediaEnd ?? null,
        truncated: note.truncated ?? false,
    });

    return (
        <div
            className={
                isCollapsed
                    ? "tree-item search-result is-collapsed"
                    : "tree-item search-result"
            }
        >
            <div
                className="tree-item-self search-result-file-title is-clickable"
                draggable="true"
                onDragStart={handleDragStart}
                onClick={(e) => onNoteClick(e, note)}
                onKeyDown={undefined}
                onContextMenu={(e) => onContextMenu(e, note)}
            >
                <div
                    className={
                        isCollapsed
                            ? "tree-item-icon collapse-icon is-collapsed"
                            : "tree-item-icon collapse-icon"
                    }
                    onKeyDown={undefined}
                    onClick={toggleCollapse}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="svg-icon right-triangle"
                    >
                        <title>collapse-icon</title>
                        <path d="M3 8L12 17L21 8" />
                    </svg>
                </div>
                <div className="tree-item-inner" title={note.file.path}>
                    {getNoteDisplayText(
                        note.file,
                        note.title,
                        { noteDisplayMode },
                        allSimilarNotes.map((entry) => entry.file)
                    )}
                </div>
                <div className="tree-item-flair-outer">
                    {mediaLabel && (
                        <div className="tree-item-flair docindex-media-type">{mediaLabel}</div>
                    )}
                    {formatSimilarityPercent(note.similarity) && (
                        <div className="tree-item-flair">
                            {formatSimilarityPercent(note.similarity)}
                        </div>
                    )}
                </div>
            </div>
            {shouldRender && (
                <SearchResultPreview
                    preview={note.preview}
                    sourceChunk={note.sourceChunk}
                    additionalChunks={note.additionalChunks}
                    isOpen={!isAnimating}
                />
            )}
        </div>
    );
};

const SearchResultsContainer = ({
    similarNotes,
    onNoteClick,
    onContextMenu,
    noteDisplayMode,
}: {
    similarNotes: SimilarNoteEntry[];
    onNoteClick: (e: React.MouseEvent, note: SimilarNoteEntry) => void;
    onContextMenu: (e: React.MouseEvent, note: SimilarNoteEntry) => void;
    noteDisplayMode: "title" | "path" | "smart";
}) => {
    if (similarNotes.length === 0) {
        return (
            <div className="search-result-container">
                <div className="search-empty-state">
                    No similar notes found.
                </div>
            </div>
        );
    }

    return (
        <div className="search-result-container">
            <div className="search-results-children">
                {similarNotes.map((note) => (
                    <SearchResult
                        key={note.file.path}
                        note={note}
                        onNoteClick={onNoteClick}
                        onContextMenu={onContextMenu}
                        noteDisplayMode={noteDisplayMode}
                        allSimilarNotes={similarNotes}
                    />
                ))}
            </div>
        </div>
    );
};

// Main Component
const NoteBottomViewReact: React.FC<NoteBottomViewProps> = ({
    workspace,
    vaultName,
    leaf,
    bottomViewModelSubject$,
    viewType,
}) => {
    const [collapsed, setCollapsed] = useState(false);
    const [similarNotes, setSimilarNotes] = useState<SimilarNoteEntry[]>([]);
    const [noteDisplayMode, setNoteDisplayMode] = useState<
        "title" | "path" | "smart"
    >("title");

    // Clear stale rows the instant Obsidian focuses a different file so the
    // user never sees last-note's hits attached to this-note's title. The
    // new hits arrive through the view-model subject a moment later.
    useEffect(() => {
        let lastPath = leaf.file?.path ?? null;
        const handler = () => {
            const currentPath = leaf.file?.path ?? null;
            if (currentPath !== lastPath) {
                lastPath = currentPath;
                setSimilarNotes([]);
            }
        };
        const activeRef = workspace.on("active-leaf-change", handler);
        const openRef = workspace.on("file-open", handler);
        return () => {
            workspace.offref(activeRef);
            workspace.offref(openRef);
        };
    }, [workspace, leaf]);

    useEffect(() => {
        const sub = bottomViewModelSubject$.subscribe((model: NoteBottomViewModel) => {
            // Compare by path — TFile objects can be replaced across renames
            // and stale responses from the previous file must not render
            // under the current file's header.
            const currentPath = leaf.file?.path ?? null;
            const modelPath = model.currentFile?.path ?? null;
            if (currentPath !== modelPath) {
                return;
            }

            const limit = viewType === "sidebar"
                ? model.sidebarResultCount
                : model.bottomResultCount;
            setSimilarNotes(model.similarNoteEntries.slice(0, limit));
            setNoteDisplayMode(model.noteDisplayMode);
        });
        return () => sub.unsubscribe();
    }, [bottomViewModelSubject$, leaf, viewType, workspace]);

    const openNote = (file: TFile, newTab = false, headingPath?: string[]) => {
        // When a heading is available, Obsidian's openLinkText accepts
        // `path#Heading` and scrolls to the first match. Falls back to the
        // top of the file for plain-text notes or chunks without headings.
        const deepest = headingPath?.[headingPath.length - 1];
        const link = deepest ? `${file.path}#${deepest}` : file.path;
        workspace.openLinkText(link, "", newTab);
    };

    const handleNoteClick = (e: React.MouseEvent, note: SimilarNoteEntry) => {
        e.preventDefault();
        openNote(note.file, e.ctrlKey || e.metaKey, note.headingPath);
    };

    const handleContextMenu = (e: React.MouseEvent, note: SimilarNoteEntry) => {
        e.preventDefault();
        const menu = new Menu();
        menu.addItem((item) =>
            item.setTitle("Open link").onClick(() => {
                openNote(note.file, false, note.headingPath);
            })
        );
        menu.addItem((item) =>
            item.setTitle("Open in new tab").onClick(() => {
                openNote(note.file, true, note.headingPath);
            })
        );
        menu.addSeparator();
        menu.addItem((item) =>
            item.setTitle("Copy Obsidian URL").onClick(() => {
                const uri = `obsidian://open?vault=${vaultName}&file=${note.file.path}`;
                navigator.clipboard.writeText(uri);
            })
        );
        menu.showAtMouseEvent(e.nativeEvent);
    };

    const toggleCollapse = () => {
        setCollapsed(!collapsed);
    };

    return (
        <>
            <div className="nav-header" />
            <div className="similar-notes-pane">
                <SimilarNotesHeader
                    collapsed={collapsed}
                    onToggleCollapse={toggleCollapse}
                />
                {!collapsed && (
                    <SearchResultsContainer
                        similarNotes={similarNotes}
                        onNoteClick={handleNoteClick}
                        onContextMenu={handleContextMenu}
                        noteDisplayMode={noteDisplayMode}
                    />
                )}
            </div>
        </>
    );
};

export default NoteBottomViewReact;
