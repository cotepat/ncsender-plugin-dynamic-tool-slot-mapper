# Dynamic Tool Slot Mapper v2.0.2

## 🐛 Hotfix: restore exception safety

v2.0.1 stripped the top-level `try/catch` wrapper around `onGcodeProgramLoad` along with the debug breadcrumbs — that wrapper was load-bearing. Without it, any unhandled JavaScript exception inside the plugin propagates to the host, and AOT-compiled hosts can crash without writing anything to the log.

This release puts the wrapper back. Any exception is now caught, logged via `pluginContext.log`, and the plugin returns the original (untranslated) G-code as a graceful fallback. Wrapped all internal `pluginContext.log` calls with a `safeLog` helper that swallows logging errors too.

## Requirements

- **ncSender (OSS)**: 2.0.37 or higher
- **ncSender Pro**: 2.0.88 or higher

---

**Full Changelog**: https://github.com/cotepat/ncsender-plugin-dynamic-tool-slot-mapper/compare/v2.0.1...v2.0.2
