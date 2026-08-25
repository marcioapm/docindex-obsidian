import log from "loglevel";
import { Plugin, type TFile } from "obsidian";
import { DocindexClient, RemoteSearchService } from "./adapter/docindex";
import { registerActiveNoteStartup } from "./application/registerActiveNoteStartup";
import { SettingsService } from "./application/SettingsService";
import { SimilarNoteCoordinator } from "./application/SimilarNoteCoordinator";
import {
    SemanticSearchCommand,
    ShowSimilarNotesCommand,
    type Command,
} from "./commands";
import { SemanticLinkSuggest } from "./components/SemanticLinkSuggest";
import { SimilarNotesSettingTab } from "./components/SimilarNotesSettingTab";
import { SimilarNotesSidebarView } from "./components/SimilarNotesSidebarView";
import { VIEW_TYPE_SIMILAR_NOTES_SIDEBAR } from "./constants/viewTypes";

/**
 * docindex-obsidian — a thin remote-only client.
 *
 * All indexing lives on a docindex-server backend (Tailscale-reachable). This
 * plugin:
 *   - reads the active TFile's path, sends it to `/similar` for the sidebar
 *   - sends free-text queries to `/search` for the semantic-search modal
 *
 * It never embeds, never chunks, never opens IndexedDB, never spawns a worker.
 */
export default class MainPlugin extends Plugin {
    private settingsService!: SettingsService;
    private docindexClient!: DocindexClient;
    private remoteSearchService!: RemoteSearchService;
    private similarNoteCoordinator!: SimilarNoteCoordinator;
    private settingTab!: SimilarNotesSettingTab;
    private commands: Command[] = [];

    async onload() {
        log.setDefaultLevel(log.levels.INFO);
        log.info("Loading docindex-obsidian");

        this.settingsService = new SettingsService(this);
        await this.settingsService.load();

        this.docindexClient = new DocindexClient(
            () => this.settingsService.get().docindex
        );
        this.remoteSearchService = new RemoteSearchService(this.docindexClient);

        this.settingTab = new SimilarNotesSettingTab(
            this,
            this.settingsService,
            this.docindexClient
        );
        this.addSettingTab(this.settingTab);

        this.similarNoteCoordinator = new SimilarNoteCoordinator(
            this.app.vault,
            this.remoteSearchService,
            this.settingsService
        );

        this.registerEvent(
            this.app.workspace.on("file-open", async (file) => {
                await this.similarNoteCoordinator.onFileOpen(file);
            })
        );

        // file-open only fires for future switches — a note already active
        // when the plugin loads (e.g. on Obsidian restart) would otherwise
        // leave the sidebar/bottom view empty until the user changes files.
        registerActiveNoteStartup(this.app.workspace, this.similarNoteCoordinator);

        this.registerView(
            VIEW_TYPE_SIMILAR_NOTES_SIDEBAR,
            (leaf) =>
                new SimilarNotesSidebarView(
                    leaf,
                    this.similarNoteCoordinator.getNoteBottomViewModelObservable()
                )
        );

        this.addRibbonIcon("files", "Open Similar Notes", () => {
            this.activateSimilarNotesView();
        });

        this.registerCommands();
        this.registerEditorDropEvent();
        this.registerEditorSuggest(
            new SemanticLinkSuggest(
                this.app,
                this.remoteSearchService,
                this.settingsService
            )
        );
    }

    private registerEditorDropEvent() {
        // Let users drag a similar-note result into the active editor as a
        // wiki link. Purely a UI convenience; no network I/O.
        this.registerEvent(
            this.app.workspace.on("editor-drop", (evt, editor, info) => {
                const plainText = evt.dataTransfer?.getData("text/plain");
                if (!plainText || !/^\[\[.+\]\]$/.test(plainText)) return;

                const notePath = plainText.slice(2, -2);
                const file = this.app.vault.getAbstractFileByPath(notePath);
                if (!file) return;

                evt.preventDefault();

                const sourcePath = info?.file?.path ?? "";
                const linktext = this.app.metadataCache.fileToLinktext(
                    file as TFile,
                    sourcePath
                );
                const linkMarkup = `[[${linktext}]]`;

                // @ts-expect-error - Accessing internal CodeMirror EditorView
                const editorView = info?.editor?.cm;
                if (editorView?.posAtCoords) {
                    const pos = editorView.posAtCoords({
                        x: evt.clientX,
                        y: evt.clientY,
                    });
                    if (pos !== null) {
                        editorView.dispatch({
                            changes: { from: pos, insert: linkMarkup },
                        });
                        return;
                    }
                }

                editor.replaceSelection(linkMarkup);
            })
        );
    }

    private registerCommands() {
        this.commands = [
            new ShowSimilarNotesCommand(this),
            new SemanticSearchCommand(
                this.app,
                this.remoteSearchService,
                this.settingsService
            ),
        ];
        this.commands.forEach((command) => command.register(this));
    }

    async activateSimilarNotesView() {
        const existing = this.app.workspace.getLeavesOfType(
            VIEW_TYPE_SIMILAR_NOTES_SIDEBAR
        );
        if (existing.length > 0) {
            this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({
                type: VIEW_TYPE_SIMILAR_NOTES_SIDEBAR,
                active: true,
            });
        }
    }

    async onunload() {
        this.app.workspace.detachLeavesOfType(
            VIEW_TYPE_SIMILAR_NOTES_SIDEBAR
        );
        log.info("docindex-obsidian unloaded");
    }

    public setLogLevel(level: log.LogLevelDesc): void {
        log.setLevel(level);
        log.info(`Log level set to: ${log.getLevel()}`);
    }
}
