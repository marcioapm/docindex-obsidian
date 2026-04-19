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
                similarNotes: response.hits.slice(0, limit).map((h) => hitToSimilarNote(h, text)),
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
            return response.hits
                .filter((h) => h.path !== note.path)
                .slice(0, limit)
                .map((h) => hitToSimilarNote(h, note.content ?? ""));
        } catch {
            return [];
        }
    }
}

function hitToSimilarNote(hit: DocindexHit, sourceChunk: string): SimilarNote {
    return new SimilarNote(hit.title || hit.path, hit.path, hit.score, hit.snippet, sourceChunk);
}
