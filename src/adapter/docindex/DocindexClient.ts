import { Notice, requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";
import log from "loglevel";
import { sanitizeErrorForLog } from "@/utils/errorSanitizer";
import {
    getDisplayScore,
    isThresholdEligible,
    KNOWN_MEDIA_TYPES,
    type DocindexHit,
    type DocindexHitWire,
    type DocindexSearchResponse,
    type DocindexSearchResponseWire,
    type DocindexSettings,
} from "./types";

export type DocindexErrorKind =
    | "not-configured"
    | "network"
    | "unauthorized"
    | "server"
    | "malformed";

export class DocindexError extends Error {
    constructor(public readonly kind: DocindexErrorKind, message: string, public readonly status?: number) {
        super(message);
        this.name = "DocindexError";
    }
}

export type RequestUrlFn = (req: RequestUrlParam) => Promise<RequestUrlResponse>;

/**
 * Thin adapter over the docindex-server HTTP API.
 *
 * - Uses Obsidian's `requestUrl` (NOT `fetch`) because `fetch` has CORS/TLS
 *   quirks on iOS/Android. `requestUrl` is injected in tests.
 * - Runtime-validates responses; unexpected shapes surface one `Notice` and
 *   the caller is expected to disable the provider for the session.
 * - Bearer token is never logged. Only the URL + non-sensitive fields appear
 *   in debug output.
 */
export class DocindexClient {
    private disabledForSession = false;

    constructor(
        private readonly getSettings: () => DocindexSettings,
        private readonly request: RequestUrlFn = requestUrl
    ) {}

    isAvailable(): boolean {
        if (this.disabledForSession) return false;
        const s = this.getSettings();
        return s.enabled && s.backendUrl.trim().length > 0 && s.bearerToken.trim().length > 0;
    }

    reset(): void {
        this.disabledForSession = false;
    }

    async search(query: string, limit?: number): Promise<DocindexSearchResponse> {
        return this.post("/search", { query, limit: limit ?? this.getSettings().limit });
    }

    async similar(path: string, limit?: number): Promise<DocindexSearchResponse> {
        return this.post("/similar", { path, limit: limit ?? this.getSettings().limit });
    }

    private async post(endpoint: string, body: Record<string, unknown>): Promise<DocindexSearchResponse> {
        if (this.disabledForSession) {
            throw new DocindexError("not-configured", "provider disabled for this session (malformed response)");
        }
        const settings = this.getSettings();
        if (!settings.enabled) {
            throw new DocindexError("not-configured", "docindex is disabled");
        }
        const base = settings.backendUrl.trim().replace(/\/+$/, "");
        if (!base) {
            throw new DocindexError("not-configured", "docindex backend URL is empty");
        }
        if (!settings.bearerToken.trim()) {
            throw new DocindexError("not-configured", "docindex bearer token is empty");
        }

        const url = `${base}${endpoint}`;
        log.debug(`[docindex] POST ${endpoint}`); // no token, no payload

        let resp: RequestUrlResponse;
        try {
            resp = await this.request({
                url,
                method: "POST",
                contentType: "application/json",
                headers: {
                    Authorization: `Bearer ${settings.bearerToken}`,
                    Accept: "application/json",
                },
                body: JSON.stringify(body),
                throw: false,
            });
        } catch (err) {
            log.debug(`[docindex] network error: ${sanitizeErrorForLog(err, settings.bearerToken)}`);
            this.notify("docindex: backend unreachable (Tailscale?)");
            throw new DocindexError("network", "backend unreachable");
        }

        if (resp.status === 401 || resp.status === 403) {
            this.notify("docindex: bearer token missing or wrong");
            throw new DocindexError("unauthorized", `auth failed (${resp.status})`, resp.status);
        }
        if (resp.status >= 400) {
            this.notify(`docindex: server error ${resp.status}`);
            throw new DocindexError("server", `server returned ${resp.status}`, resp.status);
        }

        const parsed = this.parseResponse(resp);
        if (!parsed) {
            this.notify("docindex: malformed response — provider disabled for this session");
            this.disabledForSession = true;
            throw new DocindexError("malformed", "response did not match expected shape");
        }
        return { hits: filterByThreshold(parsed.hits, settings.relevanceThreshold) };
    }

    private parseResponse(resp: RequestUrlResponse): DocindexSearchResponse | null {
        let raw: unknown;
        try {
            raw = resp.json ?? JSON.parse(resp.text ?? "");
        } catch {
            return null;
        }
        if (!isSearchResponseWire(raw)) {
            return null;
        }
        return { hits: raw.hits.map(toDomainHit) };
    }

    private notify(message: string): void {
        new Notice(message);
    }
}

function toDomainHit(wire: DocindexHitWire): DocindexHit {
    let headingPath: string[] = [];
    if (Array.isArray(wire.heading_path)) {
        headingPath = wire.heading_path;
    } else if (typeof wire.heading_path === "string" && wire.heading_path.length > 0) {
        // The server may prefix the heading chain with "filename - ".
        const first = wire.heading_path.split(" - ", 2);
        const body = first.length === 2 ? first[1] : first[0];
        headingPath = body.split(" > ").filter((s) => s.length > 0);
    }
    return {
        path: wire.path,
        title: wire.title,
        headingPath,
        snippet: wire.snippet,
        score: wire.score,
        scoreRrf: wire.score_rrf,
        scoreNormalized: wire.score_normalized,
        chunkId: String(wire.chunk_id),
        // Missing and unknown server variants degrade without rejecting other hits.
        mediaType: wire.media_type == null
            ? "text"
            : KNOWN_MEDIA_TYPES.has(wire.media_type)
                ? (wire.media_type as DocindexHit["mediaType"])
                : "other",
        mimeType: wire.mime_type,
        mediaStart: wire.media_start,
        mediaEnd: wire.media_end,
        mediaUnit: wire.media_unit,
        truncated: wire.truncated ?? undefined,
    };
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Filters calibrated text scores; media and uncalibrated hits always pass. */
export function filterByThreshold(hits: DocindexHit[], threshold: number): DocindexHit[] {
    if (!(threshold > 0)) return hits;
    return hits.filter((h) => {
        if (!isThresholdEligible(h)) return true;
        const score = getDisplayScore(h);
        return score !== undefined && score >= threshold;
    });
}

function isHitWire(v: unknown): v is DocindexHitWire {
    if (!isRecord(v)) return false;
    if (typeof v.path !== "string") return false;
    if (typeof v.title !== "string") return false;
    if (typeof v.snippet !== "string") return false;
    if (typeof v.score !== "number" || !Number.isFinite(v.score)) return false;
    if (typeof v.chunk_id !== "string" && typeof v.chunk_id !== "number") return false;
    if (v.score_rrf !== undefined && (typeof v.score_rrf !== "number" || !Number.isFinite(v.score_rrf))) {
        return false;
    }
    if (v.score_normalized !== undefined) {
        if (typeof v.score_normalized !== "number" || !Number.isFinite(v.score_normalized)) return false;
        if (v.score_normalized < 0 || v.score_normalized > 1) return false;
    }
    if (v.heading_path !== null && v.heading_path !== undefined) {
        if (Array.isArray(v.heading_path)) {
            if (!v.heading_path.every((x) => typeof x === "string")) return false;
        } else if (typeof v.heading_path !== "string") {
            return false;
        }
    }
    // Unknown media_type strings are valid and map to "other".
    if (v.media_type != null && typeof v.media_type !== "string") return false;
    if (v.mime_type !== undefined && v.mime_type !== null && typeof v.mime_type !== "string") return false;
    if (v.media_start !== undefined && v.media_start !== null && typeof v.media_start !== "number") return false;
    if (v.media_end !== undefined && v.media_end !== null && typeof v.media_end !== "number") return false;
    if (v.media_unit !== undefined && v.media_unit !== null && typeof v.media_unit !== "string") return false;
    if (v.truncated != null && typeof v.truncated !== "boolean") return false;
    return true;
}

function isSearchResponseWire(v: unknown): v is DocindexSearchResponseWire {
    if (!isRecord(v)) return false;
    if (!Array.isArray(v.hits)) return false;
    return v.hits.every(isHitWire);
}
