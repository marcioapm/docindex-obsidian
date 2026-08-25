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
    // Absent on servers predating v0.3. When absent, no calibrated relevance
    // score exists for this hit — clients must not fall back to `score`.
    score_rrf?: number;
    score_normalized?: number;
    chunk_id: string | number;
    // Optional media fields: absent on old servers. null and undefined both
    // mean "not applicable" — see isHitWire for the validation contract.
    media_type?: MediaType | null;
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
     * Text hits with `scoreNormalized` below this value are hidden from both
     * the sidebar and the semantic-search modal. Range 0.0-1.0. 0 = show
     * everything. 1 = only rank-1-in-both-branches hits. Typical sweet spot:
     * 0.35-0.60. Does not apply to media hits (see `isThresholdEligible`) or
     * to hits from servers that don't supply `scoreNormalized`.
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
 * Returns `hit.scoreNormalized`, or `undefined` when the server didn't
 * supply it (pre-v0.3). RRF (`hit.score`) is not in [0, 1] and must never
 * be used as a display or threshold value — there is no calibrated
 * fallback for legacy responses.
 */
export function getDisplayScore(hit: DocindexHit): number | undefined {
    return hit.scoreNormalized;
}

/**
 * A hit's score can drive `relevanceThreshold` filtering only when it is
 * both present and query-dependent. Media `scoreNormalized` is currently
 * `(k+1)/(k+vector_rank)` — a function of rank, not of the query — so it
 * would either admit the top hit unconditionally or reject genuinely
 * relevant results past a fixed rank. Text scores are query-dependent.
 */
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
