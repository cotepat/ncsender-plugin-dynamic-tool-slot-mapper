# Dynamic Tool Slot Mapper v2.1.0

## ✨ G-code translation now works on files of any size

The plugin now does the heavy translation in the **browser** instead of inside Jint's 50 MB sandbox — same architecture Francis's `edge-align` plugin uses for big G-code transforms. 5 MB+ files translate without crashing or hitting memory limits.

### How it works

1. Plugin parses tool changes (lightweight, stays well under 50 MB) and shows the dialog as before
2. Slot swaps refresh the carousel + table **in place** — no flicker (unchanged from v2.0.1)
3. When you click **Map Tools**, the dialog:
   - Downloads the current G-code via `/api/gcode-files/current/download`
   - Transforms it in the browser (where memory is effectively unlimited)
   - Adds a marker comment so the upload doesn't trigger a re-process loop
   - Uploads the transformed content via `/api/gcode-files/load-temp`
   - Closes
4. Plugin returns the original content from `onGcodeProgramLoad`; the load-temp upload then replaces the cache with the translated version a moment later (brief flicker — file shows untranslated for ~500 ms before flipping to translated)

### Limit removed

- The 2 MB file-size guard from v2.0.3 is gone. There is no practical upper limit anymore.

### Logs

Same `[DTSM]` prefix as v2.0.3 — easy to grep in `~/Library/Application Support/ncSender/logs/<date>.log`.

## Requirements

- **ncSender (OSS)**: 2.0.37 or higher
- **ncSender Pro**: 2.0.88 or higher

---

**Full Changelog**: https://github.com/cotepat/ncsender-plugin-dynamic-tool-slot-mapper/compare/v2.0.3...v2.1.0
