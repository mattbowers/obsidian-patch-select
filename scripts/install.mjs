import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TARGET_DIR = "/Users/matthew/Documents/Vaults/Live/.obsidian/plugins/patch-select";

const targetDir = process.argv[2] ?? process.env.PATCH_SELECT_TARGET_DIR ?? DEFAULT_TARGET_DIR;
const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceDir, "..");
const filesToCopy = ["main.js", "manifest.json", "styles.css"];

await mkdir(targetDir, { recursive: true });

await Promise.all(
	filesToCopy.map((file) =>
		copyFile(path.join(projectRoot, file), path.join(targetDir, file))
	)
);

console.log(`Installed plugin files to ${targetDir}`);
