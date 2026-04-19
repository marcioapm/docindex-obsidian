import type { SettingsService } from "@/application/SettingsService";
import type { DocindexClient } from "@/adapter/docindex";
import log from "loglevel";
import { PluginSettingTab, Setting, SettingGroup } from "obsidian";
import type MainPlugin from "../main";
import { renderDocindexSection } from "./DocindexSettingsSection";

/**
 * Settings tab for obsidian-docindex.
 *
 * Two sections only:
 *   1. Docindex backend — URL, bearer token, limit, enabled toggle, test.
 *   2. Debug — log level.
 *
 * No local-indexing / model / folder-exclusion / usage-stats / env-dump UI;
 * the plugin is a thin remote-only client.
 */
export class SimilarNotesSettingTab extends PluginSettingTab {
    constructor(
        private plugin: MainPlugin,
        private settingsService: SettingsService,
        private docindexClient: DocindexClient
    ) {
        super(plugin.app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        renderDocindexSection({
            containerEl,
            settingsService: this.settingsService,
            client: this.docindexClient,
        });

        new SettingGroup(containerEl).setHeading("Debug");
        new Setting(containerEl)
            .setName("Log level")
            .setDesc("Logging verbosity for plugin output.")
            .addDropdown((dropdown) => {
                dropdown
                    .addOption(log.levels.TRACE.toString(), "TRACE")
                    .addOption(log.levels.DEBUG.toString(), "DEBUG")
                    .addOption(log.levels.INFO.toString(), "INFO")
                    .addOption(log.levels.WARN.toString(), "WARN")
                    .addOption(log.levels.ERROR.toString(), "ERROR")
                    .addOption(log.levels.SILENT.toString(), "SILENT")
                    .setValue(log.getLevel().toString())
                    .onChange((value) => {
                        this.plugin.setLogLevel(
                            Number(value) as log.LogLevelDesc
                        );
                    });
            });
    }
}
