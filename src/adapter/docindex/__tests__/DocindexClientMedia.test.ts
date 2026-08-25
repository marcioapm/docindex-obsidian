/**
 * toDomainHit media field mapping and isHitWire media field validation.
 * Kept separate to stay within the 400-line ESLint limit for DocindexClient.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocindexClient } from "../DocindexClient";
import type { DocindexSettings } from "../types";

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

function makeClient(overrides: Partial<DocindexSettings> = {}, requestFn?: ReturnType<typeof vi.fn>) {
    const settings: DocindexSettings = {
        enabled: true,
        backendUrl: "http://100.0.0.1:7777",
        bearerToken: "test-token",
        limit: 10,
        relevanceThreshold: 0,
        ...overrides,
    };
    const fn = requestFn ?? vi.fn();
    const client = new DocindexClient(() => settings, fn);
    return { client, requestFn: fn };
}

/** Minimal valid wire hit. Extra fields are merged on top. */
function makeHitJson(extra: Record<string, unknown> = {}) {
    return { path: "n.md", title: "N", heading_path: [], snippet: "s", score: 0.5, chunk_id: "c", ...extra };
}

function makeResponse(extra: Record<string, unknown> = {}) {
    return vi.fn().mockResolvedValue({
        status: 200,
        headers: {},
        json: { hits: [makeHitJson(extra)] },
    });
}

beforeEach(() => {
    noticeMessages.length = 0;
});

describe("DocindexClient — toDomainHit media field mapping", () => {
    it("maps all six media fields from a new-server hit", async () => {
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    makeHitJson({
                        media_type: "pdf",
                        mime_type: "application/pdf",
                        media_start: 1,
                        media_end: 4,
                        media_unit: "page",
                        truncated: false,
                    }),
                ],
            },
        });
        const { client } = makeClient({}, requestFn);
        const res = await client.search("q");
        const h = res.hits[0];
        expect(h.mediaType).toBe("pdf");
        expect(h.mimeType).toBe("application/pdf");
        expect(h.mediaStart).toBe(1);
        expect(h.mediaEnd).toBe(4);
        expect(h.mediaUnit).toBe("page");
        expect(h.truncated).toBe(false);
    });

    it("defaults mediaType to 'text' when media_type is absent (old server)", async () => {
        const { client } = makeClient({}, makeResponse());
        const res = await client.search("q");
        expect(res.hits[0].mediaType).toBe("text");
    });

    it("maps a truncated image hit", async () => {
        const { client } = makeClient(
            {},
            makeResponse({
                media_type: "image",
                mime_type: "image/gif",
                media_start: null,
                media_end: null,
                media_unit: null,
                truncated: true,
            })
        );
        const res = await client.search("q");
        const h = res.hits[0];
        expect(h.mediaType).toBe("image");
        expect(h.truncated).toBe(true);
        expect(h.mediaStart).toBeNull();
        expect(h.mediaEnd).toBeNull();
        expect(h.mimeType).toBe("image/gif");
        expect(h.mediaUnit).toBeNull();
    });
});

describe("DocindexClient — isHitWire media field validation", () => {
    it("accepts a payload with none of the new fields (old server)", async () => {
        const { client } = makeClient({}, makeResponse());
        const res = await client.search("q");
        expect(res.hits).toHaveLength(1);
    });

    it("rejects a hit where a present media_type has the wrong type", async () => {
        const { client } = makeClient({}, makeResponse({ media_type: 42 }));
        await expect(client.search("q")).rejects.toMatchObject({ kind: "malformed" });
    });

    it("rejects a hit where truncated is present but not a boolean", async () => {
        const { client } = makeClient({}, makeResponse({ truncated: "yes" }));
        await expect(client.search("q")).rejects.toMatchObject({ kind: "malformed" });
    });

    it("rejects a hit where mime_type is present but not a string or null", async () => {
        const { client } = makeClient({}, makeResponse({ mime_type: 42 }));
        await expect(client.search("q")).rejects.toMatchObject({ kind: "malformed" });
    });

    it("rejects a hit where media_start is present but not a number or null", async () => {
        const { client } = makeClient({}, makeResponse({ media_start: "first" }));
        await expect(client.search("q")).rejects.toMatchObject({ kind: "malformed" });
    });

    it("rejects a hit where media_end is present but not a number or null", async () => {
        const { client } = makeClient({}, makeResponse({ media_end: true }));
        await expect(client.search("q")).rejects.toMatchObject({ kind: "malformed" });
    });

    it("rejects a hit where media_unit is present but not a string or null", async () => {
        // media_unit: 42 — a plausible server bug (numeric enum instead of string).
        const { client } = makeClient({}, makeResponse({ media_unit: 42 }));
        await expect(client.search("q")).rejects.toMatchObject({ kind: "malformed" });
    });
});

describe("DocindexClient — audio/video and unrecognized media_type", () => {
    it("maps an audio hit to mediaType 'audio' without discarding other hits in the response", async () => {
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    makeHitJson({ path: "song.mp3", media_type: "audio" }),
                    makeHitJson({ path: "note.md" }),
                ],
            },
        });
        const { client } = makeClient({}, requestFn);
        const res = await client.search("q");
        expect(res.hits).toHaveLength(2);
        expect(res.hits[0].mediaType).toBe("audio");
        expect(res.hits[1].mediaType).toBe("text");
    });

    it("maps a video hit to mediaType 'video'", async () => {
        const { client } = makeClient({}, makeResponse({ media_type: "video" }));
        const res = await client.search("q");
        expect(res.hits[0].mediaType).toBe("video");
    });

    it("degrades a structurally valid but unrecognized media_type string to 'other' instead of rejecting the response", async () => {
        const { client } = makeClient({}, makeResponse({ media_type: "spreadsheet" }));
        const res = await client.search("q");
        expect(res.hits).toHaveLength(1);
        expect(res.hits[0].mediaType).toBe("other");
    });
});

describe("DocindexClient — isHitWire null-as-absent semantics", () => {
    it("accepts a payload with all media fields explicitly null and maps every field to its null-equivalent domain value", async () => {
        // Rust serde_json with Option<T> and no skip_serializing_if emits null rather
        // than omitting absent fields. isHitWire uses `!= null` (not `!== undefined`)
        // so null passes the same as undefined for every optional media field.
        const { client } = makeClient(
            {},
            makeResponse({
                media_type: null,
                mime_type: null,
                media_start: null,
                media_end: null,
                media_unit: null,
                truncated: null,
            })
        );
        const res = await client.search("q");
        expect(res.hits).toHaveLength(1);
        const h = res.hits[0];
        // mediaType defaults to "text" (not null — MediaType has no null member).
        expect(h.mediaType).toBe("text");
        expect(h.mimeType).toBeNull();
        expect(h.mediaStart).toBeNull();
        expect(h.mediaEnd).toBeNull();
        expect(h.mediaUnit).toBeNull();
        // truncated is boolean | undefined in the domain type — null is
        // normalized to undefined, not passed through as null.
        expect(h.truncated).toBeUndefined();
    });
});
