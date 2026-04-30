# Dynamic Tool Slot Mapper v2.0.1

## 🐛 Bug Fixes

- **Memory limit** — large G-code files (50k+ lines) no longer hit Jint's 50 MB cap during parsing or translation. `parseToolChanges` now matches only tool-change lines via a single regex (skips ~99% of lines), and `performTranslation` only visits lines that contain `T<digit>`, `H<digit>`, or `M6` — leaving everything else as-is via `String.replace`.
- **Stripped debug breadcrumb logging** that was added during the v2 port. Plugin logs are back to high-signal ("Loaded N tool(s)", "T## → T##", "✓ Translated N tool change(s)").

## ✨ Improvements

- **Slot swaps no longer reload the dialog.** When you click a slot to assign or swap a tool, the change is applied via `/api/tools/{id}` and the carousel + table + status banner refresh **in place** — no flicker, no scroll-position loss, no dialog close/reopen cycle.
- **Plugin re-parses with final session mappings on Map Tools** so the dialog never has to round-trip the plugin on each individual edit.
- **Clearer error message** when running on a host that lacks `pluginContext.getTools()` (older pre-2.0.37 OSS or pre-2.0.88 Pro).

## Requirements

- **ncSender (OSS)**: 2.0.37 or higher
- **ncSender Pro**: 2.0.88 or higher

---

**Full Changelog**: https://github.com/cotepat/ncsender-plugin-dynamic-tool-slot-mapper/compare/v2.0.0...v2.0.1
