import type { App, Plugin } from "obsidian";
import type { SettingsService } from "@/application/SettingsService";
import type { TextSearchResult } from "@/domain/service/TextSearchService";
import { SemanticSearchModal } from "@/components/SemanticSearchModal";
import type { Command } from "./Command";

/**
 * Structural surface the command depends on — lets us pass either the
 * upstream TextSearchService or the docindex SearchDispatcher.
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
