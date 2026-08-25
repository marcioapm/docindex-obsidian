import { describe, expect, it, vi } from "vitest";
import { SimilarNoteCoordinator, INDEXABLE_TEXT_EXTENSIONS } from "../SimilarNoteCoordinator";
import type { SimilarNote } from "@/domain/model/SimilarNote";
import type { TFile, Vault } from "obsidian";
import { Subject } from "rxjs";

// Required by SimilarNoteCoordinator — obsidian types are mocked globally
vi.mock("obsidian");

/** Minimal TFile stub with a controllable extension. */
function makeTFile(path: string, extension: string): TFile {
    return {
        path,
        name: path.split("/").pop() ?? path,
        extension,
        basename: (path.split("/").pop() ?? path).replace(`.${extension}`, ""),
        stat: { mtime: 1000, ctime: 1000, size: 0 },
    } as unknown as TFile;
}

/** SettingsService stub. Returns a minimal settings object. */
function makeSettingsService() {
    const subject = new Subject<Record<string, unknown>>();
    return {
        get: vi.fn().mockReturnValue({
            noteDisplayMode: "title",
            sidebarResultCount: 10,
            bottomResultCount: 5,
            showSourceChunk: false,
        }),
        getNewSettingsObservable: vi.fn().mockReturnValue(subject.asObservable()),
    };
}

/** Vault stub. cachedRead returns empty string; getFileByPath returns a stub TFile. */
function makeVault(files: Map<string, TFile> = new Map()): Partial<Vault> {
    return {
        cachedRead: vi.fn().mockResolvedValue(""),
        getFileByPath: vi.fn((path: string) => files.get(path) ?? null),
    };
}

/** SimilarNoteFinderLike stub returning an empty list by default. */
function makeFinder(notes: SimilarNote[] = []) {
    return {
        findSimilarNotes: vi.fn().mockResolvedValue(notes),
    };
}

describe("SimilarNoteCoordinator — INDEXABLE_TEXT_EXTENSIONS", () => {
    it("contains 'md' and 'txt', and no other common extensions", () => {
        expect(INDEXABLE_TEXT_EXTENSIONS.has("md")).toBe(true);
        expect(INDEXABLE_TEXT_EXTENSIONS.has("txt")).toBe(true);
        // Binary extensions must not be included — sidebar has no meaning for them.
        expect(INDEXABLE_TEXT_EXTENSIONS.has("pdf")).toBe(false);
        expect(INDEXABLE_TEXT_EXTENSIONS.has("png")).toBe(false);
    });
});

describe("SimilarNoteCoordinator — getSimilarNotes media field mapping", () => {
    it("maps all four media fields from SimilarNote onto SimilarNoteEntry", async () => {
        // An image hit with truncated=true ensures every value is non-default and
        // distinguishable from SimilarNoteEntry defaults.
        const { SimilarNote } = await import("@/domain/model/SimilarNote");
        const imageNote = new SimilarNote(
            "Photo",           // title
            "assets/photo.png",// path
            0.8,               // similarity
            "snippet",         // similarChunk
            "source",          // sourceChunk
            [],                // additionalChunks
            [],                // headingPath
            "img:0",           // chunkId
            "image",           // mediaType
            null,              // mediaStart
            null,              // mediaEnd
            true               // truncated
        );

        const photoFile = makeTFile("assets/photo.png", "png");
        const vault = makeVault(new Map([["assets/photo.png", photoFile]]));
        const finder = makeFinder([imageNote]);

        const coordinator = new SimilarNoteCoordinator(
            vault as Vault,
            finder,
            makeSettingsService() as ReturnType<typeof makeSettingsService>
        );

        const entries = await coordinator.getSimilarNotes(photoFile);
        expect(entries).toHaveLength(1);
        expect(entries[0].mediaType).toBe("image");
        expect(entries[0].mediaStart).toBeNull();
        expect(entries[0].mediaEnd).toBeNull();
        expect(entries[0].truncated).toBe(true);
    });
});

describe("SimilarNoteCoordinator — onFileOpen extension filter", () => {
    it("triggers getSimilarNotes for a .md file", async () => {
        const finder = makeFinder();
        const mdFile = makeTFile("notes/foo.md", "md");
        const vault = makeVault(new Map([["notes/foo.md", mdFile]]));
        const coordinator = new SimilarNoteCoordinator(
            vault as Vault,
            finder,
            makeSettingsService() as ReturnType<typeof makeSettingsService>
        );

        await coordinator.onFileOpen(mdFile);
        expect(finder.findSimilarNotes).toHaveBeenCalledTimes(1);
    });

    it("triggers getSimilarNotes for a .txt file", async () => {
        const finder = makeFinder();
        const txtFile = makeTFile("notes/readme.txt", "txt");
        const vault = makeVault(new Map([["notes/readme.txt", txtFile]]));
        const coordinator = new SimilarNoteCoordinator(
            vault as Vault,
            finder,
            makeSettingsService() as ReturnType<typeof makeSettingsService>
        );

        await coordinator.onFileOpen(txtFile);
        expect(finder.findSimilarNotes).toHaveBeenCalledTimes(1);
    });

    it("does not trigger getSimilarNotes for a non-indexable extension", async () => {
        const finder = makeFinder();
        const pdfFile = makeTFile("docs/report.pdf", "pdf");
        const vault = makeVault();
        const coordinator = new SimilarNoteCoordinator(
            vault as Vault,
            finder,
            makeSettingsService() as ReturnType<typeof makeSettingsService>
        );

        await coordinator.onFileOpen(pdfFile);
        expect(finder.findSimilarNotes).not.toHaveBeenCalled();
    });

    it("does not trigger when file is null", async () => {
        const finder = makeFinder();
        const coordinator = new SimilarNoteCoordinator(
            makeVault() as Vault,
            finder,
            makeSettingsService() as ReturnType<typeof makeSettingsService>
        );

        await coordinator.onFileOpen(null);
        expect(finder.findSimilarNotes).not.toHaveBeenCalled();
    });
});
