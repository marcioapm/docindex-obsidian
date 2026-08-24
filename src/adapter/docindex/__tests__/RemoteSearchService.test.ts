import { describe, expect, it, vi } from "vitest";
import { RemoteSearchService } from "../RemoteSearchService";
import type { DocindexClient } from "../DocindexClient";
import type { DocindexHit, DocindexSearchResponse } from "../types";
import { Note } from "@/domain/model/Note";

function hit(overrides: Partial<DocindexHit> = {}): DocindexHit {
    return {
        path: "a.md",
        title: "A",
        headingPath: [],
        snippet: "snippet",
        score: 0.03,
        scoreNormalized: 0.87,
        chunkId: "c1",
        mediaType: "text",
        ...overrides,
    };
}

function mockClient(response: DocindexSearchResponse): DocindexClient {
    return {
        search: vi.fn().mockResolvedValue(response),
        similar: vi.fn().mockResolvedValue(response),
    } as unknown as DocindexClient;
}

describe("RemoteSearchService", () => {
    it("maps score_normalized into SimilarNote.similarity", async () => {
        const svc = new RemoteSearchService(mockClient({ hits: [hit()] }));
        const res = await svc.findSimilarNotesFromText("query");
        expect(res.similarNotes[0].similarity).toBe(0.87);
    });

    it("falls back to raw score when score_normalized is missing", async () => {
        const svc = new RemoteSearchService(
            mockClient({ hits: [hit({ scoreNormalized: undefined, score: 0.42 })] })
        );
        const res = await svc.findSimilarNotesFromText("query");
        expect(res.similarNotes[0].similarity).toBe(0.42);
    });

    it("findSimilarNotes also carries score_normalized forward", async () => {
        const svc = new RemoteSearchService(
            mockClient({ hits: [hit({ path: "other.md", scoreNormalized: 0.6 })] })
        );
        const note = new Note("source.md", "source", "content", []);
        const [primary] = await svc.findSimilarNotes(note);
        expect(primary.similarity).toBe(0.6);
    });
});
