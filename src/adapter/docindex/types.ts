/**
 * Response types from the docindex-server backend.
 *
 * Wire format (snake_case) matches the Rust server. We keep the server's
 * naming on the network and camelCase on domain objects — conversion lives
 * in `DocindexClient`.
 */

/** Discriminated union matching the server's `MediaType` enum. */
export type MediaType = "text" | "image" | "pdf";

export interface DocindexHitWire {
    path: string;
    title: string;
    // Server sends either a pre-joined string (current form) or an array of
    // heading segments. Accept both — `DocindexClient` normalizes to string[].
    heading_path: string | string[] | null;
    snippet: string;
    score: number;
    // Optional: added in server v0.3+. Old servers don't emit these; the
    // client falls back to `score` wherever `score_normalized` is missing.
    score_rrf?: number;
    score_normalized?: number;
    chunk_id: string | number;
    // Optional: added when the server indexes non-Markdown sources.
    // Absent on old servers — all fields below must be treated as optional.
    /** Content category. Absent on old servers; defaults to "text". */
    media_type?: MediaType;
    /** MIME type string (e.g. "image/jpeg"), nullable. */
    mime_type?: string | null;
    /**
     * 0-based start of the page range (PDFs). Half-open with `media_end`.
     * Null for non-paginated media.
     */
    media_start?: number | null;
    /**
     * 0-based exclusive end of the page range (PDFs). Null for
     * non-paginated media.
     */
    media_end?: number | null;
    /** Unit label for the range (e.g. "page"). Null when not applicable. */
    media_unit?: string | null;
    /** True when the embedding covers only part of the source (e.g. first
     *  frame of an animated GIF, or an oversized input that was truncated). */
    truncated?: boolean;
}

export interface DocindexSearchResponseWire {
    hits: DocindexHitWire[];
}

export interface DocindexHit {
    path: string;
    title: string;
    headingPath: string[];
    snippet: string;
    score: number;
    /** RRF fusion score. Equals `score` when the server supplies it. */
    scoreRrf?: number;
    /**
     * Query-independent 0..1 display score. When the server doesn't supply
     * it, clients should fall back to `score` (the RRF value).
     */
    scoreNormalized?: number;
    chunkId: string;
    /**
     * Content category. Defaults to "text" when absent from the wire
     * payload (old servers pre-dating media indexing).
     */
    mediaType: MediaType;
    /** MIME type string, or undefined when the server didn't supply it. */
    mimeType?: string | null;
    /**
     * 0-based start page (PDFs). Undefined when the server didn't supply it
     * or when the media is not paginated.
     */
    mediaStart?: number | null;
    /**
     * 0-based exclusive end page (PDFs). Undefined when the server didn't
     * supply it or when the media is not paginated.
     */
    mediaEnd?: number | null;
    /** Unit label for the range, or undefined when not applicable. */
    mediaUnit?: string | null;
    /**
     * True when the embedding covers only part of the source. Undefined
     * when the server didn't supply it (treat as false).
     */
    truncated?: boolean;
}

export interface DocindexSearchResponse {
    hits: DocindexHit[];
}

export interface DocindexSettings {
    enabled: boolean;
    backendUrl: string;
    bearerToken: string;
    limit: number;
    /**
     * Hits with `scoreNormalized` (or `score`, as fallback) below this value
     * are hidden from both the sidebar and the semantic-search modal. Range
     * 0.0-1.0. 0 = show everything. 1 = only rank-1-in-both-branches hits.
     * Typical sweet spot: 0.35-0.60.
     */
    relevanceThreshold: number;
}

export const DEFAULT_DOCINDEX_SETTINGS: DocindexSettings = {
    enabled: false,
    backendUrl: "",
    bearerToken: "",
    limit: 10,
    relevanceThreshold: 0.4,
};

/**
 * Normalized-score accessor with graceful fallback.
 *
 * Returns `hit.scoreNormalized` when the server supplied it (v0.3+), else
 * `hit.score` (the RRF value). The fallback is lossy — RRF scores are not
 * in [0, 1] — but it keeps old servers functional during rollout. Consumers
 * that want strict fallback semantics should check `scoreNormalized`
 * directly.
 */
export function getDisplayScore(hit: DocindexHit): number {
    return hit.scoreNormalized ?? hit.score;
}

/**
 * Formats a human-readable media type label for a hit.
 *
 * Returns an empty string for text hits so callers can render it
 * conditionally without a branch: `label && <span>{label}</span>`.
 *
 * PDF page numbers are derived from the 0-based half-open range
 * [mediaStart, mediaEnd): displayed as 1-based inclusive [start+1, end].
 * The range is used only when both bounds are non-null finite integers,
 * mediaStart ≥ 0, and mediaEnd > mediaStart. Any other combination
 * (zero-length, inverted, negative, NaN, Infinity, float) falls back to
 * the bare "📄 PDF" label so a malformed server can never produce an
 * inverted or meaningless page string. A truncated flag appends
 * "(truncated)" to signal partial embedding.
 *
 * Examples:
 *   image, not truncated  → "🖼 Image"
 *   image, truncated      → "🖼 Image (truncated)"
 *   pdf, page 0..1        → "📄 PDF page 1"
 *   pdf, pages 1..3       → "📄 PDF pages 2–3"
 *   pdf, no range         → "📄 PDF"
 *   pdf, zero-length [2,2) → "📄 PDF"
 *   pdf, inverted [5,2)   → "📄 PDF"
 *   text                  → ""
 */
export function formatMediaLabel(hit: Pick<DocindexHit, "mediaType" | "mediaStart" | "mediaEnd" | "truncated">): string {
    const { mediaType, mediaStart, mediaEnd, truncated } = hit;

    let base: string;
    if (mediaType === "image") {
        base = "🖼 Image";
    } else if (mediaType === "pdf") {
        // Valid range: both values must be non-null finite integers, start ≥ 0,
        // and end strictly greater than start. Any other combination (zero-length,
        // inverted, negative, NaN, Infinity, float) falls back to the bare label.
        if (
            mediaStart != null &&
            mediaEnd != null &&
            Number.isInteger(mediaStart) &&
            Number.isInteger(mediaEnd) &&
            mediaStart >= 0 &&
            mediaEnd > mediaStart
        ) {
            const displayStart = mediaStart + 1;      // 0-based → 1-based
            const displayEnd = mediaEnd;               // exclusive end equals 1-based inclusive end
            if (mediaEnd - mediaStart === 1) {
                // Half-open range covers exactly one page.
                base = `📄 PDF page ${displayStart}`;
            } else {
                base = `📄 PDF pages ${displayStart}–${displayEnd}`;
            }
        } else {
            base = "📄 PDF";
        }
    } else {
        // text: no indicator — renders exactly as before
        return "";
    }

    return truncated ? `${base} (truncated)` : base;
}
