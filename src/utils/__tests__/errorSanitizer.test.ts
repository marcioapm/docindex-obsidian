import { describe, expect, it } from "vitest";
import { sanitizeErrorForLog } from "../errorSanitizer";

describe("sanitizeErrorForLog", () => {
    it("redacts an exact secret occurrence in the error message", () => {
        const err = new Error("request failed: Authorization: Bearer sekret-token-123");
        const out = sanitizeErrorForLog(err, "sekret-token-123");
        expect(out).not.toContain("sekret-token-123");
        expect(out).toContain("[redacted]");
    });

    it("redacts a Bearer <token> pattern even without the exact secret supplied", () => {
        const err = new Error("upstream config: Authorization: Bearer some-other-token");
        const out = sanitizeErrorForLog(err);
        expect(out).not.toContain("some-other-token");
    });

    it("includes the error name and a redacted message", () => {
        const err = new TypeError("network down");
        const out = sanitizeErrorForLog(err, "tok");
        expect(out).toContain("TypeError");
        expect(out).toContain("network down");
    });

    it("handles non-Error thrown values without throwing", () => {
        expect(sanitizeErrorForLog("plain string", "tok")).toContain("plain string");
        expect(sanitizeErrorForLog(undefined, "tok")).toContain("undefined");
    });

    it("does not throw or leak when secret is an empty string", () => {
        const err = new Error("Authorization: Bearer abc123");
        const out = sanitizeErrorForLog(err, "");
        expect(out).not.toContain("abc123");
    });
});
