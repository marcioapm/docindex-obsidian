import { Notice } from "obsidian";
import type { Note } from "@/domain/model/Note";
import { SimilarNote } from "@/domain/model/SimilarNote";
import { DocindexError, type DocindexClient } from "./DocindexClient";
import { getDisplayScore, isThresholdEligible, type DocindexHit } from "./types";

/**
 * Result shape for text-based semantic search.
 */
export interface TextSearchResult {
    similarNotes: SimilarNote[];
    tokenCount: number;
    maxTokens: number;
    isOverLimit: boolean;
}

/**
 * Runs a `DocindexClient` request and converts a thrown `DocindexError`
 * into an empty hit list. `DocindexClient` already shows a `Notice` for
 * every kind except `not-configured` (disabled provider, empty URL, empty
 * token) — that kind means "search is silently doing nothing" and would
 * otherwise be indistinguishable from a query with zero matches, so it
 * gets its own `Notice` here. A non-`DocindexError` (e.g. a bug thrown
 * synchronously in a caller-supplied argument) is not a transport failure
 * and is rethrown rather than swallowed.
 */
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

/**
 * Remote-only search service. All calls go through `DocindexClient` to the
 * docindex-server backend. No local embedding, no local index.
 */
export class RemoteSearchService {
    constructor(private readonly client: DocindexClient) {}

    /** Text-to-similar-notes lookup: free-text query against /search. */
    async findSimilarNotesFromText(text: string, limit = 10): Promise<TextSearchResult> {
        const hits = await runRequest(() => this.client.search(text, limit));
        return {
            similarNotes: groupHitsByPath(hits, text).slice(0, limit),
            // Remote backend handles tokenization itself; surface empty stats.
            tokenCount: 0,
            maxTokens: 0,
            isOverLimit: false,
        };
    }

    /** Stub — the remote backend does not expose a token-limit endpoint. */
    async checkTokenLimit(_text: string): Promise<{ tokenCount: number; maxTokens: number; isOverLimit: boolean }> {
        return { tokenCount: 0, maxTokens: 0, isOverLimit: false };
    }

    /** Path-to-similar-notes lookup: note-similarity query against /similar. */
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
 * The backend ranks chunks independently, so a single note can show up
 * multiple times in a single response. The sidebar is a note-list, not a
 * chunk-list — we surface the top-scoring chunk as the primary preview and
 * stash the others in `additionalChunks` so the UI can render them as
 * expandable sub-rows. Input order is preserved for top-hit priority.
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
            // Media scoreNormalized is rank-derived, not query-dependent
            // (see isThresholdEligible) — rendering it as a relevance
            // percentage would misrepresent an arbitrary vector-rank
            // position as calibrated similarity.
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
