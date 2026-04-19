import type { Note } from "@/domain/model/Note";
import { SimilarNote } from "@/domain/model/SimilarNote";
import type { DocindexClient } from "./DocindexClient";
import type { DocindexHit } from "./types";

/**
 * Result shape for text-based semantic search.
 *
 * Previously lived in `src/domain/service/TextSearchService.ts` when the plugin
 * supported a local embedding pipeline. After the strip to remote-only this is
 * the single source of truth for the shape.
 */
export interface TextSearchResult {
    similarNotes: SimilarNote[];
    tokenCount: number;
    maxTokens: number;
    isOverLimit: boolean;
}

/**
 * Remote-only search service. All calls go through `DocindexClient` to the
 * docindex-server backend. No local embedding, no local index.
 */
export class RemoteSearchService {
    constructor(private readonly client: DocindexClient) {}

    /** Text-to-similar-notes lookup. Matches the former `TextSearchService` surface. */
    async findSimilarNotesFromText(text: string, limit = 10): Promise<TextSearchResult> {
        try {
            const response = await this.client.search(text, limit);
            return {
                similarNotes: groupHitsByPath(response.hits, text).slice(0, limit),
                // Remote backend handles tokenization itself; surface empty stats.
                tokenCount: 0,
                maxTokens: 0,
                isOverLimit: false,
            };
        } catch {
            // DocindexClient already surfaced a Notice.
            return { similarNotes: [], tokenCount: 0, maxTokens: 0, isOverLimit: false };
        }
    }

    /** Stub — the remote backend does not expose a token-limit endpoint. */
    async checkTokenLimit(_text: string): Promise<{ tokenCount: number; maxTokens: number; isOverLimit: boolean }> {
        return { tokenCount: 0, maxTokens: 0, isOverLimit: false };
    }

    /** Path-to-similar-notes lookup. Matches the former `SimilarNoteFinder` surface. */
    async findSimilarNotes(note: Note, limit = 5): Promise<SimilarNote[]> {
        if (!note.path) return [];
        try {
            const response = await this.client.similar(note.path, limit);
            const filtered = response.hits.filter((h) => h.path !== note.path);
            return groupHitsByPath(filtered, note.content ?? "").slice(0, limit);
        } catch {
            return [];
        }
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
            primary.score,
            primary.snippet,
            sourceChunk,
            extras
        )
    );
}
