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
    it("falls back to defaults when loadData() resolves to a non-object", async () => {
        const { plugin } = makePlugin("not an object");
        const service = new SettingsService(plugin);
        await service.load();
        expect(service.get().sidebarResultCount).toBe(10);
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

    it("rejects a null docindex block entirely, falling back to defaults", async () => {
        const { plugin } = makePlugin({ docindex: null });
        const service = new SettingsService(plugin);
        await service.load();
        expect(service.get().docindex.limit).toBe(10);
        expect(service.get().docindex.relevanceThreshold).toBe(0.4);
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
