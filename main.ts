import { App, Plugin, TFile } from "obsidian";

const PATCH_PATTERN = /^CP\s+(\d+)\s*-\s*(\d+)$/i;

export default class PatchSelectPlugin extends Plugin {
	private midiAccess: MIDIAccess | null = null;
	private midiAvailable = false;

	async onload(): Promise<void> {
		await this.initializeMidi();

		this.registerEvent(this.app.workspace.on("file-open", (file) => {
			void this.handleFileOpen(file);
		}));

		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			void this.handleFileOpen(activeFile);
		}
	}

	private async initializeMidi(): Promise<void> {
		if (!("requestMIDIAccess" in navigator)) {
			this.midiAvailable = false;
			return;
		}

		try {
			this.midiAccess = await navigator.requestMIDIAccess();
			this.midiAvailable = true;
		} catch (error) {
			this.midiAvailable = false;
			console.error("[obsidian-patch-select] Could not access MIDI outputs.", error);
		}
	}

	private async handleFileOpen(file: TFile | null): Promise<void> {
		if (!file || file.extension !== "md") {
			return;
		}

		const patchValue = this.getPatchFrontmatter(this.app, file);
		if (!patchValue) {
			return;
		}

		const parsed = this.parsePatchNotation(patchValue);
		if (!parsed) {
			console.warn(`[obsidian-patch-select] Invalid patch format: "${patchValue}". Expected "CP x-y".`);
			return;
		}

		await this.sendPatch(parsed.patch, parsed.program);
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
		if (!this.midiAvailable || !this.midiAccess) {
			await this.initializeMidi();
		}
		if (!this.midiAvailable || !this.midiAccess) {
			return;
		}

		const lsb = patch - 1;
		for (const output of this.midiAccess.outputs.values()) {
			output.send([0xb0, 0x00, 0x3f]);
			output.send([0xb0, 0x20, lsb]);
			output.send([0xc0, program]);
		}
	}
}
