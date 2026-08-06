import {
	App,
	DropdownComponent,
	MarkdownPostProcessorContext,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile
} from "obsidian";

const PATCH_PATTERN = /^CP\s+(\d+)\s*-\s*(\d+)$/i;

interface PatchSelectSettings {
	midiOutputDeviceId: string;
	secondaryMidiOutputDeviceId: string;
}

const DEFAULT_SETTINGS: PatchSelectSettings = {
	midiOutputDeviceId: "",
	secondaryMidiOutputDeviceId: ""
};

export default class PatchSelectPlugin extends Plugin {
	settings: PatchSelectSettings;
	private midiAccess: MIDIAccess | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new PatchSelectSettingTab(this.app, this));
		this.addCommand({
			id: "send-patch-for-active-note",
			name: "Send patch for active note",
			callback: () => {
				void this.handleActiveNote();
			}
		});

		this.registerMarkdownPostProcessor((el, ctx) => {
			void this.addPatchButton(el, ctx);
		});
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

	private async getSelectedMidiOutputs(): Promise<MIDIOutput[]> {
		const outputs = await this.getAvailableMidiOutputs();
		if (outputs.length === 0) {
			return [];
		}

		const selectedOutputs: MIDIOutput[] = [];
		let didChange = false;

		const primaryOutput = outputs.find((output) => output.id === this.settings.midiOutputDeviceId) ?? outputs[0];
		selectedOutputs.push(primaryOutput);

		if (this.settings.midiOutputDeviceId !== primaryOutput.id) {
			this.settings.midiOutputDeviceId = primaryOutput.id;
			didChange = true;
		}

		if (this.settings.secondaryMidiOutputDeviceId) {
			const secondaryOutput = outputs.find((output) => output.id === this.settings.secondaryMidiOutputDeviceId);
			if (secondaryOutput) {
				if (secondaryOutput.id !== primaryOutput.id) {
					selectedOutputs.push(secondaryOutput);
				}
			} else {
				this.settings.secondaryMidiOutputDeviceId = "";
				didChange = true;
			}
		}

		if (didChange) {
			await this.saveSettings();
		}

		return selectedOutputs;
	}

	private async handleActiveNote(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		await this.handleFile(file);
	}

	private async handleSourcePath(sourcePath: string | null | undefined): Promise<void> {
		if (!sourcePath) {
			new Notice("Patch Select: Could not resolve embedded note.");
			return;
		}

		const abstractFile = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(abstractFile instanceof TFile)) {
			new Notice("Patch Select: Could not resolve embedded note.");
			return;
		}

		await this.handleFile(abstractFile);
	}

	private async handleFile(file: TFile | null): Promise<void> {
		if (!file || file.extension !== "md") {
			return;
		}

		const patchValue = this.getPatchFrontmatter(this.app, file);
		await this.sendPatchFromValue(patchValue);
	}

	private async sendPatchFromValue(patchValue: string | null): Promise<void> {
		let parsed = patchValue ? this.parsePatchNotation(patchValue) : null;

		if (patchValue && !parsed) {
			console.warn(`[obsidian-patch-select] Invalid patch format: "${patchValue}". Expected "CP x-y". Defaulting to patch 1-1.`);
		}

		const patch = parsed?.patch ?? 1;
		const program = parsed?.program ?? 1;
		await this.sendPatch(patch, program);
	}

	private async addPatchButton(el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
		if (!(file instanceof TFile) || file.extension !== "md") {
			return;
		}

		const host = el.querySelector<HTMLElement>(".chord-sheet-properties");
		if (!host || host.dataset.patchSelectButton === "true") {
			return;
		}

		host.dataset.patchSelectButton = "true";
		host.style.cursor = "pointer";
		host.title = "Send patch";

		this.registerDomEvent(host, "click", () => {
			void this.handleSourcePath(ctx.sourcePath);
		});
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
		const outputs = await this.getSelectedMidiOutputs();
		if (outputs.length === 0) {
			return;
		}

		const lsb = patch - 1;
		for (const output of outputs) {
			output.send([0xb0, 0x00, 0x3f]);
			output.send([0xb0, 0x20, lsb]);
			output.send([0xc0, program - 1]);
		}

		new Notice("Sent patch " + patch + "-" + program);
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
				void this.populatePrimaryOutputDeviceDropdown(dropdown);
			});

		new Setting(containerEl)
			.setName("Secondary MIDI output device")
			.setDesc("Optionally send patch-select messages to a second MIDI output device")
			.addDropdown((dropdown) => {
				void this.populateSecondaryOutputDeviceDropdown(dropdown);
			});
	}

	private async populatePrimaryOutputDeviceDropdown(dropdown: DropdownComponent): Promise<void> {
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
				void this.handlePrimaryOutputSelection(value);
			});
		} catch (error) {
			console.error("[obsidian-patch-select] Failed to enumerate MIDI outputs.", error);
			dropdown.addOption("", "No MIDI outputs available");
			dropdown.setDisabled(true);
			dropdown.setValue("");
		}
	}

	private async populateSecondaryOutputDeviceDropdown(dropdown: DropdownComponent): Promise<void> {
		try {
			const outputs = await this.plugin.getAvailableMidiOutputs();
			dropdown.addOption("", "None");

			if (outputs.length === 0) {
				dropdown.setDisabled(true);
				dropdown.setValue("");
				return;
			}

			for (const output of outputs) {
				dropdown.addOption(output.id, output.name || "Unknown Device");
			}

			const resolvedValue = this.plugin.settings.secondaryMidiOutputDeviceId && outputs.some((output) => output.id === this.plugin.settings.secondaryMidiOutputDeviceId)
				? this.plugin.settings.secondaryMidiOutputDeviceId
				: "";

			if (this.plugin.settings.secondaryMidiOutputDeviceId !== resolvedValue) {
				this.plugin.settings.secondaryMidiOutputDeviceId = resolvedValue;
				await this.plugin.saveSettings();
			}

			dropdown.setValue(resolvedValue);
			dropdown.onChange((value) => {
				void this.handleSecondaryOutputSelection(value);
			});
		} catch (error) {
			console.error("[obsidian-patch-select] Failed to enumerate MIDI outputs.", error);
			dropdown.addOption("", "No MIDI outputs available");
			dropdown.setDisabled(true);
			dropdown.setValue("");
		}
	}

	private async handlePrimaryOutputSelection(value: string): Promise<void> {
		this.plugin.settings.midiOutputDeviceId = value;
		await this.plugin.saveSettings();
	}

	private async handleSecondaryOutputSelection(value: string): Promise<void> {
		this.plugin.settings.secondaryMidiOutputDeviceId = value;
		await this.plugin.saveSettings();
	}
}
