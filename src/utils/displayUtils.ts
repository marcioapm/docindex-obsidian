import type { TFile } from "obsidian";

/**
 * Get the display text for a note based on the current settings
 */
export function getNoteDisplayText(
    file: TFile,
    title: string,
    options: { noteDisplayMode: "title" | "path" | "smart" },
    allFiles?: TFile[]
): string {
    switch (options.noteDisplayMode) {
        case "path":
            return file.path;
        case "smart":
            // Show path only when there are duplicate note names (basenames)
            if (allFiles) {
                const duplicateTitles = allFiles.filter(
                    (f) => f !== file && f.basename === file.basename
                );
                if (duplicateTitles.length > 0) {
                    return file.path.replace(/\.md$/, "");
                }
            }
            return title;
        case "title":
        default:
            return title;
    }
}

/**
 * Abbreviate a file path if it's too long
 * For now, just return the path as-is, CSS will handle truncation
 * TODO: Implement dynamic path abbreviation based on available width
 */
export function abbreviatePath(path: string, maxLength?: number): string {
    if (!maxLength) {
        return path;
    }

    if (path.length <= maxLength) {
        return path;
    }

    // Simple abbreviation: show start and end
    const startLength = Math.floor(maxLength * 0.3);
    const endLength = Math.floor(maxLength * 0.6);

    if (startLength + endLength + 3 >= maxLength) {
        return path;
    }

    return `${path.slice(0, startLength)}...${path.slice(-endLength)}`;
}

/**
 * Formats a 0..1 similarity score as a rounded percentage string, or `null`
 * when the score is absent (media hit with a rank-derived score, or a
 * legacy server that didn't supply `score_normalized`). Callers must not
 * render a percentage in that case.
 */
export function formatSimilarityPercent(similarity: number | undefined): string | null {
    if (similarity === undefined) return null;
    return `${Math.round(similarity * 100)}%`;
}
