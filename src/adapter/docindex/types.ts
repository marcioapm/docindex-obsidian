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
}

export const DEFAULT_DOCINDEX_SETTINGS: DocindexSettings = {
    enabled: false,
    backendUrl: "",
    bearerToken: "",
    limit: 10,
};
