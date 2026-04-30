# Dynamic Tool Slot Mapper v2.0.3

## 🐛 Fixes

- **Logs are findable again** — restored the `[DTSM]` prefix on plugin log messages. Greppable as `[DTSM]` in the host log (`~/Library/Application Support/ncSender/logs/<date>.log` on macOS).
- **Large G-code file guard** — files over 2 MB now bail out cleanly with a clear log message instead of silently failing mid-translation. Jint's 50 MB memory cap means large files exhaust available memory before translation can finish; until the host raises the cap, the plugin will load the original G-code untranslated and tell you why in the log.

## What still works

Files under 2 MB (typical for most CNC jobs, including 50k+ line files at <1 MB) translate normally with the in-place dialog refresh from v2.0.1.

## Known limitation

Files larger than 2 MB skip translation. Slot assignments still persist in your tool library, so re-loading on the host with a future LimitMemory bump (or doing the slot mapping with a smaller file first) will work.

## Requirements

- **ncSender (OSS)**: 2.0.37 or higher
- **ncSender Pro**: 2.0.88 or higher

---

**Full Changelog**: https://github.com/cotepat/ncsender-plugin-dynamic-tool-slot-mapper/compare/v2.0.2...v2.0.3
