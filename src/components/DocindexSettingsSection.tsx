import type { SettingsService } from "@/application/SettingsService";
import { Notice, Setting, SettingGroup, requestUrl } from "obsidian";
import type { DocindexClient } from "@/adapter/docindex";

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
            "When on, semantic search and similar-notes are served by a docindex-server backend. " +
                "When off, the upstream local provider is used."
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
                const base = cfg.backendUrl.trim().replace(/\/+$/, "");
                if (!base) {
                    new Notice("docindex: set the backend URL first");
                    return;
                }
                try {
                    const resp = await requestUrl({
                        url: `${base}/health`,
                        method: "GET",
                        throw: false,
                    });
                    if (resp.status >= 200 && resp.status < 300) {
                        new Notice(`docindex: backend OK (${resp.status})`);
                    } else {
                        new Notice(`docindex: backend returned ${resp.status}`);
                    }
                } catch {
                    new Notice("docindex: backend unreachable (Tailscale?)");
                }
            });
        });
}
