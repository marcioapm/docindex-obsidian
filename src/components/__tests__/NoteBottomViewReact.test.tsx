/* eslint-disable @typescript-eslint/no-explicit-any */
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MarkdownView, TFile, Workspace } from "obsidian";
import { BehaviorSubject } from "rxjs";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Helper function to create mock TFile objects
const createMockTFile = (path: string): TFile => ({
    path,
    name: path.split('/').pop() || '',
    extension: path.split('.').pop() || '',
    basename: path.split('/').pop()?.split('.')[0] || '',
    stat: { 
        mtime: Date.now(), 
        ctime: Date.now(), 
        size: 100 
    },
    vault: {} as any,
    parent: {} as any
});
import NoteBottomViewReact from "../NoteBottomViewReact";

// Vitest will automatically use the mock from src/__mocks__/obsidian.ts
vi.mock("obsidian");

// Define the SimilarNote type to match what your component expects
interface SimilarNote {
    file: TFile;
    title: string;
    preview: string;
    similarity: number;
}

describe("SimilarNotesViewReact", () => {
    let mockWorkspace: Partial<Workspace>;
    let mockLeaf: MarkdownView;
    let mockOpenLinkText: (
        linktext: string,
        sourcePath: string,
        newLeaf?: boolean
    ) => Promise<void>;
    let bottomViewModelSubject$: BehaviorSubject<{
        currentFile: TFile;
        similarNoteEntries: SimilarNote[];
        noteDisplayMode: "title" | "path" | "smart";
    }>;
    let currentFile: TFile;

    beforeEach(() => {
        mockOpenLinkText = vi.fn();
        mockLeaf = {
            file: undefined,
        } as unknown as MarkdownView;
        mockWorkspace = {
            getLeaf: vi.fn().mockReturnValue(mockLeaf),
            openLinkText: mockOpenLinkText,
            on: vi.fn().mockReturnValue({}),
            offref: vi.fn(),
        };
        currentFile = createMockTFile("current-file.md");
        bottomViewModelSubject$ = new BehaviorSubject({
            currentFile,
            similarNoteEntries: [
                {
                    file: createMockTFile("similar1.md"),
                    title: "Similar Note 1",
                    preview: "Preview of Similar Note 1",
                    similarity: 0.95,
                },
                {
                    file: createMockTFile("similar2.md"),
                    title: "Similar Note 2",
                    preview: "Preview of Similar Note 2",
                    similarity: 0.85,
                },
            ],
            noteDisplayMode: "title",
        });
        mockLeaf.file = currentFile;
    });

    test("renders header with correct text", async () => {
        render(
            <NoteBottomViewReact
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf as unknown as MarkdownView}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
            />
        );

        expect(screen.getByText("Similar notes")).toBeInTheDocument();
        expect(await screen.findByText("Similar Note 1")).toBeInTheDocument();
    });

    test("renders similar notes when provided", async () => {
        render(
            <NoteBottomViewReact
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf as unknown as MarkdownView}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
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
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf as unknown as MarkdownView}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
            />
        );

        await screen.findByText("Similar Note 1");
        fireEvent.click(screen.getByText("Similar notes"));
        expect(screen.queryByText("Similar Note 1")).not.toBeInTheDocument();
    });

    test("shows empty state when no similar notes", async () => {
        bottomViewModelSubject$.next({
            currentFile,
            similarNoteEntries: [],
            noteDisplayMode: "title",
        });
        render(
            <NoteBottomViewReact
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf as unknown as MarkdownView}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
            />
        );
        // 클래스 이름으로 빈 상태 요소를 찾음
        await waitFor(() => {
            const emptyStateEl = screen.getByText("No similar notes found.");
            expect(emptyStateEl).toBeInTheDocument();
        });
    });

    test("calls openFile when note is clicked", async () => {
        render(
            <NoteBottomViewReact
                workspace={mockWorkspace as unknown as Workspace}
                leaf={mockLeaf as unknown as MarkdownView}
                bottomViewModelSubject$={bottomViewModelSubject$}
                vaultName="test-vault"
            />
        );
        const noteElement = await screen.findByText("Similar Note 1");
        fireEvent.click(noteElement);
        expect(mockOpenLinkText).toHaveBeenCalledWith("similar1.md", "", false);
    });
});

describe("SimilarNotesViewReact — media label rendering", () => {
    function makeWorkspace(leaf: MarkdownView): Partial<Workspace> {
        return {
            getLeaf: vi.fn().mockReturnValue(leaf),
            openLinkText: vi.fn(),
            on: vi.fn().mockReturnValue({}),
            offref: vi.fn(),
        };
    }

    test("renders docindex-media-type element for a PDF hit with a page range", async () => {
        const currentFile = createMockTFile("current-file.md");
        const leaf = { file: currentFile } as unknown as MarkdownView;
        const subject$ = new BehaviorSubject({
            currentFile,
            similarNoteEntries: [
                {
                    file: createMockTFile("report.pdf"),
                    title: "Annual Report",
                    preview: "PDF preview",
                    similarity: 0.9,
                    mediaType: "pdf" as const,
                    mediaStart: 0,
                    mediaEnd: 2,
                    truncated: false,
                },
            ],
            noteDisplayMode: "title" as const,
            sidebarResultCount: 10,
            bottomResultCount: 5,
        });
        render(
            <NoteBottomViewReact
                workspace={makeWorkspace(leaf) as unknown as Workspace}
                leaf={leaf}
                bottomViewModelSubject$={subject$}
                vaultName="test-vault"
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
        const subject$ = new BehaviorSubject({
            currentFile,
            similarNoteEntries: [
                {
                    file: createMockTFile("photo.png"),
                    title: "Vacation Photo",
                    preview: "Image preview",
                    similarity: 0.75,
                    mediaType: "image" as const,
                    mediaStart: null,
                    mediaEnd: null,
                    truncated: false,
                },
            ],
            noteDisplayMode: "title" as const,
            sidebarResultCount: 10,
            bottomResultCount: 5,
        });
        render(
            <NoteBottomViewReact
                workspace={makeWorkspace(leaf) as unknown as Workspace}
                leaf={leaf}
                bottomViewModelSubject$={subject$}
                vaultName="test-vault"
            />
        );
        expect(await screen.findByText("🖼 Image")).toBeInTheDocument();
        const labelEl = screen.getByText("🖼 Image");
        expect(labelEl.className).toContain("docindex-media-type");
    });

    test("renders no docindex-media-type element for a text hit", async () => {
        const currentFile = createMockTFile("current-file.md");
        const leaf = { file: currentFile } as unknown as MarkdownView;
        const subject$ = new BehaviorSubject({
            currentFile,
            similarNoteEntries: [
                {
                    file: createMockTFile("note.md"),
                    title: "Plain Note",
                    preview: "Text preview",
                    similarity: 0.8,
                    mediaType: "text" as const,
                    mediaStart: null,
                    mediaEnd: null,
                    truncated: false,
                },
            ],
            noteDisplayMode: "title" as const,
            sidebarResultCount: 10,
            bottomResultCount: 5,
        });
        render(
            <NoteBottomViewReact
                workspace={makeWorkspace(leaf) as unknown as Workspace}
                leaf={leaf}
                bottomViewModelSubject$={subject$}
                vaultName="test-vault"
            />
        );
        await screen.findByText("Plain Note");
        expect(document.querySelector(".docindex-media-type")).not.toBeInTheDocument();
    });
});
