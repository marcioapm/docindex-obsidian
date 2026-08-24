import { describe, expect, it, vi } from "vitest";
import { testDocindexHealth } from "../DocindexSettingsSection";

function makeOptions(overrides: Partial<Parameters<typeof testDocindexHealth>[0]> = {}) {
    const requestFn = vi.fn();
    const client = { reset: vi.fn() };
    return {
        options: {
            backendUrl: "http://100.0.0.1:7777/",
            bearerToken: "secret-token",
            requestFn,
            client,
            ...overrides,
        },
        requestFn,
        client,
    };
}

describe("testDocindexHealth", () => {
    it("sends the bearer token only in the Authorization header", async () => {
        const { options, requestFn } = makeOptions();
        requestFn.mockResolvedValue({
            status: 200,
            headers: {},
            json: { ok: true, authenticated: true },
        });

        const result = await testDocindexHealth(options);

        expect(result).toMatchObject({ kind: "success" });
        const request = requestFn.mock.calls[0][0];
        expect(request).toMatchObject({
            url: "http://100.0.0.1:7777/health",
            method: "GET",
            headers: {
                Authorization: "Bearer secret-token",
                Accept: "application/json",
            },
            throw: false,
        });
        expect(JSON.stringify(result)).not.toContain("secret-token");
    });

    it("accepts an authenticated health response and resets the client", async () => {
        const { options, requestFn, client } = makeOptions();
        requestFn.mockResolvedValue({
            status: 200,
            headers: {},
            json: {
                ok: true,
                authenticated: true,
                indexed_chunks: 42,
                embedding_model: "test-model",
            },
        });

        await expect(testDocindexHealth(options)).resolves.toEqual({
            kind: "success",
            status: 200,
            indexedChunks: 42,
            embeddingModel: "test-model",
        });
        expect(client.reset).toHaveBeenCalledTimes(1);
    });

    it("treats an unauthenticated 2xx response as an authentication failure", async () => {
        const { options, requestFn, client } = makeOptions();
        requestFn.mockResolvedValue({
            status: 200,
            headers: {},
            json: { ok: true, authenticated: false },
        });

        await expect(testDocindexHealth(options)).resolves.toEqual({ kind: "authentication-failed" });
        expect(client.reset).not.toHaveBeenCalled();
    });

    it("treats a malformed 2xx response as malformed", async () => {
        const { options, requestFn, client } = makeOptions();
        requestFn.mockResolvedValue({ status: 200, headers: {}, json: { authenticated: true } });

        await expect(testDocindexHealth(options)).resolves.toEqual({ kind: "malformed" });
        expect(client.reset).not.toHaveBeenCalled();
    });

    it("maps a rejected request to unreachable", async () => {
        const { options, requestFn, client } = makeOptions();
        requestFn.mockRejectedValue(new Error("connection refused"));

        await expect(testDocindexHealth(options)).resolves.toEqual({ kind: "unreachable" });
        expect(client.reset).not.toHaveBeenCalled();
    });

    it.each([
        ["", "secret-token", "missing-url"],
        ["http://100.0.0.1:7777", "  ", "missing-token"],
    ] as const)("short-circuits for %s", async (backendUrl, bearerToken, kind) => {
        const { options, requestFn, client } = makeOptions({ backendUrl, bearerToken });

        await expect(testDocindexHealth(options)).resolves.toEqual({ kind });
        expect(requestFn).not.toHaveBeenCalled();
        expect(client.reset).not.toHaveBeenCalled();
    });
});
