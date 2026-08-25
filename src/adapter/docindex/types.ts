/**
 * Response types from the docindex-server backend.
 *
 * Wire format (snake_case) matches the Rust server. We keep the server's
 * naming on the network and camelCase on domain objects — conversion lives
 * in `DocindexClient`.
 */

/** Known server media variants plus a fallback for unknown strings. */
export type MediaType = "text" | "image" | "pdf" | "audio" | "video" | "other";

/** Media types the server enum currently defines. */
export const KNOWN_MEDIA_TYPES: ReadonlySet<string> = new Set<MediaType>([
    "text",
    "image",
    "pdf",
    "audio",
    "video",
]);

export interface DocindexHitWire {
    path: string;
    title: string;
    // Server sends either a pre-joined string (current form) or an array of
    // heading segments. Accept both — `DocindexClient` normalizes to string[].
    heading_path: string | string[] | null;
    snippet: string;
    score: number;
    // Absent when the server supplies no calibrated relevance score.
    score_rrf?: number;
    score_normalized?: number;
    chunk_id: string | number;
    // Bare string allows unknown server variants to degrade to "other".
    media_type?: string | null;
    mime_type?: string | null;
    /** 0-based start of the half-open page range [media_start, media_end). */
    media_start?: number | null;
    /** 0-based exclusive end of the page range. */
    media_end?: number | null;
    media_unit?: string | null;
    truncated?: boolean | null;
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
     * Calibrated 0..1 relevance score for text hits. For non-text hits this
     * currently holds `(k+1)/(k+vector_rank)` — a vector-rank position, not
     * a relevance measure — so it must not drive filtering or percentage
     * display for media. Absent on servers predating v0.3.
     */
    scoreNormalized?: number;
    chunkId: string;
    /** Defaults to "text" when absent from the wire payload. */
    mediaType: MediaType;
    mimeType?: string | null;
    /** 0-based start of the half-open page range [mediaStart, mediaEnd). Null = not paginated. */
    mediaStart?: number | null;
    /** 0-based exclusive end of the page range. Null = not paginated. */
    mediaEnd?: number | null;
    mediaUnit?: string | null;
    /** Undefined when absent from the wire payload. */
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
    /** Minimum calibrated text score in [0, 1]; 0 disables filtering. */
    relevanceThreshold: number;
}

export const DEFAULT_DOCINDEX_SETTINGS: DocindexSettings = {
    enabled: false,
    backendUrl: "",
    bearerToken: "",
    limit: 10,
    relevanceThreshold: 0.4,
};

/** Returns the calibrated score, with no RRF fallback. */
export function getDisplayScore(hit: DocindexHit): number | undefined {
    return hit.scoreNormalized;
}

/** Media scores are rank-derived and cannot drive thresholds or percentages. */
export function isThresholdEligible(hit: DocindexHit): boolean {
    return hit.scoreNormalized !== undefined && hit.mediaType === "text";
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
        if (
            mediaStart != null &&
            mediaEnd != null &&
            Number.isInteger(mediaStart) &&
            Number.isInteger(mediaEnd) &&
            mediaStart >= 0 &&
            mediaEnd > mediaStart
        ) {
            const displayStart = mediaStart + 1;
            const displayEnd = mediaEnd;
            if (mediaEnd - mediaStart === 1) {
                base = `📄 PDF page ${displayStart}`;
            } else {
                base = `📄 PDF pages ${displayStart}–${displayEnd}`;
            }
        } else {
            base = "📄 PDF";
        }
    } else if (mediaType === "audio") {
        base = "🎵 Audio";
    } else if (mediaType === "video") {
        base = "🎬 Video";
    } else if (mediaType === "other") {
        base = "📎 Media";
    } else {
        return "";
    }

    return truncated ? `${base} (truncated)` : base;
}
