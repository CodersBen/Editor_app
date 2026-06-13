// Asset library: searchable visual reference panel for mood-boarding.
// Backed by the Openverse API (keyless, open-license imagery); the provider
// call is isolated in fetchAssetProvider() so a Pinterest/Unsplash API can be
// swapped in with credentials.
Object.assign(MiniCanva.prototype, {

    initAssetsPanel() {
        this.assetResults = [];
        this.designAssets = this.designAssets || [];
    },

    async fetchAssetProvider(query) {
        const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=20`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error('Provider responded ' + res.status);
        const json = await res.json();
        return (json.results || []).map(r => ({
            thumb: r.thumbnail || r.url,
            full: r.url,
            title: r.title || 'Untitled',
            creator: r.creator || '',
            license: r.license || ''
        }));
    },

    async searchAssets() {
        const q = document.getElementById('asset-query').value.trim();
        const grid = document.getElementById('assets-results');
        if (!q) return;
        grid.innerHTML = `<div class="muted" style="grid-column:span 2;">Searching…</div>`;
        try {
            this.assetResults = await this.fetchAssetProvider(q);
            if (!this.assetResults.length) {
                grid.innerHTML = `<div class="muted" style="grid-column:span 2;">No results for “${q}”.</div>`;
                return;
            }
            grid.innerHTML = '';
            this.assetResults.forEach((r, i) => {
                const card = document.createElement('div');
                card.className = 'asset-card';
                card.title = `${r.title}${r.creator ? ' — ' + r.creator : ''} (${r.license})`;
                const img = document.createElement('img');
                img.loading = 'lazy';
                img.src = r.thumb;
                img.onerror = () => card.remove();
                card.appendChild(img);
                const meta = document.createElement('div');
                meta.className = 'asset-meta';
                meta.textContent = r.title;
                card.appendChild(meta);
                card.onclick = () => this.addImageElement(this.assetResults[i]);
                grid.appendChild(card);
            });
        } catch (err) {
            grid.innerHTML = `<div class="muted" style="grid-column:span 2;">Search unavailable (network/provider error). ${err.message || ''}</div>`;
        }
    },

    addImageElement(asset) {
        const ab = this.artboards.find(a => a.id === this.activeArtboardId) || this.artboards[0];
        if (!ab) return;
        const w = 320, h = 240;
        const el = this.createElementData('image', (ab.w - w) / 2, (ab.h - h) / 2, ab.id);
        el.w = w; el.h = h;
        el.src = asset.full || asset.thumb;
        el.title = asset.title;
        this.elements.push(el);
        this.buildElementDom(el);
        this.setSelection([el.id]);
        this.switchTab('props');
        this.renderLayersPanel();
        this.markDirty();
    },

    selectedAssetRoot() {
        if (this.selection.size !== 1) return null;
        const el = this.elements.find(e => e.id === Array.from(this.selection)[0]);
        return el && el.type === 'group' && el.assetId ? el : null;
    },

    assetBounds(elements) {
        if (!elements.length) return { x: 0, y: 0, w: 100, h: 100 };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        elements.forEach(el => {
            minX = Math.min(minX, el.x || 0);
            minY = Math.min(minY, el.y || 0);
            maxX = Math.max(maxX, (el.x || 0) + (el.w || 0));
            maxY = Math.max(maxY, (el.y || 0) + (el.h || 0));
        });
        return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
    },

    normalizeAssetElements(roots) {
        const all = [];
        roots.forEach(id => this.collectSubtree(id).forEach(el => all.push(JSON.parse(JSON.stringify(el)))));
        const rootIds = new Set(roots);
        const bounds = this.assetBounds(all.filter(el => rootIds.has(el.id)));
        all.forEach(el => {
            if (rootIds.has(el.id)) {
                el.x = (el.x || 0) - bounds.x;
                el.y = (el.y || 0) - bounds.y;
                el.parentId = '__asset_root__';
            }
            delete el.assetId;
        });
        return { elements: all, bounds };
    },

    addSelectionToAssets() {
        const roots = Array.from(this.selection).filter(id => this.elements.find(el => el.id === id));
        if (!roots.length) return;
        const assetData = this.normalizeAssetElements(roots);
        const name = prompt('Asset name', 'Asset ' + ((this.designAssets || []).length + 1));
        if (name === null) return;
        this.designAssets.push({
            id: 'asset_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
            name: name || 'Untitled asset',
            w: assetData.bounds.w,
            h: assetData.bounds.h,
            elements: assetData.elements,
            updatedAt: Date.now()
        });
        this.renderAssetLibrary();
        this.switchTab('assets');
        this.hideContextMenu();
        this.markDirty();
    },

    renderAssetLibrary() {
        const wrap = document.getElementById('project-assets');
        if (!wrap) return;
        const linked = this.selectedAssetRoot();
        const assets = this.designAssets || [];
        wrap.innerHTML = `
            <div class="asset-section-title">Project Assets</div>
            ${linked ? `<button class="asset-wide-btn" onclick="app.updateLinkedAssetFromSelection()">Update “${this.escapeHtml(this.designAssets.find(a => a.id === linked.assetId)?.name || 'Asset')}” from selection</button>` : ''}
            ${assets.length ? `<div class="asset-library-grid">
                ${assets.map(a => `
                    <div class="asset-library-card" title="Click to place. Double-click to edit master. Right-click for actions." onclick="app.addAssetInstance('${a.id}')" ondblclick="event.stopPropagation(); app.openAssetEditor('${a.id}')" oncontextmenu="app.showAssetContextMenu(event, '${a.id}')">
                        <div class="asset-thumb">${this.escapeHtml(a.name.slice(0, 1).toUpperCase())}</div>
                        <div class="asset-meta">${this.escapeHtml(a.name)}</div>
                    </div>`).join('')}
            </div>` : `<div class="muted" style="padding:0 12px 10px;">Right-click selected artwork and choose Add to Assets.</div>`}
        `;
    },

    showAssetContextMenu(event, assetId) {
        event.preventDefault();
        event.stopPropagation();
        document.getElementById('asset-context-menu')?.remove();
        const menu = document.createElement('div');
        menu.id = 'asset-context-menu';
        menu.className = 'floating-menu';
        menu.innerHTML = `
            <div class="menu-item" onclick="app.addAssetInstance('${assetId}'); app.hideAssetContextMenu();"><i data-lucide="plus-square"></i> Add to Active Artboard</div>
            <div class="menu-item" onclick="app.openAssetEditor('${assetId}'); app.hideAssetContextMenu();"><i data-lucide="external-link"></i> Open / Edit Asset</div>
        `;
        document.body.appendChild(menu);
        menu.style.left = Math.min(event.clientX, window.innerWidth - 220) + 'px';
        menu.style.top = Math.min(event.clientY, window.innerHeight - 90) + 'px';
        setTimeout(() => document.addEventListener('click', this.hideAssetContextMenu, { once: true }), 0);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    hideAssetContextMenu() {
        document.getElementById('asset-context-menu')?.remove();
    },

    cloneAssetElements(asset, parentId, offsetX = 0, offsetY = 0) {
        const idMap = {};
        return asset.elements.map(src => {
            const copy = JSON.parse(JSON.stringify(src));
            idMap[src.id] = 'el_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
            copy.id = idMap[src.id];
            if (src.parentId === '__asset_root__') {
                copy.parentId = parentId;
                copy.x = (copy.x || 0) + offsetX;
                copy.y = (copy.y || 0) + offsetY;
            } else {
                copy.parentId = idMap[src.parentId] || parentId;
            }
            return copy;
        });
    },

    addAssetInstance(assetId) {
        const asset = (this.designAssets || []).find(a => a.id === assetId);
        const ab = this.artboards.find(a => a.id === this.activeArtboardId) || this.artboards[0];
        if (!asset || !ab) return;
        const group = this.createElementData('group', Math.max(0, (ab.w - asset.w) / 2), Math.max(0, (ab.h - asset.h) / 2), ab.id);
        group.w = asset.w;
        group.h = asset.h;
        group.assetId = asset.id;
        group.name = asset.name;
        this.elements.push(group);
        this.buildElementDom(group);
        this.cloneAssetElements(asset, group.id).forEach(el => {
            this.elements.push(el);
            this.buildElementDom(el);
        });
        this.setSelection([group.id]);
        this.renderLayersPanel();
        this.markDirty();
    },

    syncAssetInstances(assetId) {
        const asset = (this.designAssets || []).find(a => a.id === assetId);
        if (!asset) return;
        this.elements.filter(el => el.type === 'group' && el.assetId === assetId).forEach(group => {
            const childIds = this.elements.filter(el => el.parentId === group.id).flatMap(el => this.collectSubtree(el.id).map(x => x.id));
            childIds.forEach(id => document.getElementById(id)?.remove());
            this.elements = this.elements.filter(el => !childIds.includes(el.id));
            group.w = asset.w;
            group.h = asset.h;
            group.name = asset.name;
            this.applyElementStyles(group);
            this.cloneAssetElements(asset, group.id).forEach(el => {
                this.elements.push(el);
                this.buildElementDom(el);
            });
        });
        this.renderLayersPanel();
        this.renderGizmo();
    },

    updateLinkedAssetFromSelection() {
        const root = this.selectedAssetRoot();
        if (!root) { this.hideContextMenu(); return; }
        const asset = (this.designAssets || []).find(a => a.id === root.assetId);
        if (!asset) { this.hideContextMenu(); return; }
        const childRoots = this.elements.filter(el => el.parentId === root.id).map(el => el.id);
        const assetData = this.normalizeAssetElements(childRoots);
        asset.w = root.w;
        asset.h = root.h;
        asset.elements = assetData.elements;
        asset.updatedAt = Date.now();
        this.syncAssetInstances(asset.id);
        this.setSelection([root.id]);
        this.renderAssetLibrary();
        this.hideContextMenu();
        this.markDirty();
    },

    showAssetEditorBanner(asset) {
        document.getElementById('asset-editor-banner')?.remove();
        const banner = document.createElement('div');
        banner.id = 'asset-editor-banner';
        banner.innerHTML = `
            <div><strong>Editing asset:</strong> ${this.escapeHtml(asset.name)}</div>
            <div class="row">
                <button class="action-btn" onclick="app.commitAssetEditor()">Update Asset</button>
                <button class="action-btn" onclick="app.cancelAssetEditor()">Back to Design</button>
            </div>`;
        this.viewport.appendChild(banner);
    },

    openAssetEditor(assetId) {
        const asset = (this.designAssets || []).find(a => a.id === assetId);
        if (!asset || this.assetEditSession) return;
        this.assetEditSession = { assetId, returnData: this.serializeCurrent() };
        this.clearWorkspace({ keepAssets: true });
        const artboardId = this.createArtboard({ x: 0, y: 0, w: asset.w, h: asset.h, label: 'Asset — ' + asset.name });
        this.cloneAssetElements(asset, artboardId).forEach(el => {
            this.elements.push(el);
            this.buildElementDom(el);
        });
        document.getElementById('project-title').textContent = 'Asset: ' + asset.name;
        this.showAssetEditorBanner(asset);
        this.autoFit();
        this.renderLayersPanel();
        this.updatePropPanel();
        this.resetHistory();
    },

    commitAssetEditor() {
        const session = this.assetEditSession;
        if (!session) return;
        const asset = (this.designAssets || []).find(a => a.id === session.assetId);
        const ab = this.artboards[0];
        if (asset && ab) {
            const roots = this.elements.filter(el => el.parentId === ab.id).map(el => el.id);
            const assetData = this.normalizeAssetElements(roots);
            asset.w = ab.w;
            asset.h = ab.h;
            asset.elements = assetData.elements;
            asset.updatedAt = Date.now();
        }
        const returnData = session.returnData;
        returnData.designAssets = this.designAssets;
        this.assetEditSession = null;
        document.getElementById('asset-editor-banner')?.remove();
        this.loadProjectData(returnData);
        if (asset) this.syncAssetInstances(asset.id);
        const project = Store.getProject(this.currentProjectId);
        if (project) document.getElementById('project-title').textContent = project.name;
        this.markDirty();
    },

    cancelAssetEditor() {
        const session = this.assetEditSession;
        if (!session) return;
        this.assetEditSession = null;
        document.getElementById('asset-editor-banner')?.remove();
        this.loadProjectData(session.returnData);
        const project = Store.getProject(this.currentProjectId);
        if (project) document.getElementById('project-title').textContent = project.name;
    }
});
