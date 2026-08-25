import { describe, expect, it } from "vitest";
import { formatMediaLabel } from "../types";

describe("formatMediaLabel", () => {
    it("returns empty string for text hits", () => {
        expect(formatMediaLabel({ mediaType: "text", mediaStart: null, mediaEnd: null, truncated: false })).toBe("");
    });

    it("returns '🖼 Image' for a non-truncated image hit", () => {
        expect(formatMediaLabel({ mediaType: "image", mediaStart: null, mediaEnd: null, truncated: false })).toBe("🖼 Image");
    });

    it("appends '(truncated)' to an image label when truncated is true", () => {
        expect(formatMediaLabel({ mediaType: "image", mediaStart: null, mediaEnd: null, truncated: true })).toBe("🖼 Image (truncated)");
    });

    it("returns '📄 PDF' for a PDF hit with no page range", () => {
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: null, mediaEnd: null, truncated: false })).toBe("📄 PDF");
    });

    it("returns '📄 PDF page N' for a single-page range (0-based start → 1-based display)", () => {
        // mediaStart=0, mediaEnd=1 → half-open [0,1) → page 1
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: 0, mediaEnd: 1, truncated: false })).toBe("📄 PDF page 1");
    });

    it("returns '📄 PDF pages N–M' for a multi-page range", () => {
        // mediaStart=1, mediaEnd=4 → half-open [1,4) → pages 2–4
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: 1, mediaEnd: 4, truncated: false })).toBe("📄 PDF pages 2–4");
    });

    it("appends '(truncated)' to a PDF page label when truncated is true", () => {
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: 0, mediaEnd: 1, truncated: true })).toBe("📄 PDF page 1 (truncated)");
    });

    it("text hits produce no label regardless of truncated flag", () => {
        expect(formatMediaLabel({ mediaType: "text", mediaStart: null, mediaEnd: null, truncated: true })).toBe("");
    });

    it("undefined truncated is treated as false (not-truncated path)", () => {
        // DocindexHit.truncated is boolean | undefined; JS truthiness means undefined → no suffix.
        expect(formatMediaLabel({ mediaType: "image", mediaStart: null, mediaEnd: null, truncated: undefined })).toBe("🖼 Image");
    });
});

describe("formatMediaLabel — audio, video, and unrecognized media types", () => {
    it("returns '🎵 Audio' for an audio hit", () => {
        expect(formatMediaLabel({ mediaType: "audio", mediaStart: null, mediaEnd: null, truncated: false })).toBe("🎵 Audio");
    });

    it("returns '🎬 Video' for a video hit", () => {
        expect(formatMediaLabel({ mediaType: "video", mediaStart: null, mediaEnd: null, truncated: false })).toBe("🎬 Video");
    });

    it("returns '📎 Media' for an unrecognized-but-structurally-valid media type", () => {
        expect(formatMediaLabel({ mediaType: "other", mediaStart: null, mediaEnd: null, truncated: false })).toBe("📎 Media");
    });

    it("appends '(truncated)' to an audio label when truncated is true", () => {
        expect(formatMediaLabel({ mediaType: "audio", mediaStart: null, mediaEnd: null, truncated: true })).toBe("🎵 Audio (truncated)");
    });
});

describe("formatMediaLabel — degenerate PDF page ranges fall back to bare label", () => {
    it("zero-length range [2,2) → '📄 PDF'", () => {
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: 2, mediaEnd: 2, truncated: false })).toBe("📄 PDF");
    });

    it("inverted range [5,2) → '📄 PDF'", () => {
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: 5, mediaEnd: 2, truncated: false })).toBe("📄 PDF");
    });

    it("negative start [-1,2) → '📄 PDF'", () => {
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: -1, mediaEnd: 2, truncated: false })).toBe("📄 PDF");
    });

    it("NaN start → '📄 PDF'", () => {
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: NaN, mediaEnd: 3, truncated: false })).toBe("📄 PDF");
    });

    it("Infinity start → '📄 PDF'", () => {
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: Infinity, mediaEnd: Infinity, truncated: false })).toBe("📄 PDF");
    });

    it("Infinity end alone (finite start) → '📄 PDF'", () => {
        // mediaStart=0 is finite and passes Number.isInteger; mediaEnd=Infinity is the
        // only failing guard here. { Infinity, Infinity } alone would leave
        // `Number.isInteger(mediaEnd)` un-exercised in isolation because
        // `Infinity > Infinity` is already false regardless of that guard.
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: 0, mediaEnd: Infinity, truncated: false })).toBe("📄 PDF");
    });

    it("float start 1.5 → '📄 PDF'", () => {
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: 1.5, mediaEnd: 3, truncated: false })).toBe("📄 PDF");
    });

    it("start present with end null → '📄 PDF'", () => {
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: 0, mediaEnd: null, truncated: false })).toBe("📄 PDF");
    });

    it("end present with start null → '📄 PDF'", () => {
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: null, mediaEnd: 3, truncated: false })).toBe("📄 PDF");
    });
});
