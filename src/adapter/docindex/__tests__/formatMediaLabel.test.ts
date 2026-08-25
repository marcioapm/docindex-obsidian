import { describe, expect, it } from "vitest";
import { formatMediaLabel } from "../types";

/**
 * Tests for formatMediaLabel. Each case is annotated with the one-line source
 * mutation that would make it fail — proving the assertion is load-bearing.
 */
describe("formatMediaLabel", () => {
    it("returns empty string for text hits", () => {
        // Mutation: change the `else { return ""; }` branch to return any non-empty string.
        expect(formatMediaLabel({ mediaType: "text", mediaStart: null, mediaEnd: null, truncated: false })).toBe("");
    });

    it("returns '🖼 Image' for a non-truncated image hit", () => {
        // Mutation: change the image emoji or label string in the image branch.
        expect(formatMediaLabel({ mediaType: "image", mediaStart: null, mediaEnd: null, truncated: false })).toBe("🖼 Image");
    });

    it("appends '(truncated)' to an image label when truncated is true", () => {
        // Mutation: remove the `truncated ? \`${base} (truncated)\` : base` conditional.
        expect(formatMediaLabel({ mediaType: "image", mediaStart: null, mediaEnd: null, truncated: true })).toBe("🖼 Image (truncated)");
    });

    it("returns '📄 PDF' for a PDF hit with no page range", () => {
        // Mutation: change the PDF base label string, or add an erroneous page suffix
        // when mediaStart/mediaEnd are null.
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: null, mediaEnd: null, truncated: false })).toBe("📄 PDF");
    });

    it("returns '📄 PDF page N' for a single-page range (0-based start → 1-based display)", () => {
        // Mutation: change `mediaStart + 1` to `mediaStart` (drop the +1 offset), or
        // change the single-page branch condition so a two-page range hits this path.
        // mediaStart=0, mediaEnd=1 → half-open [0,1) → page 1
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: 0, mediaEnd: 1, truncated: false })).toBe("📄 PDF page 1");
    });

    it("returns '📄 PDF pages N–M' for a multi-page range", () => {
        // Mutation: swap start/end in the label, or change the separator character,
        // or use the wrong bound (e.g. displayEnd - 1).
        // mediaStart=1, mediaEnd=4 → half-open [1,4) → pages 2–4
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: 1, mediaEnd: 4, truncated: false })).toBe("📄 PDF pages 2–4");
    });

    it("appends '(truncated)' to a PDF page label when truncated is true", () => {
        // Mutation: remove the truncated suffix for PDF hits while keeping it for images.
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: 0, mediaEnd: 1, truncated: true })).toBe("📄 PDF page 1 (truncated)");
    });

    it("text hits produce no label regardless of truncated flag", () => {
        // Mutation: add truncated handling for text hits that returns a non-empty string.
        expect(formatMediaLabel({ mediaType: "text", mediaStart: null, mediaEnd: null, truncated: true })).toBe("");
    });
});

describe("formatMediaLabel — degenerate PDF page ranges fall back to bare label", () => {
    // Each test is annotated with the one-line mutation that makes it fail.

    it("zero-length range [2,2) → '📄 PDF'", () => {
        // Mutation: removing the `mediaEnd > mediaStart` guard lets the multi-page
        // branch run, producing '📄 PDF pages 3–2'.
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: 2, mediaEnd: 2, truncated: false })).toBe("📄 PDF");
    });

    it("inverted range [5,2) → '📄 PDF'", () => {
        // Mutation: removing the `mediaEnd > mediaStart` guard produces '📄 PDF pages 6–2'.
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: 5, mediaEnd: 2, truncated: false })).toBe("📄 PDF");
    });

    it("negative start [-1,2) → '📄 PDF'", () => {
        // Mutation: removing the `mediaStart >= 0` guard lets the single-page branch
        // run when end - start === 1, producing '📄 PDF page 0'.
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: -1, mediaEnd: 2, truncated: false })).toBe("📄 PDF");
    });

    it("NaN start → '📄 PDF'", () => {
        // Mutation: replacing Number.isInteger with typeof === 'number' accepts NaN.
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: NaN, mediaEnd: 3, truncated: false })).toBe("📄 PDF");
    });

    it("Infinity start → '📄 PDF'", () => {
        // Mutation: replacing Number.isInteger with Number.isFinite accepts integers
        // but not Infinity; however Number.isFinite would still reject this. The
        // load-bearing check here is Number.isInteger (which rejects Infinity).
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: Infinity, mediaEnd: Infinity, truncated: false })).toBe("📄 PDF");
    });

    it("float start 1.5 → '📄 PDF'", () => {
        // Mutation: removing Number.isInteger (e.g. using Number.isFinite instead)
        // accepts 1.5 and produces '📄 PDF page 2.5' or similar.
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: 1.5, mediaEnd: 3, truncated: false })).toBe("📄 PDF");
    });

    it("start present with end null → '📄 PDF'", () => {
        // Mutation: removing the `mediaEnd != null` check would allow the range
        // block to run with a null end, producing NaN-based output.
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: 0, mediaEnd: null, truncated: false })).toBe("📄 PDF");
    });

    it("end present with start null → '📄 PDF'", () => {
        // Mutation: removing the `mediaStart != null` check would allow the range
        // block to run with a null start.
        expect(formatMediaLabel({ mediaType: "pdf", mediaStart: null, mediaEnd: 3, truncated: false })).toBe("📄 PDF");
    });
});
