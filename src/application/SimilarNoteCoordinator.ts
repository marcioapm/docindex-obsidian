import type {
    NoteBottomViewModel,
    SimilarNoteEntry,
} from "@/components/NoteBottomViewReact";
import { Note } from "@/domain/model/Note";
import type { SimilarNote } from "@/domain/model/SimilarNote";
import log from "loglevel";
import type { TFile, Vault } from "obsidian";
import { BehaviorSubject } from "rxjs";
import type { SettingsService } from "./SettingsService";

/**
 * Minimal surface SimilarNoteCoordinator depends on. Structural interface so
 * any remote or local similar-note provider can be injected.
 */
interface SimilarNoteFinderLike {
    findSimilarNotes(note: Note, limit?: number): Promise<SimilarNote[]>;
}

interface SimilarNoteCacheEntry {
    mtime: number;
    notes: SimilarNoteEntry[];
}

const MAX_CACHE_SIZE = 20;

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
            .subscribe((newSettings) => {
                if (
                    newSettings.sidebarResultCount !== undefined ||
                    newSettings.bottomResultCount !== undefined
                ) {
                    this.cache.clear();
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

    async onFileOpen(file: TFile | null) {
        if (!file || file.extension !== "md") return;
        this.emitNoteBottomViewModel(file);
    }

    async emitNoteBottomViewModelFromPath(path: string) {
        const file = this.vault.getFileByPath(path);
        if (!file) return;
        this.emitNoteBottomViewModel(file);
    }

    async emitNoteBottomViewModel(file: TFile) {
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
        if (cacheEntry && cacheEntry.mtime === file.stat.mtime) {
            return cacheEntry.notes;
        }

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
            notes: similarNoteEntries,
        });
        if (this.cache.size > MAX_CACHE_SIZE) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }

        return similarNoteEntries;
    }
}
