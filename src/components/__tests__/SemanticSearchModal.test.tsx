/**
 * Tests for the media-label render path in SearchResultItem.
 *
 * SemanticSearchModal extends Obsidian's Modal and mounts via createRoot on
 * a runtime-provided DOM element — that flow requires an Obsidian desktop
 * runtime and cannot be exercised here. SearchResultItem is a pure function
 * component with no Obsidian dependencies; exporting it makes these tests
 * possible without faking the full runtime or the debounce lifecycle.
 */
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchResultItem } from "../SemanticSearchModal";
import { SimilarNote } from "@/domain/model/SimilarNote";
import type { TFile } from "obsidian";

vi.mock("obsidian");

/** Minimal TFile stub. Only `path` is accessed in SearchResultItem. */
function makeFile(path: string): TFile {
    return { path, name: path, extension: "png", basename: path, stat: { mtime: 0, ctime: 0, size: 0 } } as unknown as TFile;
}

/** Props shared by all tests — only `note` and `file` vary per case. */
function baseProps(note: SimilarNote, file: TFile | null) {
    return {
        note,
        file,
        isSelected: false,
        isHovered: false,
        scrollOnSelect: false,
        noteDisplayMode: "title" as const,
        allFiles: file ? [file] : [],
        onHover: vi.fn(),
        onLeaveHover: vi.fn(),
        onOpen: vi.fn(),
        onInsertLink: vi.fn(),
    };
}

describe("SearchResultItem — media label rendering", () => {
    it("renders docindex-media-type element for a PDF hit with a page range", () => {
        const note = new SimilarNote(
            "Annual Report",
            "reports/annual.pdf",
            0.9,
            "snippet",
            "source",
            [],
            [],
            "pdf:0",
            "pdf",
            0,      // mediaStart: 0-based → display page 1
            3,      // mediaEnd: exclusive → display page 3
            false
        );
        render(<SearchResultItem {...baseProps(note, makeFile("reports/annual.pdf"))} />);
        // mediaStart=0, mediaEnd=3 → "📄 PDF pages 1–3"
        expect(screen.getByText("📄 PDF pages 1–3")).toBeInTheDocument();
        expect(screen.getByText("📄 PDF pages 1–3").className).toContain("docindex-media-type");
    });

    it("renders docindex-media-type element for an image hit", () => {
        const note = new SimilarNote(
            "Vacation Photo",
            "photos/beach.png",
            0.75,
            "Image snippet",
            "source",
            [],
            [],
            "img:0",
            "image",
            null,
            null,
            true   // truncated
        );
        render(<SearchResultItem {...baseProps(note, makeFile("photos/beach.png"))} />);
        expect(screen.getByText("🖼 Image (truncated)")).toBeInTheDocument();
        expect(screen.getByText("🖼 Image (truncated)").className).toContain("docindex-media-type");
    });

    it("renders no docindex-media-type element for a text hit", () => {
        const note = new SimilarNote(
            "Plain Note",
            "notes/plain.md",
            0.8,
            "Text snippet",
            "source",
            [],
            [],
            "txt:0",
            "text",
            null,
            null,
            false
        );
        render(<SearchResultItem {...baseProps(note, makeFile("notes/plain.md"))} />);
        expect(screen.getByText("Plain Note")).toBeInTheDocument();
        expect(document.querySelector(".docindex-media-type")).not.toBeInTheDocument();
    });
});
