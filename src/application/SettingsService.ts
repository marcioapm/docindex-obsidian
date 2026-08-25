import { type Plugin } from "obsidian";
import { type Observable, Subject } from "rxjs";
import { DEFAULT_DOCINDEX_SETTINGS, type DocindexSettings } from "@/adapter/docindex";

/** Remote-only plugin settings. Validated on load; see `validateSettings`. */
export interface SimilarNotesSettings {
    /** How to display note names in results. */
    noteDisplayMode: "title" | "path" | "smart";
    /** Whether to show the original source chunk alongside each result. */
    showSourceChunk: boolean;
    /** Number of similar notes to show in the sidebar. */
    sidebarResultCount: number;
    /** Number of similar notes to show at the bottom of a note. */
    bottomResultCount: number;
    /** docindex-server remote search provider config. */
    docindex: DocindexSettings;
    /** Trigger sequence for the semantic link suggester. Empty string disables it. */
    semanticLinkTrigger: string;
}

const DEFAULT_SETTINGS: SimilarNotesSettings = {
    noteDisplayMode: "smart",
    showSourceChunk: false,
    sidebarResultCount: 10,
    bottomResultCount: 5,
    docindex: DEFAULT_DOCINDEX_SETTINGS,
    semanticLinkTrigger: ";;",
};

const NOTE_DISPLAY_MODES = new Set(["title", "path", "smart"]);
const MAX_RESULT_COUNT = 100;

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validBool(v: unknown, fallback: boolean): boolean {
    return typeof v === "boolean" ? v : fallback;
}

function validString(v: unknown, fallback: string): string {
    return typeof v === "string" ? v : fallback;
}

/** A finite integer within [min, max]; anything else falls back to the default. */
function validInt(v: unknown, fallback: number, min: number, max: number): number {
    return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

/** A finite number within [min, max]; anything else falls back to the default. */
function validFiniteRange(v: unknown, fallback: number, min: number, max: number): number {
    return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

function validNoteDisplayMode(v: unknown): SimilarNotesSettings["noteDisplayMode"] {
    return typeof v === "string" && NOTE_DISPLAY_MODES.has(v)
        ? (v as SimilarNotesSettings["noteDisplayMode"])
        : DEFAULT_SETTINGS.noteDisplayMode;
}

function validateDocindex(v: unknown): DocindexSettings {
    if (!isRecord(v)) return { ...DEFAULT_DOCINDEX_SETTINGS };
    return {
        enabled: validBool(v.enabled, DEFAULT_DOCINDEX_SETTINGS.enabled),
        backendUrl: validString(v.backendUrl, DEFAULT_DOCINDEX_SETTINGS.backendUrl),
        bearerToken: validString(v.bearerToken, DEFAULT_DOCINDEX_SETTINGS.bearerToken),
        limit: validInt(v.limit, DEFAULT_DOCINDEX_SETTINGS.limit, 1, 50),
        relevanceThreshold: validFiniteRange(
            v.relevanceThreshold,
            DEFAULT_DOCINDEX_SETTINGS.relevanceThreshold,
            0,
            1
        ),
    };
}

/**
 * Validates `plugin.loadData()` output, which is untrusted: it can be
 * hand-edited, left over from an older schema, or simply malformed. Every
 * field falls back to its default rather than propagating an invalid type,
 * a string where a count is expected, or an out-of-range number. Fields
 * from pre-remote-only versions (model provider, OpenAI/Gemini API keys,
 * GPU/indexing/exclusion settings) are not read here and are dropped the
 * next time settings are saved.
 */
function validateSettings(data: unknown): SimilarNotesSettings {
    if (!isRecord(data)) return { ...DEFAULT_SETTINGS };
    return {
        noteDisplayMode: validNoteDisplayMode(data.noteDisplayMode),
        showSourceChunk: validBool(data.showSourceChunk, DEFAULT_SETTINGS.showSourceChunk),
        sidebarResultCount: validInt(data.sidebarResultCount, DEFAULT_SETTINGS.sidebarResultCount, 1, MAX_RESULT_COUNT),
        bottomResultCount: validInt(data.bottomResultCount, DEFAULT_SETTINGS.bottomResultCount, 1, MAX_RESULT_COUNT),
        docindex: validateDocindex(data.docindex),
        semanticLinkTrigger: validString(data.semanticLinkTrigger, DEFAULT_SETTINGS.semanticLinkTrigger),
    };
}

export class SettingsService {
    private settings: SimilarNotesSettings = { ...DEFAULT_SETTINGS };
    private newSettingsObservable$ = new Subject<
        Partial<SimilarNotesSettings>
    >();

    constructor(private plugin: Plugin) {}

    async load(): Promise<void> {
        const data: unknown = await this.plugin.loadData();
        this.settings = validateSettings(data);
    }

    async save(): Promise<void> {
        await this.plugin.saveData(this.settings);
    }

    get(): SimilarNotesSettings {
        return this.settings;
    }

    getNewSettingsObservable(): Observable<Partial<SimilarNotesSettings>> {
        return this.newSettingsObservable$.asObservable();
    }

    async update(newSettings: Partial<SimilarNotesSettings>): Promise<void> {
        this.settings = { ...this.settings, ...newSettings };
        await this.save();

        this.newSettingsObservable$.next(newSettings);
    }
}
