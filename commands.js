/*
 * Dynamic Tool Slot Mapper - ncSender v2 plugin
 *
 * Just-in-time tool slot mapping for unlimited tool libraries with limited
 * magazine capacity. On G-code load, parses tool changes, lets the user map
 * unknown/unassigned tools to slots via an interactive dialog, then rewrites
 * T## and H## references to slot numbers.
 *
 * Runs in the v2 Jint sandbox via onGcodeProgramLoad. The host injects a
 * `pluginContext` global with: log(), getTools(), showDialog().
 */

// === Plugin settings (sanitize / defaults) ===

function buildInitialConfig(raw) {
  // No persisted user settings; magazine size is fetched by the dialog
  // itself from /api/settings.
  return {};
}

// === M6 Pattern Matching (matches ncSender core) ===

const M6_PATTERN = /(?:^|[^A-Z])M0*6(?:\s*T0*(\d+)|(?=[^0-9T])|$)|(?:^|[^A-Z])T0*(\d+)\s*M0*6(?:[^0-9]|$)/i;

// === Entry point ===

// Marker comment we add to the top of transformed G-code. When the dialog's
// browser-side translation finishes, it uploads the transformed file via
// /api/gcode-files/load-temp — that endpoint runs plugin transforms again,
// which would re-fire this plugin in a loop. The marker breaks the loop:
// if we see it, we know the content is already transformed and bail.
const DTSM_MARKER = '; ncSender-dtsm-transformed';

function onGcodeProgramLoad(content, context, settings) {
  // Top-level try/catch is load-bearing: AOT-compiled hosts can crash hard
  // on unhandled JS exceptions. Always return original content on failure
  // (host sees a graceful fallback, user can still load the file untranslated).
  try {
    // Skip if this content was already transformed by us (marker on first line).
    // Cheap check — only inspects the first ~80 chars.
    if (content && content.length > 0 && content.substring(0, 80).indexOf(DTSM_MARKER) !== -1) {
      return content;
    }

    safeLog('Dynamic Tool Slot Mapper: analyzing G-code (' + Math.round(content.length / 1024) + ' KB)...');

    let toolLibrary = loadToolLibrary();
    let manualMappings = {};
    let toolChanges = parseToolChanges(content, toolLibrary, manualMappings);

    if (toolChanges.allTools.length === 0) {
      safeLog('No tool changes found — loading original G-code');
      return content;
    }

    const status = determineStatus(toolChanges);

    // Show dialog. The dialog does the heavy work in the browser (translation
    // is browser-side to bypass Jint's 50 MB memory cap on large files), then
    // uploads via /api/gcode-files/load-temp before closing. Plugin always
    // returns the original content from here — the load-temp upload replaces
    // the cached version with the transformed one a moment later.
    showStatusDialog(
      context && context.filename,
      context && context.sourcePath,
      toolChanges,
      status,
      toolLibrary,
      manualMappings
    );

    return content;

  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    safeLog('[DTSM] onGcodeProgramLoad failed: ' + msg);
    return content;
  }
}

// safeLog never throws — even if pluginContext.log itself misbehaves we
// silently drop the message rather than crash the plugin. Prefix [DTSM]
// for easy grepping in the host log alongside other plugins.
function safeLog(msg) {
  try {
    if (typeof pluginContext !== 'undefined' && pluginContext && typeof pluginContext.log === 'function') {
      pluginContext.log('[DTSM] ' + msg);
    }
  } catch (e) { /* swallow */ }
}

// G-code translation has moved to the dialog (browser side) — see the
// performTranslationInBrowser function inside the dialog HTML's <script>.
// Browser memory is effectively unlimited, so files of any size translate
// without hitting Jint's 50 MB cap.

// === Tool library ===

function loadToolLibrary() {
  if (typeof pluginContext === 'undefined' || !pluginContext) {
    throw new Error('pluginContext is not defined — host did not inject the plugin context');
  }
  if (typeof pluginContext.getTools !== 'function') {
    throw new Error('pluginContext.getTools is not available — host needs ncSender 2.0.37+ (OSS) or 2.0.88+ (Pro)');
  }

  const tools = pluginContext.getTools();
  const library = {};
  if (!Array.isArray(tools)) return library;

  tools.forEach(tool => {
    const toolId = (tool.toolId !== undefined && tool.toolId !== null) ? tool.toolId : tool.id;
    if (toolId !== undefined && toolId !== null) {
      if (tool.toolId === undefined || tool.toolId === null) {
        tool.toolId = tool.id;
      }
      library[toolId] = tool;
    }
  });

  safeLog('Loaded ' + tools.length + ' tool(s) from library');
  return library;
}

// === Parse tool changes ===

function parseToolChanges(content, toolLibrary, manualMappings) {
  manualMappings = manualMappings || {};
  const allTools = [];
  const inLibrary = [];
  const inMagazine = [];
  const notInMagazine = [];
  const unknownTools = [];
  const seenTools = {};

  // Match ONLY lines containing a tool change. Anchored with /gm so ^ is
  // start-of-line, with a negative lookahead to skip comment lines. This way
  // we don't visit / allocate per non-matching line — Jint counts cumulative
  // allocations and 54k+ line files would exhaust the 50MB cap otherwise.
  //
  // Captures: group 1 = tool# from "M6 T##", group 2 = tool# from "T## M6"
  const TOOL_CHANGE_RE = /^(?!\s*[;(])[^\n]*?(?:M0*6\s*T0*(\d+)|T0*(\d+)\s*M0*6)/gmi;
  let m;
  while ((m = TOOL_CHANGE_RE.exec(content)) !== null) {
    const toolNumberStr = m[1] || m[2];
    if (!toolNumberStr) continue;

    const toolNumber = parseInt(toolNumberStr, 10);
    if (seenTools[toolNumber]) continue;
    seenTools[toolNumber] = true;

    const toolNumberKey = String(toolNumber);
    const hasManualMapping = Object.prototype.hasOwnProperty.call(manualMappings, toolNumberKey);
    const manualPocketNumber = manualMappings[toolNumberKey];

    const toolInfo = toolLibrary[toolNumber];
    const toolData = {
      toolNumber: toolNumber,
      toolInfo: toolInfo,
      manualMapping: hasManualMapping
    };

    allTools.push(toolData);

    if (hasManualMapping) {
      if (manualPocketNumber !== -1) {
        toolData.pocketNumber = manualPocketNumber;
        inMagazine.push(toolData);
      } else {
        if (toolInfo) inLibrary.push(toolData);
        notInMagazine.push(toolData);
      }
    } else if (toolInfo) {
      inLibrary.push(toolData);
      if (toolInfo.toolNumber !== null && toolInfo.toolNumber !== undefined) {
        toolData.pocketNumber = toolInfo.toolNumber;
        inMagazine.push(toolData);
      } else {
        notInMagazine.push(toolData);
      }
    } else {
      unknownTools.push(toolData);
    }
  }

  return {
    allTools: allTools,
    inLibrary: inLibrary,
    inMagazine: inMagazine,
    notInMagazine: notInMagazine,
    unknownTools: unknownTools
  };
}

// === Status ===

function determineStatus(toolChanges) {
  if (toolChanges.unknownTools.length > 0) return 'red';
  if (toolChanges.notInMagazine.length > 0) return 'yellow';
  return 'green';
}

// === Status dialog ===

function showStatusDialog(filename, sourcePath, toolChanges, status, toolLibrary, sessionMappings) {
  sessionMappings = sessionMappings || {};

  const allToolsForTable = []
    .concat(toolChanges.inMagazine.map(t => Object.assign({}, t, { statusClass: 'green', statusLabel: 'Ready' })))
    .concat(toolChanges.notInMagazine.map(t => Object.assign({}, t, { statusClass: 'yellow', statusLabel: 'No Slot' })))
    .concat(toolChanges.unknownTools.map(t => Object.assign({}, t, { statusClass: 'red', statusLabel: 'Unknown' })));

  const statusConfig = {
    red: {
      color: '#dc3545',
      bgColor: 'rgba(220, 53, 69, 0.1)',
      icon: '🔴',
      title: 'Tools Not Found in Library',
      message: `${toolChanges.unknownTools.length} tool(s) are not in your ncSender library. If you proceed with "Map Tools", tools that exist will be mapped - unknown tools will remain as-is.`
    },
    yellow: {
      color: '#ffc107',
      bgColor: 'rgba(255, 193, 7, 0.1)',
      icon: '🟡',
      title: 'Manual Tool Changes Required',
      message: `${toolChanges.notInMagazine.length} tool(s) are in ncSender library but not assigned to slots. These will require manual tool changes.`
    },
    green: {
      color: '#28a745',
      bgColor: 'rgba(40, 167, 69, 0.1)',
      icon: '🟢',
      title: 'All Tools Ready for ATC',
      message: 'All tools are in ncSender library and assigned to slots. Original tool numbers will be mapped to ncSender slots.'
    }
  };

  const config = statusConfig[status];

  // Normalize toolLibrary keyed by toolId for the dialog JS.
  const dialogToolLibrary = {};
  Object.keys(toolLibrary).forEach(key => {
    const tool = toolLibrary[key];
    const toolId = (tool.toolId !== undefined && tool.toolId !== null) ? tool.toolId : tool.id;
    dialogToolLibrary[toolId] = Object.assign({}, tool, { toolId: toolId });
  });

  const html = `
    <style>
      .status-container {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
        color: var(--color-text-primary, #e0e0e0);
        padding: 20px;
        max-width: 700px;
        margin: 0 auto;
      }
      .status-header { text-align: center; margin-bottom: 20px; }
      .status-header h2 { margin: 0 0 8px 0; font-size: 1.3rem; }
      .status-filename { color: var(--color-text-secondary); font-size: 0.9rem; word-break: break-all; }
      .status-banner {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 1.1rem;
        font-weight: 600;
        margin: 16px 0;
        background: ${config.bgColor};
        border: 2px solid ${config.color};
        color: ${config.color};
      }
      .status-message {
        background: var(--color-surface-muted, #1a1a1a);
        padding: 16px;
        border-radius: 8px;
        margin-bottom: 20px;
        line-height: 1.5;
      }
      .slot-carousel-section {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 16px;
        background: var(--color-surface-muted, #1a1a1a);
        border-radius: 8px;
        margin-bottom: 16px;
        overflow-x: auto;
        min-height: 96px;
      }
      .slot-carousel-loading {
        color: var(--color-text-secondary, #999);
        font-size: 0.85rem;
        font-style: italic;
      }
      .slot-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 60px;
        height: 60px;
        background: var(--color-surface, #0a0a0a);
        border: 2px solid var(--color-border, #444);
        border-radius: 6px;
        overflow: hidden;
        flex-shrink: 0;
      }
      .slot-box--used {
        background: var(--color-accent, #1abc9c);
        border-color: var(--color-accent, #1abc9c);
      }
      .slot-box--unused {
        background: var(--color-surface-muted, #2a2a2a);
        border-color: var(--color-border, #444);
        opacity: 0.5;
      }
      .slot-box-content {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 1;
        width: 100%;
        padding: 0 8px;
      }
      .slot-tool-id { font-size: 1rem; font-weight: 700; color: #fff; }
      .slot-empty { font-size: 1.2rem; color: var(--color-text-secondary, #666); }
      .slot-box-label {
        font-size: 0.65rem;
        font-weight: 700;
        text-transform: uppercase;
        color: var(--color-text-secondary, #999);
        background: var(--color-surface-muted, #1a1a1a);
        width: 100%;
        text-align: center;
        padding: 3px 0;
        letter-spacing: 0.03em;
      }
      .slot-box--used .slot-box-label {
        background: color-mix(in srgb, var(--color-accent, #1abc9c) 80%, #000);
        color: rgba(255, 255, 255, 0.95);
      }
      .tools-table-container {
        max-height: 400px;
        overflow-y: auto;
        border: 1px solid var(--color-border, #444);
        border-radius: 8px;
        margin-bottom: 16px;
      }
      .tools-table { width: 100%; border-collapse: collapse; }
      .tools-table thead {
        position: sticky;
        top: 0;
        background: var(--color-surface-muted, #1a1a1a);
        z-index: 10;
      }
      .tools-table th {
        padding: 8px 12px;
        text-align: left;
        font-weight: 600;
        border-bottom: 2px solid var(--color-border, #444);
        font-size: 0.85rem;
      }
      .tools-table td {
        padding: 8px 12px;
        border-bottom: 1px solid var(--color-border, #333);
      }
      .tools-table tbody tr:hover { background: var(--color-border, #2a2a2a); }
      .row-status-badge {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        border: 1px solid transparent;
      }
      .row-status-badge--green { background: rgba(40, 167, 69, 0.2); color: #28a745; border-color: #28a745; }
      .row-status-badge--yellow { background: rgba(255, 193, 7, 0.2); color: #ffc107; border-color: #ffc107; }
      .row-status-badge--red { background: rgba(220, 53, 69, 0.2); color: #dc3545; border-color: #dc3545; }
      .tool-id-cell {
        display: flex;
        flex-direction: column;
        gap: 4px;
        align-items: center;
        justify-content: center;
        min-width: 80px;
        cursor: pointer;
        user-select: none;
      }
      .tool-id-cell:hover { opacity: 0.8; }
      .tool-id-text { font-size: 1rem; font-weight: 600; }
      .tool-number-badge {
        display: inline-block;
        padding: 2px 6px;
        border: 1px solid #f59e0b;
        border-radius: 3px;
        background: #f59e0b;
        color: #000;
        font-size: 0.65rem;
        font-weight: 600;
        text-transform: uppercase;
        width: fit-content;
      }
      .tool-slot-placeholder {
        font-size: 0.65rem;
        color: var(--color-text-secondary);
        opacity: 0.6;
      }
      .actions {
        display: flex;
        gap: 12px;
        justify-content: center;
        margin-top: 20px;
      }
      .btn {
        padding: 12px 24px;
        border: none;
        border-radius: 6px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }
      .btn-primary { background: var(--color-accent, #1abc9c); color: white; }
      .btn-primary:hover { opacity: 0.9; }
      .btn-secondary {
        background: var(--color-surface-muted, #2a2a2a);
        color: var(--color-text-primary);
        border: 1px solid var(--color-border, #444);
      }
      .btn-secondary:hover { background: var(--color-border, #444); }
      .btn-success { background: #28a745; color: white; }
      .btn-warning { background: #ffc107; color: #000; }
      .slot-selector-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        z-index: 99998;
        display: none;
      }
      .slot-selector-overlay.show { display: block; }
      .slot-selector-popup {
        position: fixed;
        background: var(--color-surface, #2a2a2a);
        border: 1px solid var(--color-border, #444);
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        min-width: 200px;
        max-height: 300px;
        display: flex;
        flex-direction: column;
        z-index: 99999;
      }
      .slot-selector-header {
        padding: 10px 12px;
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--color-text-secondary, #999);
        border-bottom: 1px solid var(--color-border, #444);
        flex-shrink: 0;
      }
      .slot-selector-list { overflow-y: auto; flex: 1; }
      .slot-selector-item {
        padding: 8px 12px;
        font-size: 0.85rem;
        color: var(--color-text-primary, #e0e0e0);
        cursor: pointer;
        transition: background 0.1s ease;
      }
      .slot-selector-item:hover { background: var(--color-surface-muted, #1a1a1a); }
      .slot-selector-item--active { background: var(--color-accent, #1abc9c); color: white; }
      .slot-selector-item--active:hover { background: var(--color-accent, #1abc9c); }
      .slot-selector-item--occupied { color: #f59e0b; }
    </style>

    <div class="status-container">
      <div class="status-header">
        <div class="status-filename">${filename || 'G-Code File'}</div>
        <div class="status-banner" id="statusBanner">
          <span id="statusIcon">${config.icon}</span>
          <span id="statusTitle">${config.title}</span>
        </div>
      </div>

      <div class="status-message" id="statusMessage">${config.message}</div>

      <div id="slotCarousel" class="slot-carousel-section">
        <span class="slot-carousel-loading">Loading slots…</span>
      </div>

      <div class="tools-table-container">
        <table class="tools-table">
          <thead>
            <tr>
              <th>Tool ID</th>
              <th>Description</th>
              <th>Type</th>
              <th>Diameter</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="toolsTableBody"></tbody>
        </table>
      </div>

      <div class="actions">
        <button id="bypassBtn" class="btn btn-secondary">Bypass Mapping</button>
        <button id="mapBtn" class="btn ${status === 'green' ? 'btn-success' : (status === 'yellow' ? 'btn-warning' : 'btn-primary')}">Map Tools</button>
      </div>
    </div>

    <div id="slotSelectorOverlay" class="slot-selector-overlay">
      <div id="slotSelectorPopup" class="slot-selector-popup">
        <div class="slot-selector-header">Assign to Slot</div>
        <div class="slot-selector-list" id="slotSelectorList"></div>
      </div>
    </div>

    <script>
      (function() {
        const sessionMappings = ${JSON.stringify(sessionMappings)};
        const allToolsData = ${JSON.stringify(allToolsForTable)};
        const toolLibrary = ${JSON.stringify(dialogToolLibrary)};
        const sourcePath = ${JSON.stringify(sourcePath || '')};
        const filename = ${JSON.stringify(filename || 'translated.gcode')};
        let magazineSize = 0;

        const overlay = document.getElementById('slotSelectorOverlay');
        const popup = document.getElementById('slotSelectorPopup');
        const listContainer = document.getElementById('slotSelectorList');
        const carousel = document.getElementById('slotCarousel');

        let currentTool = null;

        function fetchMagazineSize() {
          return fetch('/api/settings')
            .then(r => r.ok ? r.json() : null)
            .then(s => (s && s.tool && typeof s.tool.count === 'number') ? s.tool.count : 8)
            .catch(() => 8);
        }

        function renderCarousel() {
          const usedToolNumbers = new Set(allToolsData.map(t => t.toolNumber));
          let html = '';

          for (let i = 1; i <= magazineSize; i++) {
            let toolInSlot = Object.values(toolLibrary).find(t => t.toolNumber === i);

            if (!toolInSlot) {
              const unknownToolNumber = Object.keys(sessionMappings).find(key => sessionMappings[key] === i);
              if (unknownToolNumber) {
                toolInSlot = { toolId: unknownToolNumber, toolNumber: i, isTemporary: true };
              }
            }

            const toolIdForComparison = toolInSlot ? (toolInSlot.toolId || toolInSlot.id) : null;
            const isUsed = toolInSlot && toolIdForComparison &&
              (usedToolNumbers.has(parseInt(toolIdForComparison, 10)) || usedToolNumbers.has(toolIdForComparison));

            const cls = toolInSlot ? (isUsed ? 'slot-box--used' : 'slot-box--unused') : '';
            const content = toolIdForComparison
              ? \`<span class="slot-tool-id">#\${toolIdForComparison}</span>\`
              : \`<span class="slot-empty">—</span>\`;

            html += \`<div class="slot-box \${cls}">
                       <div class="slot-box-content">\${content}</div>
                       <div class="slot-box-label">SLOT\${i}</div>
                     </div>\`;
          }

          carousel.innerHTML = html;
        }

        function showSlotSelector(toolData, event) {
          currentTool = toolData;

          let html = \`
            <div class="slot-selector-item \${(toolData.pocketNumber === null || toolData.pocketNumber === undefined) ? 'slot-selector-item--active' : ''}" data-slot="">
              None (Not in magazine)
            </div>
          \`;

          for (let i = 1; i <= magazineSize; i++) {
            const toolInSlot = Object.values(toolLibrary).find(t => t.toolNumber === i);
            const unknownToolInSlot = Object.keys(sessionMappings).find(key => sessionMappings[key] === i);

            const toolInSlotId = toolInSlot ? (toolInSlot.toolId || toolInSlot.id) : null;
            const isOccupied = (toolInSlot && toolInSlotId !== toolData.toolNumber) ||
                               (unknownToolInSlot && parseInt(unknownToolInSlot, 10) !== toolData.toolNumber);
            const isActive = toolData.pocketNumber === i;

            let occupiedInfo = '';
            if (toolInSlot && toolInSlotId !== toolData.toolNumber) {
              occupiedInfo = \` (Swap with #\${toolInSlotId})\`;
            } else if (unknownToolInSlot && parseInt(unknownToolInSlot, 10) !== toolData.toolNumber) {
              occupiedInfo = \` (Swap with T\${unknownToolInSlot})\`;
            }

            html += \`
              <div class="slot-selector-item \${isActive ? 'slot-selector-item--active' : ''} \${isOccupied ? 'slot-selector-item--occupied' : ''}" data-slot="\${i}">
                Slot\${i}\${occupiedInfo}
              </div>
            \`;
          }

          listContainer.innerHTML = html;

          const rect = event.target.closest('.tool-id-cell').getBoundingClientRect();
          popup.style.top = (rect.bottom + 5) + 'px';
          popup.style.left = rect.left + 'px';

          overlay.classList.add('show');
        }

        function closeSlotSelector() {
          overlay.classList.remove('show');
          currentTool = null;
        }

        async function selectSlot(slotNumber) {
          if (!currentTool) return;

          const toolNumber = currentTool.toolNumber;
          const toolInfo = currentTool.toolInfo;
          const oldSlotNumber = currentTool.pocketNumber;

          if (slotNumber === oldSlotNumber) {
            closeSlotSelector();
            return;
          }

          closeSlotSelector();

          try {
            if (toolInfo) {
              const currentToolId = toolInfo.toolId || toolInfo.id;

              const conflictingTool = (slotNumber !== null)
                ? Object.values(toolLibrary).find(t => t.toolNumber === slotNumber && t.id !== toolInfo.id)
                : null;

              const conflictingUnknownToolNumber = (slotNumber !== null)
                ? Object.keys(sessionMappings).find(key => sessionMappings[key] === slotNumber)
                : null;

              if (conflictingTool) {
                // 3-step swap with library tool
                await fetch(\`/api/tools/\${conflictingTool.id}\`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ...conflictingTool, toolNumber: null })
                });
                await fetch(\`/api/tools/\${toolInfo.id}\`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ...toolInfo, toolNumber: slotNumber })
                });
                if (oldSlotNumber !== null && oldSlotNumber !== undefined) {
                  await fetch(\`/api/tools/\${conflictingTool.id}\`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...conflictingTool, toolNumber: oldSlotNumber })
                  });
                }
              } else if (conflictingUnknownToolNumber) {
                // Swap with unknown (session-only) tool
                if (oldSlotNumber !== null && oldSlotNumber !== undefined) {
                  sessionMappings[conflictingUnknownToolNumber] = oldSlotNumber;
                } else {
                  delete sessionMappings[conflictingUnknownToolNumber];
                }
                await fetch(\`/api/tools/\${toolInfo.id}\`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ...toolInfo, toolNumber: slotNumber })
                });
              } else {
                await fetch(\`/api/tools/\${toolInfo.id}\`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ...toolInfo, toolNumber: slotNumber })
                });
              }
            } else {
              // Tool not in library — temporary session mapping
              if (slotNumber === null) {
                delete sessionMappings[String(toolNumber)];
              } else {
                const conflictingTool = Object.values(toolLibrary).find(t => t.toolNumber === slotNumber);
                const toolNumberKey = String(toolNumber);
                const conflictingUnknownToolNumber2 = Object.keys(sessionMappings).find(key =>
                  sessionMappings[key] === slotNumber && key !== toolNumberKey
                );

                if (conflictingTool) {
                  if (oldSlotNumber !== null && oldSlotNumber !== undefined) {
                    await fetch(\`/api/tools/\${conflictingTool.id}\`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ...conflictingTool, toolNumber: oldSlotNumber })
                    });
                  } else {
                    await fetch(\`/api/tools/\${conflictingTool.id}\`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ...conflictingTool, toolNumber: null })
                    });
                  }
                  sessionMappings[toolNumberKey] = slotNumber;
                } else if (conflictingUnknownToolNumber2) {
                  if (oldSlotNumber !== null && oldSlotNumber !== undefined) {
                    sessionMappings[conflictingUnknownToolNumber2] = oldSlotNumber;
                  } else {
                    delete sessionMappings[conflictingUnknownToolNumber2];
                  }
                  sessionMappings[toolNumberKey] = slotNumber;
                } else {
                  sessionMappings[toolNumberKey] = slotNumber;
                }
              }
            }

            // Small delay for /api/tools writes to settle, then refresh in place
            await new Promise(resolve => setTimeout(resolve, 100));
            await refreshFromServer();

          } catch (error) {
            alert('Failed to update slot: ' + (error && error.message ? error.message : error));
          }
        }

        // === In-place refresh helpers ===
        // Re-fetch the tool library, recompute each row's status, then re-render
        // the carousel + table + status banner without closing the dialog.

        async function refreshFromServer() {
          try {
            const r = await fetch('/api/tools');
            if (!r.ok) return;
            const tools = await r.json();

            // Rebuild local toolLibrary in place
            for (const k in toolLibrary) delete toolLibrary[k];
            tools.forEach(t => {
              const tid = (t.toolId !== undefined && t.toolId !== null) ? t.toolId : t.id;
              if (tid !== undefined && tid !== null) {
                toolLibrary[tid] = Object.assign({}, t, { toolId: tid });
              }
            });

            // Re-resolve every row in allToolsData based on fresh library + sessionMappings
            allToolsData.forEach(item => {
              const k = String(item.toolNumber);
              const hasSession = Object.prototype.hasOwnProperty.call(sessionMappings, k);
              const libTool = toolLibrary[item.toolNumber];

              if (hasSession) {
                const sp = sessionMappings[k];
                if (sp !== -1) {
                  item.toolInfo = libTool || null;
                  item.pocketNumber = sp;
                  item.statusClass = 'green';
                  item.statusLabel = 'Ready';
                } else {
                  item.toolInfo = libTool || null;
                  item.pocketNumber = undefined;
                  item.statusClass = libTool ? 'yellow' : 'red';
                  item.statusLabel = libTool ? 'No Slot' : 'Unknown';
                }
              } else if (libTool) {
                item.toolInfo = libTool;
                if (libTool.toolNumber !== null && libTool.toolNumber !== undefined) {
                  item.pocketNumber = libTool.toolNumber;
                  item.statusClass = 'green';
                  item.statusLabel = 'Ready';
                } else {
                  item.pocketNumber = undefined;
                  item.statusClass = 'yellow';
                  item.statusLabel = 'No Slot';
                }
              } else {
                item.toolInfo = null;
                item.pocketNumber = undefined;
                item.statusClass = 'red';
                item.statusLabel = 'Unknown';
              }
            });

            renderCarousel();
            renderTable();
            updateStatusBanner();
          } catch (e) {
            // ignore refresh failures — user can retry
          }
        }

        function renderTable() {
          const tbody = document.getElementById('toolsTableBody');
          if (!tbody) return;

          tbody.innerHTML = allToolsData.map(t => {
            const slotBadge = (t.pocketNumber !== null && t.pocketNumber !== undefined)
              ? \`<span class="tool-number-badge">Slot\${t.pocketNumber}</span>\`
              : \`<span class="tool-slot-placeholder">No Slot</span>\`;
            const desc = t.toolInfo ? t.toolInfo.name : 'Tool ' + t.toolNumber;
            const type = t.toolInfo ? t.toolInfo.type : '-';
            const dia = t.toolInfo ? (t.toolInfo.diameter.toFixed(2) + ' mm') : '-';
            return \`<tr class="tool-row tool-row--\${t.statusClass}">
              <td><div class="tool-id-cell">
                <span class="tool-id-text">\${t.toolNumber}</span>
                \${slotBadge}
              </div></td>
              <td>\${desc}</td>
              <td>\${type}</td>
              <td>\${dia}</td>
              <td><span class="row-status-badge row-status-badge--\${t.statusClass}">\${t.statusLabel}</span></td>
            </tr>\`;
          }).join('');
        }

        function updateStatusBanner() {
          const unknownCount = allToolsData.filter(t => t.statusClass === 'red').length;
          const unmappedCount = allToolsData.filter(t => t.statusClass === 'yellow').length;
          const status = unknownCount > 0 ? 'red' : (unmappedCount > 0 ? 'yellow' : 'green');

          const cfg = {
            red: { color: '#dc3545', bg: 'rgba(220, 53, 69, 0.1)', icon: '🔴', title: 'Tools Not Found in Library', msg: unknownCount + ' tool(s) are not in your ncSender library. If you proceed with "Map Tools", tools that exist will be mapped - unknown tools will remain as-is.' },
            yellow: { color: '#ffc107', bg: 'rgba(255, 193, 7, 0.1)', icon: '🟡', title: 'Manual Tool Changes Required', msg: unmappedCount + ' tool(s) are in ncSender library but not assigned to slots. These will require manual tool changes.' },
            green: { color: '#28a745', bg: 'rgba(40, 167, 69, 0.1)', icon: '🟢', title: 'All Tools Ready for ATC', msg: 'All tools are in ncSender library and assigned to slots. Original tool numbers will be mapped to ncSender slots.' }
          }[status];

          const banner = document.getElementById('statusBanner');
          if (banner) {
            banner.style.background = cfg.bg;
            banner.style.borderColor = cfg.color;
            banner.style.color = cfg.color;
          }
          const iconEl = document.getElementById('statusIcon');
          if (iconEl) iconEl.textContent = cfg.icon;
          const titleEl = document.getElementById('statusTitle');
          if (titleEl) titleEl.textContent = cfg.title;
          const msgEl = document.getElementById('statusMessage');
          if (msgEl) msgEl.textContent = cfg.msg;

          const mapBtn = document.getElementById('mapBtn');
          if (mapBtn) {
            mapBtn.classList.remove('btn-success', 'btn-warning', 'btn-primary');
            mapBtn.classList.add(status === 'green' ? 'btn-success' : (status === 'yellow' ? 'btn-warning' : 'btn-primary'));
          }
        }

        // Init: render table now (was pre-rendered before, now JS-driven so it
        // can be re-rendered in place after slot edits). Then fetch magazine
        // size and render the carousel once we know it.
        renderTable();
        fetchMagazineSize().then(size => {
          magazineSize = size;
          renderCarousel();
        });

        overlay.addEventListener('click', closeSlotSelector);
        popup.addEventListener('click', e => e.stopPropagation());

        // Event delegation on tbody so re-rendered rows still respond to clicks.
        const toolsTableBody = document.getElementById('toolsTableBody');
        if (toolsTableBody) {
          toolsTableBody.addEventListener('click', e => {
            const cell = e.target.closest('.tool-id-cell');
            if (!cell) return;
            const tr = cell.closest('tr');
            const index = Array.from(toolsTableBody.children).indexOf(tr);
            if (index >= 0 && allToolsData[index]) {
              showSlotSelector(allToolsData[index], e);
            }
          });
        }

        listContainer.addEventListener('click', e => {
          const item = e.target.closest('.slot-selector-item');
          if (item) {
            const slotStr = item.getAttribute('data-slot');
            const slotNumber = slotStr === '' ? null : parseInt(slotStr, 10);
            selectSlot(slotNumber);
          }
        });

        document.getElementById('bypassBtn').addEventListener('click', () => {
          window.parent.postMessage({
            type: 'close-plugin-dialog',
            data: { action: 'bypass' }
          }, '*');
        });

        // Browser-side translation: bypasses Jint's 50 MB memory cap on big
        // files. Build map from current allToolsData (already reflects any
        // slot edits the user made), download current G-code, transform via
        // regex.replace, prepend marker, upload via /api/gcode-files/load-temp.
        // The plugin's onGcodeProgramLoad sees the marker on the next call
        // and skips, breaking what would otherwise be a re-processing loop.
        function performTranslationInBrowser(content) {
          const map = {};
          allToolsData.forEach(t => {
            if (t.statusClass === 'green' && t.pocketNumber !== null && t.pocketNumber !== undefined) {
              map[t.toolNumber] = t.pocketNumber;
            }
          });

          // Match only lines containing T<digit>, H<digit>, or M6.
          // Untouched lines pass through unchanged.
          return content.replace(/^[^\\n]*(?:M0*6|T\\d|H\\d)[^\\n]*$/gmi, function(line) {
            if (!line) return line;
            const trimmed = line.trim();
            if (!trimmed) return line;

            const firstChar = trimmed.charAt(0);

            // Comment line: translate T## but tag with [Original: tool ##]
            if (firstChar === '(' || firstChar === ';') {
              const m = line.match(/T(\\d+)/i);
              if (m) {
                const toolNumber = parseInt(m[1], 10);
                const pocket = map[toolNumber];
                if (pocket !== undefined) {
                  return line.replace(/T(\\d+)/i, function(_, num) {
                    return 'T' + pocket + ' [Original: tool ' + num + ']';
                  });
                }
              }
              return line;
            }

            let out = line;
            const tm = line.match(/T(\\d+)/i);
            if (tm) {
              const toolNumber = parseInt(tm[1], 10);
              const pocket = map[toolNumber];
              if (pocket !== undefined) {
                out = out.replace(/T\\d+/i, 'T' + pocket);
              }
            }
            const hm = out.match(/H(\\d+)/i);
            if (hm) {
              const heightNumber = parseInt(hm[1], 10);
              const pocket = map[heightNumber];
              if (pocket !== undefined) {
                out = out.replace(/H\\d+/i, 'H' + pocket);
              }
            }
            return out;
          });
        }

        document.getElementById('mapBtn').addEventListener('click', async () => {
          const mapBtn = document.getElementById('mapBtn');
          const bypassBtn = document.getElementById('bypassBtn');
          mapBtn.disabled = true;
          bypassBtn.disabled = true;
          mapBtn.textContent = 'Translating…';

          try {
            // Fetch the file we are currently loading. We canNOT use
            // /api/gcode-files/current/download here — that serves from the
            // cache, which still contains the *previously* loaded file
            // because the plugin is blocking the current load by showing
            // this dialog. Instead, read fresh from disk via sourcePath.
            let content;
            if (sourcePath) {
              const r = await fetch('/api/gcode-files/file?path=' + encodeURIComponent(sourcePath));
              if (!r.ok) throw new Error('Failed to fetch source file: HTTP ' + r.status);
              const data = await r.json();
              content = data.content;
            } else {
              // Fallback for paths where we don't have a sourcePath (rare).
              const r = await fetch('/api/gcode-files/current/download');
              if (!r.ok) throw new Error('Failed to download G-code: HTTP ' + r.status);
              content = await r.text();
            }

            const transformed = '${DTSM_MARKER}\\n' + performTranslationInBrowser(content);

            // CRITICAL: schedule the load-temp upload via setTimeout(0) so it
            // fires AFTER the close-plugin-dialog message releases the engine
            // lock. Otherwise load-temp's plugin-transform call would block
            // forever waiting for the lock that is currently held by the very
            // onGcodeProgramLoad call that's waiting for this dialog to close.
            //
            // Race: on Windows, the original LoadFileAsync's File.WriteAllTextAsync
            // and our load-temp's File.WriteAllTextAsync both write to
            // current.gcode. Windows holds an exclusive file lock during write,
            // so concurrent writes fail with "file in use". Retry with backoff
            // — the original write completes in <1s typically.
            const payload = { content: transformed, filename: filename, sourceFile: sourcePath || null };
            const delays = [0, 250, 500, 1000, 2000, 4000];
            function attempt(i) {
              fetch('/api/gcode-files/load-temp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              }).then(r => {
                if (r.ok) return;
                if (i + 1 < delays.length) setTimeout(() => attempt(i + 1), delays[i + 1]);
                else console.error('[DTSM dialog] load-temp failed after retries: HTTP ' + r.status);
              }).catch(err => {
                if (i + 1 < delays.length) setTimeout(() => attempt(i + 1), delays[i + 1]);
                else console.error('[DTSM dialog] load-temp failed after retries:', err);
              });
            }
            setTimeout(() => attempt(0), delays[0]);

            // Now release the engine lock by closing the dialog.
            window.parent.postMessage({
              type: 'close-plugin-dialog',
              data: { action: 'map' }
            }, '*');
          } catch (err) {
            mapBtn.disabled = false;
            bypassBtn.disabled = false;
            mapBtn.textContent = 'Map Tools';
            alert('Translation failed: ' + (err && err.message ? err.message : err));
          }
        });
      })();
    <\/script>
  `;

  if (typeof pluginContext.showDialog !== 'function') {
    throw new Error('pluginContext.showDialog is not available — host needs ncSender 2.0.37+ (OSS) or 2.0.88+ (Pro)');
  }

  const response = pluginContext.showDialog('Dynamic Tool Slot Mapper (Tool Mapping Summary)', html, { closable: false });

  if (response && response.action) {
    return response;
  }
  return { action: 'bypass' };
}
