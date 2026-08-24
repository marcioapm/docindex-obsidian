import type { SettingsService } from "@/application/SettingsService";
import { Notice, Setting, SettingGroup, requestUrl, type RequestUrlResponse } from "obsidian";
import type { DocindexClient, RequestUrlFn } from "@/adapter/docindex";
import { isForbiddenTrigger } from "./semanticLinkTrigger";

export type HealthCheckResult =
    | { kind: "missing-url" }
    | { kind: "missing-token" }
    | { kind: "success"; status: number; indexedChunks?: number; embeddingModel?: string }
    | { kind: "authentication-failed" }
    | { kind: "http-error"; status: number }
    | { kind: "malformed" }
    | { kind: "unreachable" };

export interface HealthCheckClient {
    reset(): void;
}

export interface TestDocindexHealthOptions {
    backendUrl: string;
    bearerToken: string;
    requestFn: RequestUrlFn;
    client: HealthCheckClient;
}

export async function testDocindexHealth(options: TestDocindexHealthOptions): Promise<HealthCheckResult> {
    const base = options.backendUrl.trim().replace(/\/+$/, "");
    if (!base) return { kind: "missing-url" };

    const bearerToken = options.bearerToken.trim();
    if (!bearerToken) return { kind: "missing-token" };

    let response: RequestUrlResponse;
    try {
        response = await options.requestFn({
            url: `${base}/health`,
            method: "GET",
            headers: {
                Authorization: `Bearer ${bearerToken}`,
                Accept: "application/json",
            },
            throw: false,
        });
    } catch {
        return { kind: "unreachable" };
    }

    if (response.status < 200 || response.status >= 300) {
        return { kind: "http-error", status: response.status };
    }

    const health = parseHealthResponse(response);
    if (!health) return { kind: "malformed" };
    if (health.authenticated !== true) return { kind: "authentication-failed" };

    options.client.reset();
    return {
        kind: "success",
        status: response.status,
        indexedChunks: typeof health.indexed_chunks === "number" ? health.indexed_chunks : undefined,
        embeddingModel: typeof health.embedding_model === "string" ? health.embedding_model : undefined,
    };
}

function parseHealthResponse(response: RequestUrlResponse): Record<string, unknown> | null {
    let raw: unknown;
    try {
        raw = response.json ?? JSON.parse(response.text ?? "");
    } catch {
        return null;
    }
    if (!isRecord(raw) || raw.ok !== true) return null;
    return raw;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatHealthSuccess(result: Extract<HealthCheckResult, { kind: "success" }>): string {
    const details: string[] = [];
    if (result.indexedChunks !== undefined) details.push(`${result.indexedChunks} chunks`);
    if (result.embeddingModel) details.push(result.embeddingModel);
    const suffix = details.length > 0 ? `: ${details.join(", ")}` : "";
    return `docindex: backend OK (${result.status})${suffix}`;
}

interface DocindexSettingsSectionProps {
    containerEl: HTMLElement;
    settingsService: SettingsService;
    client: DocindexClient;
}

/**
 * Renders the "docindex (remote search)" group in the plugin settings tab.
 *
 * Fields:
 *  - Enabled toggle (routes search/similar through the backend when true).
 *  - Backend URL (e.g. a Tailscale host).
 *  - Bearer token (masked; never persisted to any log).
 *  - Result limit (1..50).
 *  - Relevance threshold (0.0..1.0; hits below the normalized score are hidden).
 *  - Test connection button → GET /health.
 */
export function renderDocindexSection(props: DocindexSettingsSectionProps): void {
    const { containerEl, settingsService, client } = props;
    new SettingGroup(containerEl).setHeading("docindex (remote search)");
    const settings = settingsService.get().docindex;

    new Setting(containerEl)
        .setName("Enable docindex remote search")
        .setDesc(
            "The docindex backend is required for all search. " +
                "When off, the similar-notes sidebar and semantic-search modal return no results."
        )
        .addToggle((toggle) => {
            toggle.setValue(settings.enabled).onChange(async (value) => {
                await settingsService.update({
                    docindex: { ...settingsService.get().docindex, enabled: value },
                });
                client.reset();
            });
        });

    new Setting(containerEl)
        .setName("Backend URL")
        .setDesc("e.g. http://100.64.0.1:7777 (Tailscale). No trailing slash.")
        .addText((text) => {
            text.setPlaceholder("http://100.x.y.z:7777")
                .setValue(settings.backendUrl)
                .onChange(async (value) => {
                    await settingsService.update({
                        docindex: { ...settingsService.get().docindex, backendUrl: value.trim() },
                    });
                    client.reset();
                });
            text.inputEl.type = "url";
            text.inputEl.style.width = "100%";
        });

    new Setting(containerEl)
        .setName("Bearer token")
        .setDesc("Sent as Authorization: Bearer <token>. Never logged.")
        .addText((text) => {
            text.setPlaceholder("paste token").setValue(settings.bearerToken);
            text.inputEl.type = "password";
            text.inputEl.autocomplete = "off";
            text.inputEl.style.width = "100%";
            text.onChange(async (value) => {
                await settingsService.update({
                    docindex: { ...settingsService.get().docindex, bearerToken: value.trim() },
                });
                client.reset();
            });
        });

    new Setting(containerEl)
        .setName("Result limit")
        .setDesc("Maximum number of results per query (1-50).")
        .addText((text) => {
            text.setValue(String(settings.limit)).onChange(async (value) => {
                const num = parseInt(value, 10);
                if (!Number.isNaN(num) && num >= 1 && num <= 50) {
                    await settingsService.update({
                        docindex: { ...settingsService.get().docindex, limit: num },
                    });
                }
            });
            text.inputEl.type = "number";
            text.inputEl.min = "1";
            text.inputEl.max = "50";
            text.inputEl.style.width = "80px";
        });

    new Setting(containerEl)
        .setName("Relevance threshold")
        .setDesc(
            "Drop results with a normalized score below this value. " +
                "0 = show everything the server ranked. " +
                "0.40 ≈ rank ≤ 15 in at least one branch (default). " +
                "Raise toward 0.60 for tighter results."
        )
        .addSlider((slider) => {
            slider
                .setLimits(0, 1, 0.05)
                .setValue(settings.relevanceThreshold)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    await settingsService.update({
                        docindex: {
                            ...settingsService.get().docindex,
                            relevanceThreshold: value,
                        },
                    });
                });
        });

    new Setting(containerEl)
        .setName("Semantic link trigger")
        .setDesc(
            'Character sequence that opens the semantic link suggester in the editor (e.g. ";;"). ' +
                "Clear the field to disable the feature. Must not start with \"[\" (reserved for Obsidian's built-in link suggester)."
        )
        .addText((text) => {
            text.setPlaceholder(";;")
                .setValue(settingsService.get().semanticLinkTrigger)
                .onChange(async (value) => {
                    if (isForbiddenTrigger(value)) {
                        new Notice('docindex: trigger must not start with "[" (reserved for Obsidian\'s link suggester)');
                        return;
                    }
                    await settingsService.update({ semanticLinkTrigger: value });
                });
            text.inputEl.style.width = "80px";
        });

    new Setting(containerEl)
        .setName("Test connection")
        .setDesc("Calls GET /health on the configured backend.")
        .addButton((button) => {
            button.setButtonText("Test").onClick(async () => {
                const cfg = settingsService.get().docindex;
                const result = await testDocindexHealth({
                    backendUrl: cfg.backendUrl,
                    bearerToken: cfg.bearerToken,
                    requestFn: requestUrl,
                    client,
                });
                switch (result.kind) {
                    case "missing-url":
                        new Notice("docindex: set the backend URL first");
                        return;
                    case "missing-token":
                        new Notice("docindex: set the bearer token first");
                        return;
                    case "success":
                        new Notice(formatHealthSuccess(result));
                        return;
                    case "authentication-failed":
                        new Notice("docindex: server reachable but bearer token is missing or wrong");
                        return;
                    case "http-error":
                        new Notice(`docindex: backend returned ${result.status}`);
                        return;
                    case "malformed":
                        new Notice("docindex: backend returned a malformed health response");
                        return;
                    case "unreachable":
                        new Notice("docindex: backend unreachable (Tailscale?)");
                        return;
                }
            });
        });
}
