import {App, DropdownComponent, Notice, Plugin, PluginSettingTab, Setting, TFile} from "obsidian";

const PATCH_PATTERN = /^CP\s+(\d+)\s*-\s*(\d+)$/i;

interface PatchSelectSettings {
	midiOutputDeviceId: string;
}

const DEFAULT_SETTINGS: PatchSelectSettings = {
	midiOutputDeviceId: ""
};

export default class PatchSelectPlugin extends Plugin {
	settings: PatchSelectSettings;
	private midiAccess: MIDIAccess | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new PatchSelectSettingTab(this.app, this));

		this.registerEvent(this.app.workspace.on("file-open", (file) => {
			void this.handleFileOpen(file);
		}));

		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			void this.handleFileOpen(activeFile);
		}
	}

	private async requestMidiAccess(): Promise<MIDIAccess | null> {
		if (this.midiAccess) {
			return this.midiAccess;
		}

		if (!("requestMIDIAccess" in navigator)) {
			console.error("[obsidian-patch-select] Web MIDI API is not supported.");
			return null;
		}

		try {
			this.midiAccess = await navigator.requestMIDIAccess();
			return this.midiAccess;
		} catch (error) {
			console.error("[obsidian-patch-select] Could not access MIDI outputs.", error);
			return null;
		}
	}

	private getMidiOutputs(access: MIDIAccess): MIDIOutput[] {
		return Array.from(access.outputs as unknown as Iterable<[string, MIDIOutput]>, ([, output]) => output);
	}

	async getAvailableMidiOutputs(): Promise<MIDIOutput[]> {
		const access = await this.requestMidiAccess();
		return access ? this.getMidiOutputs(access) : [];
	}

	private async getSelectedMidiOutput(): Promise<MIDIOutput | null> {
		const outputs = await this.getAvailableMidiOutputs();
		if (outputs.length === 0) {
			return null;
		}

		const selectedOutput = outputs.find((output) => output.id === this.settings.midiOutputDeviceId) ?? outputs[0];
		if (this.settings.midiOutputDeviceId !== selectedOutput.id) {
			this.settings.midiOutputDeviceId = selectedOutput.id;
			await this.saveSettings();
		}

		return selectedOutput;
	}

	private async handleFileOpen(file: TFile | null): Promise<void> {
		if (!file || file.extension !== "md") {
			return;
		}

		const patchValue = this.getPatchFrontmatter(this.app, file);
		let parsed = patchValue ? this.parsePatchNotation(patchValue) : null;

		if (patchValue && !parsed) {
			new Notice('Invalid patch format');
			console.warn(`[obsidian-patch-select] Invalid patch format: "${patchValue}". Expected "CP x-y". Defaulting to patch 1-1.`);
		}

		const patch = parsed?.patch ?? 1;
		const program = parsed?.program ?? 1;
		await this.sendPatch(patch, program);
	}

	private getPatchFrontmatter(app: App, file: TFile): string | null {
		const cache = app.metadataCache.getFileCache(file);
		const value = cache?.frontmatter?.patch;
		if (typeof value !== "string") {
			return null;
		}
		return value.trim();
	}

	private parsePatchNotation(value: string): { patch: number; program: number } | null {
		const match = PATCH_PATTERN.exec(value);
		if (!match) {
			return null;
		}

		const patch = Number.parseInt(match[1], 10);
		const program = Number.parseInt(match[2], 10);
		if (!Number.isInteger(patch) || !Number.isInteger(program) || patch < 1 || program < 1) {
			return null;
		}

		return { patch, program };
	}

	private async sendPatch(patch: number, program: number): Promise<void> {
		const output = await this.getSelectedMidiOutput();
		if (!output) {
			return;
		}

		const lsb = patch - 1;
		output.send([0xb0, 0x00, 0x3f]);
		output.send([0xb0, 0x20, lsb]);
		output.send([0xc0, program-1]);

		new Notice('Sent patch '+patch+"-"+program);
	}

	async loadSettings(): Promise<void> {
		const loadedSettings = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedSettings);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

class PatchSelectSettingTab extends PluginSettingTab {
	plugin: PatchSelectPlugin;

	constructor(app: App, plugin: PatchSelectPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("MIDI output device")
			.setDesc("Select which MIDI output device receives patch-select messages")
			.addDropdown((dropdown) => {
				void this.populateOutputDeviceDropdown(dropdown);
			});
	}

	private async populateOutputDeviceDropdown(dropdown: DropdownComponent): Promise<void> {
		try {
			const outputs = await this.plugin.getAvailableMidiOutputs();
			if (outputs.length === 0) {
				dropdown.addOption("", "No MIDI outputs available");
				dropdown.setDisabled(true);
				dropdown.setValue("");
				return;
			}

			for (const output of outputs) {
				dropdown.addOption(output.id, output.name || "Unknown Device");
			}

			const resolvedValue = outputs.some((output) => output.id === this.plugin.settings.midiOutputDeviceId)
				? this.plugin.settings.midiOutputDeviceId
				: outputs[0].id;

			if (this.plugin.settings.midiOutputDeviceId !== resolvedValue) {
				this.plugin.settings.midiOutputDeviceId = resolvedValue;
				await this.plugin.saveSettings();
			}

			dropdown.setValue(resolvedValue);
			dropdown.onChange((value) => {
				void this.handleOutputSelection(value);
			});
		} catch (error) {
			console.error("[obsidian-patch-select] Failed to enumerate MIDI outputs.", error);
			dropdown.addOption("", "No MIDI outputs available");
			dropdown.setDisabled(true);
			dropdown.setValue("");
		}
	}

	private async handleOutputSelection(value: string): Promise<void> {
		this.plugin.settings.midiOutputDeviceId = value;
		await this.plugin.saveSettings();
	}
}
