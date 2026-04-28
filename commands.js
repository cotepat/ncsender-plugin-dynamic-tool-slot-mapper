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

function onGcodeProgramLoad(content, context, settings) {
  pluginContext.log('Dynamic Tool Slot Mapper: analyzing G-code...');

  let toolLibrary = loadToolLibrary();
  const lines = content.split('\n');
  let manualMappings = {};
  let toolChanges = parseToolChanges(lines, toolLibrary, manualMappings);

  if (toolChanges.allTools.length === 0) {
    pluginContext.log('No tool changes found in G-code');
    return content;
  }

  let status = determineStatus(toolChanges);

  let userChoice;
  while (true) {
    userChoice = showStatusDialog(
      context && context.filename,
      toolChanges,
      status,
      toolLibrary,
      manualMappings
    );

    const action = typeof userChoice === 'string' ? userChoice : (userChoice && userChoice.action);

    if (action === 'refresh') {
      toolLibrary = loadToolLibrary();
      if (userChoice && userChoice.sessionMappings !== undefined) {
        manualMappings = userChoice.sessionMappings;
      }
      toolChanges = parseToolChanges(lines, toolLibrary, manualMappings);
      status = determineStatus(toolChanges);
      continue;
    }
    break;
  }

  const finalAction = typeof userChoice === 'string' ? userChoice : (userChoice && userChoice.action);

  if (finalAction === 'bypass') {
    pluginContext.log('Tool mapping bypassed — loading original G-code');
    return content;
  }

  pluginContext.log('Starting tool translation...');
  return performTranslation(lines, toolChanges);
}

// === Tool library ===

function loadToolLibrary() {
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

  pluginContext.log(`Loaded ${tools.length} tool(s) from library`);
  return library;
}

// === Parse tool changes ===

function parseToolChanges(lines, toolLibrary, manualMappings) {
  manualMappings = manualMappings || {};
  const allTools = [];
  const inLibrary = [];
  const inMagazine = [];
  const notInMagazine = [];
  const unknownTools = [];

  const seenTools = {};

  lines.forEach((line, index) => {
    if (!line.trim()) return;

    const trimmed = line.trim();
    if (trimmed.charAt(0) === ';') return;
    if (trimmed.charAt(0) === '(' && trimmed.charAt(trimmed.length - 1) === ')') return;

    const match = trimmed.match(M6_PATTERN);
    if (!match) return;

    const toolNumberStr = match[1] || match[2];
    if (!toolNumberStr) return;

    const toolNumber = parseInt(toolNumberStr, 10);
    if (seenTools[toolNumber]) return;
    seenTools[toolNumber] = true;

    const toolNumberKey = String(toolNumber);
    const hasManualMapping = Object.prototype.hasOwnProperty.call(manualMappings, toolNumberKey);
    const manualPocketNumber = manualMappings[toolNumberKey];

    const toolInfo = toolLibrary[toolNumber];
    const toolData = {
      line: index + 1,
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
  });

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

// === G-code translation ===

function performTranslation(lines, toolChanges) {
  const translationMap = {};
  toolChanges.inMagazine.forEach(t => {
    translationMap[t.toolNumber] = t.pocketNumber;
  });

  let translationCount = 0;
  let commentTranslationCount = 0;

  // In-place mutation to avoid allocating a parallel translatedLines array
  // (large G-code files were hitting Jint's 50 MB LimitMemory).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const trimmed = line.trim();
    if (!trimmed) continue;

    const firstChar = trimmed.charAt(0);

    if (firstChar === '(' || firstChar === ';') {
      // Comment: translate T## and tag with [Original: tool ##]
      const toolMatch = line.match(/T(\d+)/i);
      if (toolMatch) {
        const toolNumber = parseInt(toolMatch[1], 10);
        const pocketNumber = translationMap[toolNumber];
        if (pocketNumber !== undefined) {
          lines[i] = line.replace(/T(\d+)/i, (m, num) => `T${pocketNumber} [Original: tool ${num}]`);
          commentTranslationCount++;
        }
      }
      continue;
    }

    // Fast skip: lines without any T or H letter can't have a translation.
    if (line.indexOf('T') < 0 && line.indexOf('t') < 0 && line.indexOf('H') < 0 && line.indexOf('h') < 0) continue;

    let out = line;
    let wasTranslated = false;

    const toolMatch = line.match(/T(\d+)/i);
    if (toolMatch) {
      const toolNumber = parseInt(toolMatch[1], 10);
      const pocketNumber = translationMap[toolNumber];
      if (pocketNumber !== undefined) {
        out = out.replace(/T\d+/i, `T${pocketNumber}`);
        wasTranslated = true;
        if (M6_PATTERN.test(line)) {
          pluginContext.log(`  T${toolNumber} → T${pocketNumber}`);
        }
      }
    }

    const heightMatch = out.match(/H(\d+)/i);
    if (heightMatch) {
      const heightNumber = parseInt(heightMatch[1], 10);
      const pocketNumber = translationMap[heightNumber];
      if (pocketNumber !== undefined) {
        out = out.replace(/H\d+/i, `H${pocketNumber}`);
        wasTranslated = true;
      }
    }

    if (wasTranslated) {
      lines[i] = out;
      translationCount++;
    }
  }

  pluginContext.log(`✓ Translated ${translationCount} tool change(s) and ${commentTranslationCount} comment(s)`);

  return lines.join('\n');
}

// === Status dialog ===

function showStatusDialog(filename, toolChanges, status, toolLibrary, sessionMappings) {
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
        <div class="status-banner">
          <span>${config.icon}</span>
          <span>${config.title}</span>
        </div>
      </div>

      <div class="status-message">${config.message}</div>

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
          <tbody>
            ${allToolsForTable.map(t => {
              const slotBadge = (t.pocketNumber !== null && t.pocketNumber !== undefined)
                ? `<span class="tool-number-badge">Slot${t.pocketNumber}</span>`
                : `<span class="tool-slot-placeholder">No Slot</span>`;
              return `
                <tr class="tool-row tool-row--${t.statusClass}">
                  <td>
                    <div class="tool-id-cell">
                      <span class="tool-id-text">${t.toolNumber}</span>
                      ${slotBadge}
                    </div>
                  </td>
                  <td>${t.toolInfo ? t.toolInfo.name : `Tool ${t.toolNumber}`}</td>
                  <td>${t.toolInfo ? t.toolInfo.type : '-'}</td>
                  <td>${t.toolInfo ? t.toolInfo.diameter.toFixed(2) + ' mm' : '-'}</td>
                  <td><span class="row-status-badge row-status-badge--${t.statusClass}">${t.statusLabel}</span></td>
                </tr>
              `;
            }).join('')}
          </tbody>
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

            // Small delay for /api/tools writes to settle, then refresh dialog
            await new Promise(resolve => setTimeout(resolve, 100));

            window.parent.postMessage({
              type: 'close-plugin-dialog',
              data: { action: 'refresh', sessionMappings: sessionMappings }
            }, '*');

          } catch (error) {
            alert('Failed to update slot: ' + (error && error.message ? error.message : error));
          }
        }

        // Init: fetch magazine size, then render carousel
        fetchMagazineSize().then(size => {
          magazineSize = size;
          renderCarousel();
        });

        overlay.addEventListener('click', closeSlotSelector);
        popup.addEventListener('click', e => e.stopPropagation());

        document.querySelectorAll('.tool-id-cell').forEach((cell, index) => {
          cell.addEventListener('click', e => {
            showSlotSelector(allToolsData[index], e);
          });
        });

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

        document.getElementById('mapBtn').addEventListener('click', () => {
          window.parent.postMessage({
            type: 'close-plugin-dialog',
            data: { action: 'map' }
          }, '*');
        });
      })();
    <\/script>
  `;

  const response = pluginContext.showDialog('Dynamic Tool Slot Mapper (Tool Mapping Summary)', html, { closable: false });

  if (response && response.action) {
    return response;
  }
  return { action: 'bypass' };
}
