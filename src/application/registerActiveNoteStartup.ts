import log from "loglevel";
import type { TFile } from "obsidian";
import { sanitizeErrorForLog } from "@/utils/errorSanitizer";

interface WorkspaceLike {
    onLayoutReady(callback: () => void): void;
    getActiveFile(): TFile | null;
}

interface CoordinatorLike {
    onFileOpen(file: TFile | null): Promise<void>;
}

/** Loads the active note because `file-open` only observes later changes. */
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
