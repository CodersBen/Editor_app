// Project dashboard: dense, sortable, Excel-style file management plus
// project persistence and reusable templates.
Object.assign(MiniCanva.prototype, {

    // --- Serialization -----------------------------------------------------------
    serializeCurrent() {
        return {
            artboards: JSON.parse(JSON.stringify(this.artboards)),
            elements: JSON.parse(JSON.stringify(this.elements)),
            swatches: JSON.parse(JSON.stringify(this.swatches)),
            designAssets: JSON.parse(JSON.stringify(this.designAssets || [])),
            documentSettings: JSON.parse(JSON.stringify(this.documentSettings || {})),
            guides: JSON.parse(JSON.stringify(this.guides)),
            gridMode: this.gridMode,
            gridSize: this.gridSize,
            baselineSize: this.baselineSize
        };
    },

    saveCurrentProject() {
        if (!this.currentProjectId) return;
        Store.updateProject(this.currentProjectId, { data: this.serializeCurrent() });
    },

    clearWorkspace(options = {}) {
        this.setSelection([]);
        this.elements.forEach(el => document.getElementById(el.id)?.remove());
        this.artboards.forEach(ab => {
            document.getElementById(ab.id)?.remove();
            document.getElementById(ab.id + '_label')?.remove();
        });
        this.artboards = [];
        this.elements = [];
        this.guides = [];
        this.swatches = [];
        if (!options.keepAssets) this.designAssets = [];
        this.cancelPen();
        this.renderGuides();
    },

    loadProjectData(data) {
        this.clearWorkspace();
        if (!data) {
            this.createArtboard({ label: 'Artboard 1' });
        } else {
            this.designAssets = data.designAssets || [];
            (data.artboards || []).forEach(ab => this.createArtboard(ab));
            // Build elements parents-first so group containers exist before children.
            const pending = (data.elements || []).map(e => JSON.parse(JSON.stringify(e)));
            let guard = pending.length * 2 + 4;
            while (pending.length && guard-- > 0) {
                for (let i = pending.length - 1; i >= 0; i--) {
                    const el = pending[i];
                    if (document.getElementById(el.parentId)) {
                        this.elements.push(el);
                        this.buildElementDom(el);
                        pending.splice(i, 1);
                    }
                }
            }
            this.swatches = data.swatches || [];
            this.documentSettings = data.documentSettings || this.documentSettings || {};
            this.guides = data.guides || [];
            this.gridMode = data.gridMode || 'none';
            this.gridSize = data.gridSize || 20;
            this.baselineSize = data.baselineSize || 24;
            const sel = document.getElementById('grid-mode');
            if (sel) sel.value = this.gridMode;
            this.renderGuides();
        }
        this.activeArtboardId = this.artboards[0]?.id || null;
        this.renderLayersPanel();
        this.updatePropPanel();
        this.renderAssetLibrary();
        this.resetHistory();
    },

    // --- View switching ----------------------------------------------------------
    openProject(id) {
        const project = Store.getProject(id);
        if (!project) return;
        this.currentProjectId = id;
        document.getElementById('dashboard-view').classList.add('hidden');
        document.getElementById('editor-view').classList.remove('hidden');
        document.getElementById('project-title').textContent = project.name;
        this.loadProjectData(project.data);
        this.resizeOverlays();
        this.autoFit();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    backToDashboard() {
        if (this.assetEditSession) {
            this.cancelAssetEditor();
            return;
        }
        this.saveCurrentProject();
        this.currentProjectId = null;
        document.getElementById('editor-view').classList.add('hidden');
        document.getElementById('dashboard-view').classList.remove('hidden');
        this.renderDashboard();
    },

    // --- Dashboard rendering --------------------------------------------------------
    renderDashboard() {
        this.renderTemplateStrip();
        this.renderProjectTable();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    renderTemplateStrip() {
        const strip = document.getElementById('template-strip');
        const templates = Store.loadTemplates();
        if (!templates.length) {
            strip.innerHTML = `<div class="template-empty">No templates yet — open a project and use “Template” in the toolbar to save it as a reusable blueprint (guides, swatches and layout included).</div>`;
            return;
        }
        strip.innerHTML = templates.map(t => `
            <div class="template-card">
                <div class="t-name">${this.escapeHtml(t.name)}</div>
                <div class="t-meta">${(t.data?.artboards || []).length} artboard(s) · ${Store.formatDate(t.createdAt)}</div>
                <div class="row">
                    <button class="action-btn flex-1" onclick="app.useTemplate('${t.id}')">Use</button>
                    <button class="ghost-btn" onclick="app.deleteTemplate('${t.id}')" title="Delete template">✕</button>
                </div>
            </div>`).join('');
    },

    renderProjectTable() {
        const wrap = document.getElementById('project-table-wrap');
        let projects = Store.loadProjects();
        if (!this.dashSort) this.dashSort = { key: 'modifiedAt', dir: -1 };
        const { key, dir } = this.dashSort;

        projects.sort((a, b) => {
            let av, bv;
            if (key === 'size') { av = Store.projectSize(a); bv = Store.projectSize(b); }
            else if (key === 'name' || key === 'client') { av = (a[key] || '').toLowerCase(); bv = (b[key] || '').toLowerCase(); }
            else { av = a[key] || 0; bv = b[key] || 0; }
            return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
        });

        const arrow = (k) => key === k ? `<span class="sort-arrow">${dir === 1 ? '▲' : '▼'}</span>` : '';
        const rows = projects.map(p => `
            <tr>
                <td><span class="p-name" onclick="app.openProject('${p.id}')">${this.escapeHtml(p.name)}</span></td>
                <td><input class="client-input" value="${this.escapeHtml(p.client || '')}" placeholder="—" onchange="app.setProjectClient('${p.id}', this.value)"></td>
                <td class="num">${Store.formatDate(p.modifiedAt)}</td>
                <td class="num">${Store.formatDate(p.createdAt)}</td>
                <td class="num">${Store.formatSize(Store.projectSize(p))}</td>
                <td>
                    <div class="cell-actions">
                        <button onclick="app.openProject('${p.id}')">Open</button>
                        <button onclick="app.duplicateProject('${p.id}')">Duplicate</button>
                        <button class="del" onclick="app.deleteProject('${p.id}')">Delete</button>
                    </div>
                </td>
            </tr>`).join('');

        wrap.innerHTML = `
        <table class="project-table">
            <thead>
                <tr>
                    <th onclick="app.sortDash('name')">Name${arrow('name')}</th>
                    <th onclick="app.sortDash('client')">Client${arrow('client')}</th>
                    <th onclick="app.sortDash('modifiedAt')">Modified${arrow('modifiedAt')}</th>
                    <th onclick="app.sortDash('createdAt')">Created${arrow('createdAt')}</th>
                    <th onclick="app.sortDash('size')">Size${arrow('size')}</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        ${projects.length ? '' : `<div class="table-empty">No projects yet. Create one to get started.</div>`}`;
    },

    sortDash(key) {
        if (this.dashSort && this.dashSort.key === key) this.dashSort.dir *= -1;
        else this.dashSort = { key, dir: key === 'name' || key === 'client' ? 1 : -1 };
        this.renderProjectTable();
    },

    setProjectClient(id, client) {
        Store.updateProject(id, { client });
        this.renderProjectTable();
    },

    deleteProject(id) {
        const p = Store.getProject(id);
        if (!p) return;
        if (!confirm(`Delete project “${p.name}”? This cannot be undone.`)) return;
        Store.deleteProject(id);
        this.renderDashboard();
    },

    duplicateProject(id) {
        Store.duplicateProject(id);
        this.renderDashboard();
    },

    // --- Modals -------------------------------------------------------------------
    showNewProjectModal() {
        document.getElementById('np-name').value = '';
        document.getElementById('np-client').value = '';
        this.applyNewProjectPreset('instagram-post');
        document.getElementById('modal-new-project').classList.remove('hidden');
        document.getElementById('np-name').focus();
    },

    hideModal(id) { document.getElementById(id).classList.add('hidden'); },

    projectPresets() {
        return {
            custom: { w: 1080, h: 1080, unit: 'px', resolution: 144, colorMode: 'rgb' },
            iphone: { w: 1179, h: 2556, unit: 'px', resolution: 144, colorMode: 'rgb' },
            android: { w: 1080, h: 2400, unit: 'px', resolution: 144, colorMode: 'rgb' },
            'instagram-post': { w: 1080, h: 1080, unit: 'px', resolution: 144, colorMode: 'rgb' },
            'instagram-story': { w: 1080, h: 1920, unit: 'px', resolution: 144, colorMode: 'rgb' },
            'youtube-thumb': { w: 1280, h: 720, unit: 'px', resolution: 72, colorMode: 'rgb' },
            a4: { w: 210, h: 297, unit: 'mm', resolution: 300, colorMode: 'cmyk' },
            letter: { w: 8.5, h: 11, unit: 'in', resolution: 300, colorMode: 'cmyk' },
            legal: { w: 8.5, h: 14, unit: 'in', resolution: 300, colorMode: 'cmyk' }
        };
    },

    presetLabels() {
        return {
            custom: 'Custom', iphone: 'iPhone 15', android: 'Android',
            'instagram-post': 'Instagram Post', 'instagram-story': 'Instagram Story',
            'youtube-thumb': 'YouTube Thumbnail', a4: 'A4', letter: 'US Letter', legal: 'US Legal'
        };
    },

    unitToPixels(value, unit, resolution) {
        const n = parseFloat(value) || 1;
        const f = this.unitFactor(unit);
        return Math.round(f ? n * f * resolution : n);
    },

    applyNewProjectPreset(key) {
        const p = this.projectPresets()[key] || this.projectPresets().custom;
        const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
        set('np-preset', key);
        set('np-width', p.w);
        set('np-height', p.h);
        set('np-unit', p.unit);
        set('np-resolution', p.resolution);
        set('np-color-mode', p.colorMode);
    },

    createProjectFromModal() {
        const name = document.getElementById('np-name').value.trim() || 'Untitled design';
        const client = document.getElementById('np-client').value.trim();
        const unit = document.getElementById('np-unit')?.value || 'px';
        const resolution = Math.max(1, parseFloat(document.getElementById('np-resolution')?.value) || 144);
        const colorMode = document.getElementById('np-color-mode')?.value || 'rgb';
        const w = this.unitToPixels(document.getElementById('np-width')?.value, unit, resolution);
        const h = this.unitToPixels(document.getElementById('np-height')?.value, unit, resolution);
        const bgColor = document.getElementById('np-bg')?.value || '#ffffff';
        const data = {
            artboards: [{ x: 0, y: 0, w, h, label: 'Artboard 1', bgColor }],
            elements: [],
            swatches: [],
            designAssets: [],
            guides: [],
            gridMode: 'none',
            gridSize: 20,
            baselineSize: 24,
            documentSettings: { preset: document.getElementById('np-preset')?.value || 'custom', unit, resolution, colorMode, width: parseFloat(document.getElementById('np-width')?.value) || w, height: parseFloat(document.getElementById('np-height')?.value) || h }
        };
        const project = Store.createProject(name, client, data);
        this.hideModal('modal-new-project');
        this.openProject(project.id);
    },

    showTemplateModal() {
        document.getElementById('tpl-name').value = '';
        document.getElementById('modal-template').classList.remove('hidden');
        document.getElementById('tpl-name').focus();
    },

    saveAsTemplateFromModal() {
        const name = document.getElementById('tpl-name').value.trim() || 'Untitled template';
        Store.saveTemplate(name, this.serializeCurrent());
        this.hideModal('modal-template');
        const label = document.getElementById('save-state');
        if (label) { label.textContent = 'Template saved'; setTimeout(() => label.textContent = 'Saved', 2000); }
    },

    useTemplate(id) {
        const t = Store.loadTemplates().find(x => x.id === id);
        if (!t) return;
        const project = Store.createProject(t.name + ' project', '', JSON.parse(JSON.stringify(t.data)));
        this.openProject(project.id);
    },

    deleteTemplate(id) {
        Store.deleteTemplate(id);
        this.renderDashboard();
    },

    escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
});
