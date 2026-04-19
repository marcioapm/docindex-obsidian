import type { Note } from "@/domain/model/Note";
import type { SimilarNote } from "@/domain/model/SimilarNote";
import type { SimilarNoteFinder } from "@/domain/service/SimilarNoteFinder";
import type { TextSearchResult, TextSearchService } from "@/domain/service/TextSearchService";
import type { RemoteSearchService } from "./RemoteSearchService";
import type { DocindexClient } from "./DocindexClient";

/**
 * Routes search + similar-notes calls to either the upstream local services
 * or the remote docindex provider, depending on settings at call time.
 *
 * Structurally compatible with `TextSearchService` (so it can be passed to the
 * semantic-search modal) and with `SimilarNoteFinder` (so it can be passed to
 * `SimilarNoteCoordinator`).
 */
export class SearchDispatcher {
    constructor(
        private readonly local: {
            text: TextSearchService;
            similar: SimilarNoteFinder;
        },
        private readonly remote: RemoteSearchService,
        private readonly client: DocindexClient
    ) {}

    // TextSearchService-compatible surface
    findSimilarNotesFromText(text: string, limit?: number): Promise<TextSearchResult> {
        if (this.client.isAvailable()) {
            return this.remote.findSimilarNotesFromText(text, limit);
        }
        return this.local.text.findSimilarNotesFromText(text, limit);
    }

    checkTokenLimit(text: string): Promise<{ tokenCount: number; maxTokens: number; isOverLimit: boolean }> {
        if (this.client.isAvailable()) {
            return this.remote.checkTokenLimit(text);
        }
        return this.local.text.checkTokenLimit(text);
    }

    // SimilarNoteFinder-compatible surface
    findSimilarNotes(note: Note, limit?: number): Promise<SimilarNote[]> {
        if (this.client.isAvailable()) {
            return this.remote.findSimilarNotes(note, limit);
        }
        return this.local.similar.findSimilarNotes(note, limit);
    }
}
