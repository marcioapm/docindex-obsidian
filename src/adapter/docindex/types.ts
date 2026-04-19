/**
 * Response types from the docindex-server backend.
 *
 * Wire format (snake_case) matches the Rust server. We keep the server's
 * naming on the network and camelCase on domain objects — conversion lives
 * in `DocindexClient`.
 */

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
