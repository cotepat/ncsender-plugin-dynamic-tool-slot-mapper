# Dynamic Tool Slot Mapper v2.1.1

## 🐛 Hotfix: Map Tools translated the wrong file

v2.1.0's browser-side translation fetched the G-code from `/api/gcode-files/current/download`, but that endpoint serves the **cached** version of the previously-loaded file. The plugin shows the dialog *before* the cache is updated for the new file (because the plugin is blocking the load), so Map Tools translated whatever was loaded last and uploaded that — leaving the file the user actually wanted untranslated.

Fix: dialog now fetches fresh from disk via `/api/gcode-files/file?path=<sourcePath>` — always the file the user is loading, never stale cache content.

## Requirements

- **ncSender (OSS)**: 2.0.37 or higher
- **ncSender Pro**: 2.0.88 or higher

---

**Full Changelog**: https://github.com/cotepat/ncsender-plugin-dynamic-tool-slot-mapper/compare/v2.1.0...v2.1.1
