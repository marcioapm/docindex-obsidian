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
