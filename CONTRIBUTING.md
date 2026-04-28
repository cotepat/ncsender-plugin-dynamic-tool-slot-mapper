# Contributing to Dynamic Tool Slot Mapper

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to this plugin.

## Development Setup

### Prerequisites

- Node.js 18+ (for running build scripts)
- ncSender 2.0.37+ (OSS) or ncSender Pro 2.0.88+ (for testing — `pro-v2` runtime)
- Git

### Getting Started

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/cotepat/ncsender-plugin-dynamic-tool-slot-mapper.git
   cd ncsender-plugin-dynamic-tool-slot-mapper
   ```

2. **Make your changes**
   - Edit `commands.js` (the entire plugin lives here)
   - Test in ncSender by installing the plugin locally

3. **Test your changes**
   ```bash
   .scripts/package.sh && .scripts/test-package.sh
   ```

## Plugin Structure

```
ncsender-plugin-dynamic-tool-slot-mapper/
├── manifest.json           # Plugin metadata (declares commands + onGcodeProgramLoad event)
├── commands.js             # Plugin logic (runs in v2 Jint sandbox)
├── logo.png                # Plugin icon
├── package.json            # NPM metadata
├── README.md               # Main documentation
├── QUICKSTART.md           # Quick start guide
├── CONTRIBUTING.md         # This file
└── .scripts/               # Build scripts
    ├── package.sh          # Package plugin as .zip
    └── test-package.sh     # Verify package
```

## Runtime Notes (v2)

`commands.js` runs inside ncSender v2's Jint engine, **not** Node.js. This means:

- **No `import`/`require`** — Jint strips ESM `export {}` automatically; declare functions at top level
- **No Node modules** — `fs`, `path`, `os` are unavailable
- **Use `pluginContext`** (a global injected by the host):
  - `pluginContext.log(...)` — server log
  - `pluginContext.getTools()` — tool library (with `id`, `toolId`, `toolNumber`, `name`, `type`, `diameter`)
  - `pluginContext.showDialog(title, html, opts)` — synchronous dialog; returns user response
- Entry points are top-level functions: `buildInitialConfig`, `onGcodeProgramLoad`, `onBeforeCommand`, `onAfterJobEnd`
- The dialog HTML is rendered inline by the client; relative `fetch('/api/...')` works against the local server

## Plugin Development References

ncSender v2 has no standalone plugin guide yet — the source itself is the spec:

- [ncSender repository](https://github.com/siganberg/ncSender)
- Plugin engine & host APIs: [`src/NcSender.Server/Plugins/JsPluginEngine.cs`](https://github.com/siganberg/ncSender/blob/main/src/NcSender.Server/Plugins/JsPluginEngine.cs)
- Plugin loader & manifest schema: [`src/NcSender.Server/Plugins/PluginManager.cs`](https://github.com/siganberg/ncSender/blob/main/src/NcSender.Server/Plugins/PluginManager.cs)
- Manifest model fields: [`src/NcSender.Core/Models/PluginModels.cs`](https://github.com/siganberg/ncSender/blob/main/src/NcSender.Core/Models/PluginModels.cs)

## Code Style

- Follow existing code formatting
- Add comments for complex logic
- Keep functions focused and small

## Testing

Before submitting a pull request:

1. **Manual Testing**
   - Install the plugin in ncSender
   - Load various G-code files
   - Test slot assignment, swapping, unknown tools
   - Verify translation accuracy

2. **Edge Cases**
   - Empty slots
   - Unknown tools
   - Swap scenarios
   - Magazine size limits

3. **Documentation**
   - Update README.md if adding features
   - Update QUICKSTART.md if changing workflows
   - Add comments to complex code

## Submitting Changes

1. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Commit your changes**
   ```bash
   git add .
   git commit -m "Description of changes"
   ```

3. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

4. **Open a Pull Request**
   - Go to GitHub
   - Click "New Pull Request"
   - Describe your changes
   - Link any related issues

## Pull Request Guidelines

- **Clear title**: Describe what the PR does
- **Description**: Explain why and how
- **Testing**: Describe how you tested
- **Screenshots**: Include for UI changes
- **Small PRs**: Keep changes focused

## Release Process

Releases are managed by the maintainers:

1. Update version in `manifest.json` and `package.json`
2. Update `README.md` with new version number
3. Create git tag (`v2.x.x`)
4. Push tag to trigger GitHub Actions
5. GitHub Actions builds and publishes release

## Questions?

Feel free to open an issue for:
- Bug reports
- Feature requests
- Questions about development
- Clarifications on contributing

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.
