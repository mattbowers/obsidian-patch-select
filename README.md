# Patch Select (Obsidian plugin)

This plugin sends MIDI bank/program change messages whenever a note is opened and the note has a `patch` frontmatter key.

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
