import { beforeEach, describe, expect, it } from "vitest";
import { SettingsService } from "../SettingsService";
import type { Plugin } from "obsidian";

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

async function loadSettings(data: unknown) {
    const service = new SettingsService(makePlugin(data).plugin);
    await service.load();
    return service.get();
}

const DEFAULT_DOCINDEX = {
    enabled: false,
    backendUrl: "",
    bearerToken: "",
    limit: 10,
    relevanceThreshold: 0.4,
};

const DEFAULT_SETTINGS = {
    noteDisplayMode: "smart",
    showSourceChunk: false,
    sidebarResultCount: 10,
    bottomResultCount: 5,
    docindex: DEFAULT_DOCINDEX,
    semanticLinkTrigger: ";;",
};

describe("SettingsService — load() with no persisted data", () => {
    it("falls back to defaults when loadData() resolves to undefined (fresh install)", async () => {
        expect(await loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    });
});

describe("SettingsService — load() rejects invalid persisted values", () => {
    it("falls back to the complete default settings object when loadData() resolves to a non-record (array with enumerable properties matching setting keys)", async () => {
        const fields = {
            sidebarResultCount: 999,
            bottomResultCount: 999,
            noteDisplayMode: "path",
            showSourceChunk: true,
            semanticLinkTrigger: "!!",
            docindex: { limit: 999 },
        };
        expect(await loadSettings({ ...fields, sidebarResultCount: 20, bottomResultCount: 30, docindex: {} }))
            .toMatchObject({ sidebarResultCount: 20, bottomResultCount: 30 });
        expect(await loadSettings(Object.assign([], fields))).toEqual(DEFAULT_SETTINGS);
    });

    for (const { name, valid, invalid, validResult, fallback } of [
        {
            name: "rejects a string sidebarResultCount instead of letting it reach Math.max/slice",
            valid: { sidebarResultCount: 12 },
            invalid: { sidebarResultCount: "10" },
            validResult: { sidebarResultCount: 12 },
            fallback: { sidebarResultCount: 10 },
        },
        {
            name: "rejects a negative or zero result count",
            valid: { sidebarResultCount: 1, bottomResultCount: 1 },
            invalid: { sidebarResultCount: -5, bottomResultCount: 0 },
            validResult: { sidebarResultCount: 1, bottomResultCount: 1 },
            fallback: { sidebarResultCount: 10, bottomResultCount: 5 },
        },
        {
            name: "rejects a non-integer result count",
            valid: { sidebarResultCount: 3 },
            invalid: { sidebarResultCount: 3.5 },
            validResult: { sidebarResultCount: 3 },
            fallback: { sidebarResultCount: 10 },
        },
        {
            name: "rejects a result count above the allowed range",
            valid: { sidebarResultCount: 100 },
            invalid: { sidebarResultCount: 100000 },
            validResult: { sidebarResultCount: 100 },
            fallback: { sidebarResultCount: 10 },
        },
        {
            name: "rejects an out-of-union noteDisplayMode",
            valid: { noteDisplayMode: "path" },
            invalid: { noteDisplayMode: "banana" },
            validResult: { noteDisplayMode: "path" },
            fallback: { noteDisplayMode: "smart" },
        },
        {
            name: "rejects a non-boolean showSourceChunk",
            valid: { showSourceChunk: true },
            invalid: { showSourceChunk: "yes" },
            validResult: { showSourceChunk: true },
            fallback: { showSourceChunk: false },
        },
        {
            name: "rejects a non-string semanticLinkTrigger",
            valid: { semanticLinkTrigger: "!!" },
            invalid: { semanticLinkTrigger: 42 },
            validResult: { semanticLinkTrigger: "!!" },
            fallback: { semanticLinkTrigger: ";;" },
        },
        {
            name: "rejects a docindex.limit outside 1..50",
            valid: { docindex: { limit: 50 } },
            invalid: { docindex: { limit: 0 } },
            validResult: { docindex: { limit: 50 } },
            fallback: { docindex: { limit: 10 } },
        },
    ]) {
        it(name, async () => {
            expect(await loadSettings(valid)).toMatchObject(validResult);
            expect(await loadSettings(invalid)).toMatchObject(fallback);
        });
    }

    it("rejects a null docindex block entirely, falling back to the complete default docindex object", async () => {
        expect((await loadSettings({ docindex: { enabled: true } })).docindex.enabled).toBe(true);
        expect((await loadSettings({ docindex: null })).docindex).toEqual(DEFAULT_DOCINDEX);
    });

    it("strips unknown keys from an otherwise-valid docindex block instead of persisting them", async () => {
        const settings = await loadSettings({
            docindex: { limit: 20, legacyApiKey: "sk-old-secret" },
        });
        expect(settings.docindex).toEqual({ ...DEFAULT_DOCINDEX, limit: 20 });
    });

    it("rejects an array-shaped docindex block whose own enumerable properties resemble valid fields", async () => {
        const fields = {
            enabled: true,
            backendUrl: "http://evil",
            bearerToken: "stolen",
            limit: 20,
            relevanceThreshold: 0.5,
        };
        expect((await loadSettings({ docindex: fields })).docindex).toEqual(fields);
        expect((await loadSettings({ docindex: Object.assign([], fields) })).docindex).toEqual(DEFAULT_DOCINDEX);
    });

    it("rejects individual invalid docindex fields while keeping valid ones", async () => {
        const { plugin } = makePlugin({
            docindex: {
                enabled: true,
                backendUrl: "http://100.0.0.1:7777",
                bearerToken: "tok",
                limit: "ten",
                relevanceThreshold: 5,
            },
        });
        const service = new SettingsService(plugin);
        await service.load();
        const docindex = service.get().docindex;
        expect(docindex.enabled).toBe(true);
        expect(docindex.backendUrl).toBe("http://100.0.0.1:7777");
        expect(docindex.bearerToken).toBe("tok");
        expect(docindex.limit).toBe(10);
        expect(docindex.relevanceThreshold).toBe(0.4);
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
