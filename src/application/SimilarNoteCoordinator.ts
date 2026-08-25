import type {
    NoteBottomViewModel,
    SimilarNoteEntry,
} from "@/components/NoteBottomViewReact";
import { Note } from "@/domain/model/Note";
import type { SimilarNote } from "@/domain/model/SimilarNote";
import log from "loglevel";
import type { TFile, Vault } from "obsidian";
import { BehaviorSubject } from "rxjs";
import type { SettingsService, SimilarNotesSettings } from "./SettingsService";

interface SimilarNoteFinderLike {
    findSimilarNotes(note: Note, limit?: number): Promise<SimilarNote[]>;
}

interface SimilarNoteCacheEntry {
    mtime: number;
    settingsGeneration: number;
    notes: SimilarNoteEntry[];
}

const MAX_CACHE_SIZE = 20;

/**
 * Extensions indexed by docindex-server as text chunks. The sidebar attaches
 * to a Markdown editor leaf, so only text formats belong here — binary files
 * (images, PDFs) are searchable via the semantic modal but have no sidebar
 * representation.
 */
export const INDEXABLE_TEXT_EXTENSIONS = new Set(["md", "txt"]);

const RETRIEVAL_AFFECTING_KEYS: ReadonlySet<keyof SimilarNotesSettings> = new Set([
    "docindex",
    "showSourceChunk",
    "sidebarResultCount",
    "bottomResultCount",
]);

/**
 * Drives the sidebar view-model.
 *
 * Reads the active note's content via `vault.cachedRead`, asks the injected
 * similar-notes provider (a `RemoteSearchService` in the remote-only build)
 * for hits, and emits the resulting view-model on every file-open.
 *
 * No embedding, no chunking, no indexing here — all that lives on the
 * docindex-server backend.
 */
export class SimilarNoteCoordinator {
    private noteBottomViewModel$ = new BehaviorSubject<NoteBottomViewModel>({
        currentFile: null,
        similarNoteEntries: [],
        noteDisplayMode: "title",
        sidebarResultCount: 10,
        bottomResultCount: 5,
    });
    private cache = new Map<string, SimilarNoteCacheEntry>();
    // Identifies the settings generation used to fetch each cache entry.
    private settingsGeneration = 0;

    constructor(
        private readonly vault: Vault,
        private readonly similarNoteFinder: SimilarNoteFinderLike,
        private readonly settingsService: SettingsService
    ) {
        const settings = this.settingsService.get();
        this.noteBottomViewModel$.next({
            ...this.noteBottomViewModel$.value,
            noteDisplayMode: settings.noteDisplayMode,
            sidebarResultCount: settings.sidebarResultCount,
            bottomResultCount: settings.bottomResultCount,
        });

        this.settingsService
            .getNewSettingsObservable()
            .subscribe((changed) => {
                if (Object.keys(changed).some((key) =>
                    RETRIEVAL_AFFECTING_KEYS.has(key as keyof SimilarNotesSettings)
                )) {
                    this.settingsGeneration++;
                }

                const s = this.settingsService.get();
                this.noteBottomViewModel$.next({
                    ...this.noteBottomViewModel$.value,
                    noteDisplayMode: s.noteDisplayMode,
                    sidebarResultCount: s.sidebarResultCount,
                    bottomResultCount: s.bottomResultCount,
                });
            });
    }

    getNoteBottomViewModelObservable() {
        return this.noteBottomViewModel$.asObservable();
    }

    onFileOpen(file: TFile | null): Promise<void> {
        if (!file || !INDEXABLE_TEXT_EXTENSIONS.has(file.extension)) {
            return Promise.resolve();
        }
        return this.emitNoteBottomViewModel(file);
    }

    emitNoteBottomViewModelFromPath(path: string): Promise<void> {
        const file = this.vault.getFileByPath(path);
        if (!file) return Promise.resolve();
        return this.emitNoteBottomViewModel(file);
    }

    async emitNoteBottomViewModel(file: TFile): Promise<void> {
        const similarNotes = await this.getSimilarNotes(file);
        const settings = this.settingsService.get();
        this.noteBottomViewModel$.next({
            currentFile: file,
            similarNoteEntries: similarNotes,
            noteDisplayMode: settings.noteDisplayMode,
            sidebarResultCount: settings.sidebarResultCount,
            bottomResultCount: settings.bottomResultCount,
        });
    }

    async getSimilarNotes(file: TFile): Promise<SimilarNoteEntry[]> {
        const cacheEntry = this.cache.get(file.path);
        if (
            cacheEntry &&
            cacheEntry.mtime === file.stat.mtime &&
            cacheEntry.settingsGeneration === this.settingsGeneration
        ) {
            return cacheEntry.notes;
        }

        // Capture before I/O so old-settings responses cannot enter the current cache.
        const requestGeneration = this.settingsGeneration;
        const settings = this.settingsService.get();
        const content = await this.vault.cachedRead(file);
        const note = new Note(file.path, file.basename, content, []);
        const maxResultCount = Math.max(
            settings.sidebarResultCount,
            settings.bottomResultCount
        );
        const similarNotes = await this.similarNoteFinder.findSimilarNotes(
            note,
            maxResultCount
        );

        if (requestGeneration !== this.settingsGeneration) {
            return this.getSimilarNotes(file);
        }

        const showSourceChunk = settings.showSourceChunk;
        const similarNoteEntries = similarNotes
            .map((similarNote) => ({
                file: this.vault.getFileByPath(similarNote.path),
                title: similarNote.title,
                similarity: similarNote.similarity,
                preview: similarNote.similarChunk,
                sourceChunk: showSourceChunk ? similarNote.sourceChunk : undefined,
                additionalChunks: similarNote.additionalChunks,
                headingPath: similarNote.headingPath,
                path: similarNote.path,
                mediaType: similarNote.mediaType,
                mediaStart: similarNote.mediaStart,
                mediaEnd: similarNote.mediaEnd,
                truncated: similarNote.truncated,
            }))
            .filter((vm) => {
                if (vm.file === null) {
                    log.error(
                        `Stale data: similar note not found in vault (path: ${vm.path}). ` +
                            `The file may have been renamed/moved since the remote index was last built.`
                    );
                    return false;
                }
                return true;
            })
            .map(({ path: _path, ...rest }) => rest) as SimilarNoteEntry[];

        this.cache.set(file.path, {
            mtime: file.stat.mtime,
            settingsGeneration: requestGeneration,
            notes: similarNoteEntries,
        });
        if (this.cache.size > MAX_CACHE_SIZE) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }

        return similarNoteEntries;
    }
}
