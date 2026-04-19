import type { Note } from "@/domain/model/Note";
import { SimilarNote } from "@/domain/model/SimilarNote";
import type { TextSearchResult } from "@/domain/service/TextSearchService";
import type { DocindexClient } from "./DocindexClient";
import type { DocindexHit } from "./types";

/**
 * Remote replacement for `TextSearchService` + `SimilarNoteFinder` when the
 * docindex provider is enabled.
 *
 * We match the public signatures of both upstream services structurally so
 * callers (the semantic-search modal, similar-note coordinator) can swap us
 * in without knowing which provider is active.
 */
export class RemoteSearchService {
    constructor(private readonly client: DocindexClient) {}

    /** Mirrors `TextSearchService.findSimilarNotesFromText`. */
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

    /** Matches the signature of `TextSearchService.checkTokenLimit`. */
    async checkTokenLimit(_text: string): Promise<{ tokenCount: number; maxTokens: number; isOverLimit: boolean }> {
        return { tokenCount: 0, maxTokens: 0, isOverLimit: false };
    }

    /** Mirrors `SimilarNoteFinder.findSimilarNotes`. */
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
