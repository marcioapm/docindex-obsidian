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

/** SettingsService stub. Returns a mutable settings object; `push` updates it and emits on the observable, mirroring SettingsService.update. */
function makeSettingsService(overrides: Record<string, unknown> = {}) {
    const subject = new Subject<Record<string, unknown>>();
    let settings: Record<string, unknown> = {
        noteDisplayMode: "title",
        sidebarResultCount: 10,
        bottomResultCount: 5,
        showSourceChunk: false,
        ...overrides,
    };
    return {
        get: vi.fn(() => settings),
        getNewSettingsObservable: vi.fn().mockReturnValue(subject.asObservable()),
        push: (partial: Record<string, unknown>) => {
            settings = { ...settings, ...partial };
            subject.next(partial);
        },
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
        // A pdf hit with a non-null page range and truncated=true ensures every
        // field is independently load-bearing: null-defaulting mediaStart/
        // mediaEnd in the mapping (e.g. `mediaStart: null` instead of
        // `similarNote.mediaStart`) would pass with null inputs but fails here.
        const { SimilarNote } = await import("@/domain/model/SimilarNote");
        const pdfNote = new SimilarNote(
            "Scan",            // title
            "assets/scan.pdf", // path
            0.8,               // similarity
            "snippet",         // similarChunk
            "source",          // sourceChunk
            [],                // additionalChunks
            [],                // headingPath
            "pdf:0",           // chunkId
            "pdf",             // mediaType
            2,                 // mediaStart
            5,                 // mediaEnd
            true               // truncated
        );

        const pdfFile = makeTFile("assets/scan.pdf", "pdf");
        const vault = makeVault(new Map([["assets/scan.pdf", pdfFile]]));
        const finder = makeFinder([pdfNote]);

        const coordinator = new SimilarNoteCoordinator(
            vault as Vault,
            finder,
            makeSettingsService() as ReturnType<typeof makeSettingsService>
        );

        const entries = await coordinator.getSimilarNotes(pdfFile);
        expect(entries).toHaveLength(1);
        expect(entries[0].mediaType).toBe("pdf");
        expect(entries[0].mediaStart).toBe(2);
        expect(entries[0].mediaEnd).toBe(5);
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

describe("SimilarNoteCoordinator — cache invalidation on settings change", () => {
    it("serves a cached entry unchanged when mtime and settings are both unchanged", async () => {
        const finder = makeFinder([]);
        const mdFile = makeTFile("notes/foo.md", "md");
        const vault = makeVault(new Map([["notes/foo.md", mdFile]]));
        const coordinator = new SimilarNoteCoordinator(
            vault as Vault,
            finder,
            makeSettingsService() as ReturnType<typeof makeSettingsService>
        );

        await coordinator.getSimilarNotes(mdFile);
        await coordinator.getSimilarNotes(mdFile);
        expect(finder.findSimilarNotes).toHaveBeenCalledTimes(1);
    });

    it("re-fetches after a showSourceChunk change even though mtime is unchanged", async () => {
        const finder = makeFinder([]);
        const mdFile = makeTFile("notes/foo.md", "md");
        const vault = makeVault(new Map([["notes/foo.md", mdFile]]));
        const settingsService = makeSettingsService({ showSourceChunk: false });
        const coordinator = new SimilarNoteCoordinator(
            vault as Vault,
            finder,
            settingsService as ReturnType<typeof makeSettingsService>
        );

        await coordinator.getSimilarNotes(mdFile);
        settingsService.push({ showSourceChunk: true });
        await coordinator.getSimilarNotes(mdFile);

        expect(finder.findSimilarNotes).toHaveBeenCalledTimes(2);
    });

    it("re-fetches after a docindex config change even though mtime is unchanged", async () => {
        const finder = makeFinder([]);
        const mdFile = makeTFile("notes/foo.md", "md");
        const vault = makeVault(new Map([["notes/foo.md", mdFile]]));
        const settingsService = makeSettingsService({ docindex: { backendUrl: "http://a" } });
        const coordinator = new SimilarNoteCoordinator(
            vault as Vault,
            finder,
            settingsService as ReturnType<typeof makeSettingsService>
        );

        await coordinator.getSimilarNotes(mdFile);
        settingsService.push({ docindex: { backendUrl: "http://b" } });
        await coordinator.getSimilarNotes(mdFile);

        expect(finder.findSimilarNotes).toHaveBeenCalledTimes(2);
    });

    it("still re-fetches on a sidebarResultCount/bottomResultCount change (regression guard)", async () => {
        const finder = makeFinder([]);
        const mdFile = makeTFile("notes/foo.md", "md");
        const vault = makeVault(new Map([["notes/foo.md", mdFile]]));
        const settingsService = makeSettingsService();
        const coordinator = new SimilarNoteCoordinator(
            vault as Vault,
            finder,
            settingsService as ReturnType<typeof makeSettingsService>
        );

        await coordinator.getSimilarNotes(mdFile);
        settingsService.push({ sidebarResultCount: 20 });
        await coordinator.getSimilarNotes(mdFile);

        expect(finder.findSimilarNotes).toHaveBeenCalledTimes(2);
    });

    it("does not invalidate the cache on a semanticLinkTrigger-only change", async () => {
        const finder = makeFinder([]);
        const mdFile = makeTFile("notes/foo.md", "md");
        const vault = makeVault(new Map([["notes/foo.md", mdFile]]));
        const settingsService = makeSettingsService({ semanticLinkTrigger: ";;" });
        const coordinator = new SimilarNoteCoordinator(
            vault as Vault,
            finder,
            settingsService as ReturnType<typeof makeSettingsService>
        );

        await coordinator.getSimilarNotes(mdFile);
        settingsService.push({ semanticLinkTrigger: "::" });
        await coordinator.getSimilarNotes(mdFile);

        expect(finder.findSimilarNotes).toHaveBeenCalledTimes(1);
    });

    it("does not invalidate the cache on a noteDisplayMode-only change", async () => {
        const finder = makeFinder([]);
        const mdFile = makeTFile("notes/foo.md", "md");
        const vault = makeVault(new Map([["notes/foo.md", mdFile]]));
        const settingsService = makeSettingsService();
        const coordinator = new SimilarNoteCoordinator(
            vault as Vault,
            finder,
            settingsService as ReturnType<typeof makeSettingsService>
        );

        await coordinator.getSimilarNotes(mdFile);
        settingsService.push({ noteDisplayMode: "path" });
        await coordinator.getSimilarNotes(mdFile);

        expect(finder.findSimilarNotes).toHaveBeenCalledTimes(1);
    });

    it("discards and restarts a request whose settings changed before it resolved, without caching or emitting the stale response", async () => {
        let resolveFirst!: (notes: SimilarNote[]) => void;
        const findSimilarNotes = vi
            .fn()
            .mockImplementationOnce(
                () => new Promise<SimilarNote[]>((resolve) => { resolveFirst = resolve; })
            )
            .mockResolvedValueOnce([]);
        const finder = { findSimilarNotes };
        const mdFile = makeTFile("notes/foo.md", "md");
        const vault = makeVault(new Map([["notes/foo.md", mdFile]]));
        const settingsService = makeSettingsService({ sidebarResultCount: 10 });
        const coordinator = new SimilarNoteCoordinator(
            vault as Vault,
            finder,
            settingsService as ReturnType<typeof makeSettingsService>
        );

        // Start a request; settings change while it is in flight (before the
        // deferred findSimilarNotes call resolves). vault.cachedRead awaits
        // a microtask first, so flush that before findSimilarNotes is invoked.
        const pending = coordinator.getSimilarNotes(mdFile);
        await Promise.resolve();
        await Promise.resolve();
        settingsService.push({ sidebarResultCount: 25 });
        resolveFirst([]);
        await pending;

        // The old request must have restarted under the new generation —
        // findSimilarNotes called a second time — rather than caching or
        // returning the stale-generation response directly.
        expect(findSimilarNotes).toHaveBeenCalledTimes(2);

        // A subsequent call must be served from cache (no third call),
        // proving the entry was stamped with the CURRENT generation, not
        // an earlier one that would force another fetch.
        await coordinator.getSimilarNotes(mdFile);
        expect(findSimilarNotes).toHaveBeenCalledTimes(2);
    });
});

describe("SimilarNoteCoordinator — onFileOpen/emitNoteBottomViewModelFromPath return the emission promise", () => {
    it("onFileOpen stays pending until search and emission complete", async () => {
        let resolveSearch!: (notes: SimilarNote[]) => void;
        const finder = {
            findSimilarNotes: vi.fn(
                () => new Promise<SimilarNote[]>((resolve) => { resolveSearch = resolve; })
            ),
        };
        const mdFile = makeTFile("notes/foo.md", "md");
        const vault = makeVault(new Map([["notes/foo.md", mdFile]]));
        const coordinator = new SimilarNoteCoordinator(
            vault as Vault,
            finder,
            makeSettingsService() as ReturnType<typeof makeSettingsService>
        );

        let settled = false;
        const promise = coordinator.onFileOpen(mdFile).then(() => {
            settled = true;
        });

        // Two microtask flushes without resolving the search — must still be pending.
        await Promise.resolve();
        await Promise.resolve();
        expect(settled).toBe(false);

        resolveSearch([]);
        await promise;
        expect(settled).toBe(true);
    });

    it("emitNoteBottomViewModelFromPath stays pending until search and emission complete", async () => {
        let resolveSearch!: (notes: SimilarNote[]) => void;
        const finder = {
            findSimilarNotes: vi.fn(
                () => new Promise<SimilarNote[]>((resolve) => { resolveSearch = resolve; })
            ),
        };
        const mdFile = makeTFile("notes/foo.md", "md");
        const vault = makeVault(new Map([["notes/foo.md", mdFile]]));
        const coordinator = new SimilarNoteCoordinator(
            vault as Vault,
            finder,
            makeSettingsService() as ReturnType<typeof makeSettingsService>
        );

        let settled = false;
        const promise = coordinator
            .emitNoteBottomViewModelFromPath("notes/foo.md")
            .then(() => {
                settled = true;
            });

        await Promise.resolve();
        await Promise.resolve();
        expect(settled).toBe(false);

        resolveSearch([]);
        await promise;
        expect(settled).toBe(true);
    });

    it("a rejection from findSimilarNotes propagates to the awaited onFileOpen call", async () => {
        const finder = {
            findSimilarNotes: vi.fn().mockRejectedValue(new Error("boom")),
        };
        const mdFile = makeTFile("notes/foo.md", "md");
        const vault = makeVault(new Map([["notes/foo.md", mdFile]]));
        const coordinator = new SimilarNoteCoordinator(
            vault as Vault,
            finder,
            makeSettingsService() as ReturnType<typeof makeSettingsService>
        );

        await expect(coordinator.onFileOpen(mdFile)).rejects.toThrow("boom");
    });
});
