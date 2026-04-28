# Quick Start Guide

## Installation

1. Download the latest release from GitHub
2. In ncSender: **Settings → Plugins → Install Plugin**
3. Select the downloaded `.zip` file
4. Restart ncSender

## Basic Usage

### When You Load G-Code

1. **Load any G-code file** with tool changes
2. Plugin automatically shows the **visual slot management dialog**
3. You'll see:
   - **Slot carousel** at the top (visual representation of your ATC)
   - **Tool table** below (list of all tools in G-code)

### Understanding the Slot Carousel

- **🟢 Green slots**: Tool is in slot AND used in your G-code
- **⚙️ Grey slots**: Tool is in slot but NOT used in G-code
- **Empty (—)**: No tool assigned to this slot

### Assigning Tools to Slots

1. **Click any tool row** in the table
2. **Dropdown appears** showing all available slots
3. **Select a slot**:
   - If empty: Tool is assigned
   - If occupied: You'll see "Swap with #XX" option
4. **Dialog refreshes** automatically

### Unknown Tools

If you have tools in G-code that aren't in your library:
- They show with **red "Unknown" badge**
- You can **map them temporarily** for this session
- Mappings **won't persist** after closing

### Completing Translation

1. Review all tool assignments
2. Click **"Map Tools"** to translate and proceed
3. Or click **"Bypass Mapping"** to skip translation

## Tips

- **Smart Swapping**: The plugin handles all slot conflicts automatically
- **Status Colors**:
  - 🟢 Ready: Tool is mapped and ready
  - 🟡 Unmapped: Needs slot assignment
  - 🔴 Unknown: Not in library
- **Quick Mapping**: Most common workflow is just clicking "Map Tools" if everything is green

## Troubleshooting

**Dialog doesn't appear when loading G-code:**
- Check that the plugin is enabled in Settings → Plugins
- Verify G-code contains tool changes (M6 commands)
- Confirm you're on ncSender 2.0.37+ (OSS) or 2.0.88+ (Pro) — this plugin requires `pluginContext.getTools()` which was added in those releases

**Can't assign a slot:**
- Click the tool row to open dropdown
- Select target slot or "Swap" option

**Tools show as "Unknown":**
- These tools aren't in your library yet
- You can map them temporarily or add them to your library first

## Support

For issues, questions, or feature requests, visit:
[github.com/cotepat/ncsender-plugin-dynamic-tool-slot-mapper/issues](https://github.com/cotepat/ncsender-plugin-dynamic-tool-slot-mapper/issues)
