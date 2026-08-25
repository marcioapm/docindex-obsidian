import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteSearchService } from "../RemoteSearchService";
import { DocindexError, type DocindexClient } from "../DocindexClient";
import type { DocindexHit, DocindexSearchResponse } from "../types";
import { Note } from "@/domain/model/Note";

const noticeMessages: string[] = [];
vi.mock("obsidian", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("obsidian");
    return {
        ...actual,
        Notice: class {
            constructor(msg: string) {
                noticeMessages.push(msg);
            }
        },
    };
});

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

function mockRejectingClient(err: unknown): DocindexClient {
    return {
        search: vi.fn().mockRejectedValue(err),
        similar: vi.fn().mockRejectedValue(err),
    } as unknown as DocindexClient;
}

beforeEach(() => {
    noticeMessages.length = 0;
});

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

describe("RemoteSearchService — error handling", () => {
    it("surfaces a Notice for a not-configured DocindexError and returns empty results", async () => {
        const svc = new RemoteSearchService(
            mockRejectingClient(new DocindexError("not-configured", "docindex is disabled"))
        );
        const res = await svc.findSimilarNotesFromText("query");
        expect(res.similarNotes).toEqual([]);
        expect(noticeMessages.some((m) => m.includes("disabled or not configured"))).toBe(true);
    });

    it("does not duplicate a Notice for a network/server/auth/malformed DocindexError (already surfaced by DocindexClient)", async () => {
        for (const kind of ["network", "server", "unauthorized", "malformed"] as const) {
            noticeMessages.length = 0;
            const svc = new RemoteSearchService(
                mockRejectingClient(new DocindexError(kind, `${kind} failure`))
            );
            const res = await svc.findSimilarNotesFromText("query");
            expect(res.similarNotes).toEqual([]);
            expect(noticeMessages).toEqual([]);
        }
    });

    it("rethrows a non-DocindexError instead of swallowing it as an empty result", async () => {
        const svc = new RemoteSearchService(mockRejectingClient(new TypeError("bug in grouping")));
        await expect(svc.findSimilarNotesFromText("query")).rejects.toThrow("bug in grouping");
    });

    it("findSimilarNotes surfaces a not-configured Notice and returns []", async () => {
        const svc = new RemoteSearchService(
            mockRejectingClient(new DocindexError("not-configured", "docindex is disabled"))
        );
        const note = new Note("source.md", "source", "content", []);
        const result = await svc.findSimilarNotes(note);
        expect(result).toEqual([]);
        expect(noticeMessages.some((m) => m.includes("disabled or not configured"))).toBe(true);
    });
});
