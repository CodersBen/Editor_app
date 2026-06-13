// Properties panel: builders and update handlers, including the appearance
// stack (multi-stroke / multi-shadow / extrude), typography controls,
// global swatches and artboard margin settings.
Object.assign(MiniCanva.prototype, {

    // --- Swatches ---------------------------------------------------------------
    buildSwatchesHTML(linkedId) {
        const rows = this.swatches.map((s, i) => `
            <div class="swatch-row">
                <input type="color" value="${s.color}" oninput="app.updateSwatch(${i}, 'color', this.value)" title="Edit swatch — updates every linked object">
                <input type="text" value="${s.name}" onchange="app.updateSwatch(${i}, 'name', this.value)">
                ${ColorUtil.warnBadge(s.color)}
                <button class="stack-remove" onclick="app.removeSwatch(${i})" title="Delete swatch">✕</button>
            </div>`).join('');
        return `
            <details ${this.swatches.length ? 'open' : ''}>
                <summary>Global Swatches</summary>
                <div class="details-content">
                    ${rows || '<div class="muted">No swatches yet.</div>'}
                    <button class="stack-add" onclick="app.addSwatch()">+ Add Swatch</button>
                </div>
            </details>`;
    },

    addSwatch(color) {
        this.swatches.push({
            id: 'sw_' + Date.now(),
            name: 'Swatch ' + (this.swatches.length + 1),
            color: color || '#8b5cf6'
        });
        this.updatePropPanel();
        this.markDirty();
    },

    // Editing a global swatch re-paints every linked object.
    updateSwatch(i, key, value) {
        const sw = this.swatches[i];
        if (!sw) return;
        sw[key] = value;
        if (key === 'color') {
            this.elements.forEach(el => {
                if (el.fillSwatchId === sw.id) { el.bgColor = value; this.applyElementStyles(el); }
                if (el.textSwatchId === sw.id) { el.color = value; this.applyElementStyles(el); }
            });
        }
        this.markDirty();
    },

    removeSwatch(i) {
        const sw = this.swatches[i];
        if (!sw) return;
        this.elements.forEach(el => {
            if (el.fillSwatchId === sw.id) el.fillSwatchId = null;
            if (el.textSwatchId === sw.id) el.textSwatchId = null;
        });
        this.swatches.splice(i, 1);
        this.updatePropPanel();
        this.markDirty();
    },

    linkSwatch(elId, prop, swatchId) {
        const el = this.elements.find(e => e.id === elId);
        if (!el) return;
        const sw = this.swatches.find(s => s.id === swatchId);
        if (prop === 'fill') {
            el.fillSwatchId = sw ? sw.id : null;
            if (sw) el.bgColor = sw.color;
        } else {
            el.textSwatchId = sw ? sw.id : null;
            if (sw) el.color = sw.color;
        }
        this.applyElementStyles(el);
        this.updatePropPanel();
        this.markDirty();
    },

    swatchSelectHTML(el, prop) {
        const current = prop === 'fill' ? el.fillSwatchId : el.textSwatchId;
        const opts = this.swatches.map(s =>
            `<option value="${s.id}" ${current === s.id ? 'selected' : ''}>${s.name}</option>`).join('');
        return `<select onchange="app.linkSwatch('${el.id}', '${prop}', this.value)" title="Link to global swatch" style="width:90px;">
            <option value="">No swatch</option>${opts}</select>`;
    },

    // --- Appearance stack ----------------------------------------------------------
    buildAppearanceHTML(el) {
        const a = el.appearance || this.defaultAppearance();
        const id = el.id;

        const strokeRows = (a.strokes || []).map((s, i) => `
            <div class="stack-item">
                <div class="row">
                    <input type="color" value="${s.color}" oninput="app.updateStackItem('${id}','strokes',${i},'color',this.value)">
                    <input type="number" value="${s.width}" min="0" style="width:52px;" onchange="app.updateStackItem('${id}','strokes',${i},'width',this.value)" title="Width">
                    <select onchange="app.updateStackItem('${id}','strokes',${i},'align',this.value)" style="width:74px;">
                        <option value="inside" ${s.align === 'inside' ? 'selected' : ''}>Inside</option>
                        <option value="center" ${s.align === 'center' ? 'selected' : ''}>Center</option>
                        <option value="outside" ${s.align === 'outside' ? 'selected' : ''}>Outside</option>
                    </select>
                    <button class="stack-remove" onclick="app.removeStackItem('${id}','strokes',${i})">✕</button>
                </div>
            </div>`).join('');

        const shadowRows = (a.shadows || []).map((s, i) => `
            <div class="stack-item">
                <div class="row">
                    <div class="flex-1"><label class="f-label">X</label><input type="number" value="${s.x}" onchange="app.updateStackItem('${id}','shadows',${i},'x',this.value)"></div>
                    <div class="flex-1"><label class="f-label">Y</label><input type="number" value="${s.y}" onchange="app.updateStackItem('${id}','shadows',${i},'y',this.value)"></div>
                    <div class="flex-1"><label class="f-label">Blur</label><input type="number" value="${s.blur}" min="0" onchange="app.updateStackItem('${id}','shadows',${i},'blur',this.value)"></div>
                    <input type="color" value="${s.color}" oninput="app.updateStackItem('${id}','shadows',${i},'color',this.value)" style="margin-top:10px;">
                    <button class="stack-remove" onclick="app.removeStackItem('${id}','shadows',${i})">✕</button>
                </div>
            </div>`).join('');

        const extrudeRows = (a.extrudes || []).map((s, i) => `
            <div class="stack-item">
                <div class="row">
                    <div class="flex-1"><label class="f-label">X</label><input type="number" value="${s.x}" onchange="app.updateStackItem('${id}','extrudes',${i},'x',this.value)"></div>
                    <div class="flex-1"><label class="f-label">Y</label><input type="number" value="${s.y}" onchange="app.updateStackItem('${id}','extrudes',${i},'y',this.value)"></div>
                    <input type="color" value="${s.color}" oninput="app.updateStackItem('${id}','extrudes',${i},'color',this.value)" style="margin-top:10px;">
                    <button class="stack-remove" onclick="app.removeStackItem('${id}','extrudes',${i})">✕</button>
                </div>
            </div>`).join('');

        return `
            <details ${(a.strokes?.length || a.shadows?.length || a.extrudes?.length) ? 'open' : ''}>
                <summary>Appearance</summary>
                <div class="details-content">
                    <div class="muted" style="font-weight:700;">Strokes</div>
                    ${strokeRows}
                    <button class="stack-add" onclick="app.addStackItem('${id}','strokes')">+ Add Stroke</button>
                    <div class="muted" style="font-weight:700;margin-top:6px;">Drop Shadows</div>
                    ${shadowRows}
                    <button class="stack-add" onclick="app.addStackItem('${id}','shadows')">+ Add Shadow</button>
                    <div class="muted" style="font-weight:700;margin-top:6px;">Extrude (Block Shadow)</div>
                    ${extrudeRows}
                    <button class="stack-add" onclick="app.addStackItem('${id}','extrudes')">+ Add Extrude</button>
                    <button class="stack-add danger-soft" onclick="app.resetAppearance('${id}')">Reset Appearance</button>
                </div>
            </details>`;
    },

    addStackItem(id, kind) {
        const el = this.elements.find(e => e.id === id);
        if (!el) return;
        if (!el.appearance) el.appearance = this.defaultAppearance();
        const defaults = {
            strokes: { width: 2, color: '#111111', align: 'outside' },
            shadows: { x: 4, y: 6, blur: 12, color: '#000000' },
            extrudes: { x: 6, y: 6, color: '#3b0764' }
        };
        el.appearance[kind].push(Object.assign({}, defaults[kind]));
        this.applyElementStyles(el);
        this.updatePropPanel();
        this.markDirty();
    },

    updateStackItem(id, kind, i, key, value) {
        const el = this.elements.find(e => e.id === id);
        const item = el?.appearance?.[kind]?.[i];
        if (!item) return;
        item[key] = ['width', 'x', 'y', 'blur'].includes(key) ? (parseFloat(value) || 0) : value;
        this.applyElementStyles(el);
        this.markDirty();
    },

    removeStackItem(id, kind, i) {
        const el = this.elements.find(e => e.id === id);
        if (!el?.appearance?.[kind]) return;
        el.appearance[kind].splice(i, 1);
        this.applyElementStyles(el);
        this.updatePropPanel();
        this.markDirty();
    },

    resetAppearance(id) {
        const el = this.elements.find(e => e.id === id);
        if (!el) return;
        el.appearance = this.defaultAppearance();
        const dom = document.getElementById(id);
        if (dom) {
            dom.style.boxShadow = 'none';
            dom.style.textShadow = 'none';
            dom.style.webkitTextStroke = '0';
            dom.style.filter = 'none';
        }
        this.applyElementStyles(el);
        this.updatePropPanel();
        this.renderGizmo();
        this.markDirty();
    },

    resetAppearanceSelected() {
        Array.from(this.selection).forEach(id => this.resetAppearance(id));
        this.hideContextMenu();
    },

    // --- Panel root --------------------------------------------------------------
    updatePropPanel() {
        const count = this.selection.size;

        if (count === 0) { this.renderArtboardPanel(); return; }
        if (count > 1) { this.renderMultiPanel(count); return; }

        const id = Array.from(this.selection)[0];
        const el = this.elements.find(e => e.id === id);
        if (!el) { this.renderArtboardPanel(); return; }

        const u = this.docUnit();
        let html = `
        <details open>
            <summary>Layout</summary>
            <div class="details-content">
                <div class="grid-2">
                    <div><label class="f-label">X (${u})</label><input id="prop-x" type="number" step="any" value="${this.fmtDim(el.x)}" onchange="app.updatePropU('${id}', 'x', this.value)"></div>
                    <div><label class="f-label">Y (${u})</label><input id="prop-y" type="number" step="any" value="${this.fmtDim(el.y)}" onchange="app.updatePropU('${id}', 'y', this.value)"></div>
                    <div><label class="f-label">W (${u})</label><input id="prop-w" type="number" step="any" value="${this.fmtDim(el.w)}" onchange="app.updatePropU('${id}', 'w', this.value)"></div>
                    <div><label class="f-label">H (${u})</label><input id="prop-h" type="number" step="any" value="${this.fmtDim(el.h)}" onchange="app.updatePropU('${id}', 'h', this.value)"></div>
                    <div><label class="f-label">Rotation</label><input id="prop-rotation" type="number" value="${Math.round(el.rotation)}" onchange="app.updateProp('${id}', 'rotation', this.value)"></div>
                    <div><label class="f-label">Opacity %</label><input type="number" value="${Math.round(el.opacity ?? 100)}" min="0" max="100" onchange="app.updateProp('${id}', 'opacity', this.value)"></div>
                </div>
                <label class="row" style="font-size:11px;gap:6px;" title="Keep width/height ratio when resizing (or hold Shift)">
                    <input type="checkbox" ${el.aspectLocked ? 'checked' : ''} onchange="app.updateProp('${id}', 'aspectLocked', this.checked)"> 🔒 Lock aspect ratio
                </label>
                <div>
                    <label class="f-label">Pivot</label>
                    <select onchange="app.updateProp('${id}', 'transformOrigin', this.value)">
                        ${[
                            ['50% 50%', 'Center'],
                            ['50% 0%', 'Top'],
                            ['0% 0%', 'Left Top'],
                            ['100% 0%', 'Right Top'],
                            ['0% 50%', 'Left Center'],
                            ['100% 50%', 'Right Center'],
                            ['0% 100%', 'Left Bottom'],
                            ['100% 100%', 'Right Bottom'],
                            ['50% 100%', 'Bottom']
                        ].map(([value, label]) => `<option value="${value}" ${(el.transformOrigin || '50% 50%') === value ? 'selected' : ''}>${label}</option>`).join('')}
                    </select>
                </div>
                <div class="align-strip">
                    <button onclick="app.alignElements('left')" class="icon-btn" title="Align left"><i data-lucide="align-start-vertical"></i></button>
                    <button onclick="app.alignElements('center')" class="icon-btn" title="Align center"><i data-lucide="align-center-vertical"></i></button>
                    <button onclick="app.alignElements('right')" class="icon-btn" title="Align right"><i data-lucide="align-end-vertical"></i></button>
                    <button onclick="app.alignElements('top')" class="icon-btn" title="Align top"><i data-lucide="align-start-horizontal"></i></button>
                    <button onclick="app.alignElements('middle')" class="icon-btn" title="Align middle"><i data-lucide="align-center-horizontal"></i></button>
                    <button onclick="app.alignElements('bottom')" class="icon-btn" title="Align bottom"><i data-lucide="align-end-horizontal"></i></button>
                    <button onclick="app.distributeElements('h')" class="icon-btn" title="Distribute horizontal"><i data-lucide="columns-3"></i></button>
                    <button onclick="app.distributeElements('v')" class="icon-btn" title="Distribute vertical"><i data-lucide="rows-3"></i></button>
                </div>
            </div>
        </details>`;

        if (['rect', 'circle', 'path', 'bool'].includes(el.type)) {
            html += `
            <details open>
                <summary>Fill</summary>
                <div class="details-content">
                    <div class="row">
                        <label class="row" style="gap:4px;font-size:11px;" title="No Fill: only strokes remain visible and clickable">
                            <input type="checkbox" ${el.fillEnabled !== false ? 'checked' : ''} onchange="app.updateProp('${id}', 'fillEnabled', this.checked)">
                        </label>
                        <input id="prop-bgColor" type="color" value="${el.bgColor}" oninput="app.updateProp('${id}', 'bgColor', this.value)" ${el.fillEnabled === false ? 'disabled' : ''}>
                        ${ColorUtil.warnBadge(el.bgColor)}
                        ${this.swatchSelectHTML(el, 'fill')}
                    </div>
                    ${el.type === 'rect' ? (() => {
                        const rr = el.radii || [el.borderRadius || 0, el.borderRadius || 0, el.borderRadius || 0, el.borderRadius || 0];
                        return `
                    <div>
                        <label class="f-label">Corner Radius (uniform)</label>
                        <div class="row">
                            <input type="range" min="0" max="100" value="${parseInt(el.borderRadius) || 0}" class="flex-1" oninput="app.updateProp('${id}', 'borderRadius', this.value)">
                            <span id="val-borderRadius" class="muted" style="width:24px;text-align:right;">${parseInt(el.borderRadius) || 0}</span>
                        </div>
                    </div>
                    <div>
                        <div class="row" style="justify-content:space-between;">
                            <label class="f-label" style="margin:0;">Corners (TL · TR · BR · BL)</label>
                            <label class="row" style="gap:4px;font-size:10px;" title="Link corners: editing or dragging any corner changes all four">
                                <input type="checkbox" ${el.radiusLinked ? 'checked' : ''} onchange="app.updateProp('${id}', 'radiusLinked', this.checked)"> 🔗
                            </label>
                        </div>
                        <div class="row" style="gap:4px;">
                            ${rr.map((r, i) => `<input type="number" min="0" value="${Math.round(r)}" style="width:25%;" oninput="app.setRectCorner('${id}', ${i}, this.value)" title="${['Top left', 'Top right', 'Bottom right', 'Bottom left'][i]}">`).join('')}
                        </div>
                    </div>`;
                    })() : ''}
                </div>
            </details>`;
        }

        // Direct-selection: per-anchor controls for the selected point.
        if (el.type === 'path' && this.currentTool === 'node' && this.selectedVertex >= 0 && el.points && el.points[this.selectedVertex]) {
            const pSel = el.points[this.selectedVertex];
            const sharp = !pSel.hi && !pSel.ho;
            html += `
            <details open>
                <summary>Anchor Point</summary>
                <div class="details-content">
                    <div class="row" style="justify-content:space-between;">
                        <span class="muted">Point ${this.selectedVertex + 1} — ${sharp ? 'corner' : 'smooth'}</span>
                        <button class="action-btn" onclick="app.toggleVertexType(${this.selectedVertex})">${sharp ? 'Make Smooth' : 'Make Corner'}</button>
                    </div>
                    <button class="action-btn danger-soft" onclick="app.removeSelectedVertices()">− Remove Point${this.selectedVertices && this.selectedVertices.size > 1 ? 's (' + this.selectedVertices.size + ')' : ''}</button>
                    ${sharp ? `
                    <div>
                        <label class="f-label">Corner radius px</label>
                        <input type="number" min="0" value="${Math.round(pSel.r || 0)}" oninput="app.setVertexRadius('${el.id}', ${this.selectedVertex}, this.value)">
                    </div>` : ''}
                    <div class="muted">Alt+click: corner/smooth · Shift+click: multi-select · Double-click: delete point</div>
                </div>
            </details>`;
        }

        if (el.type === 'text') html += this.buildTypographyHTML(el);

        if (['rect', 'circle', 'path', 'bool', 'text', 'image'].includes(el.type)) {
            html += this.buildAppearanceHTML(el);
        }

        if (el.type === 'group') {
            if (el.maskSvg) {
                html += `
                <details open>
                    <summary>Mask</summary>
                    <div class="details-content">
                        <div class="muted">${el.maskInverted ? 'Inverted mask (shape punches a hole).' : 'Clipping mask applied.'}</div>
                        <button class="action-btn" onclick="app.releaseMask()">Release Mask</button>
                    </div>
                </details>`;
            }
            html += `
            <details open>
                <summary>Auto Layout</summary>
                <div class="details-content">
                    <div class="row" style="justify-content:space-between;">
                        <span class="muted">Mode</span>
                        <div class="row" style="gap:2px;background:var(--bg-2);border:1px solid var(--border);padding:2px;">
                            <button onclick="app.updateProp('${id}', 'layoutMode', 'none')" class="icon-btn ${el.layoutMode === 'none' ? 'active-tool' : ''}"><i data-lucide="x"></i></button>
                            <button onclick="app.updateProp('${id}', 'layoutMode', 'horizontal')" class="icon-btn ${el.layoutMode === 'horizontal' ? 'active-tool' : ''}"><i data-lucide="arrow-right"></i></button>
                            <button onclick="app.updateProp('${id}', 'layoutMode', 'vertical')" class="icon-btn ${el.layoutMode === 'vertical' ? 'active-tool' : ''}"><i data-lucide="arrow-down"></i></button>
                        </div>
                    </div>
                    ${el.layoutMode !== 'none' ? `
                    <div class="grid-2">
                        <div><label class="f-label">Gap (≥0)</label><input type="number" min="0" value="${el.gap}" onchange="app.updateProp('${id}', 'gap', this.value)"></div>
                        <div><label class="f-label">Padding (≥0)</label><input type="number" min="0" value="${el.padding}" onchange="app.updateProp('${id}', 'padding', this.value)"></div>
                    </div>
                    <div class="row" style="justify-content:space-between;">
                        <span class="muted">Align</span>
                        <select onchange="app.updateProp('${id}', 'alignItems', this.value)" style="width:100px;">
                            <option value="start" ${el.alignItems === 'start' ? 'selected' : ''}>Start</option>
                            <option value="center" ${el.alignItems === 'center' ? 'selected' : ''}>Center</option>
                            <option value="end" ${el.alignItems === 'end' ? 'selected' : ''}>End</option>
                        </select>
                    </div>` : ''}
                </div>
            </details>`;
        }

        this.propPanel.innerHTML = html;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    buildTypographyHTML(el) {
        const id = el.id;
        const f = el.features || {};
        const warp = el.warp || { mode: 'none', amount: 30 };
        return `
        <details open>
            <summary>Typography</summary>
            <div class="details-content">
                <div><label class="f-label">Content</label><input id="prop-text" type="text" value="${(el.text || '').replace(/"/g, '&quot;')}" oninput="app.updateProp('${id}', 'text', this.value)"></div>
                <div class="grid-2">
                    <div><label class="f-label">Size</label><input id="prop-fontSize" type="number" value="${el.fontSize}" onchange="app.updateProp('${id}', 'fontSize', this.value)"></div>
                    <div><label class="f-label">Weight</label>
                        <select onchange="app.updateProp('${id}', 'fontWeight', this.value)">
                            ${['300', '400', '500', '600', '700', '800'].map(w => `<option value="${w}" ${el.fontWeight === w ? 'selected' : ''}>${w}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="row">
                    <label class="row" style="gap:4px;font-size:11px;" title="No Fill: text shows strokes only">
                        <input type="checkbox" ${el.fillEnabled !== false ? 'checked' : ''} onchange="app.updateProp('${id}', 'fillEnabled', this.checked)">
                    </label>
                    <input id="prop-color" type="color" value="${el.color}" oninput="app.updateProp('${id}', 'color', this.value)" ${el.fillEnabled === false ? 'disabled' : ''}>
                    ${ColorUtil.warnBadge(el.color)}
                    ${this.swatchSelectHTML(el, 'text')}
                </div>
                <div class="grid-2">
                    <div><label class="f-label">Kerning ‰</label><input type="number" value="${el.kerning || 0}" onchange="app.updateProp('${id}', 'kerning', this.value)"></div>
                    <div><label class="f-label">Tracking ‰</label><input type="number" value="${el.tracking || 0}" onchange="app.updateProp('${id}', 'tracking', this.value)"></div>
                    <div><label class="f-label">Leading px</label><input type="number" value="${el.leading || 0}" min="0" onchange="app.updateProp('${id}', 'leading', this.value)" title="0 = auto"></div>
                    <div><label class="f-label">Baseline ±px</label><input type="number" value="${el.baselineShift || 0}" onchange="app.updateProp('${id}', 'baselineShift', this.value)"></div>
                </div>
            </div>
        </details>
        <details>
            <summary>OpenType</summary>
            <div class="details-content">
                <label class="row" style="font-size:11px;"><input type="checkbox" ${f.liga ? 'checked' : ''} onchange="app.updateFeature('${id}', 'liga', this.checked)"> Standard ligatures</label>
                <label class="row" style="font-size:11px;"><input type="checkbox" ${f.dlig ? 'checked' : ''} onchange="app.updateFeature('${id}', 'dlig', this.checked)"> Discretionary ligatures</label>
                <label class="row" style="font-size:11px;"><input type="checkbox" ${f.swsh ? 'checked' : ''} onchange="app.updateFeature('${id}', 'swsh', this.checked)"> Swashes</label>
            </div>
        </details>
        <details ${warp.mode !== 'none' || el.curveRadius ? 'open' : ''}>
            <summary>Distort &amp; Path</summary>
            <div class="details-content">
                <div class="row" style="justify-content:space-between;">
                    <span class="muted">Envelope Warp</span>
                    <select onchange="app.updateWarp('${id}', 'mode', this.value)" style="width:100px;">
                        ${['none', 'arc', 'arch', 'flag', 'wave', 'rise'].map(m => `<option value="${m}" ${warp.mode === m ? 'selected' : ''}>${m[0].toUpperCase() + m.slice(1)}</option>`).join('')}
                    </select>
                </div>
                <div class="row">
                    <input type="range" min="-100" max="100" value="${warp.amount}" class="flex-1" oninput="app.updateWarp('${id}', 'amount', this.value)">
                    <span id="val-warpAmount" class="muted" style="width:28px;text-align:right;">${warp.amount}</span>
                </div>
                <div>
                    <label class="f-label">Type on Path — arc radius</label>
                    <div class="row">
                        <input type="range" min="-300" max="300" value="${el.curveRadius || 0}" class="flex-1" oninput="app.updateProp('${id}', 'curveRadius', this.value)">
                        <span id="val-curveRadius" class="muted" style="width:28px;text-align:right;">${el.curveRadius || 0}</span>
                    </div>
                </div>
                <button class="stack-add danger-soft" onclick="app.resetDistortion('${id}')">Reset Warp / Path</button>
            </div>
        </details>`;
    },

    renderMultiPanel(count) {
        this.propPanel.innerHTML = `
        <div class="details-content" style="padding-top:14px;">
            <div class="muted" style="font-weight:700;">${count} objects selected</div>
            <div class="align-strip">
                <button onclick="app.alignElements('left')" class="icon-btn" title="Align left"><i data-lucide="align-start-vertical"></i></button>
                <button onclick="app.alignElements('center')" class="icon-btn" title="Align center"><i data-lucide="align-center-vertical"></i></button>
                <button onclick="app.alignElements('right')" class="icon-btn" title="Align right"><i data-lucide="align-end-vertical"></i></button>
                <button onclick="app.alignElements('top')" class="icon-btn" title="Align top"><i data-lucide="align-start-horizontal"></i></button>
                <button onclick="app.alignElements('middle')" class="icon-btn" title="Align middle"><i data-lucide="align-center-horizontal"></i></button>
                <button onclick="app.alignElements('bottom')" class="icon-btn" title="Align bottom"><i data-lucide="align-end-horizontal"></i></button>
                <button onclick="app.distributeElements('h')" class="icon-btn" title="Distribute horizontal"><i data-lucide="columns-3"></i></button>
                <button onclick="app.distributeElements('v')" class="icon-btn" title="Distribute vertical"><i data-lucide="rows-3"></i></button>
            </div>
            <div class="muted" style="font-weight:700;margin-top:8px;">Pathfinder</div>
            <div class="grid-2">
                <button class="action-btn" onclick="app.pathfinder('add')">Add</button>
                <button class="action-btn" onclick="app.pathfinder('subtract')">Subtract</button>
                <button class="action-btn" onclick="app.pathfinder('intersect')">Intersect</button>
                <button class="action-btn" onclick="app.pathfinder('exclude')">Exclude</button>
            </div>
            <div class="muted" style="font-weight:700;margin-top:8px;">Masking</div>
            <button class="action-btn" onclick="app.makeMask(false)">Make Clipping Mask</button>
            <button class="action-btn" onclick="app.makeMask(true)">Make Inverted Mask</button>
            <div class="muted" style="font-weight:700;margin-top:8px;">Structure</div>
            <button class="action-btn" onclick="app.groupSelected()">Group Selection</button>
        </div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    renderArtboardPanel() {
        const ab = this.artboards.find(a => a.id === this.activeArtboardId) || this.artboards[0];
        if (!ab) {
            this.propPanel.innerHTML = `<div class="muted" style="text-align:center;padding:40px 0;">No artboards</div>` + this.buildSwatchesHTML();
            return;
        }
        const u = this.docUnit();
        const isLandscape = ab.w >= ab.h;
        const presetOptions = Object.entries(this.presetLabels())
            .map(([k, label]) => `<option value="${k}">${label}</option>`).join('');
        const unitOptions = ['px', 'in', 'mm', 'cm', 'm', 'ft', 'yd', 'pt', 'pc']
            .map(x => `<option value="${x}" ${u === x ? 'selected' : ''}>${x}</option>`).join('');
        this.propPanel.innerHTML = `
        <details open>
            <summary>Artboard — ${this.escapeHtml(ab.label || '')}</summary>
            <div class="details-content">
                <div><label class="f-label">Name</label><input type="text" value="${this.escapeHtml(ab.label || '')}" onchange="app.renameArtboard('${ab.id}', this.value)"></div>
                <div><label class="f-label">Preset</label>
                    <select onchange="app.applyArtboardPreset('${ab.id}', this.value); this.value='custom';">
                        ${presetOptions}
                    </select>
                </div>
                <div class="grid-2">
                    <div><label class="f-label">W (${u})</label><input type="number" step="any" value="${this.fmtDim(ab.w)}" onchange="app.updateArtboardPropU('${ab.id}', 'w', this.value)"></div>
                    <div><label class="f-label">H (${u})</label><input type="number" step="any" value="${this.fmtDim(ab.h)}" onchange="app.updateArtboardPropU('${ab.id}', 'h', this.value)"></div>
                </div>
                <div class="row" style="justify-content:space-between;">
                    <span class="muted">Orientation</span>
                    <div class="row" style="gap:2px;background:var(--bg-2);border:1px solid var(--border);padding:2px;">
                        <button onclick="app.setArtboardOrientation('${ab.id}', 'portrait')" class="icon-btn ${!isLandscape ? 'active-tool' : ''}" title="Portrait"><i data-lucide="rectangle-vertical"></i></button>
                        <button onclick="app.setArtboardOrientation('${ab.id}', 'landscape')" class="icon-btn ${isLandscape ? 'active-tool' : ''}" title="Landscape"><i data-lucide="rectangle-horizontal"></i></button>
                    </div>
                </div>
                <div class="row">
                    <label class="f-label" style="margin:0;">Background</label>
                    <input type="color" value="${ab.bgColor}" oninput="app.updateArtboardProp('${ab.id}', 'bgColor', this.value)">
                    ${ColorUtil.warnBadge(ab.bgColor)}
                </div>
                <label class="row" style="font-size:11px;gap:6px;" title="Hide objects outside the artboard (they stay editable)">
                    <input type="checkbox" ${ab.clipContent !== false ? 'checked' : ''} onchange="app.updateArtboardProp('${ab.id}', 'clipContent', this.checked)"> Clip content
                </label>
                <div class="grid-2">
                    <button class="action-btn" onclick="app.duplicateArtboard('${ab.id}')">Duplicate</button>
                    <button class="action-btn danger-soft" onclick="app.deleteArtboard('${ab.id}')">Delete</button>
                </div>
            </div>
        </details>
        <details open>
            <summary>Document</summary>
            <div class="details-content">
                <div class="grid-2">
                    <div><label class="f-label">Units</label>
                        <select onchange="app.setDocumentUnit(this.value)">${unitOptions}</select>
                    </div>
                    <div><label class="f-label">Resolution PPI</label>
                        <input type="number" min="1" value="${this.docResolution()}" list="ppi-presets" onchange="app.setDocumentResolution(this.value)">
                    </div>
                </div>
                <div class="muted">Units affect display only — geometry never changes.</div>
            </div>
        </details>
        <details open>
            <summary>Margins <input type="checkbox" ${ab.marginEnabled ? 'checked' : ''} onclick="event.stopPropagation(); app.updateArtboardMargin('${ab.id}', 'enabled', this.checked)"></summary>
            <div class="details-content" style="${!ab.marginEnabled ? 'opacity:0.45;pointer-events:none;' : ''}">
                <div class="grid-2">
                    <div><label class="f-label">Top (${u})</label><input type="number" min="0" step="any" value="${this.fmtDim(ab.marginTop)}" onchange="app.updateArtboardMarginU('${ab.id}', 'marginTop', this.value)"></div>
                    <div><label class="f-label">Left (${u})</label><input type="number" min="0" step="any" value="${this.fmtDim(ab.marginLeft)}" onchange="app.updateArtboardMarginU('${ab.id}', 'marginLeft', this.value)"></div>
                    <div><label class="f-label">Bottom (${u})</label><input type="number" min="0" step="any" value="${this.fmtDim(ab.marginBottom)}" onchange="app.updateArtboardMarginU('${ab.id}', 'marginBottom', this.value)"></div>
                    <div><label class="f-label">Right (${u})</label><input type="number" min="0" step="any" value="${this.fmtDim(ab.marginRight)}" onchange="app.updateArtboardMarginU('${ab.id}', 'marginRight', this.value)"></div>
                </div>
                <div class="row">
                    <label class="f-label" style="margin:0;">Guide color</label>
                    <input type="color" value="${ab.marginColor}" oninput="app.updateArtboardMargin('${ab.id}', 'color', this.value)">
                </div>
            </div>
        </details>
        ${this.buildSwatchesHTML()}
        <details>
            <summary>Drafting Grid</summary>
            <div class="details-content">
                <div class="grid-2">
                    <div><label class="f-label">Grid size px</label><input type="number" min="2" value="${this.gridSize}" onchange="app.gridSize = Math.max(2, parseFloat(this.value)||20); app.drawGrid(); app.markDirty();"></div>
                    <div><label class="f-label">Baseline px</label><input type="number" min="2" value="${this.baselineSize}" onchange="app.baselineSize = Math.max(2, parseFloat(this.value)||24); app.drawGrid(); app.markDirty();"></div>
                </div>
            </div>
        </details>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    refreshPanelValues() {
        if (this.selection.size !== 1) return;
        const id = Array.from(this.selection)[0];
        const el = this.elements.find(e => e.id === id);
        if (!el) return;
        const setVal = (pid, val) => {
            const inp = document.getElementById(pid);
            if (inp && document.activeElement !== inp) inp.value = val;
        };
        setVal('prop-x', this.fmtDim(el.x));
        setVal('prop-y', this.fmtDim(el.y));
        setVal('prop-w', this.fmtDim(el.w));
        setVal('prop-h', this.fmtDim(el.h));
        setVal('prop-rotation', Math.round(el.rotation));
        if (el.type === 'text') setVal('prop-fontSize', Math.round(el.fontSize));
    },

    // Unit-aware wrappers: panel inputs speak the document unit, the model px.
    updatePropU(id, key, value) {
        this.updateProp(id, key, this.unitToPx(parseFloat(value) || 0));
    },

    updateArtboardPropU(id, key, value) {
        this.updateArtboardProp(id, key, this.unitToPx(parseFloat(value) || 0));
    },

    updateArtboardMarginU(id, key, value) {
        this.updateArtboardMargin(id, key, this.unitToPx(parseFloat(value) || 0));
    },

    setRectCorner(id, corner, value) {
        const el = this.elements.find(e => e.id === id);
        if (!el || el.type !== 'rect') return;
        const u = el.borderRadius || 0;
        if (!el.radii) el.radii = [u, u, u, u];
        const r = Math.max(0, parseFloat(value) || 0);
        // Linked corners: any corner edit applies to all four.
        if (el.radiusLinked) { el.radii = [r, r, r, r]; el.borderRadius = r; }
        else el.radii[corner] = r;
        this.applyElementStyles(el);
        this.renderGizmo();
        this.markDirty();
    },

    // --- Property updates -------------------------------------------------------------
    updateProp(id, key, value) {
        const el = this.elements.find(e => e.id === id);
        if (!el) return;

        const numeric = ['x', 'y', 'w', 'h', 'rotation', 'fontSize', 'opacity', 'borderRadius',
            'curveRadius', 'gap', 'padding', 'tracking', 'kerning', 'leading', 'baselineShift'];
        if (numeric.includes(key)) value = parseFloat(value) || 0;
        if (key === 'w' || key === 'h') value = Math.max(1, value);
        if (key === 'gap' || key === 'padding') value = Math.max(0, value);

        // With the aspect lock on, editing one dimension scales the other.
        if ((key === 'w' || key === 'h') && el.aspectLocked && el.w > 0 && el.h > 0) {
            const ratio = el.h / el.w;
            if (key === 'w') { el.w = value; el.h = Math.max(1, value * ratio); }
            else { el.h = value; el.w = Math.max(1, value / ratio); }
        } else {
            el[key] = value;
        }

        // Manually picking a color unlinks the swatch.
        if (key === 'bgColor') el.fillSwatchId = null;
        if (key === 'color') el.textSwatchId = null;
        // The uniform radius slider overrides any per-corner radii.
        if (key === 'borderRadius') el.radii = null;

        this.applyElementStyles(el);

        if (el.type === 'text' && ['text', 'fontSize', 'tracking', 'kerning', 'leading', 'fontWeight'].includes(key)) {
            this.autoResizeText(id);
            this.applyElementStyles(el);
        }

        if (el.type === 'group' && ['layoutMode', 'gap', 'padding', 'alignItems'].includes(key)) {
            this.applyAutoLayout(id);
        }
        // If this element sits inside an auto-layout group, reflow it.
        const parent = this.elements.find(p => p.id === el.parentId);
        if (parent && parent.type === 'group' && parent.layoutMode !== 'none' && ['w', 'h', 'x', 'y'].includes(key)) {
            this.applyAutoLayout(parent.id);
        }

        this.renderGizmo();

        const valSpan = document.getElementById('val-' + key);
        if (valSpan) valSpan.textContent = value;

        // Live radius readout floating over the shape while the slider drags.
        if (key === 'borderRadius') {
            const b = this.getGlobalBounds(el);
            const r = this.viewport.getBoundingClientRect();
            this.flashHud('Radius ' + Math.round(value),
                r.left + b.left * this.scale + this.panX,
                r.top + b.top * this.scale + this.panY - 40);
        }

        if (!['curveRadius', 'borderRadius', 'text'].includes(key)) this.refreshPanelValues();
        if (key === 'text') this.renderLayersPanel();
        if (key === 'layoutMode' || key === 'fillEnabled') this.updatePropPanel();
        this.markDirty();
    },

    updateFeature(id, key, checked) {
        const el = this.elements.find(e => e.id === id);
        if (!el) return;
        if (!el.features) el.features = {};
        el.features[key] = !!checked;
        this.applyElementStyles(el);
        this.markDirty();
    },

    updateWarp(id, key, value) {
        const el = this.elements.find(e => e.id === id);
        if (!el) return;
        if (!el.warp) el.warp = { mode: 'none', amount: 30 };
        el.warp[key] = key === 'amount' ? (parseFloat(value) || 0) : value;
        this.applyElementStyles(el);
        this.autoResizeText(id);
        this.applyElementStyles(el);
        const valSpan = document.getElementById('val-warpAmount');
        if (valSpan && key === 'amount') valSpan.textContent = value;
        if (key === 'mode') this.updatePropPanel();
        this.renderGizmo();
        this.markDirty();
    },

    resetDistortion(id) {
        const el = this.elements.find(e => e.id === id);
        if (!el) return;
        el.warp = { mode: 'none', amount: 0 };
        el.curveRadius = 0;
        this.applyElementStyles(el);
        if (el.type === 'text') {
            this.autoResizeText(id);
            this.applyElementStyles(el);
        }
        this.updatePropPanel();
        this.renderGizmo();
        this.markDirty();
    }
});
