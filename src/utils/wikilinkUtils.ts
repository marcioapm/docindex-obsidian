import type { App } from "obsidian";
import { TFile } from "obsidian";

/**
 * Resolve a vault-relative path to a `[[linktext]]` string using Obsidian's
 * configured link format, relative to `sourcePath`. Returns null when the path
 * does not resolve to a TFile (folder, missing, etc.).
 */
export function resolveWikilink(
    app: App,
    notePath: string,
    sourcePath: string
): string | null {
    const file = app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return null;
    const linktext = app.metadataCache.fileToLinktext(file, sourcePath);
    return `[[${linktext}]]`;
}
