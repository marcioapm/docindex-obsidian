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
    // Optional media fields: absent on old servers. null and undefined both
    // mean "not applicable" — see isHitWire for the validation contract.
    media_type?: MediaType;
    mime_type?: string | null;
    /** 0-based start of the half-open page range [media_start, media_end). */
    media_start?: number | null;
    /** 0-based exclusive end of the page range. */
    media_end?: number | null;
    media_unit?: string | null;
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
    /** Defaults to "text" when absent from the wire payload (old servers). */
    mediaType: MediaType;
    mimeType?: string | null;
    /** 0-based start of the half-open page range [mediaStart, mediaEnd). Null = not paginated. */
    mediaStart?: number | null;
    /** 0-based exclusive end of the page range. Null = not paginated. */
    mediaEnd?: number | null;
    mediaUnit?: string | null;
    /** Undefined when absent from wire; treat as false. */
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
 * Returns a human-readable label for the media type of a hit, or `""` for
 * text hits (so callers can use `label && <span>{label}</span>` without a
 * branch).
 *
 * PDF page numbers use the 0-based half-open range [mediaStart, mediaEnd)
 * converted to 1-based inclusive display. Degenerate ranges (zero-length,
 * inverted, negative, NaN, Infinity, float) fall back to the bare "📄 PDF"
 * label. `truncated` appends " (truncated)".
 *
 * Examples: `{ mediaType:"pdf", mediaStart:0, mediaEnd:1 }` → "📄 PDF page 1"
 *           `{ mediaType:"image", truncated:true }` → "🖼 Image (truncated)"
 */
export function formatMediaLabel(hit: Pick<DocindexHit, "mediaType" | "mediaStart" | "mediaEnd" | "truncated">): string {
    const { mediaType, mediaStart, mediaEnd, truncated } = hit;

    let base: string;
    if (mediaType === "image") {
        base = "🖼 Image";
    } else if (mediaType === "pdf") {
        // Requires non-null finite integers, mediaStart ≥ 0, mediaEnd > mediaStart.
        if (
            mediaStart != null &&
            mediaEnd != null &&
            Number.isInteger(mediaStart) &&
            Number.isInteger(mediaEnd) &&
            mediaStart >= 0 &&
            mediaEnd > mediaStart
        ) {
            const displayStart = mediaStart + 1;      // 0-based → 1-based
            const displayEnd = mediaEnd;               // exclusive end = 1-based inclusive end
            if (mediaEnd - mediaStart === 1) {
                base = `📄 PDF page ${displayStart}`;
            } else {
                base = `📄 PDF pages ${displayStart}–${displayEnd}`;
            }
        } else {
            base = "📄 PDF";
        }
    } else {
        return "";
    }

    return truncated ? `${base} (truncated)` : base;
}
