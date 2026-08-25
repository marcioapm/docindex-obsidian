import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MarkdownView, TFile, Workspace } from "obsidian";
import { BehaviorSubject } from "rxjs";
import { beforeEach, describe, expect, test, vi } from "vitest";
import NoteBottomViewReact, {
    type NoteBottomViewModel,
    type SimilarNoteEntry,
} from "../NoteBottomViewReact";

// Vitest will automatically use the mock from src/__mocks__/obsidian.ts
vi.mock("obsidian");

// Helper function to create mock TFile objects
const createMockTFile = (path: string): TFile =>
    ({
        path,
        name: path.split("/").pop() || "",
        extension: path.split(".").pop() || "",
        basename: path.split("/").pop()?.split(".")[0] || "",
        stat: {
            mtime: Date.now(),
            ctime: Date.now(),
            size: 100,
        },
    }) as TFile;

/** Builds a full NoteBottomViewModel so every field a component reads has a value. */
function makeModel(overrides: Partial<NoteBottomViewModel> = {}): NoteBottomViewModel {
    return {
        currentFile: createMockTFile("current-file.md"),
        similarNoteEntries: [],
        noteDisplayMode: "title",
        sidebarResultCount: 10,
        bottomResultCount: 5,
        ...overrides,
    };
}

/** Builds a full SimilarNoteEntry so limit-slicing tests aren't affected by missing fields. */
function makeEntry(overrides: Partial<SimilarNoteEntry> & Pick<SimilarNoteEntry, "file" | "title">): SimilarNoteEntry {
    return {
        similarity: 0.5,
        preview: "preview",
        mediaType: "text",
        mediaStart: null,
        mediaEnd: null,
        truncated: false,
        ...overrides,
    };
}

function makeWorkspace(): { workspace: Partial<Workspace>; openLinkText: ReturnType<typeof vi.fn> } {
    const openLinkText = vi.fn();
    const workspace: Partial<Workspace> = {
        getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn() }),
        openLinkText,
        on: vi.fn().mockReturnValue({}),
        offref: vi.fn(),
    };
    return { workspace, openLinkText };
}

describe("NoteBottomViewReact", () => {
    let workspace: Partial<Workspace>;
    let openLinkText: ReturnType<typeof vi.fn>;
    let leaf: MarkdownView;
    let currentFile: TFile;
    let bottomViewModelSubject$: BehaviorSubject<NoteBottomViewModel>;

    beforeEach(() => {
        ({ workspace, openLinkText } = makeWorkspace());
        currentFile = createMockTFile("current-file.md");
        leaf = { file: currentFile } as unknown as MarkdownView;
        bottomViewModelSubject$ = new BehaviorSubject(
            makeModel({
                currentFile,
                similarNoteEntries: [
                    makeEntry({
                        file: createMockTFile("similar1.md"),
                        title: "Similar Note 1",
                        preview: "Preview of Similar Note 1",
                        similarity: 0.95,
                    }),
                    makeEntry({
                        file: createMockTFile("similar2.md"),
                        title: "Similar Note 2",
                        preview: "Preview of Similar Note 2",
                        similarity: 0.85,
                    }),
                ],
            })
        );
    });

    test("renders header with correct text", async () => {
        render(
            <NoteBottomViewReact
                workspace={workspace as Workspace}
                leaf={leaf}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
                viewType="bottom"
            />
        );

        expect(screen.getByText("Similar notes")).toBeInTheDocument();
        expect(await screen.findByText("Similar Note 1")).toBeInTheDocument();
    });

    test("renders similar notes when provided", async () => {
        render(
            <NoteBottomViewReact
                workspace={workspace as Workspace}
                leaf={leaf}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
                viewType="bottom"
            />
        );

        expect(await screen.findByText("Similar Note 1")).toBeInTheDocument();
        expect(await screen.findByText("Similar Note 2")).toBeInTheDocument();
        expect(await screen.findByText("95%")).toBeInTheDocument();
        expect(await screen.findByText("85%")).toBeInTheDocument();
    });

    test("hides content when collapsed", async () => {
        render(
            <NoteBottomViewReact
                workspace={workspace as Workspace}
                leaf={leaf}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
                viewType="bottom"
            />
        );

        await screen.findByText("Similar Note 1");
        fireEvent.click(screen.getByText("Similar notes"));
        expect(screen.queryByText("Similar Note 1")).not.toBeInTheDocument();
    });

    test("shows empty state when no similar notes", async () => {
        bottomViewModelSubject$.next(makeModel({ currentFile, similarNoteEntries: [] }));
        render(
            <NoteBottomViewReact
                workspace={workspace as Workspace}
                leaf={leaf}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
                viewType="bottom"
            />
        );
        await waitFor(() => {
            expect(screen.getByText("No similar notes found.")).toBeInTheDocument();
        });
    });

    test("calls openLinkText when a note is clicked", async () => {
        render(
            <NoteBottomViewReact
                workspace={workspace as Workspace}
                leaf={leaf}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
                viewType="bottom"
            />
        );
        const noteElement = await screen.findByText("Similar Note 1");
        fireEvent.click(noteElement);
        expect(openLinkText).toHaveBeenCalledWith("similar1.md", "", false);
    });
});

describe("NoteBottomViewReact — result-count limiting", () => {
    function makeEntries(count: number): SimilarNoteEntry[] {
        return Array.from({ length: count }, (_, i) =>
            makeEntry({
                file: createMockTFile(`similar${i}.md`),
                title: `Similar Note ${i}`,
                similarity: 0.5,
            })
        );
    }

    test("sidebar view renders only sidebarResultCount entries, even with more available", async () => {
        const { workspace: ws } = makeWorkspace();
        const currentFile = createMockTFile("current-file.md");
        const leaf = { file: currentFile } as unknown as MarkdownView;
        const subject$ = new BehaviorSubject(
            makeModel({
                currentFile,
                similarNoteEntries: makeEntries(8),
                sidebarResultCount: 3,
                bottomResultCount: 5,
            })
        );

        render(
            <NoteBottomViewReact
                workspace={ws as Workspace}
                leaf={leaf}
                bottomViewModelSubject$={subject$}
                vaultName="test-vault"
                viewType="sidebar"
            />
        );

        await screen.findByText("Similar Note 0");
        expect(screen.getByText("Similar Note 2")).toBeInTheDocument();
        expect(screen.queryByText("Similar Note 3")).not.toBeInTheDocument();
        expect(screen.queryByText("Similar Note 7")).not.toBeInTheDocument();
    });

    test("bottom view renders only bottomResultCount entries, even with more available", async () => {
        const { workspace: ws } = makeWorkspace();
        const currentFile = createMockTFile("current-file.md");
        const leaf = { file: currentFile } as unknown as MarkdownView;
        const subject$ = new BehaviorSubject(
            makeModel({
                currentFile,
                similarNoteEntries: makeEntries(8),
                sidebarResultCount: 10,
                bottomResultCount: 2,
            })
        );

        render(
            <NoteBottomViewReact
                workspace={ws as Workspace}
                leaf={leaf}
                bottomViewModelSubject$={subject$}
                vaultName="test-vault"
                viewType="bottom"
            />
        );

        await screen.findByText("Similar Note 0");
        expect(screen.getByText("Similar Note 1")).toBeInTheDocument();
        expect(screen.queryByText("Similar Note 2")).not.toBeInTheDocument();
        expect(screen.queryByText("Similar Note 7")).not.toBeInTheDocument();
    });

    test("sidebar and bottom views apply their own limit independently for the same model", async () => {
        const entries = makeEntries(6);
        const model = makeModel({
            similarNoteEntries: entries,
            sidebarResultCount: 4,
            bottomResultCount: 1,
        });

        const { workspace: sidebarWs } = makeWorkspace();
        const sidebarLeaf = { file: model.currentFile } as unknown as MarkdownView;
        const sidebarSubject$ = new BehaviorSubject(model);
        const { unmount: unmountSidebar } = render(
            <NoteBottomViewReact
                workspace={sidebarWs as Workspace}
                leaf={sidebarLeaf}
                bottomViewModelSubject$={sidebarSubject$}
                vaultName="test-vault"
                viewType="sidebar"
            />
        );
        await screen.findByText("Similar Note 3");
        expect(screen.queryByText("Similar Note 4")).not.toBeInTheDocument();
        unmountSidebar();

        const { workspace: bottomWs } = makeWorkspace();
        const bottomLeaf = { file: model.currentFile } as unknown as MarkdownView;
        const bottomSubject$ = new BehaviorSubject(model);
        render(
            <NoteBottomViewReact
                workspace={bottomWs as Workspace}
                leaf={bottomLeaf}
                bottomViewModelSubject$={bottomSubject$}
                vaultName="test-vault"
                viewType="bottom"
            />
        );
        await screen.findByText("Similar Note 0");
        expect(screen.queryByText("Similar Note 1")).not.toBeInTheDocument();
    });
});

describe("NoteBottomViewReact — media label rendering", () => {
    test("renders docindex-media-type element for a PDF hit with a page range", async () => {
        const currentFile = createMockTFile("current-file.md");
        const leaf = { file: currentFile } as unknown as MarkdownView;
        const { workspace: ws } = makeWorkspace();
        const subject$ = new BehaviorSubject(
            makeModel({
                currentFile,
                similarNoteEntries: [
                    makeEntry({
                        file: createMockTFile("report.pdf"),
                        title: "Annual Report",
                        preview: "PDF preview",
                        similarity: 0.9,
                        mediaType: "pdf",
                        mediaStart: 0,
                        mediaEnd: 2,
                    }),
                ],
            })
        );
        render(
            <NoteBottomViewReact
                workspace={ws as Workspace}
                leaf={leaf}
                bottomViewModelSubject$={subject$}
                vaultName="test-vault"
                viewType="bottom"
            />
        );
        // "📄 PDF pages 1–2" from mediaStart=0, mediaEnd=2 (0-based half-open → 1-based inclusive).
        expect(await screen.findByText("📄 PDF pages 1–2")).toBeInTheDocument();
        const labelEl = screen.getByText("📄 PDF pages 1–2");
        expect(labelEl.className).toContain("docindex-media-type");
    });

    test("renders docindex-media-type element for an image hit", async () => {
        const currentFile = createMockTFile("current-file.md");
        const leaf = { file: currentFile } as unknown as MarkdownView;
        const { workspace: ws } = makeWorkspace();
        const subject$ = new BehaviorSubject(
            makeModel({
                currentFile,
                similarNoteEntries: [
                    makeEntry({
                        file: createMockTFile("photo.png"),
                        title: "Vacation Photo",
                        preview: "Image preview",
                        similarity: 0.75,
                        mediaType: "image",
                    }),
                ],
            })
        );
        render(
            <NoteBottomViewReact
                workspace={ws as Workspace}
                leaf={leaf}
                bottomViewModelSubject$={subject$}
                vaultName="test-vault"
                viewType="bottom"
            />
        );
        expect(await screen.findByText("🖼 Image")).toBeInTheDocument();
        const labelEl = screen.getByText("🖼 Image");
        expect(labelEl.className).toContain("docindex-media-type");
    });

    test("renders no docindex-media-type element for a text hit", async () => {
        const currentFile = createMockTFile("current-file.md");
        const leaf = { file: currentFile } as unknown as MarkdownView;
        const { workspace: ws } = makeWorkspace();
        const subject$ = new BehaviorSubject(
            makeModel({
                currentFile,
                similarNoteEntries: [
                    makeEntry({
                        file: createMockTFile("note.md"),
                        title: "Plain Note",
                        preview: "Text preview",
                        similarity: 0.8,
                        mediaType: "text",
                    }),
                ],
            })
        );
        render(
            <NoteBottomViewReact
                workspace={ws as Workspace}
                leaf={leaf}
                bottomViewModelSubject$={subject$}
                vaultName="test-vault"
                viewType="bottom"
            />
        );
        await screen.findByText("Plain Note");
        expect(document.querySelector(".docindex-media-type")).not.toBeInTheDocument();
    });
});
