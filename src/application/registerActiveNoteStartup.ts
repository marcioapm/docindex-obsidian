import log from "loglevel";
import type { TFile } from "obsidian";
import { sanitizeErrorForLog } from "@/utils/errorSanitizer";

/**
 * Minimal structural surfaces this depends on. Satisfied by `Workspace` and
 * `SimilarNoteCoordinator` respectively.
 */
interface WorkspaceLike {
    onLayoutReady(callback: () => void): void;
    getActiveFile(): TFile | null;
}

interface CoordinatorLike {
    onFileOpen(file: TFile | null): Promise<void>;
}

/**
 * `file-open` only fires for future switches — a note already active when
 * the plugin loads (e.g. on Obsidian restart) would otherwise leave the
 * sidebar/bottom view empty until the user changes files. Kept in its own
 * module (rather than inline in `main.ts`) so it can be unit-tested without
 * pulling in `MainPlugin`'s full import graph.
 */
export function registerActiveNoteStartup(
    workspace: WorkspaceLike,
    coordinator: CoordinatorLike
): void {
    workspace.onLayoutReady(() => {
        coordinator.onFileOpen(workspace.getActiveFile()).catch((err: unknown) => {
            log.error(`docindex: failed to load similar notes for the active file: ${sanitizeErrorForLog(err)}`);
        });
    });
}
