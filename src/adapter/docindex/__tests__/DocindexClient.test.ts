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
        ...overrides,
    };
    const fn = requestFn ?? vi.fn();
    const client = new DocindexClient(() => settings, fn);
    return { client, requestFn: fn };
}

beforeEach(() => {
    noticeMessages.length = 0;
});

describe("DocindexClient", () => {
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

    it("surfaces a Notice and rejects on 401", async () => {
        const requestFn = vi.fn().mockResolvedValue({ status: 401, headers: {}, text: "" });
        const { client } = makeClient({}, requestFn);
        await expect(client.search("q")).rejects.toMatchObject({ kind: "unauthorized" });
        expect(noticeMessages).toContain("docindex: bearer token missing or wrong");
    });

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

    it("surfaces a Notice and disables the provider on malformed JSON", async () => {
        const requestFn = vi.fn().mockResolvedValue({ status: 200, headers: {}, json: { not: "a hit list" } });
        const { client } = makeClient({}, requestFn);
        await expect(client.search("q")).rejects.toMatchObject({ kind: "malformed" });
        expect(noticeMessages.some((m) => m.includes("malformed"))).toBe(true);
        // Subsequent calls should short-circuit via isAvailable == false.
        expect(client.isAvailable()).toBe(false);
    });

    it("reset() re-enables after a malformed-disable", async () => {
        const requestFn = vi.fn().mockResolvedValue({ status: 200, headers: {}, json: { bad: true } });
        const { client } = makeClient({}, requestFn);
        await expect(client.search("q")).rejects.toBeDefined();
        expect(client.isAvailable()).toBe(false);
        client.reset();
        expect(client.isAvailable()).toBe(true);
    });

    it("is unavailable when disabled, URL empty, or token empty", () => {
        expect(makeClient({ enabled: false }).client.isAvailable()).toBe(false);
        expect(makeClient({ backendUrl: "   " }).client.isAvailable()).toBe(false);
        expect(makeClient({ bearerToken: "" }).client.isAvailable()).toBe(false);
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
});
