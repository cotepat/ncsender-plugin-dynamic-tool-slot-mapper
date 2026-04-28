# Dynamic Tool Slot Mapper v2.0.0

## ⚠️ Breaking Change: ncSender v2 Required

This release **requires ncSender v2** with all the latest plugin APIs:

- **ncSender (OSS)**: 2.0.37 or higher
- **ncSender Pro**: 2.0.88 or higher

The plugin has been rewritten for the `pro-v2` runtime (Jint sandbox) and depends on three host APIs:

- `onGcodeProgramLoad` event
- `pluginContext.showDialog()`
- `pluginContext.getTools()`

It will **not** load on ncSender v1 (0.3.x). If you're still on v1, stay on plugin v1.0.2.

## What's New

### 🔌 Rewritten for ncSender v2 Plugin Model
- Migrated from the v1 Node.js plugin runtime to v2's Jint sandbox
- Plugin now ships as a single `commands.js` file (no `index.js` wrapper)
- Reads the tool library via `pluginContext.getTools()` instead of `tools.json` on disk
- Reads magazine size in the dialog via `/api/settings` instead of disk
- Persists slot assignments via `/api/tools/{id}` (PUT) — same as before, just more direct

### ✨ Behavior Preserved
The full v1 user experience is intact:
- Auto-pops the slot mapping dialog on G-code load
- Visual slot carousel with 🟢 used / ⚙️ unused / — empty status
- Click any tool to assign/reassign slots (with smart 3-step swap when slots collide)
- Unknown tools (not in library) can be temporarily mapped for the current session
- 🟢 / 🟡 / 🔴 status indicator
- "Map Tools" rewrites the loaded G-code; "Bypass" leaves it untouched
- Translates `T##` and `H##` references (and tags comments with the original tool number)

### ⚙️ Memory Optimization
- `performTranslation` now mutates the line array in place rather than allocating a parallel array. Large G-code files (50k+ lines) no longer push the plugin past Jint's memory limit.

## Requirements

- **ncSender (OSS)**: 2.0.37 or higher
- **ncSender Pro**: 2.0.88 or higher
- **G-code**: Standard tool change commands (M6, T##, H##)

## How to Use

1. Load any G-code file with tool changes
2. Plugin opens the slot mapping dialog automatically
3. Map tools to slots (click any tool row → pick a slot)
4. Click **Map Tools** to translate, or **Bypass Mapping** to skip

---

**Full Changelog**: https://github.com/cotepat/ncsender-plugin-dynamic-tool-slot-mapper/compare/v1.0.2...v2.0.0
