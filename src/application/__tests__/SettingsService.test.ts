import { beforeEach, describe, expect, it } from "vitest";
import { SettingsService } from "../SettingsService";
import type { Plugin } from "obsidian";

/** Minimal Plugin stub: only loadData/saveData are read by SettingsService. */
function makePlugin(loadResult: unknown): { plugin: Plugin; saved: unknown[] } {
    const saved: unknown[] = [];
    const plugin = {
        loadData: async () => loadResult,
        saveData: async (data: unknown) => {
            saved.push(data);
        },
    } as unknown as Plugin;
    return { plugin, saved };
}

describe("SettingsService — load() with no persisted data", () => {
    it("falls back to defaults when loadData() resolves to undefined (fresh install)", async () => {
        const { plugin } = makePlugin(undefined);
        const service = new SettingsService(plugin);
        await service.load();
        const settings = service.get();
        expect(settings.noteDisplayMode).toBe("smart");
        expect(settings.sidebarResultCount).toBe(10);
        expect(settings.bottomResultCount).toBe(5);
        expect(settings.showSourceChunk).toBe(false);
        expect(settings.semanticLinkTrigger).toBe(";;");
        expect(settings.docindex).toEqual({
            enabled: false,
            backendUrl: "",
            bearerToken: "",
            limit: 10,
            relevanceThreshold: 0.4,
        });
    });
});

describe("SettingsService — load() rejects invalid persisted values", () => {
    it("falls back to the complete default settings object when loadData() resolves to a non-record (array with enumerable properties matching setting keys)", async () => {
        // A validator that only checks nested field types but not the shape of
        // `data` itself (e.g. a spread-based loader) would merge these
        // enumerable properties directly onto DEFAULT_SETTINGS since arrays
        // spread their own properties like any object. isRecord's
        // `!Array.isArray` check must reject this before any field is read.
        const corrupt = Object.assign([], {
            sidebarResultCount: 999,
            bottomResultCount: 999,
            noteDisplayMode: "path",
            showSourceChunk: true,
            semanticLinkTrigger: "!!",
            docindex: { limit: 999 },
        });
        const { plugin } = makePlugin(corrupt);
        const service = new SettingsService(plugin);
        await service.load();
        expect(service.get()).toEqual({
            noteDisplayMode: "smart",
            showSourceChunk: false,
            sidebarResultCount: 10,
            bottomResultCount: 5,
            docindex: {
                enabled: false,
                backendUrl: "",
                bearerToken: "",
                limit: 10,
                relevanceThreshold: 0.4,
            },
            semanticLinkTrigger: ";;",
        });
    });

    it("rejects a string sidebarResultCount instead of letting it reach Math.max/slice", async () => {
        const { plugin } = makePlugin({ sidebarResultCount: "10" });
        const service = new SettingsService(plugin);
        await service.load();
        expect(service.get().sidebarResultCount).toBe(10);
        expect(typeof service.get().sidebarResultCount).toBe("number");
    });

    it("rejects a negative or zero result count", async () => {
        const { plugin } = makePlugin({ sidebarResultCount: -5, bottomResultCount: 0 });
        const service = new SettingsService(plugin);
        await service.load();
        expect(service.get().sidebarResultCount).toBe(10);
        expect(service.get().bottomResultCount).toBe(5);
    });

    it("rejects a non-integer result count", async () => {
        const { plugin } = makePlugin({ sidebarResultCount: 3.5 });
        const service = new SettingsService(plugin);
        await service.load();
        expect(service.get().sidebarResultCount).toBe(10);
    });

    it("rejects a result count above the allowed range", async () => {
        const { plugin } = makePlugin({ sidebarResultCount: 100000 });
        const service = new SettingsService(plugin);
        await service.load();
        expect(service.get().sidebarResultCount).toBe(10);
    });

    it("rejects an out-of-union noteDisplayMode", async () => {
        const { plugin } = makePlugin({ noteDisplayMode: "banana" });
        const service = new SettingsService(plugin);
        await service.load();
        expect(service.get().noteDisplayMode).toBe("smart");
    });

    it("rejects a non-boolean showSourceChunk", async () => {
        const { plugin } = makePlugin({ showSourceChunk: "yes" });
        const service = new SettingsService(plugin);
        await service.load();
        expect(service.get().showSourceChunk).toBe(false);
    });

    it("rejects a non-string semanticLinkTrigger", async () => {
        const { plugin } = makePlugin({ semanticLinkTrigger: 42 });
        const service = new SettingsService(plugin);
        await service.load();
        expect(service.get().semanticLinkTrigger).toBe(";;");
    });

    it("rejects a null docindex block entirely, falling back to the complete default docindex object", async () => {
        const { plugin } = makePlugin({ docindex: null });
        const service = new SettingsService(plugin);
        await service.load();
        expect(service.get().docindex).toEqual({
            enabled: false,
            backendUrl: "",
            bearerToken: "",
            limit: 10,
            relevanceThreshold: 0.4,
        });
    });

    it("strips unknown keys from an otherwise-valid docindex block instead of persisting them", async () => {
        // A spread-based loader (`{ ...DEFAULT_DOCINDEX_SETTINGS, ...data.docindex }`)
        // would carry an unrecognized key straight through; the allowlisted
        // object built field-by-field cannot.
        const { plugin } = makePlugin({
            docindex: { limit: 20, legacyApiKey: "sk-old-secret" },
        });
        const service = new SettingsService(plugin);
        await service.load();
        expect(service.get().docindex).toEqual({
            enabled: false,
            backendUrl: "",
            bearerToken: "",
            limit: 20,
            relevanceThreshold: 0.4,
        });
    });

    it("rejects an array-shaped docindex block whose own enumerable properties resemble valid fields", async () => {
        // Array.isArray(data.docindex) must be excluded by isRecord before any
        // field is read — a spread-based loader would merge these enumerable
        // array properties (assigned like object fields) directly onto
        // DEFAULT_DOCINDEX_SETTINGS.
        const corruptDocindex = Object.assign([], {
            enabled: true,
            backendUrl: "http://evil",
            bearerToken: "stolen",
            limit: 999,
            relevanceThreshold: 999,
        });
        const { plugin } = makePlugin({ docindex: corruptDocindex });
        const service = new SettingsService(plugin);
        await service.load();
        expect(service.get().docindex).toEqual({
            enabled: false,
            backendUrl: "",
            bearerToken: "",
            limit: 10,
            relevanceThreshold: 0.4,
        });
    });

    it("rejects individual invalid docindex fields while keeping valid ones", async () => {
        const { plugin } = makePlugin({
            docindex: {
                enabled: true,
                backendUrl: "http://100.0.0.1:7777",
                bearerToken: "tok",
                limit: "ten", // invalid: not a number
                relevanceThreshold: 5, // invalid: out of [0,1]
            },
        });
        const service = new SettingsService(plugin);
        await service.load();
        const docindex = service.get().docindex;
        expect(docindex.enabled).toBe(true);
        expect(docindex.backendUrl).toBe("http://100.0.0.1:7777");
        expect(docindex.bearerToken).toBe("tok");
        expect(docindex.limit).toBe(10); // fell back to default
        expect(docindex.relevanceThreshold).toBe(0.4); // fell back to default
    });

    it("rejects a docindex.limit outside 1..50", async () => {
        const { plugin } = makePlugin({ docindex: { limit: 0 } });
        const service = new SettingsService(plugin);
        await service.load();
        expect(service.get().docindex.limit).toBe(10);
    });
});

describe("SettingsService — obsolete provider fields are dropped", () => {
    it("does not re-persist openaiApiKey/geminiApiKey/modelProvider present in old data.json", async () => {
        const { plugin, saved } = makePlugin({
            modelProvider: "openai",
            openaiApiKey: "sk-old-secret",
            geminiApiKey: "gemini-old-secret",
            useGPU: true,
            sidebarResultCount: 10,
        });
        const service = new SettingsService(plugin);
        await service.load();
        await service.save();

        expect(saved).toHaveLength(1);
        const persisted = saved[0] as Record<string, unknown>;
        expect(persisted).not.toHaveProperty("openaiApiKey");
        expect(persisted).not.toHaveProperty("geminiApiKey");
        expect(persisted).not.toHaveProperty("modelProvider");
        expect(persisted).not.toHaveProperty("useGPU");
        expect(JSON.stringify(persisted)).not.toContain("sk-old-secret");
        expect(JSON.stringify(persisted)).not.toContain("gemini-old-secret");
    });
});

describe("SettingsService — update()/save() round trip", () => {
    let service: SettingsService;
    let saved: unknown[];

    beforeEach(async () => {
        const built = makePlugin(undefined);
        saved = built.saved;
        service = new SettingsService(built.plugin);
        await service.load();
    });

    it("persists a partial update merged onto current settings", async () => {
        await service.update({ sidebarResultCount: 20 });
        expect(service.get().sidebarResultCount).toBe(20);
        expect(saved).toHaveLength(1);
        expect((saved[0] as Record<string, unknown>).sidebarResultCount).toBe(20);
    });

    it("emits the partial update on the settings observable", async () => {
        const emitted: unknown[] = [];
        service.getNewSettingsObservable().subscribe((s) => emitted.push(s));
        await service.update({ showSourceChunk: true });
        expect(emitted).toEqual([{ showSourceChunk: true }]);
    });
});
