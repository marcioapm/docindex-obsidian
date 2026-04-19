import type { App, Plugin } from "obsidian";
import type { SettingsService } from "@/application/SettingsService";
import type { TextSearchResult } from "@/adapter/docindex";
import { SemanticSearchModal } from "@/components/SemanticSearchModal";
import type { Command } from "./Command";

/**
 * Minimal structural surface the command depends on. Satisfied by
 * `RemoteSearchService`.
 */
interface TextSearchServiceLike {
    findSimilarNotesFromText(text: string, limit?: number): Promise<TextSearchResult>;
    checkTokenLimit(text: string): Promise<{ tokenCount: number; maxTokens: number; isOverLimit: boolean }>;
}

export class SemanticSearchCommand implements Command {
    id = "semantic-search";
    name = "Semantic search";

    constructor(
        private app: App,
        private textSearchService: TextSearchServiceLike,
        private settingsService: SettingsService
    ) {}

    register(plugin: Plugin): void {
        plugin.addCommand({
            id: this.id,
            name: this.name,
            hotkeys: [
                {
                    modifiers: ["Mod", "Shift"],
                    key: "o",
                },
            ],
            callback: () => {
                const settings = this.settingsService.get();
                const modal = new SemanticSearchModal(
                    this.app,
                    this.textSearchService,
                    settings.noteDisplayMode
                );
                modal.open();
            },
        });
    }
}
