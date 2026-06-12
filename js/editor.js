// Craf Studio — core editor engine.
// Feature areas (typography, vector tools, drafting aids, panels, assets,
// dashboard) extend MiniCanva.prototype from their own files.
class MiniCanva {
    constructor() {
        this.viewport = document.getElementById('viewport');
        this.workspace = document.getElementById('workspace');
        this.gizmoLayer = document.getElementById('gizmo-layer');
        this.guideLayer = document.getElementById('guide-layer');
        this.marquee = document.getElementById('marquee');
        this.contextMenu = document.getElementById('context-menu');
        this.propPanel = document.getElementById('prop-panel-content');
        this.layersContent = document.getElementById('layers-content');
        this.selCountLabel = null;

        this.scale = 1; this.panX = 0; this.panY = 0;
        this.currentTool = 'select';
        this.mode = 'idle';
        this.spaceDown = false;          // explicit pan state — blocks marquee selection
        this.snapThreshold = 6;
        this.snapEnabled = true;
        this.activeTab = 'props';
        this.clipboard = [];
        this.draggedLayerId = null;
        this.activeArtboardId = null;
        this.startState = null;

        this.artboards = [];
        this.elements = [];
        this.selection = new Set();
        this.selectedVertex = -1;

        this.guides = [];                // { id, axis: 'v'|'h', pos } in world coords
        this.gridMode = 'none';
        this.gridSize = 20;
        this.baselineSize = 24;

        this.swatches = [];              // { id, name, color }
        this.designAssets = [];          // reusable symbol-like assets for this project
        this.assetEditSession = null;
        this.documentSettings = { unit: 'px', resolution: 144, colorMode: 'rgb' };
        this.penDraft = null;

        this.currentProjectId = null;
        this._saveTimer = null;

        this.init();
    }

    init() {
        if (typeof lucide !== 'undefined') lucide.createIcons();

        window.addEventListener('resize', () => { this.updateTransform(); this.resizeOverlays(); });
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        document.addEventListener('keyup', this.handleKeyUp.bind(this));
        document.addEventListener('click', (e) => {
            if (!this.contextMenu.contains(e.target)) this.hideContextMenu();
        });

        this.viewport.addEventListener('contextmenu', this.handleContextMenu.bind(this));
        this.viewport.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });
        this.viewport.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.viewport.addEventListener('dblclick', this.handleDblClick.bind(this));
        window.addEventListener('mousemove', this.handleMouseMove.bind(this));
        window.addEventListener('mouseup', this.handleMouseUp.bind(this));

        this.initDrafting();
        this.initAssetsPanel();
        this.renderDashboard();
    }

    // --- View transform -------------------------------------------------
    worldPoint(e) {
        const r = this.viewport.getBoundingClientRect();
        return {
            x: (e.clientX - r.left - this.panX) / this.scale,
            y: (e.clientY - r.top - this.panY) / this.scale
        };
    }

    updateTransform() {
        this.workspace.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
        const zoomLevel = document.getElementById('zoom-level');
        if (zoomLevel) zoomLevel.textContent = Math.round(this.scale * 100) + '%';
        this.drawRulers();
        this.drawGrid();
    }

    zoom(d) { this.scale = Math.max(0.1, Math.min(5, this.scale + d)); this.updateTransform(); }

    autoFit() {
        if (!this.artboards.length) return;
        const pad = 60;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.artboards.forEach(a => {
            minX = Math.min(minX, a.x); minY = Math.min(minY, a.y);
            maxX = Math.max(maxX, a.x + a.w); maxY = Math.max(maxY, a.y + a.h);
        });
        const w = maxX - minX, h = maxY - minY;
        const sc = Math.min((this.viewport.clientWidth - pad * 2) / w, (this.viewport.clientHeight - pad * 2) / h);
        this.scale = Math.max(0.1, Math.min(sc, 1.4));
        this.panX = (this.viewport.clientWidth - w * this.scale) / 2 - minX * this.scale;
        this.panY = (this.viewport.clientHeight - h * this.scale) / 2 - minY * this.scale;
        this.updateTransform();
    }

    handleWheel(e) {
        e.preventDefault();
        if (e.ctrlKey) {
            const rect = this.viewport.getBoundingClientRect();
            const mx = e.clientX - rect.left, my = e.clientY - rect.top;
            const os = this.scale;
            this.scale = Math.max(0.1, Math.min(5, this.scale - e.deltaY * 0.001));
            this.panX = mx - (mx - this.panX) * (this.scale / os);
            this.panY = my - (my - this.panY) * (this.scale / os);
        } else {
            this.panX -= e.deltaX; this.panY -= e.deltaY;
        }
        this.updateTransform();
    }

    // --- Tools -----------------------------------------------------------
    setTool(t) {
        if (this.penDraft && t !== 'pen') this.cancelPen();
        this.currentTool = t;
        document.querySelectorAll('[data-tool]').forEach(b => {
            b.classList.toggle('active-tool', b.dataset.tool === t);
        });
        const drawTools = ['rect', 'circle', 'triangle', 'pen', 'text-h', 'text-p'];
        this.viewport.classList.toggle('tool-draw', drawTools.includes(t));
        this.viewport.classList.toggle('panning', t === 'hand');
        this.renderGizmo();
    }

    switchTab(tab) {
        this.activeTab = tab;
        ['props', 'layers', 'assets'].forEach(t => {
            document.getElementById('panel-' + t).classList.toggle('hidden', t !== tab);
            document.getElementById('tab-' + t).classList.toggle('active', t === tab);
        });
        if (tab === 'layers') this.renderLayersPanel();
        if (tab === 'assets') this.renderAssetLibrary();
    }

    // --- Keyboard ---------------------------------------------------------
    handleKeyDown(e) {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
        if (document.getElementById('editor-view').classList.contains('hidden')) return;

        if (e.code === 'Space') {
            // Spacebar pan state: explicitly disables marquee/selection mousedown.
            this.spaceDown = true;
            this.viewport.classList.add('panning');
            e.preventDefault();
            return;
        }
        if (e.key === 'Escape') {
            if (this.penDraft) { this.cancelPen(); return; }
            this.setSelection([]);
            return;
        }
        if (e.key === 'Enter' && this.penDraft) { this.finishPen(false); return; }

        if (e.ctrlKey || e.metaKey) {
            const k = e.key.toLowerCase();
            if (k === 'c') { this.copySelected(); e.preventDefault(); }
            if (k === 'v') { this.paste(); e.preventDefault(); }
            if (k === 'd') { this.duplicateSelected(); e.preventDefault(); }
            if (k === 'g') { e.shiftKey ? this.ungroupSelected() : this.groupSelected(); e.preventDefault(); }
            if (k === 'l') { this.lockSelected(); e.preventDefault(); }
            return;
        }

        if (e.key === 'v') this.setTool('select');
        if (e.key === 'a') this.setTool('node');
        if (e.key === 'h') this.setTool('hand');
        if (e.key === 'p') this.setTool('pen');
        if (e.key === 'r') this.setTool('rect');
        if (e.key === 'o') this.setTool('circle');
        if (e.key === 't') this.setTool('text-h');
        if (e.key === ']') this.arrange('front');
        if (e.key === '[') this.arrange('back');
        if (e.key === 'Delete' || e.key === 'Backspace') this.deleteSelected();
    }

    handleKeyUp(e) {
        if (e.code === 'Space') {
            this.spaceDown = false;
            if (this.currentTool !== 'hand') this.viewport.classList.remove('panning');
        }
    }

    // --- Mouse ------------------------------------------------------------
    handleMouseDown(e) {
        if (e.button === 2) return;
        this.hideContextMenu();

        // 1) Panning has absolute priority: spacebar state blocks marquee/selection.
        if (this.spaceDown || e.button === 1 || this.currentTool === 'hand') {
            this.mode = 'panning';
            this.viewport.classList.add('pan-active');
            this.startState = { mx: e.clientX, my: e.clientY, px: this.panX, py: this.panY };
            e.preventDefault();
            return;
        }

        // 2) Gizmo handles (resize / rotate).
        if (e.target.classList.contains('handle')) {
            e.stopPropagation();
            this.beginHandleDrag(e);
            return;
        }
        if (e.target.classList.contains('handle-vertex')) {
            e.stopPropagation();
            this.beginVertexDrag(e);
            return;
        }
        if (e.target.classList.contains('handle-bezier')) {
            e.stopPropagation();
            this.beginBezierDrag(e);
            return;
        }
        if (e.target.classList.contains('guide-line')) {
            this.mode = 'guide-move';
            this.startState = { guideId: e.target.dataset.guideId };
            return;
        }

        // 3) Drawing tools — instantiation happens here, on canvas interaction,
        //    never when the toolbar button is clicked.
        if (this.currentTool === 'pen') { this.penMouseDown(e); return; }
        if (['rect', 'circle', 'triangle'].includes(this.currentTool)) { this.beginShapeDraw(e); return; }
        if (this.currentTool === 'text-h' || this.currentTool === 'text-p') { this.placeText(e); return; }

        // 4) Artboard activation.
        const artboardTarget = e.target.closest('.artboard');
        if (artboardTarget) {
            this.activeArtboardId = artboardTarget.id;
            document.querySelectorAll('.artboard').forEach(ab => ab.classList.remove('active'));
            artboardTarget.classList.add('active');
            if (this.selection.size === 0) this.updatePropPanel();
        }

        // 5) Selection / drag / marquee.
        const elTarget = e.target.closest('.element');
        if (elTarget) {
            let targetId = elTarget.id;
            let elData = this.elements.find(x => x.id === targetId);
            if (!elData) return;
            // Selecting inside a group selects the top-level group (selection tool only).
            if (this.currentTool === 'select') {
                let current = elData;
                while (current && current.parentId && !current.parentId.startsWith('ab_')) {
                    const parent = this.elements.find(p => p.id === current.parentId);
                    if (parent && parent.type === 'group') current = parent; else break;
                }
                if (current && current.id !== targetId) { targetId = current.id; elData = current; }
            }
            if (elData.locked) { if (!e.shiftKey) this.setSelection([]); return; }
            if (!e.shiftKey && !this.selection.has(targetId)) this.setSelection([targetId]);
            else if (e.shiftKey) this.toggleSelection(targetId);

            if (this.currentTool === 'node') return; // direct selection: vertices only
            this.mode = 'dragging';
            this.startState = {
                mx: e.clientX, my: e.clientY, moved: false,
                elements: Array.from(this.selection).map(id => {
                    const d = this.elements.find(x => x.id === id);
                    return { id, x: d.x, y: d.y };
                })
            };
        } else {
            if (!e.shiftKey) this.setSelection([]);
            this.mode = 'marquee';
            this.startState = { ox: e.clientX, oy: e.clientY };
            this.marquee.style.display = 'block';
            this.updateMarquee(e.clientX, e.clientY);
        }
    }

    beginHandleDrag(e) {
        const handle = e.target.dataset.handle;
        const elId = Array.from(this.selection)[0];
        const elData = this.elements.find(x => x.id === elId);
        if (!elData) return;

        if (handle === 'rot') {
            this.mode = 'rotating';
            const b = this.getGlobalBounds(elData);
            this.startState = { cx: b.left + b.width / 2, cy: b.top + b.height / 2, startRotation: elData.rotation };
            return;
        }

        this.mode = 'resizing';
        const descendants = [];
        const captureDescendants = (parentId) => {
            this.elements.filter(el => el.parentId === parentId).forEach(child => {
                descendants.push({ id: child.id, x: child.x, y: child.y, w: child.w, h: child.h, fontSize: child.fontSize || 16 });
                if (child.type === 'group') captureDescendants(child.id);
            });
        };
        if (elData.type === 'group') captureDescendants(elData.id);

        // Anchor-stable resize: record the world position of the handle's
        // opposite point so it can be pinned during the drag (prevents the
        // shear/anchor-drift artifact on rotated objects).
        const rad = elData.rotation * Math.PI / 180;
        const sx = handle.includes('l') ? 1 : handle.includes('r') ? -1 : 0;
        const sy = handle.includes('t') ? 1 : handle.includes('b') ? -1 : 0;
        const cx = elData.x + elData.w / 2, cy = elData.y + elData.h / 2;
        const ax = sx * elData.w / 2, ay = sy * elData.h / 2;
        const anchorX = cx + ax * Math.cos(rad) - ay * Math.sin(rad);
        const anchorY = cy + ax * Math.sin(rad) + ay * Math.cos(rad);

        this.startState = {
            handle, mx: e.clientX, my: e.clientY,
            elData: JSON.parse(JSON.stringify(elData)),
            groupDescendants: descendants,
            sx, sy, anchorX, anchorY, rad
        };
    }

    handleMouseMove(e) {
        if (this.mode === 'idle') {
            if (this.penDraft) this.penMouseMove(e);
            return;
        }
        const mx = e.clientX, my = e.clientY;

        if (this.mode === 'panning') {
            this.panX = this.startState.px + (mx - this.startState.mx);
            this.panY = this.startState.py + (my - this.startState.my);
            this.updateTransform();
            return;
        }

        if (this.mode === 'guide-move') { this.moveGuide(e); return; }
        if (this.mode === 'guide-create') { this.moveGuide(e); return; }
        if (this.mode === 'pen-drag') { this.penMouseMove(e); return; }
        if (this.mode === 'drawing') { this.updateShapeDraw(e); return; }

        if (this.mode === 'dragging') {
            let dx = (mx - this.startState.mx) / this.scale;
            let dy = (my - this.startState.my) / this.scale;
            if (Math.abs(dx) > 1 || Math.abs(dy) > 1) this.startState.moved = true;
            const snapped = this.applyDragSnap(dx, dy);
            dx = snapped.dx; dy = snapped.dy;
            this.startState.elements.forEach((item) => {
                const el = this.elements.find(x => x.id === item.id);
                if (!el || el.locked) return;
                el.x = item.x + dx; el.y = item.y + dy;
                const dom = document.getElementById(el.id);
                dom.style.left = el.x + 'px'; dom.style.top = el.y + 'px';
            });
            this.renderGizmo();
            if (this.selection.size === 1) this.refreshPanelValues();
            return;
        }

        if (this.mode === 'resizing') { this.performResize(e); return; }

        if (this.mode === 'rotating') {
            const rad = Math.atan2(my - this.startState.cy * this.scale - this.panY - this.viewport.getBoundingClientRect().top,
                mx - this.startState.cx * this.scale - this.panX - this.viewport.getBoundingClientRect().left);
            let deg = rad * (180 / Math.PI) + 90;
            if (e.shiftKey) deg = Math.round(deg / 15) * 15;
            const elId = Array.from(this.selection)[0];
            const elData = this.elements.find(x => x.id === elId);
            elData.rotation = deg;
            document.getElementById(elId).style.transform = `rotate(${deg}deg)`;
            this.renderGizmo(); this.refreshPanelValues();
            return;
        }

        if (this.mode === 'moving-vertex') { this.moveVertex(e); return; }
        if (this.mode === 'moving-bezier') { this.moveBezier(e); return; }

        if (this.mode === 'marquee') {
            this.updateMarquee(mx, my);
            this.checkMarqueeSelection(e.shiftKey);
        }
    }

    // Matrix-correct resize: mouse delta is projected into the object's local
    // (rotated) axes, dimensions change along those axes, and the opposite
    // anchor point is re-pinned in world space — no skew, no anchor drift.
    performResize(e) {
        const s = this.startState;
        const elData = this.elements.find(x => x.id === s.elData.id);
        if (!elData) return;

        const dxScreen = (e.clientX - s.mx) / this.scale;
        const dyScreen = (e.clientY - s.my) / this.scale;
        const rad = s.rad;

        // Project the global drag delta into local object space.
        const dxLocal = dxScreen * Math.cos(rad) + dyScreen * Math.sin(rad);
        const dyLocal = -dxScreen * Math.sin(rad) + dyScreen * Math.cos(rad);

        let newW = s.elData.w, newH = s.elData.h;
        if (s.handle.includes('r')) newW = Math.max(1, s.elData.w + dxLocal);
        if (s.handle.includes('l')) newW = Math.max(1, s.elData.w - dxLocal);
        if (s.handle.includes('b')) newH = Math.max(1, s.elData.h + dyLocal);
        if (s.handle.includes('t')) newH = Math.max(1, s.elData.h - dyLocal);

        // Holding Shift forces proportional scaling; releasing allows free-form.
        const proportional = e.shiftKey && s.handle.length === 2;
        if (proportional) {
            const sW = newW / s.elData.w, sH = newH / s.elData.h;
            const sc = Math.abs(sW - 1) > Math.abs(sH - 1) ? sW : sH;
            newW = Math.max(1, s.elData.w * sc);
            newH = Math.max(1, s.elData.h * sc);
        }

        // Re-pin the anchor (opposite point) in world space.
        const nax = s.sx * newW / 2, nay = s.sy * newH / 2;
        const ncx = s.anchorX - (nax * Math.cos(rad) - nay * Math.sin(rad));
        const ncy = s.anchorY - (nax * Math.sin(rad) + nay * Math.cos(rad));
        let newX = ncx - newW / 2, newY = ncy - newH / 2;

        if (elData.type === 'group' && s.groupDescendants.length) {
            const scaleX = newW / s.elData.w, scaleY = newH / s.elData.h;
            s.groupDescendants.forEach(snap => {
                const child = this.elements.find(c => c.id === snap.id);
                if (!child) return;
                child.x = snap.x * scaleX; child.y = snap.y * scaleY;
                child.w = snap.w * scaleX; child.h = snap.h * scaleY;
                if (child.type === 'text') child.fontSize = Math.max(4, snap.fontSize * Math.min(scaleX, scaleY));
                this.applyElementStyles(child);
            });
        }

        if (elData.type === 'text') {
            const scaleX = newW / s.elData.w, scaleY = newH / s.elData.h;
            const sc = s.handle.length === 2 ? Math.max(scaleX, scaleY)
                : (s.handle.includes('l') || s.handle.includes('r') ? scaleX : scaleY);
            elData.fontSize = Math.max(8, s.elData.fontSize * sc);
        }

        elData.x = newX; elData.y = newY; elData.w = newW; elData.h = newH;
        this.applyElementStyles(elData);
        if (elData.type === 'text' && (!elData.warp || elData.warp.mode === 'none') && !elData.curveRadius) {
            this.autoResizeText(elData.id);
        }

        // Reflow auto-layout siblings so dynamic resizing never causes overlap.
        const parent = this.elements.find(p => p.id === elData.parentId);
        if (parent && parent.type === 'group' && parent.layoutMode !== 'none') this.applyAutoLayout(parent.id);

        this.renderGizmo();
        this.refreshPanelValues();
    }

    handleMouseUp(e) {
        const wasMode = this.mode;
        this.mode = 'idle';
        this.viewport.classList.remove('pan-active');
        this.marquee.style.display = 'none';
        this.clearSnapFlash();

        if (wasMode === 'drawing') this.finishShapeDraw(e);
        if (wasMode === 'pen-drag') this.penMouseUp(e);
        if (wasMode === 'guide-create') this.finishGuideCreate(e);

        if (wasMode === 'dragging' && this.startState && this.startState.moved) {
            this.reparentDraggedElements();
            this.markDirty();
        }
        if (['resizing', 'rotating', 'moving-vertex', 'moving-bezier', 'guide-move'].includes(wasMode)) {
            this.markDirty();
        }
    }

    handleDblClick(e) {
        if (this.penDraft) { this.finishPen(false); return; }
        const guide = e.target.closest('.guide-line');
        if (guide) this.removeGuide(guide.dataset.guideId);
    }

    // Dragging an object onto a different artboard transfers the DOM node to
    // the new artboard's container and rebases coordinates — not just z-order.
    reparentDraggedElements() {
        this.selection.forEach(id => {
            const el = this.elements.find(x => x.id === id);
            if (!el || !el.parentId || !el.parentId.startsWith('ab_')) return;
            const oldAb = this.artboards.find(a => a.id === el.parentId);
            if (!oldAb) return;
            const cx = oldAb.x + el.x + el.w / 2;
            const cy = oldAb.y + el.y + el.h / 2;
            const target = this.artboards.find(a => cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h);
            if (!target || target.id === el.parentId) return;

            el.x += oldAb.x - target.x;
            el.y += oldAb.y - target.y;
            el.parentId = target.id;
            el.zIndex = this.elements.filter(x => x.parentId === target.id && x.id !== el.id).length + 1;

            const dom = document.getElementById(el.id);
            document.getElementById(target.id).appendChild(dom);
            this.applyElementStyles(el);
            this.activeArtboardId = target.id;
        });
        this.renderLayersPanel();
        this.renderGizmo();
    }

    // --- Shape drawing (deferred instantiation) ---------------------------
    artboardAtPoint(p) {
        return this.artboards.find(a => p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h)
            || this.artboards.find(a => a.id === this.activeArtboardId)
            || this.artboards[0];
    }

    beginShapeDraw(e) {
        const p = this.worldPoint(e);
        const ab = this.artboardAtPoint(p);
        if (!ab) return;
        const lx = p.x - ab.x, ly = p.y - ab.y;
        const el = this.createElementData(this.currentTool, lx, ly, ab.id);
        el.w = 1; el.h = 1;
        this.elements.push(el);
        this.buildElementDom(el);
        this.mode = 'drawing';
        this.startState = { id: el.id, ox: lx, oy: ly };
    }

    updateShapeDraw(e) {
        const s = this.startState;
        const el = this.elements.find(x => x.id === s.id);
        if (!el) return;
        const ab = this.artboards.find(a => a.id === el.parentId);
        const p = this.worldPoint(e);
        let lx = p.x - ab.x, ly = p.y - ab.y;
        let w = lx - s.ox, h = ly - s.oy;
        if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        el.x = Math.min(s.ox, s.ox + w);
        el.y = Math.min(s.oy, s.oy + h);
        el.w = Math.max(1, Math.abs(w));
        el.h = Math.max(1, Math.abs(h));
        this.applyElementStyles(el);
    }

    finishShapeDraw() {
        const s = this.startState;
        const el = this.elements.find(x => x.id === s.id);
        if (!el) return;
        if (el.w < 4 && el.h < 4) { // simple click: drop a default-sized shape
            el.w = 120; el.h = 120;
            el.x = s.ox - 60; el.y = s.oy - 60;
            this.applyElementStyles(el);
        }
        this.setTool('select');
        this.setSelection([el.id]);
        this.renderLayersPanel();
        this.markDirty();
    }

    placeText(e) {
        const p = this.worldPoint(e);
        const ab = this.artboardAtPoint(p);
        if (!ab) return;
        const kind = this.currentTool === 'text-h' ? 'header' : 'paragraph';
        const el = this.createElementData(kind, p.x - ab.x, p.y - ab.y, ab.id);
        this.elements.push(el);
        this.buildElementDom(el);
        this.autoResizeText(el.id);
        this.setTool('select');
        this.setSelection([el.id]);
        this.renderLayersPanel();
        this.markDirty();
    }

    // --- Artboards ---------------------------------------------------------
    createArtboard(opts) {
        const data = Object.assign({
            id: 'ab_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
            x: 0, y: 0, w: 800, h: 600,
            label: 'Artboard', bgColor: '#ffffff',
            marginTop: 20, marginBottom: 20, marginLeft: 20, marginRight: 20,
            marginEnabled: false, marginColor: '#06b6d4'
        }, opts || {});

        const el = document.createElement('div');
        el.className = 'artboard';
        el.id = data.id;
        el.style.backgroundColor = data.bgColor;
        Object.assign(el.style, { left: data.x + 'px', top: data.y + 'px', width: data.w + 'px', height: data.h + 'px' });
        const title = document.createElement('div');
        title.className = 'artboard-label';
        title.textContent = data.label;
        el.appendChild(title);

        ['top', 'bottom', 'left', 'right'].forEach(side => {
            const g = document.createElement('div');
            g.className = `margin-guide margin-${side}`;
            g.style.borderStyle = 'solid';
            g.style.borderWidth = '0';
            if (side === 'top') { g.style.left = '0'; g.style.right = '0'; g.style.borderBottomWidth = '1px'; }
            else if (side === 'bottom') { g.style.left = '0'; g.style.right = '0'; g.style.borderTopWidth = '1px'; }
            else if (side === 'left') { g.style.top = '0'; g.style.bottom = '0'; g.style.borderRightWidth = '1px'; }
            else { g.style.top = '0'; g.style.bottom = '0'; g.style.borderLeftWidth = '1px'; }
            el.appendChild(g);
        });

        this.workspace.insertBefore(el, this.guideLayer);
        this.artboards.push(data);
        this.activeArtboardId = data.id;
        this.renderMarginGuides(data.id);
        this.renderLayersPanel();
        this.updatePropPanel();
        return data.id;
    }

    addArtboard() {
        const right = this.artboards.reduce((m, a) => Math.max(m, a.x + a.w), 0);
        this.createArtboard({ x: this.artboards.length ? right + 80 : 0, y: 0, label: 'Page ' + (this.artboards.length + 1) });
        this.markDirty();
    }

    artboardsOverlap(a, b, gap = 40) {
        return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x
            && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
    }

    compactArtboardsFrom(id) {
        const changed = this.artboards.find(a => a.id === id);
        if (!changed) return;
        const gap = 80;
        const ordered = this.artboards.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
        const start = ordered.findIndex(a => a.id === id);
        if (start < 0) return;
        for (let i = start + 1; i < ordered.length; i++) {
            const prev = ordered[i - 1];
            const current = ordered[i];
            const sameRow = current.y < prev.y + prev.h + gap && current.y + current.h + gap > prev.y;
            if (sameRow && current.x < prev.x + prev.w + gap) {
                current.x = prev.x + prev.w + gap;
                const dom = document.getElementById(current.id);
                if (dom) dom.style.left = current.x + 'px';
            }
        }
        this.drawGrid();
        this.renderGuides();
    }

    // The Margins state lives on the artboard record and is re-applied on every
    // render pass, so the checkbox persists and guides always reflect it.
    renderMarginGuides(id) {
        const abData = this.artboards.find(a => a.id === id);
        const el = document.getElementById(id);
        if (!abData || !el) return;
        el.classList.toggle('show-margins', !!abData.marginEnabled);
        const set = (cls, prop, val) => {
            const g = el.querySelector('.margin-' + cls);
            if (g) { g.style[prop] = val + 'px'; g.style.borderColor = abData.marginColor; }
        };
        set('top', 'top', abData.marginTop);
        set('bottom', 'bottom', abData.marginBottom);
        set('left', 'left', abData.marginLeft);
        set('right', 'right', abData.marginRight);
    }

    updateArtboardProp(id, key, value) {
        const ab = this.artboards.find(a => a.id === id);
        if (!ab) return;
        if (key === 'w' || key === 'h') value = Math.max(10, parseFloat(value) || 10);
        ab[key] = value;
        const dom = document.getElementById(id);
        if (dom) {
            if (key === 'w') dom.style.width = value + 'px';
            if (key === 'h') dom.style.height = value + 'px';
            if (key === 'bgColor') dom.style.backgroundColor = value;
        }
        if (key === 'w' || key === 'h') this.compactArtboardsFrom(id);
        this.renderMarginGuides(id);
        this.markDirty();
        if (key === 'bgColor') this.updatePropPanel();
    }

    updateArtboardMargin(id, key, value) {
        const ab = this.artboards.find(a => a.id === id);
        if (!ab) return;
        if (key === 'enabled') {
            ab.marginEnabled = !!value;
        } else if (key === 'color') {
            ab.marginColor = value;
        } else {
            // Clamp so opposing margins can never cross (no guide intersection).
            let v = Math.max(0, parseFloat(value) || 0);
            const limit = (key === 'marginTop' || key === 'marginBottom') ? ab.h : ab.w;
            const opposite = { marginTop: 'marginBottom', marginBottom: 'marginTop', marginLeft: 'marginRight', marginRight: 'marginLeft' }[key];
            v = Math.min(v, Math.max(0, limit - ab[opposite] - 1));
            ab[key] = v;
        }
        this.renderMarginGuides(id);
        this.markDirty();
        if (key === 'enabled') this.updatePropPanel();
    }

    // --- Elements -----------------------------------------------------------
    defaultAppearance() {
        return { strokes: [], shadows: [], extrudes: [] };
    }

    createElementData(type, x, y, parentId) {
        const id = 'el_' + Date.now() + '_' + Math.floor(Math.random() * 1e4);
        const data = {
            id, type, parentId, x, y, w: 100, h: 100,
            rotation: 0, opacity: 100,
            zIndex: this.elements.filter(e => e.parentId === parentId).length + 1,
            visible: true, locked: false,
            appearance: this.defaultAppearance()
        };
        if (type === 'rect') { data.bgColor = '#8b5cf6'; data.borderRadius = 0; data.fillSwatchId = null; }
        else if (type === 'circle') { data.bgColor = '#3b82f6'; data.fillSwatchId = null; }
        else if (type === 'triangle') {
            data.type = 'path';
            data.bgColor = '#ef4444'; data.fillSwatchId = null;
            data.closed = true;
            data.points = [{ x: 50, y: 0, hi: null, ho: null }, { x: 100, y: 100, hi: null, ho: null }, { x: 0, y: 100, hi: null, ho: null }];
        }
        else if (type === 'path') { data.bgColor = '#10b981'; data.fillSwatchId = null; data.closed = false; data.points = []; }
        else if (type === 'image') { data.src = ''; data.title = 'Image'; }
        else if (type === 'header' || type === 'paragraph') {
            data.type = 'text';
            data.text = type === 'header' ? 'Heading' : 'Body text';
            data.fontSize = type === 'header' ? 32 : 16;
            data.fontWeight = type === 'header' ? '700' : '400';
            data.color = '#0f172a';
            data.textSwatchId = null;
            data.w = type === 'header' ? 200 : 120; data.h = type === 'header' ? 44 : 24;
            data.tracking = 0; data.kerning = 0; data.leading = 0; data.baselineShift = 0;
            data.features = { liga: true, dlig: false, swsh: false };
            data.warp = { mode: 'none', amount: 30 };
            data.curveRadius = 0;
        }
        else if (type === 'group') {
            data.layoutMode = 'none'; data.gap = 10; data.padding = 10; data.alignItems = 'center';
        }
        return data;
    }

    buildElementDom(el) {
        const dom = document.createElement('div');
        dom.className = 'element';
        dom.id = el.id;
        dom.dataset.type = el.type;
        if (el.type === 'path' || el.type === 'bool') {
            dom.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
        }
        if (el.type === 'text') {
            const inner = document.createElement('span');
            inner.className = 'text-inner';
            dom.appendChild(inner);
        }
        if (el.type === 'image') {
            const img = document.createElement('img');
            img.className = 'asset-image';
            img.alt = el.title || 'Asset image';
            dom.appendChild(img);
        }
        const parent = document.getElementById(el.parentId);
        if (parent) parent.appendChild(dom);
        this.applyElementStyles(el);
        return dom;
    }

    // Single rendering pass: element data is the source of truth for all visuals.
    applyElementStyles(el) {
        const dom = document.getElementById(el.id);
        if (!dom) return;
        Object.assign(dom.style, {
            left: el.x + 'px', top: el.y + 'px',
            width: el.w + 'px', height: el.h + 'px',
            zIndex: el.zIndex,
            transform: el.rotation ? `rotate(${el.rotation}deg)` : '',
            opacity: (el.opacity ?? 100) / 100,
            display: el.visible === false ? 'none' : 'flex'
        });
        dom.classList.toggle('locked', !!el.locked);
        dom.classList.toggle('selected', this.selection.has(el.id));

        if (el.type === 'rect') {
            dom.style.backgroundColor = el.bgColor;
            dom.style.borderRadius = (el.borderRadius || 0) + 'px';
            dom.style.boxShadow = this.buildBoxShadows(el);
        } else if (el.type === 'circle') {
            dom.style.backgroundColor = el.bgColor;
            dom.style.borderRadius = '50%';
            dom.style.boxShadow = this.buildBoxShadows(el);
        } else if (el.type === 'image') {
            dom.style.backgroundImage = 'none';
            dom.style.backgroundColor = '#2a2a30';
            dom.style.boxShadow = this.buildBoxShadows(el);
            const img = dom.querySelector('.asset-image');
            if (img && img.src !== el.src) img.src = el.src || '';
            if (img) img.alt = el.title || 'Asset image';
        } else if (el.type === 'path') {
            this.renderPathSvg(el, dom);
        } else if (el.type === 'bool') {
            this.renderBoolSvg(el, dom);
        } else if (el.type === 'text') {
            this.renderTextVisuals(dom, el);
        } else if (el.type === 'group') {
            this.applyGroupMask(el, dom);
        }
        if (el.visible === false) dom.style.display = 'none';
    }

    // Appearance stack for box-model shapes: multiple strokes (inside/outside),
    // block-shadow extrudes and drop shadows — all with independent X/Y inputs.
    buildBoxShadows(el) {
        const a = el.appearance || this.defaultAppearance();
        const out = [];
        let ring = 0;
        (a.strokes || []).forEach(s => {
            const w = Math.max(0, s.width || 0);
            if (!w) return;
            if (s.align === 'inside') out.push(`inset 0 0 0 ${w}px ${s.color}`);
            else if (s.align === 'center') {
                out.push(`inset 0 0 0 ${w / 2}px ${s.color}`);
                out.push(`0 0 0 ${ring + w / 2}px ${s.color}`);
                ring += w / 2;
            } else {
                out.push(`0 0 0 ${ring + w}px ${s.color}`);
                ring += w;
            }
        });
        (a.extrudes || []).forEach(x => {
            const ex = x.x || 0, ey = x.y || 0;
            const steps = Math.min(160, Math.max(Math.abs(ex), Math.abs(ey), 1));
            for (let i = 1; i <= steps; i++) {
                out.push(`${(ex * i / steps).toFixed(2)}px ${(ey * i / steps).toFixed(2)}px 0 ${x.color}`);
            }
        });
        (a.shadows || []).forEach(s => {
            out.push(`${s.x || 0}px ${s.y || 0}px ${Math.max(0, s.blur || 0)}px ${s.color}`);
        });
        return out.join(', ') || 'none';
    }

    dropShadowFilter(el) {
        const a = el.appearance || this.defaultAppearance();
        return (a.shadows || []).map(s => `drop-shadow(${s.x || 0}px ${s.y || 0}px ${Math.max(0, s.blur || 0)}px ${s.color})`).join(' ') || 'none';
    }

    // --- Selection / gizmo ----------------------------------------------------
    setSelection(ids) {
        this.selection = new Set(ids);
        this.selectedVertex = -1;
        document.querySelectorAll('.element.selected').forEach(d => d.classList.remove('selected'));
        ids.forEach(id => document.getElementById(id)?.classList.add('selected'));
        this.renderGizmo(); this.renderLayersPanel(); this.updatePropPanel();
    }
    toggleSelection(id) {
        if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id);
        this.setSelection(Array.from(this.selection));
    }
    clearSelection() { this.setSelection([]); }

    renderGizmo() {
        this.gizmoLayer.innerHTML = '';
        if (this.selection.size === 0) return;
        const firstId = Array.from(this.selection)[0];
        const firstEl = this.elements.find(e => e.id === firstId);
        if (!firstEl || firstEl.locked) return;

        if (this.selection.size > 1) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            this.selection.forEach(id => {
                const elData = this.elements.find(e => e.id === id);
                if (!elData || !elData.visible) return;
                const b = this.getGlobalBounds(elData);
                minX = Math.min(minX, b.left); minY = Math.min(minY, b.top);
                maxX = Math.max(maxX, b.left + b.width); maxY = Math.max(maxY, b.top + b.height);
            });
            const box = document.createElement('div');
            box.style.cssText = `position:absolute;border:1px solid var(--selection-color);left:${minX}px;top:${minY}px;width:${maxX - minX}px;height:${maxY - minY}px;`;
            this.gizmoLayer.appendChild(box);
            return;
        }

        if (!firstEl.visible) return;

        // Direct selection tool on a path: node editing gizmo.
        if (this.currentTool === 'node' && firstEl.type === 'path') {
            this.renderNodeGizmo(firstEl);
            return;
        }

        const b = this.getGlobalBounds(firstEl);
        const gizmo = document.createElement('div');
        gizmo.className = 'gizmo';
        Object.assign(gizmo.style, {
            left: b.left + 'px', top: b.top + 'px',
            width: firstEl.w + 'px', height: firstEl.h + 'px',
            transform: `rotate(${firstEl.rotation}deg)`
        });
        ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'].forEach(h => {
            const div = document.createElement('div');
            div.className = `handle handle-${h}`;
            div.dataset.handle = h;
            div.style.cursor = this.getCursorForHandle(h, firstEl.rotation);
            gizmo.appendChild(div);
        });
        const rotLine = document.createElement('div'); rotLine.className = 'handle-rot-connector'; gizmo.appendChild(rotLine);
        const rotHandle = document.createElement('div'); rotHandle.className = 'handle handle-rot'; rotHandle.dataset.handle = 'rot'; gizmo.appendChild(rotHandle);
        this.gizmoLayer.appendChild(gizmo);
    }

    getCursorForHandle(handle, rotation) {
        const baseAngles = { tc: 0, tr: 45, mr: 90, br: 135, bc: 180, bl: 225, ml: 270, tl: 315 };
        let angle = baseAngles[handle];
        if (angle === undefined) return 'default';
        let t = (angle + rotation) % 360;
        if (t < 0) t += 360;
        const dirs = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
        return dirs[Math.round(t / 45) % 4];
    }

    getGlobalBounds(el) {
        let x = el.x, y = el.y, current = el;
        while (current.parentId && !current.parentId.startsWith('ab_')) {
            const parent = this.elements.find(e => e.id === current.parentId);
            if (parent) { x += parent.x; y += parent.y; current = parent; } else break;
        }
        const ab = this.artboards.find(a => a.id === current.parentId);
        if (ab) { x += ab.x; y += ab.y; }
        return { left: x, top: y, width: el.w, height: el.h };
    }

    updateMarquee(mx, my) {
        const { ox, oy } = this.startState;
        Object.assign(this.marquee.style, {
            left: Math.min(ox, mx) + 'px', top: Math.min(oy, my) + 'px',
            width: Math.abs(ox - mx) + 'px', height: Math.abs(oy - my) + 'px'
        });
    }

    checkMarqueeSelection(shift) {
        const mRect = this.marquee.getBoundingClientRect();
        const newSelection = new Set(shift ? this.selection : []);
        this.elements.forEach(el => {
            if (!el.visible || el.locked) return;
            const dom = document.getElementById(el.id);
            if (!dom) return;
            const rect = dom.getBoundingClientRect();
            if (mRect.left < rect.right && mRect.right > rect.left && mRect.top < rect.bottom && mRect.bottom > rect.top) {
                newSelection.add(el.id);
            }
        });
        this.setSelection(Array.from(newSelection));
    }

    // --- Layers ---------------------------------------------------------------
    renderLayersPanel() {
        if (!this.layersContent) return;
        this.layersContent.innerHTML = '';
        this.artboards.forEach(ab => {
            const groupTitle = document.createElement('div');
            groupTitle.className = 'layer-group-header';
            groupTitle.textContent = ab.label || 'Artboard';
            this.layersContent.appendChild(groupTitle);
            const renderTree = (parentId, depth) => {
                const children = this.elements.filter(e => e.parentId === parentId).sort((a, b) => b.zIndex - a.zIndex);
                children.forEach(el => {
                    const item = document.createElement('div');
                    item.className = `layer-item ${this.selection.has(el.id) ? 'active' : ''}`;
                    item.draggable = true;
                    item.style.paddingLeft = (12 + depth * 16) + 'px';
                    item.ondragstart = (e) => { this.draggedLayerId = el.id; item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
                    item.ondragend = () => { this.draggedLayerId = null; item.classList.remove('dragging'); document.querySelectorAll('.layer-item').forEach(i => i.classList.remove('drag-over-top', 'drag-over-bottom')); };
                    item.ondragover = (e) => {
                        e.preventDefault();
                        if (this.draggedLayerId === el.id) return;
                        const rect = item.getBoundingClientRect();
                        item.classList.toggle('drag-over-top', e.clientY < rect.top + rect.height / 2);
                        item.classList.toggle('drag-over-bottom', e.clientY >= rect.top + rect.height / 2);
                    };
                    item.ondragleave = () => item.classList.remove('drag-over-top', 'drag-over-bottom');
                    item.ondrop = (e) => {
                        e.preventDefault();
                        const rect = item.getBoundingClientRect();
                        this.reorderLayers(this.draggedLayerId, el.id, e.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
                    };
                    const icons = { group: 'folder', text: 'type', circle: 'circle', path: 'pen-tool', image: 'image', bool: 'combine' };
                    const icon = icons[el.type] || 'square';
                    let name = el.type;
                    if (el.type === 'text') name = el.text ? el.text.substring(0, 12) : 'Text';
                    if (el.type === 'bool') name = 'Pathfinder';
                    item.innerHTML = `<i data-lucide="${icon}" class="layer-icon"></i><span class="truncate flex-1">${name}</span>
                        <div class="layer-actions">
                            <button class="layer-action-btn" onclick="app.toggleVisibility('${el.id}')"><i data-lucide="${el.visible ? 'eye' : 'eye-off'}" style="width:12px"></i></button>
                            <button class="layer-action-btn" onclick="app.toggleLock('${el.id}')"><i data-lucide="${el.locked ? 'lock' : 'unlock'}" style="width:12px"></i></button>
                        </div>`;
                    item.onclick = (e) => {
                        if (e.target.closest('.layer-action-btn')) return;
                        if (e.shiftKey) this.toggleSelection(el.id); else this.setSelection([el.id]);
                    };
                    this.layersContent.appendChild(item);
                    if (el.type === 'group') renderTree(el.id, depth + 1);
                });
            };
            renderTree(ab.id, 0);
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    reorderLayers(draggedId, targetId, pos) {
        if (!draggedId || draggedId === targetId) return;
        const draggedEl = this.elements.find(e => e.id === draggedId);
        if (!draggedEl) return;
        const siblings = this.elements.filter(e => e.parentId === draggedEl.parentId).sort((a, b) => a.zIndex - b.zIndex);
        const fromIdx = siblings.findIndex(e => e.id === draggedId);
        siblings.splice(fromIdx, 1);
        const newIdx = siblings.findIndex(e => e.id === targetId);
        if (pos === 'before') siblings.splice(newIdx + 1, 0, draggedEl); else siblings.splice(newIdx, 0, draggedEl);
        siblings.forEach((el, i) => {
            el.zIndex = i + 1;
            const dom = document.getElementById(el.id);
            if (dom) dom.style.zIndex = el.zIndex;
        });
        this.renderLayersPanel(); this.renderGizmo(); this.markDirty();
    }

    toggleLock(id) {
        const el = this.elements.find(e => e.id === id);
        if (!el) return;
        el.locked = !el.locked;
        document.getElementById(id)?.classList.toggle('locked', el.locked);
        if (el.locked && this.selection.has(id)) this.renderGizmo();
        this.renderLayersPanel(); this.markDirty();
    }

    toggleVisibility(id) {
        const el = this.elements.find(e => e.id === id);
        if (!el) return;
        el.visible = !el.visible;
        const dom = document.getElementById(id);
        if (dom) dom.style.display = el.visible ? 'flex' : 'none';
        if (!el.visible && this.selection.has(id)) { this.selection.delete(id); this.renderGizmo(); }
        this.renderLayersPanel(); this.markDirty();
    }

    // --- Clipboard / structure --------------------------------------------------
    collectSubtree(id) {
        const root = this.elements.find(e => e.id === id);
        if (!root) return [];
        const out = [JSON.parse(JSON.stringify(root))];
        this.elements.filter(e => e.parentId === id).forEach(c => out.push(...this.collectSubtree(c.id)));
        return out;
    }

    copySelected() {
        this.clipboard = Array.from(this.selection).map(id => this.collectSubtree(id)).filter(t => t.length);
        this.hideContextMenu();
    }

    paste() {
        if (!this.clipboard.length) return;
        const newIds = [];
        this.clipboard.forEach(subtree => {
            const idMap = {};
            subtree.forEach((data, i) => {
                const copy = JSON.parse(JSON.stringify(data));
                copy.id = 'el_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
                idMap[data.id] = copy.id;
                if (i === 0) {
                    copy.x += 20; copy.y += 20;
                    if (!document.getElementById(copy.parentId)) copy.parentId = this.activeArtboardId || this.artboards[0]?.id;
                    newIds.push(copy.id);
                } else {
                    copy.parentId = idMap[data.parentId] || copy.parentId;
                }
                this.elements.push(copy);
                this.buildElementDom(copy);
            });
        });
        this.setSelection(newIds);
        this.renderLayersPanel();
        this.hideContextMenu();
        this.markDirty();
    }

    duplicateSelected() { this.copySelected(); this.paste(); }

    deleteSelected() {
        const toDelete = new Set();
        this.selection.forEach(id => this.collectSubtree(id).forEach(e => toDelete.add(e.id)));
        toDelete.forEach(id => document.getElementById(id)?.remove());
        this.elements = this.elements.filter(el => !toDelete.has(el.id));
        this.clearSelection();
        this.renderLayersPanel();
        this.hideContextMenu();
        this.markDirty();
    }

    lockSelected() { this.selection.forEach(id => this.toggleLock(id)); this.hideContextMenu(); }

    arrange(action) {
        const ids = Array.from(this.selection);
        if (!ids.length) return;
                const els = ids.map(id => this.elements.find(e => e.id === id)).filter(Boolean).sort((a, b) => a.zIndex - b.zIndex);
        if (action === 'front') {
            const maxZ = Math.max(0, ...this.elements.map(e => e.zIndex));
            els.forEach((e, i) => { e.zIndex = maxZ + 1 + i; });
        } else {
            const minZ = Math.min(0, ...this.elements.map(e => e.zIndex));
            els.forEach((e, i) => { e.zIndex = minZ - (els.length - i); });
        }
        // Renumber siblings per parent so z-indices stay positive and sequential.
        new Set(els.map(e => e.parentId)).forEach(pid => {
            this.elements.filter(e => e.parentId === pid)
                .sort((a, b) => a.zIndex - b.zIndex)
                .forEach((el, i) => {
                    el.zIndex = i + 1;
                    const dom = document.getElementById(el.id);
                    if (dom) dom.style.zIndex = el.zIndex;
                });
        });
        this.renderLayersPanel(); this.hideContextMenu(); this.markDirty();
    }

    groupSelected() {
        if (this.selection.size < 2) return null;
        const ids = Array.from(this.selection);
        const els = ids.map(id => this.elements.find(e => e.id === id)).filter(Boolean);
        const parentId = els[0].parentId;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        els.forEach(e => {
            minX = Math.min(minX, e.x); minY = Math.min(minY, e.y);
            maxX = Math.max(maxX, e.x + e.w); maxY = Math.max(maxY, e.y + e.h);
        });
        const group = this.createElementData('group', minX, minY, parentId);
        group.w = maxX - minX; group.h = maxY - minY;
        group.zIndex = Math.max(...els.map(e => e.zIndex)) + 1;
        this.elements.push(group);
        this.buildElementDom(group);
        const groupDom = document.getElementById(group.id);
        els.forEach(e => {
            const dom = document.getElementById(e.id);
            e.parentId = group.id;
            e.x -= minX; e.y -= minY;
            dom.style.left = e.x + 'px'; dom.style.top = e.y + 'px';
            groupDom.appendChild(dom);
        });
        this.setSelection([group.id]);
        this.renderLayersPanel(); this.hideContextMenu(); this.markDirty();
        return group;
    }

    ungroupSelected() {
        const groups = Array.from(this.selection).map(id => this.elements.find(e => e.id === id)).filter(e => e && e.type === 'group');
        if (!groups.length) return;
        const newSelection = [];
        groups.forEach(grp => {
            const children = this.elements.filter(e => e.parentId === grp.id);
            const grandParent = document.getElementById(grp.parentId);
            children.forEach(child => {
                const dom = document.getElementById(child.id);
                child.parentId = grp.parentId;
                child.x += grp.x; child.y += grp.y;
                dom.style.left = child.x + 'px'; dom.style.top = child.y + 'px';
                grandParent.appendChild(dom);
                newSelection.push(child.id);
            });
            document.getElementById(grp.id)?.remove();
            this.elements = this.elements.filter(e => e.id !== grp.id);
        });
        this.setSelection(newSelection);
        this.renderLayersPanel(); this.hideContextMenu(); this.markDirty();
    }

    alignElements(mode) {
        const ids = Array.from(this.selection);
        if (!ids.length) return;
        const els = ids.map(id => this.elements.find(e => e.id === id)).filter(Boolean);
        let bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        if (ids.length === 1) {
            const parent = this.artboards.find(a => a.id === els[0].parentId);
            if (!parent) return;
            bounds = parent.marginEnabled
                ? { minX: parent.marginLeft, minY: parent.marginTop, maxX: parent.w - parent.marginRight, maxY: parent.h - parent.marginBottom }
                : { minX: 0, minY: 0, maxX: parent.w, maxY: parent.h };
        } else {
            els.forEach(e => {
                bounds.minX = Math.min(bounds.minX, e.x); bounds.minY = Math.min(bounds.minY, e.y);
                bounds.maxX = Math.max(bounds.maxX, e.x + e.w); bounds.maxY = Math.max(bounds.maxY, e.y + e.h);
            });
        }
        const centerX = (bounds.minX + bounds.maxX) / 2, centerY = (bounds.minY + bounds.maxY) / 2;
        els.forEach(e => {
            if (mode === 'left') e.x = bounds.minX;
            if (mode === 'center') e.x = centerX - e.w / 2;
            if (mode === 'right') e.x = bounds.maxX - e.w;
            if (mode === 'top') e.y = bounds.minY;
            if (mode === 'middle') e.y = centerY - e.h / 2;
            if (mode === 'bottom') e.y = bounds.maxY - e.h;
            const dom = document.getElementById(e.id);
            dom.style.left = e.x + 'px'; dom.style.top = e.y + 'px';
        });
        this.renderGizmo(); this.refreshPanelValues(); this.markDirty();
    }

    // Auto layout with strict non-negative constraints: sequential placement
    // with clamped gap/padding mathematically prevents object intersection.
    applyAutoLayout(groupId) {
        const group = this.elements.find(e => e.id === groupId);
        if (!group || group.layoutMode === 'none') return;
        group.gap = Math.max(0, group.gap || 0);
        group.padding = Math.max(0, group.padding || 0);
        const children = this.elements.filter(e => e.parentId === groupId);
        if (group.layoutMode === 'horizontal') children.sort((a, b) => a.x - b.x);
        else children.sort((a, b) => a.y - b.y);

        let currentPos = group.padding;
        let maxCrossSize = 0;
        children.forEach(child => {
            if (group.layoutMode === 'horizontal') {
                child.x = currentPos; currentPos += child.w + group.gap; maxCrossSize = Math.max(maxCrossSize, child.h);
            } else {
                child.y = currentPos; currentPos += child.h + group.gap; maxCrossSize = Math.max(maxCrossSize, child.w);
            }
        });

        if (group.layoutMode === 'horizontal') {
            group.w = Math.max(10, currentPos - group.gap + group.padding);
            group.h = maxCrossSize + group.padding * 2;
            children.forEach(child => {
                if (group.alignItems === 'center') child.y = group.padding + (maxCrossSize - child.h) / 2;
                else if (group.alignItems === 'end') child.y = group.h - group.padding - child.h;
                else child.y = group.padding;
            });
        } else {
            group.h = Math.max(10, currentPos - group.gap + group.padding);
            group.w = maxCrossSize + group.padding * 2;
            children.forEach(child => {
                if (group.alignItems === 'center') child.x = group.padding + (maxCrossSize - child.w) / 2;
                else if (group.alignItems === 'end') child.x = group.w - group.padding - child.w;
                else child.x = group.padding;
            });
        }
        children.forEach(child => {
            const dom = document.getElementById(child.id);
            if (dom) { dom.style.left = child.x + 'px'; dom.style.top = child.y + 'px'; }
        });
        const grpDom = document.getElementById(group.id);
        if (grpDom) { grpDom.style.width = group.w + 'px'; grpDom.style.height = group.h + 'px'; }
        this.renderGizmo();
    }

    // --- Context menu -------------------------------------------------------
    handleContextMenu(e) {
        e.preventDefault();
        this.contextMenu.style.display = 'block';
        const mw = 220, mh = this.contextMenu.offsetHeight || 460;
        this.contextMenu.style.left = Math.min(e.clientX, window.innerWidth - mw) + 'px';
        this.contextMenu.style.top = Math.min(e.clientY, window.innerHeight - mh - 8) + 'px';
    }
    hideContextMenu() { this.contextMenu.style.display = 'none'; }

    // --- Persistence hooks -----------------------------------------------------
    markDirty() {
        const label = document.getElementById('save-state');
        if (label) label.textContent = 'Saving…';
        clearTimeout(this._saveTimer);
        if (this.assetEditSession) {
            if (label) label.textContent = 'Asset edit pending';
            return;
        }
        this._saveTimer = setTimeout(() => {
            this.saveCurrentProject();
            if (label) label.textContent = 'Saved';
        }, 600);
    }
}
