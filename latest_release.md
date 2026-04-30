# Dynamic Tool Slot Mapper v2.1.2

## 🐛 Hotfix: Windows file-write race

On Windows, when Map Tools fired the load-temp upload too quickly, it raced with the original `LoadFileAsync`'s write to `current.gcode`. Windows holds an exclusive file lock during write, so the second writer crashed with `IOException: The process cannot access the file because it is being used by another process` (visible only in Kestrel logs, not in the plugin's own log).

Linux/macOS aren't affected — those kernels serialize writes transparently — but Windows users would see the file load with the *original* untranslated content because the load-temp upload failed.

Fix: the dialog now retries the load-temp request on failure with exponential backoff (0ms, 250ms, 500ms, 1s, 2s, 4s — total ~7.7s). The original write typically completes in well under 1s, so retries succeed within 1-2 attempts.

## Requirements

- **ncSender (OSS)**: 2.0.37 or higher
- **ncSender Pro**: 2.0.88 or higher

---

**Full Changelog**: https://github.com/cotepat/ncsender-plugin-dynamic-tool-slot-mapper/compare/v2.1.1...v2.1.2
