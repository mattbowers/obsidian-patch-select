import fs from "fs";
import process from "process";

const targetVersion = process.argv[2];
if (!targetVersion) {
	console.error("Missing version number");
	process.exit(1);
}

const manifestPath = "manifest.json";
const versionsPath = "versions.json";

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const versions = JSON.parse(fs.readFileSync(versionsPath, "utf8"));

manifest.version = targetVersion;
versions[targetVersion] = manifest.minAppVersion;

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");
fs.writeFileSync(versionsPath, JSON.stringify(versions, null, "\t") + "\n");
