/**
 * Tests for toDomainHit media field mapping and isHitWire media field validation.
 * Kept in a separate file to stay within the 400-line ESLint limit for
 * DocindexClient.test.ts.
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

beforeEach(() => {
    noticeMessages.length = 0;
});

describe("DocindexClient — toDomainHit media field mapping", () => {
    it("maps all six media fields from a new-server hit", async () => {
        // Mutation that would make this fail: omitting any one of the six
        // field assignments in toDomainHit (e.g. deleting `mediaType: wire.media_type ?? "text"`).
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    {
                        path: "scan.pdf",
                        title: "Scan",
                        heading_path: [],
                        snippet: "PDF pages 2–4",
                        score: 0.8,
                        chunk_id: "p:0",
                        media_type: "pdf",
                        mime_type: "application/pdf",
                        media_start: 1,
                        media_end: 4,
                        media_unit: "page",
                        truncated: false,
                    },
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
        // Mutation that would make this fail: removing the `?? "text"` fallback
        // in toDomainHit, leaving `mediaType: undefined`.
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    { path: "note.md", title: "N", heading_path: [], snippet: "s", score: 0.5, chunk_id: "c" },
                ],
            },
        });
        const { client } = makeClient({}, requestFn);
        const res = await client.search("q");
        expect(res.hits[0].mediaType).toBe("text");
    });

    it("maps a truncated image hit", async () => {
        // Mutation: removing `truncated: wire.truncated` in toDomainHit would leave
        // truncated undefined, failing the toBe(true) assertion.
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    {
                        path: "anim.gif",
                        title: "Anim",
                        heading_path: [],
                        snippet: "Image",
                        score: 0.7,
                        chunk_id: "img:0",
                        media_type: "image",
                        mime_type: "image/gif",
                        media_start: null,
                        media_end: null,
                        media_unit: null,
                        truncated: true,
                    },
                ],
            },
        });
        const { client } = makeClient({}, requestFn);
        const res = await client.search("q");
        const h = res.hits[0];
        expect(h.mediaType).toBe("image");
        expect(h.truncated).toBe(true);
        expect(h.mediaStart).toBeNull();
        expect(h.mediaEnd).toBeNull();
    });
});

describe("DocindexClient — isHitWire media field validation", () => {
    it("accepts a payload with none of the new fields (old server)", async () => {
        // Mutation that would make this fail: adding a required check for any
        // of the six new fields in isHitWire (e.g. `if (!v.media_type) return false`).
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    { path: "n.md", title: "N", heading_path: [], snippet: "s", score: 0.5, chunk_id: "c" },
                ],
            },
        });
        const { client } = makeClient({}, requestFn);
        // Old-server payload with no media fields must parse successfully.
        const res = await client.search("q");
        expect(res.hits).toHaveLength(1);
    });

    it("rejects a hit where a present media_type has an unrecognised value", async () => {
        // Mutation that would make this fail: removing the type check for
        // `media_type` in isHitWire (e.g. deleting the VALID_MEDIA_TYPES guard).
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    {
                        path: "n.md",
                        title: "N",
                        heading_path: [],
                        snippet: "s",
                        score: 0.5,
                        chunk_id: "c",
                        media_type: "video", // not in MediaType union
                    },
                ],
            },
        });
        const { client } = makeClient({}, requestFn);
        // The guard must reject the response; the client surfaces a malformed error.
        await expect(client.search("q")).rejects.toMatchObject({ kind: "malformed" });
    });

    it("rejects a hit where truncated is present but not a boolean", async () => {
        // Mutation that would make this fail: removing the truncated type-check
        // in isHitWire (the `typeof v.truncated !== "boolean"` guard).
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    {
                        path: "n.md",
                        title: "N",
                        heading_path: [],
                        snippet: "s",
                        score: 0.5,
                        chunk_id: "c",
                        truncated: "yes", // wrong type: string, not boolean
                    },
                ],
            },
        });
        const { client } = makeClient({}, requestFn);
        await expect(client.search("q")).rejects.toMatchObject({ kind: "malformed" });
    });

    it("rejects a hit where mime_type is present but not a string or null", async () => {
        // Mutation: removing the mime_type type-check in isHitWire
        // (`typeof v.mime_type !== "string"` guard) accepts the number 42,
        // leaving this test to fail with a resolved value instead of rejection.
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    {
                        path: "n.md",
                        title: "N",
                        heading_path: [],
                        snippet: "s",
                        score: 0.5,
                        chunk_id: "c",
                        mime_type: 42, // wrong type: number, not string or null
                    },
                ],
            },
        });
        const { client } = makeClient({}, requestFn);
        await expect(client.search("q")).rejects.toMatchObject({ kind: "malformed" });
    });

    it("rejects a hit where media_start is present but not a number or null", async () => {
        // Mutation: removing the media_start type-check in isHitWire
        // (`typeof v.media_start !== "number"` guard) accepts the string 'first'.
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    {
                        path: "n.md",
                        title: "N",
                        heading_path: [],
                        snippet: "s",
                        score: 0.5,
                        chunk_id: "c",
                        media_start: "first", // wrong type: string, not number or null
                    },
                ],
            },
        });
        const { client } = makeClient({}, requestFn);
        await expect(client.search("q")).rejects.toMatchObject({ kind: "malformed" });
    });

    it("rejects a hit where media_end is present but not a number or null", async () => {
        // Mutation: removing the media_end type-check in isHitWire
        // (`typeof v.media_end !== "number"` guard) accepts the boolean true.
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    {
                        path: "n.md",
                        title: "N",
                        heading_path: [],
                        snippet: "s",
                        score: 0.5,
                        chunk_id: "c",
                        media_end: true, // wrong type: boolean, not number or null
                    },
                ],
            },
        });
        const { client } = makeClient({}, requestFn);
        await expect(client.search("q")).rejects.toMatchObject({ kind: "malformed" });
    });
});
