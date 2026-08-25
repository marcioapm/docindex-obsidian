import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocindexClient } from "../DocindexClient";
import type { DocindexSettings } from "../types";

// Capture Notice invocations so assertions can check what the user would see.
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

describe("DocindexClient — request shape", () => {
    it("parses a valid /search response into camelCase hits", async () => {
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    {
                        path: "notes/foo.md",
                        title: "Foo",
                        heading_path: ["Intro", "Why"],
                        snippet: "some snippet",
                        score: 0.87,
                        chunk_id: "abc:0",
                    },
                ],
            },
        });
        const { client } = makeClient({}, requestFn);
        const res = await client.search("hello", 5);
        expect(res.hits).toEqual([
            {
                path: "notes/foo.md",
                title: "Foo",
                headingPath: ["Intro", "Why"],
                snippet: "some snippet",
                score: 0.87,
                chunkId: "abc:0",
                mediaType: "text",
            },
        ]);
        // Verify body + auth header (but do not leak token into the assertion output).
        const call = requestFn.mock.calls[0][0];
        expect(call.url).toBe("http://100.0.0.1:7777/search");
        expect(call.headers.Authorization).toBe("Bearer test-token");
        expect(JSON.parse(call.body)).toEqual({ query: "hello", limit: 5 });
    });

    it("accepts a string heading_path and splits it into segments", async () => {
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    {
                        path: "n.md",
                        title: "N",
                        heading_path: "n.md - Section > Sub",
                        snippet: "s",
                        score: 0.1,
                        chunk_id: 42,
                    },
                ],
            },
        });
        const { client } = makeClient({}, requestFn);
        const res = await client.search("q");
        expect(res.hits[0].headingPath).toEqual(["Section", "Sub"]);
        expect(res.hits[0].chunkId).toBe("42");
    });

    it("treats null heading_path as an empty array", async () => {
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    {
                        path: "n.md",
                        title: "N",
                        heading_path: null,
                        snippet: "s",
                        score: 0.1,
                        chunk_id: "c",
                    },
                ],
            },
        });
        const { client } = makeClient({}, requestFn);
        const res = await client.search("q");
        expect(res.hits[0].headingPath).toEqual([]);
    });

    it("strips trailing slashes from the backend URL", async () => {
        const requestFn = vi.fn().mockResolvedValue({ status: 200, headers: {}, json: { hits: [] } });
        const { client } = makeClient({ backendUrl: "http://host:1/////" }, requestFn);
        await client.similar("a/b.md");
        expect(requestFn.mock.calls[0][0].url).toBe("http://host:1/similar");
    });

    it("passes vault-relative hit paths through unchanged (no prefix stripping)", async () => {
        // The server emits vault-relative paths (e.g. "notes/deep/foo.md").
        // Obsidian's TFile.path is also vault-relative, so the client must not
        // rewrite, strip, or prefix hit.path in any way — it's passed verbatim
        // to consumers like openLinkText() and getAbstractFileByPath().
        const paths = [
            "flat.md",
            "notes/nested.md",
            "very/deep/nested/path/file.md",
            "spaces in name.md",
            "unicode-ü-é-名.md",
        ];
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: paths.map((p, i) => ({
                    path: p,
                    title: `t${i}`,
                    heading_path: [],
                    snippet: "s",
                    score: 1 - i * 0.1,
                    chunk_id: `c${i}`,
                })),
            },
        });
        const { client } = makeClient({}, requestFn);
        const res = await client.search("q");
        expect(res.hits.map((h) => h.path)).toEqual(paths);
    });

    it("falls back to parsing resp.text when resp.json is missing", async () => {
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            text: JSON.stringify({
                hits: [{ path: "p", title: "t", heading_path: [], snippet: "", score: 0, chunk_id: "c" }],
            }),
        });
        const { client } = makeClient({}, requestFn);
        const res = await client.search("q");
        expect(res.hits).toHaveLength(1);
    });

    it("sends the path and limit keys in the /similar request body with the Authorization header", async () => {
        const requestFn = vi.fn().mockResolvedValue({ status: 200, headers: {}, json: { hits: [] } });
        const { client } = makeClient({}, requestFn);
        await client.similar("notes/foo.md", 7);
        const call = requestFn.mock.calls[0][0];
        expect(call.url).toContain("/similar");
        expect(call.headers.Authorization).toBe("Bearer test-token");
        expect(JSON.parse(call.body)).toEqual({ path: "notes/foo.md", limit: 7 });
    });
});

describe("DocindexClient — auth failures", () => {
    it("surfaces a Notice and rejects on 401", async () => {
        const requestFn = vi.fn().mockResolvedValue({ status: 401, headers: {}, text: "" });
        const { client } = makeClient({}, requestFn);
        await expect(client.search("q")).rejects.toMatchObject({ kind: "unauthorized" });
        expect(noticeMessages).toContain("docindex: bearer token missing or wrong");
    });

    it("is unavailable when disabled, URL empty, or token empty", () => {
        expect(makeClient({ enabled: false }).client.isAvailable()).toBe(false);
        expect(makeClient({ backendUrl: "   " }).client.isAvailable()).toBe(false);
        expect(makeClient({ bearerToken: "" }).client.isAvailable()).toBe(false);
    });
});

describe("DocindexClient — server errors", () => {
    it("surfaces a Notice and rejects on 5xx", async () => {
        const requestFn = vi.fn().mockResolvedValue({ status: 503, headers: {}, text: "" });
        const { client } = makeClient({}, requestFn);
        await expect(client.search("q")).rejects.toMatchObject({ kind: "server", status: 503 });
        expect(noticeMessages).toContain("docindex: server error 503");
    });

    it("surfaces a Notice and rejects on network failure", async () => {
        const requestFn = vi.fn().mockRejectedValue(new Error("net down"));
        const { client } = makeClient({}, requestFn);
        await expect(client.search("q")).rejects.toMatchObject({ kind: "network" });
        expect(noticeMessages).toContain("docindex: backend unreachable (Tailscale?)");
    });
});

describe("DocindexClient — malformed responses", () => {
    it("surfaces a Notice and disables the provider on malformed JSON", async () => {
        const requestFn = vi.fn().mockResolvedValue({ status: 200, headers: {}, json: { not: "a hit list" } });
        const { client } = makeClient({}, requestFn);
        await expect(client.search("q")).rejects.toMatchObject({ kind: "malformed" });
        expect(noticeMessages.some((m) => m.includes("malformed"))).toBe(true);
        // Subsequent calls should short-circuit via isAvailable == false.
        expect(client.isAvailable()).toBe(false);
    });

    it("short-circuits after a malformed disable: second call rejects without a new network request", async () => {
        const requestFn = vi.fn().mockResolvedValue({ status: 200, headers: {}, json: { not: "a hit list" } });
        const { client } = makeClient({}, requestFn);
        // First call: triggers the malformed path and sets disabledForSession.
        await expect(client.search("q")).rejects.toMatchObject({ kind: "malformed" });
        // Second call must reject immediately (kind: not-configured) and must
        // NOT issue a second HTTP request — the call count stays at 1.
        await expect(client.search("q")).rejects.toMatchObject({ kind: "not-configured" });
        expect(requestFn).toHaveBeenCalledTimes(1);
    });

    it("reset() re-enables after a malformed-disable", async () => {
        const requestFn = vi.fn().mockResolvedValue({ status: 200, headers: {}, json: { bad: true } });
        const { client } = makeClient({}, requestFn);
        await expect(client.search("q")).rejects.toBeDefined();
        expect(client.isAvailable()).toBe(false);
        client.reset();
        expect(client.isAvailable()).toBe(true);
    });
});

describe("DocindexClient — URL handling and relevance threshold", () => {
    it("filters hits below relevanceThreshold using score_normalized", async () => {
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    { path: "a.md", title: "a", heading_path: [], snippet: "", score: 99, score_rrf: 99, score_normalized: 0.9, chunk_id: "1" },
                    { path: "b.md", title: "b", heading_path: [], snippet: "", score: 50, score_rrf: 50, score_normalized: 0.45, chunk_id: "2" },
                    { path: "c.md", title: "c", heading_path: [], snippet: "", score: 10, score_rrf: 10, score_normalized: 0.2, chunk_id: "3" },
                ],
            },
        });
        const { client } = makeClient({ relevanceThreshold: 0.4 }, requestFn);
        const res = await client.search("q");
        expect(res.hits.map((h) => h.path)).toEqual(["a.md", "b.md"]);
        // Normalized fields survive the domain conversion.
        expect(res.hits[0].scoreNormalized).toBe(0.9);
        expect(res.hits[0].scoreRrf).toBe(99);
    });

    it("threshold=0 keeps everything (filter is a no-op)", async () => {
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    { path: "a.md", title: "a", heading_path: [], snippet: "", score: 0.01, score_normalized: 0.01, chunk_id: "1" },
                ],
            },
        });
        const { client } = makeClient({ relevanceThreshold: 0 }, requestFn);
        const res = await client.search("q");
        expect(res.hits).toHaveLength(1);
    });

    it("does not threshold a legacy response lacking score_normalized, even at the shipped default", async () => {
        // Real RRF values observed from a legacy deployment; all below the
        // shipped default (0.4). Raw RRF must never be compared against the
        // [0,1] threshold, so all three hits must survive.
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    { path: "a.md", title: "a", heading_path: [], snippet: "", score: 0.01639, chunk_id: "1" },
                    { path: "b.md", title: "b", heading_path: [], snippet: "", score: 0.01613, chunk_id: "2" },
                    { path: "c.md", title: "c", heading_path: [], snippet: "", score: 0.01587, chunk_id: "3" },
                ],
            },
        });
        const { client } = makeClient({ relevanceThreshold: 0.4 }, requestFn);
        const res = await client.search("q");
        expect(res.hits.map((h) => h.path)).toEqual(["a.md", "b.md", "c.md"]);
        expect(res.hits.every((h) => h.scoreNormalized === undefined)).toBe(true);
    });

    it("does not threshold a media hit even when scoreNormalized is present and below the cutoff", async () => {
        // Media scoreNormalized is rank-derived, not query-dependent — the
        // relevance threshold must not apply to it regardless of value.
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    {
                        path: "scan.pdf",
                        title: "scan",
                        heading_path: [],
                        snippet: "",
                        score: 0.05,
                        score_normalized: 0.05,
                        chunk_id: "1",
                        media_type: "pdf",
                    },
                ],
            },
        });
        const { client } = makeClient({ relevanceThreshold: 0.4 }, requestFn);
        const res = await client.search("q");
        expect(res.hits.map((h) => h.path)).toEqual(["scan.pdf"]);
    });
});

describe("DocindexClient — score validation", () => {
    it.each([
        ["NaN", NaN],
        ["Infinity", Infinity],
        ["-Infinity", -Infinity],
    ])("rejects a hit whose score is %s", async (_label, score) => {
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: { hits: [{ path: "a.md", title: "a", heading_path: [], snippet: "", score, chunk_id: "1" }] },
        });
        const { client } = makeClient({}, requestFn);
        await expect(client.search("q")).rejects.toMatchObject({ kind: "malformed" });
    });

    it.each([
        ["below 0", -0.1],
        ["above 1", 1.1],
        ["NaN", NaN],
        ["Infinity", Infinity],
    ])("rejects a hit whose score_normalized is %s", async (_label, score_normalized) => {
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    { path: "a.md", title: "a", heading_path: [], snippet: "", score: 0.5, score_normalized, chunk_id: "1" },
                ],
            },
        });
        const { client } = makeClient({}, requestFn);
        await expect(client.search("q")).rejects.toMatchObject({ kind: "malformed" });
    });

    it("accepts score_normalized at the boundaries 0 and 1", async () => {
        const requestFn = vi.fn().mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                hits: [
                    { path: "a.md", title: "a", heading_path: [], snippet: "", score: 0.5, score_normalized: 0, chunk_id: "1" },
                    { path: "b.md", title: "b", heading_path: [], snippet: "", score: 0.5, score_normalized: 1, chunk_id: "2" },
                ],
            },
        });
        const { client } = makeClient({}, requestFn);
        const res = await client.search("q");
        expect(res.hits.map((h) => h.scoreNormalized)).toEqual([0, 1]);
    });
});
