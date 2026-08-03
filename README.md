# Patch Select (Obsidian plugin)

This plugin sends MIDI bank/program change messages whenever a note is opened and the note has a `patch` frontmatter key.

## Development

```bash
npm run build
npm run install:local
```

`npm run install:local` copies `main.js`, `manifest.json`, and `styles.css` into your Obsidian plugin folder.
Set a custom target with `PATCH_SELECT_TARGET_DIR=/path/to/vault/.obsidian/plugins/patch-select npm run install:local`
or pass it as an argument: `npm run install:local -- /path/to/vault/.obsidian/plugins/patch-select`.

## Settings

Choose the target output in **Settings → Patch Select → MIDI output device**.

## Frontmatter format

Use:

```yaml
patch: CP x-y
```

- `x`: 1-based patch index
- `y`: 1-based program index

For `CP x-y`, the plugin sends:

1. CC 0 = 63 (MSB bank select)
2. CC 32 = x-1 (LSB bank select)
3. Program Change = y

If `patch` is missing, nothing is sent.
