import { describe, expect, it } from "vitest";
import { parseTrigger } from "../semanticLinkTrigger";

describe("parseTrigger", () => {
    describe("trigger found", () => {
        it("returns query and startCh when trigger is present", () => {
            const result = parseTrigger("hello ;; world", ";;");
            expect(result).toEqual({ query: " world", startCh: 6 });
        });

        it("captures the query after the trigger correctly", () => {
            const result = parseTrigger(";;semantic query", ";;");
            expect(result).toEqual({ query: "semantic query", startCh: 0 });
        });

        it("last occurrence wins when trigger appears more than once on the line", () => {
            // The second `;;` starts the active query; text before it is context.
            const result = parseTrigger("first ;;ignored;; actual query", ";;");
            expect(result).toEqual({ query: " actual query", startCh: 15 });
        });

        it("returns empty query when trigger is at end of line", () => {
            const result = parseTrigger("text;;", ";;");
            expect(result).toEqual({ query: "", startCh: 4 });
        });
    });

    describe("trigger absent or disabled", () => {
        it("returns null when trigger is not present in the line", () => {
            expect(parseTrigger("no trigger here", ";;")).toBeNull();
        });

        it("returns null for an empty trigger string (feature disabled)", () => {
            expect(parseTrigger(";;anything", "")).toBeNull();
        });

        it("a non-empty truthy trigger matches when present in the line", () => {
            // A single-char trigger that appears in the line should match.
            const result = parseTrigger("text!query", "!");
            expect(result).toEqual({ query: "query", startCh: 4 });
        });
    });

    describe("bracket-prefixed triggers rejected", () => {
        it("returns null when trigger starts with '[' (would collide with [[wikilink)])", () => {
            expect(parseTrigger("[[note", "[[")).toBeNull();
        });

        it("returns null for any trigger starting with '['", () => {
            expect(parseTrigger("[test", "[")).toBeNull();
        });
    });
});
