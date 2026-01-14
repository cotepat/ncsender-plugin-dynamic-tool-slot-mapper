# Contributing to Dynamic Tool Slot Mapper

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to this plugin.

## Development Setup

### Prerequisites

- Node.js 18+ (for running build scripts)
- ncSender 0.3.131+ (for testing)
- Git

### Getting Started

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/cotepat/ncsender-plugin-dynamic-tool-slot-mapper.git
   cd ncsender-plugin-dynamic-tool-slot-mapper
   ```

2. **Install dependencies** (if any)
   ```bash
   npm install
   ```

3. **Make your changes**
   - Edit plugin files (`index.js`)
   - Test in ncSender by installing the plugin locally

4. **Test your changes**
   ```bash
   npm test
   ```

5. **Package the plugin**
   ```bash
   npm run package
   ```

## Plugin Structure

```
ncsender-plugin-dynamic-tool-slot-mapper/
├── manifest.json           # Plugin metadata
├── index.js               # Main entry point (contains all plugin logic)
├── logo.png               # Plugin icon
├── package.json           # NPM metadata
├── README.md              # Main documentation
├── QUICKSTART.md          # Quick start guide
├── CONTRIBUTING.md        # This file
└── .scripts/              # Build scripts
    ├── package.sh         # Package plugin as .zip
    └── test-package.sh    # Verify package
```

## Code Style

- Use ES6 modules (`import`/`export`)
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
3. Create git tag (`v1.x.x`)
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
