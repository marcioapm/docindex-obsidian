import { Notice } from "obsidian";
import type { Note } from "@/domain/model/Note";
import { SimilarNote } from "@/domain/model/SimilarNote";
import { DocindexError, type DocindexClient } from "./DocindexClient";
import { getDisplayScore, isThresholdEligible, type DocindexHit } from "./types";

export interface TextSearchResult {
    similarNotes: SimilarNote[];
    tokenCount: number;
    maxTokens: number;
    isOverLimit: boolean;
}

/** Converts expected client failures to empty results without hiding programming errors. */
async function runRequest(request: () => Promise<{ hits: DocindexHit[] }>): Promise<DocindexHit[]> {
    try {
        const response = await request();
        return response.hits;
    } catch (err) {
        if (err instanceof DocindexError) {
            if (err.kind === "not-configured") {
                new Notice("docindex: search is disabled or not configured (see settings)");
            }
            return [];
        }
        throw err;
    }
}

export class RemoteSearchService {
    constructor(private readonly client: DocindexClient) {}

    async findSimilarNotesFromText(text: string, limit = 10): Promise<TextSearchResult> {
        const hits = await runRequest(() => this.client.search(text, limit));
        return {
            similarNotes: groupHitsByPath(hits, text).slice(0, limit),
            tokenCount: 0,
            maxTokens: 0,
            isOverLimit: false,
        };
    }

    async checkTokenLimit(_text: string): Promise<{ tokenCount: number; maxTokens: number; isOverLimit: boolean }> {
        return { tokenCount: 0, maxTokens: 0, isOverLimit: false };
    }

    async findSimilarNotes(note: Note, limit = 5): Promise<SimilarNote[]> {
        if (!note.path) return [];
        const hits = await runRequest(() => this.client.similar(note.path, limit));
        const filtered = hits.filter((h) => h.path !== note.path);
        return groupHitsByPath(filtered, note.content ?? "").slice(0, limit);
    }
}

/**
 * Collapses per-chunk hits into one entry per path.
 *
 * Keeps the first chunk for each path as primary and collects distinct later
 * snippets for the expanded view.
 */
function groupHitsByPath(hits: DocindexHit[], sourceChunk: string): SimilarNote[] {
    const byPath = new Map<string, { primary: DocindexHit; extras: string[] }>();
    for (const hit of hits) {
        const existing = byPath.get(hit.path);
        if (existing === undefined) {
            byPath.set(hit.path, { primary: hit, extras: [] });
        } else if (hit.snippet && hit.snippet !== existing.primary.snippet) {
            existing.extras.push(hit.snippet);
        }
    }
    return Array.from(byPath.values()).map(({ primary, extras }) =>
        new SimilarNote(
            primary.title || primary.path,
            primary.path,
            isThresholdEligible(primary) ? getDisplayScore(primary) : undefined,
            primary.snippet,
            sourceChunk,
            extras,
            primary.headingPath,
            primary.chunkId,
            primary.mediaType,
            primary.mediaStart ?? null,
            primary.mediaEnd ?? null,
            primary.truncated ?? false
        )
    );
}
