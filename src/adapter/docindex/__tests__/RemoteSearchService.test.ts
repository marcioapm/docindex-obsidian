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

    it("leaves similarity undefined when score_normalized is missing (legacy server)", async () => {
        const svc = new RemoteSearchService(
            mockClient({ hits: [hit({ scoreNormalized: undefined, score: 0.42 })] })
        );
        const res = await svc.findSimilarNotesFromText("query");
        expect(res.similarNotes[0].similarity).toBeUndefined();
    });

    it("findSimilarNotes also carries score_normalized forward", async () => {
        const svc = new RemoteSearchService(
            mockClient({ hits: [hit({ path: "other.md", scoreNormalized: 0.6 })] })
        );
        const note = new Note("source.md", "source", "content", []);
        const [primary] = await svc.findSimilarNotes(note);
        expect(primary.similarity).toBe(0.6);
    });

    it("groupHitsByPath propagates all four media fields onto SimilarNote", async () => {
        // Non-default pdf values ensure each field is independently load-bearing.
        const svc = new RemoteSearchService(
            mockClient({
                hits: [
                    hit({
                        path: "scan.pdf",
                        mediaType: "pdf",
                        mediaStart: 2,
                        mediaEnd: 5,
                        truncated: true,
                    }),
                ],
            })
        );
        const note = new Note("source.md", "source", "content", []);
        const [result] = await svc.findSimilarNotes(note);
        expect(result.mediaType).toBe("pdf");
        expect(result.mediaStart).toBe(2);
        expect(result.mediaEnd).toBe(5);
        expect(result.truncated).toBe(true);
    });
});
