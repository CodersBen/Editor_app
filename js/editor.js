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

        this.history = [];               // JSON snapshots for undo/redo
        this.historyIndex = -1;
        this.historyLimit = 50;
        this._restoring = false;

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

        // Clipboard images (screenshots, browser copies) and OS file drops.
        document.addEventListener('paste', this.handlePaste.bind(this));
        this.viewport.addEventListener('dragover', (e) => {
            if (Array.from(e.dataTransfer?.types || []).includes('Files')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            }
        });
        this.viewport.addEventListener('drop', this.handleImageDrop.bind(this));

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
        // Gizmo chrome (handles, selection borders) counter-scales with this.
        this.workspace.style.setProperty('--inv-zoom', String(1 / this.scale));
        const zoomLevel = document.getElementById('zoom-level');
        if (zoomLevel) zoomLevel.textContent = Math.round(this.scale * 100) + '%';
        this.drawRulers();
        this.drawGrid();
    }

    // Zoom is multiplicative (equal feel at every level) across a wide range,
    // and panning is unbounded — together they give an effectively infinite
    // workspace for large-format, multi-artboard documents.
    clampZoom(s) { return Math.max(0.02, Math.min(64, s)); }

    zoom(d) {
        this.scale = this.clampZoom(this.scale * (d > 0 ? 1.25 : 0.8));
        this.updateTransform();
    }

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
        this.scale = Math.max(0.02, Math.min(sc, 1.4));
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
            this.scale = this.clampZoom(os * Math.exp(-e.deltaY * 0.0015));
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
            // While a pen draft is active, undo/redo act on individual pen
            // actions (anchors, handle drags) — not on the whole document.
            if (k === 'z') {
                if (this.penDraft) { e.shiftKey ? this.penRedo() : this.penUndo(); }
                else { e.shiftKey ? this.redo() : this.undo(); }
                e.preventDefault();
            }
            if (k === 'y') { this.penDraft ? this.penRedo() : this.redo(); e.preventDefault(); }
            if (k === 'c') { this.copySelected(); e.preventDefault(); }
            // Ctrl+V is intentionally NOT handled here: the document 'paste'
            // event routes between OS-clipboard images and internal elements.
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
        if (e.key === 'Delete' || e.key === 'Backspace' || e.key === '-') {
            // While drawing: remove the last pen anchor. In direct selection
            // with vertices selected: remove those points. Otherwise (not for
            // '-') delete the selected objects.
            if (this.penDraft) {
                this.penDraft.points.pop();
                if (!this.penDraft.points.length) this.cancelPen();
                else { this.penCommit(); this.renderPenPreview(); }
                return;
            }
            if (this.currentTool === 'node' && this.selectedVertices && this.selectedVertices.size) {
                this.removeSelectedVertices();
                return;
            }
            if (e.key !== '-') this.deleteSelected();
        }
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

        // 2) Gizmo handles (resize / rotate / corner radius).
        if (e.target.classList.contains('handle-radius')) {
            e.stopPropagation();
            if (e.target.dataset.vertexRadius) this.beginVertexRadiusDrag(e);
            else this.beginRectRadiusDrag(e);
            return;
        }
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

        // 4) Artboard activation (label is a workspace sibling of the frame).
        if (e.target.classList.contains('artboard-label')) {
            const ab = this.artboards.find(a => a.id === e.target.dataset.artboardId);
            if (ab) {
                this.activateArtboard(ab.id);
                if (this.currentTool === 'select') {
                    this.mode = 'artboard-dragging';
                    this.startState = { id: ab.id, mx: e.clientX, my: e.clientY, x: ab.x, y: ab.y };
                    e.preventDefault();
                }
            }
            return;
        }
        const artboardTarget = e.target.closest('.artboard');
        if (artboardTarget) this.activateArtboard(artboardTarget.id);

        // 5) Selection / drag / marquee.
        const elTarget = e.target.closest('.element');
        if (elTarget) {
            let targetId = elTarget.id;
            let elData = this.elements.find(x => x.id === targetId);
            if (!elData) return;
            // Selecting inside a group selects the top-level group (selection tool only).
            if (this.currentTool === 'select') {
                const topId = this.topLevelIdFor(elData);
                if (topId && topId !== targetId) {
                    targetId = topId;
                    elData = this.elements.find(x => x.id === topId);
                }
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

        if (handle === 'rot' || handle.startsWith('rot-')) {
            this.mode = 'rotating';
            const b = this.selection.size > 1 ? this.selectionBounds() : this.getGlobalBounds(elData);
            this.startState = {
                cx: b.left + b.width / 2,
                cy: b.top + b.height / 2,
                startAngle: Math.atan2(e.clientY - (b.top + b.height / 2) * this.scale - this.panY - this.viewport.getBoundingClientRect().top,
                    e.clientX - (b.left + b.width / 2) * this.scale - this.panX - this.viewport.getBoundingClientRect().left),
                items: Array.from(this.selection).map(id => {
                    const item = this.elements.find(x => x.id === id);
                    const gb = this.getGlobalBounds(item);
                    return {
                        id,
                        x: item.x,
                        y: item.y,
                        rotation: item.rotation || 0,
                        centerX: gb.left + gb.width / 2,
                        centerY: gb.top + gb.height / 2
                    };
                })
            };
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
            this.reparentDraggedElements(dx, dy);
            this.renderGizmo();
            if (this.selection.size === 1) this.refreshPanelValues();
            return;
        }

        if (this.mode === 'artboard-dragging') {
            const ab = this.artboards.find(a => a.id === this.startState.id);
            if (!ab) return;
            ab.x = this.startState.x + (mx - this.startState.mx) / this.scale;
            ab.y = this.startState.y + (my - this.startState.my) / this.scale;
            this.syncArtboardDom(ab);
            this.updateTransform();
            this.renderGizmo();
            return;
        }

        if (this.mode === 'resizing') { this.performResize(e); return; }

        if (this.mode === 'rotating') {
            const rect = this.viewport.getBoundingClientRect();
            const angle = Math.atan2(my - this.startState.cy * this.scale - this.panY - rect.top,
                mx - this.startState.cx * this.scale - this.panX - rect.left);
            let delta = angle - this.startState.startAngle;
            let deltaDeg = delta * 180 / Math.PI;
            if (e.shiftKey) deltaDeg = Math.round(deltaDeg / 15) * 15;
            delta = deltaDeg * Math.PI / 180;
            const cos = Math.cos(delta), sin = Math.sin(delta);
            this.startState.items.forEach(item => {
                const elData = this.elements.find(x => x.id === item.id);
                if (!elData) return;
                const relX = item.centerX - this.startState.cx;
                const relY = item.centerY - this.startState.cy;
                const newCenterX = this.startState.cx + relX * cos - relY * sin;
                const newCenterY = this.startState.cy + relX * sin + relY * cos;
                const origin = this.parentGlobalOrigin(elData.parentId);
                elData.x = newCenterX - origin.x - elData.w / 2;
                elData.y = newCenterY - origin.y - elData.h / 2;
                elData.rotation = item.rotation + deltaDeg;
                this.applyElementStyles(elData);
            });
            const first = this.elements.find(x => x.id === this.startState.items[0]?.id);
            if (first) {
                const deg = Math.round(((first.rotation % 360) + 360) % 360);
                this.showHud(`${deg}°`, mx, my);
            }
            this.renderGizmo(); this.refreshPanelValues();
            return;
        }

        if (this.mode === 'moving-vertex') { this.moveVertex(e); return; }
        if (this.mode === 'moving-bezier') { this.moveBezier(e); return; }
        if (this.mode === 'vertex-radius') { this.moveVertexRadius(e); return; }
        if (this.mode === 'radius-drag') { this.moveRectRadius(e); return; }

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

        // Proportional scaling: Shift held, or the element's aspect lock is on.
        // Corner handles scale by the dominant axis; edge handles derive the
        // cross axis from the dragged one.
        const locked = e.shiftKey || s.elData.aspectLocked;
        if (locked) {
            if (s.handle.length === 2) {
                const sW = newW / s.elData.w, sH = newH / s.elData.h;
                const sc = Math.abs(sW - 1) > Math.abs(sH - 1) ? sW : sH;
                newW = Math.max(1, s.elData.w * sc);
                newH = Math.max(1, s.elData.h * sc);
            } else if (s.handle === 'ml' || s.handle === 'mr') {
                newH = Math.max(1, s.elData.h * newW / s.elData.w);
            } else {
                newW = Math.max(1, s.elData.w * newH / s.elData.h);
            }
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

        this.showHud(this.fmtSize(elData.w, elData.h), e.clientX, e.clientY);
        this.renderGizmo();
        this.refreshPanelValues();
    }

    handleMouseUp(e) {
        const wasMode = this.mode;
        this.mode = 'idle';
        this.viewport.classList.remove('pan-active');
        this.marquee.style.display = 'none';
        this.clearSnapFlash();
        this.hideHud();

        if (wasMode === 'drawing') this.finishShapeDraw(e);
        if (wasMode === 'pen-drag') this.penMouseUp(e);
        if (wasMode === 'guide-create') this.finishGuideCreate(e);

        if (wasMode === 'dragging' && this.startState && this.startState.moved) {
            this.reparentDraggedElements();
            this.markDirty();
        }
        // Node/handle edits change curve extrema — refit the box to the path.
        if (['moving-vertex', 'moving-bezier'].includes(wasMode) && this.startState?.elId) {
            const el = this.elements.find(x => x.id === this.startState.elId);
            if (el) { this.refitPathBounds(el); this.renderGizmo(); }
        }
        if (['resizing', 'rotating', 'moving-vertex', 'moving-bezier', 'guide-move', 'artboard-dragging', 'vertex-radius', 'radius-drag'].includes(wasMode)) {
            this.markDirty();
        }
    }

    handleDblClick(e) {
        // Double-click a vertex (direct selection) deletes it.
        if (e.target.classList.contains('handle-vertex')) {
            this.removeVertexAt(parseInt(e.target.dataset.index));
            return;
        }
        if (this.penDraft) { this.finishPen(false); return; }
        // Double-click a path segment (direct selection) inserts an anchor
        // there — an exact Bézier split, so the shape doesn't move.
        if (this.currentTool === 'node' && this.selection.size === 1) {
            const el = this.elements.find(x => x.id === Array.from(this.selection)[0]);
            if (el && el.type === 'path' && e.target.closest('.element')?.id === el.id) {
                if (this.insertPointAt(el, this.worldPoint(e))) return;
            }
        }
        const guide = e.target.closest('.guide-line');
        if (guide) this.removeGuide(guide.dataset.guideId);
    }

    // Frame containment during drag, Figma-style: an object adopts the artboard
    // under its center; while it still overlaps its current frame it stays (and
    // is clipped); once fully outside every frame it floats on the pasteboard
    // (parentId 'workspace') and renders unclipped. DOM nodes are transferred
    // live and coordinates rebased, so clipping always matches the data model.
    reparentDraggedElements(dx = 0, dy = 0) {
        let changed = false;
        ((this.startState && this.startState.elements) || []).forEach(item => {
            const el = this.elements.find(x => x.id === item.id);
            if (!el || el.locked) return;
            const pid = el.parentId;
            if (pid !== 'workspace' && !(pid && pid.startsWith('ab_'))) return; // nested in a group: skip
            const origin = this.parentGlobalOrigin(pid);
            const wx = origin.x + el.x, wy = origin.y + el.y;
            const box = this.rectAABB(wx, wy, el.w, el.h, el.rotation || 0);
            const cx = wx + el.w / 2, cy = wy + el.h / 2;

            let target = this.artboards.find(a => cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h) || null;
            if (!target) {
                const current = this.artboards.find(a => a.id === pid);
                if (current && this.boxIntersectsArtboard(box, current)) {
                    target = current; // partially inside: stays clipped to its frame
                } else {
                    let bestArea = 0;
                    this.artboards.forEach(a => {
                        const ow = Math.min(box.left + box.width, a.x + a.w) - Math.max(box.left, a.x);
                        const oh = Math.min(box.top + box.height, a.y + a.h) - Math.max(box.top, a.y);
                        if (ow > 0 && oh > 0 && ow * oh > bestArea) { bestArea = ow * oh; target = a; }
                    });
                }
            }
            const targetId = target ? target.id : 'workspace';
            if (targetId === pid) return;

            el.x = wx - (target ? target.x : 0);
            el.y = wy - (target ? target.y : 0);
            el.parentId = targetId;
            el.zIndex = this.elements.filter(x => x.parentId === targetId && x.id !== el.id).length + 1;

            const dom = document.getElementById(el.id);
            const parentDom = target ? document.getElementById(targetId) : this.workspace;
            if (dom && parentDom) parentDom.appendChild(dom);
            this.applyElementStyles(el);
            // Rebase the drag baseline so the running (mx - start) delta stays valid.
            item.x = el.x - dx;
            item.y = el.y - dy;
            if (target) this.activeArtboardId = target.id;
            changed = true;
        });
        if (changed) {
            this.renderLayersPanel();
            this.renderGizmo();
        }
    }

    // --- Shape drawing (deferred instantiation) ---------------------------
    // Returns the container for a world point: the artboard under it, or the
    // workspace pasteboard (id 'workspace', origin 0/0) when outside all frames.
    containerAtPoint(p) {
        const ab = this.artboards.find(a => p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h);
        return ab ? { id: ab.id, x: ab.x, y: ab.y } : { id: 'workspace', x: 0, y: 0 };
    }

    beginShapeDraw(e) {
        const p = this.worldPoint(e);
        const c = this.containerAtPoint(p);
        const lx = p.x - c.x, ly = p.y - c.y;
        const el = this.createElementData(this.currentTool, lx, ly, c.id);
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
        const origin = this.parentGlobalOrigin(el.parentId);
        const p = this.worldPoint(e);
        let lx = p.x - origin.x, ly = p.y - origin.y;
        let w = lx - s.ox, h = ly - s.oy;
        if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        el.x = Math.min(s.ox, s.ox + w);
        el.y = Math.min(s.oy, s.oy + h);
        el.w = Math.max(1, Math.abs(w));
        el.h = Math.max(1, Math.abs(h));
        this.applyElementStyles(el);
        this.showHud(this.fmtSize(el.w, el.h), e.clientX, e.clientY);
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
        const c = this.containerAtPoint(p);
        const kind = this.currentTool === 'text-h' ? 'header' : 'paragraph';
        const el = this.createElementData(kind, p.x - c.x, p.y - c.y, c.id);
        this.elements.push(el);
        this.buildElementDom(el);
        this.autoResizeText(el.id);
        this.setTool('select');
        this.setSelection([el.id]);
        this.renderLayersPanel();
        this.markDirty();
    }

    // --- Artboards ---------------------------------------------------------
    activateArtboard(id) {
        this.activeArtboardId = id;
        document.querySelectorAll('.artboard').forEach(ab => ab.classList.remove('active'));
        document.getElementById(id)?.classList.add('active');
        if (this.selection.size === 0) this.updatePropPanel();
    }

    syncArtboardDom(ab) {
        const dom = document.getElementById(ab.id);
        if (dom) { dom.style.left = ab.x + 'px'; dom.style.top = ab.y + 'px'; }
        const label = document.getElementById(ab.id + '_label');
        if (label) { label.style.left = ab.x + 'px'; label.style.top = ab.y + 'px'; }
    }

    createArtboard(opts) {
        const data = Object.assign({
            id: 'ab_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
            x: 0, y: 0, w: 800, h: 600,
            label: 'Artboard', bgColor: '#ffffff',
            marginTop: 20, marginBottom: 20, marginLeft: 20, marginRight: 20,
            marginEnabled: false, marginColor: '#06b6d4',
            clipContent: true
        }, opts || {});

        const el = document.createElement('div');
        el.className = 'artboard';
        el.id = data.id;
        el.style.backgroundColor = data.bgColor;
        el.style.overflow = data.clipContent === false ? 'visible' : 'hidden';
        Object.assign(el.style, { left: data.x + 'px', top: data.y + 'px', width: data.w + 'px', height: data.h + 'px' });
        // The label is a sibling of the artboard (not a child): the artboard
        // clips its content, and the label sits above the frame bounds.
        const title = document.createElement('div');
        title.className = 'artboard-label';
        title.id = data.id + '_label';
        title.dataset.artboardId = data.id;
        title.textContent = data.label;
        Object.assign(title.style, { left: data.x + 'px', top: data.y + 'px' });
        this.workspace.insertBefore(title, this.guideLayer);

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
                this.syncArtboardDom(current);
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
            if (key === 'clipContent') dom.style.overflow = value === false ? 'visible' : 'hidden';
        }
        if (key === 'w' || key === 'h') this.compactArtboardsFrom(id);
        this.renderMarginGuides(id);
        this.markDirty();
        if (key === 'bgColor' || key === 'w' || key === 'h') this.updatePropPanel();
    }

    renameArtboard(id, name) {
        const ab = this.artboards.find(a => a.id === id);
        if (!ab) return;
        ab.label = (name || '').trim() || 'Artboard';
        const label = document.getElementById(id + '_label');
        if (label) label.textContent = ab.label;
        this.renderLayersPanel();
        this.updatePropPanel();
        this.markDirty();
    }

    setArtboardOrientation(id, mode) {
        const ab = this.artboards.find(a => a.id === id);
        if (!ab) return;
        if ((mode === 'landscape') === (ab.w >= ab.h)) return;
        [ab.w, ab.h] = [ab.h, ab.w];
        const dom = document.getElementById(id);
        if (dom) { dom.style.width = ab.w + 'px'; dom.style.height = ab.h + 'px'; }
        this.compactArtboardsFrom(id);
        this.renderMarginGuides(id);
        this.updatePropPanel();
        this.markDirty();
    }

    applyArtboardPreset(id, key) {
        if (key === 'custom') return;
        const preset = this.projectPresets()[key];
        const ab = this.artboards.find(a => a.id === id);
        if (!preset || !ab) return;
        ab.w = this.unitToPixels(preset.w, preset.unit, preset.resolution);
        ab.h = this.unitToPixels(preset.h, preset.unit, preset.resolution);
        const dom = document.getElementById(id);
        if (dom) { dom.style.width = ab.w + 'px'; dom.style.height = ab.h + 'px'; }
        this.compactArtboardsFrom(id);
        this.renderMarginGuides(id);
        this.updatePropPanel();
        this.markDirty();
    }

    duplicateArtboard(id) {
        const src = this.artboards.find(a => a.id === id);
        if (!src) return;
        const data = JSON.parse(JSON.stringify(src));
        delete data.id;
        data.x = src.x + src.w + 80;
        data.label = (src.label || 'Artboard') + ' copy';
        const newId = this.createArtboard(data);
        // Deep-copy the artboard's content with fresh ids.
        this.elements.filter(e => e.parentId === id).forEach(top => {
            const idMap = {};
            this.collectSubtree(top.id).forEach((elData, i) => {
                const copy = JSON.parse(JSON.stringify(elData));
                copy.id = 'el_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
                idMap[elData.id] = copy.id;
                copy.parentId = i === 0 ? newId : (idMap[elData.parentId] || copy.parentId);
                this.elements.push(copy);
                this.buildElementDom(copy);
            });
        });
        this.compactArtboardsFrom(newId);
        this.renderLayersPanel();
        this.updatePropPanel();
        this.markDirty();
        return newId;
    }

    deleteArtboard(id) {
        const ab = this.artboards.find(a => a.id === id);
        if (!ab) return;
        const tops = this.elements.filter(e => e.parentId === id);
        if (tops.length && !confirm(`Delete "${ab.label}" and the ${tops.length} object(s) on it?`)) return;
        const doomed = new Set();
        tops.forEach(t => this.collectSubtree(t.id).forEach(x => doomed.add(x.id)));
        doomed.forEach(elId => document.getElementById(elId)?.remove());
        this.elements = this.elements.filter(e => !doomed.has(e.id));
        document.getElementById(id)?.remove();
        document.getElementById(id + '_label')?.remove();
        this.artboards = this.artboards.filter(a => a.id !== id);
        if (this.activeArtboardId === id) this.activeArtboardId = this.artboards[0]?.id || null;
        this.setSelection(Array.from(this.selection).filter(sid => !doomed.has(sid)));
        this.renderLayersPanel();
        this.updatePropPanel();
        this.markDirty();
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
        else if (type === 'image') { data.src = ''; data.title = 'Image'; data.aspectLocked = true; }
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
            transformOrigin: el.transformOrigin || '50% 50%',
            opacity: (el.opacity ?? 100) / 100,
            display: el.visible === false ? 'none' : 'flex'
        });
        dom.classList.toggle('locked', !!el.locked);
        dom.classList.toggle('selected', this.selection.has(el.id));

        if (el.type === 'rect') {
            dom.style.backgroundColor = el.fillEnabled === false ? 'transparent' : el.bgColor;
            // Per-corner radii (tl tr br bl) override the uniform radius.
            dom.style.borderRadius = el.radii
                ? el.radii.map(r => (r || 0) + 'px').join(' ')
                : (el.borderRadius || 0) + 'px';
            dom.style.boxShadow = this.buildBoxShadows(el);
        } else if (el.type === 'circle') {
            dom.style.backgroundColor = el.fillEnabled === false ? 'transparent' : el.bgColor;
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
    // Walks up to the outermost group containing an element (selection tool
    // treats groups as a unit).
    topLevelIdFor(el) {
        let current = el;
        while (current && current.parentId && !current.parentId.startsWith('ab_') && current.parentId !== 'workspace') {
            const parent = this.elements.find(p => p.id === current.parentId);
            if (parent && parent.type === 'group') current = parent; else break;
        }
        return current ? current.id : null;
    }

    setSelection(ids) {
        // Drop ids whose ancestor is also selected: a group and its children in
        // one selection would double-apply moves/aligns and break the bounds.
        const requested = new Set(ids);
        const filtered = ids.filter(id => {
            const el = this.elements.find(e => e.id === id);
            if (!el) return false;
            let pid = el.parentId;
            while (pid && !pid.startsWith('ab_') && pid !== 'workspace') {
                if (requested.has(pid)) return false;
                const parent = this.elements.find(e => e.id === pid);
                if (!parent) break;
                pid = parent.parentId;
            }
            return true;
        });
        this.selection = new Set(filtered);
        this.selectedVertex = -1;
        this.selectedVertices = new Set();
        document.querySelectorAll('.element.selected').forEach(d => d.classList.remove('selected'));
        filtered.forEach(id => document.getElementById(id)?.classList.add('selected'));
        this.renderGizmo(); this.renderLayersPanel(); this.updatePropPanel();
    }
    toggleSelection(id) {
        if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id);
        this.setSelection(Array.from(this.selection));
    }
    clearSelection() { this.setSelection([]); }

    selectionBounds() {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.selection.forEach(id => {
            const elData = this.elements.find(e => e.id === id);
            if (!elData || !elData.visible) return;
            // Rotation-aware AABB so the marquee hugs rotated objects correctly.
            const b = this.worldAABB(elData);
            minX = Math.min(minX, b.left); minY = Math.min(minY, b.top);
            maxX = Math.max(maxX, b.left + b.width); maxY = Math.max(maxY, b.top + b.height);
        });
        if (!Number.isFinite(minX)) return null;
        return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
    }

    appendCornerRotationHandles(container) {
        ['tl', 'tr', 'bl', 'br'].forEach(pos => {
            const handle = document.createElement('div');
            handle.className = `handle handle-rot-corner handle-rot-${pos}`;
            handle.dataset.handle = 'rot-' + pos;
            container.appendChild(handle);
        });
    }

    renderGizmo() {
        this.gizmoLayer.innerHTML = '';
        if (this.selection.size === 0) return;
        const firstId = Array.from(this.selection)[0];
        const firstEl = this.elements.find(e => e.id === firstId);
        if (!firstEl || firstEl.locked) return;

        if (this.selection.size > 1) {
            const bounds = this.selectionBounds();
            if (!bounds) return;
            const box = document.createElement('div');
            box.className = 'gizmo multi-gizmo';
            box.style.cssText = `position:absolute;left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;height:${bounds.height}px;`;
            this.appendCornerRotationHandles(box);
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
        this.appendCornerRotationHandles(gizmo);

        // Per-corner radius dots on rectangles (Figma-style): drag inward to
        // round, Shift applies to all four corners.
        if (firstEl.type === 'rect' && Math.min(firstEl.w, firstEl.h) * this.scale > 28) {
            const radii = firstEl.radii || [firstEl.borderRadius || 0, firstEl.borderRadius || 0, firstEl.borderRadius || 0, firstEl.borderRadius || 0];
            const maxInset = Math.min(firstEl.w, firstEl.h) / 2;
            [[0, 0, 0], [1, 1, 0], [2, 1, 1], [3, 0, 1]].forEach(([corner, fx, fy]) => {
                const inset = Math.min(maxInset, Math.max(12 / this.scale, radii[corner] || 0));
                const dot = document.createElement('div');
                dot.className = 'handle-radius';
                dot.dataset.corner = corner;
                dot.title = 'Drag to round corner (Shift: all corners)';
                Object.assign(dot.style, {
                    left: (fx ? firstEl.w - inset : inset) + 'px',
                    top: (fy ? firstEl.h - inset : inset) + 'px'
                });
                gizmo.appendChild(dot);
            });
        }
        this.gizmoLayer.appendChild(gizmo);
    }

    // --- Rect corner radius dragging -------------------------------------------
    beginRectRadiusDrag(e) {
        const elId = Array.from(this.selection)[0];
        const el = this.elements.find(x => x.id === elId);
        if (!el || el.type !== 'rect') return;
        const b = this.getGlobalBounds(el);
        this.mode = 'radius-drag';
        this.startState = {
            elId, corner: parseInt(e.target.dataset.corner),
            cx: b.left + el.w / 2, cy: b.top + el.h / 2,
            rad: (el.rotation || 0) * Math.PI / 180, w: el.w, h: el.h
        };
    }

    moveRectRadius(e) {
        const s = this.startState;
        const el = this.elements.find(x => x.id === s.elId);
        if (!el) return;
        // Cursor into the element's local (unrotated) space.
        const p = this.worldPoint(e);
        const dx = p.x - s.cx, dy = p.y - s.cy;
        const lx = dx * Math.cos(-s.rad) - dy * Math.sin(-s.rad) + s.w / 2;
        const ly = dx * Math.sin(-s.rad) + dy * Math.cos(-s.rad) + s.h / 2;
        const byCorner = [
            Math.min(lx, ly),                 // tl
            Math.min(s.w - lx, ly),           // tr
            Math.min(s.w - lx, s.h - ly),     // br
            Math.min(lx, s.h - ly)            // bl
        ];
        const r = Math.round(Math.max(0, Math.min(byCorner[s.corner], Math.min(s.w, s.h) / 2)));
        const u = el.borderRadius || 0;
        if (!el.radii) el.radii = [u, u, u, u];
        // Linked (or Shift): one corner dot drives all four.
        if (e.shiftKey || el.radiusLinked) { el.radii = [r, r, r, r]; el.borderRadius = r; }
        else el.radii[s.corner] = r;
        this.applyElementStyles(el);
        this.renderGizmo();
        this.showHud(`Radius ${r}`, e.clientX, e.clientY);
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

    // Axis-aligned bounding box of a (possibly rotated) rect in world space.
    rectAABB(wx, wy, w, h, rotation) {
        if (!rotation) return { left: wx, top: wy, width: w, height: h };
        const rad = rotation * Math.PI / 180;
        const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
        const bw = w * cos + h * sin, bh = w * sin + h * cos;
        return { left: wx + w / 2 - bw / 2, top: wy + h / 2 - bh / 2, width: bw, height: bh };
    }

    worldAABB(el) {
        const b = this.getGlobalBounds(el);
        return this.rectAABB(b.left, b.top, el.w, el.h, el.rotation || 0);
    }

    boxIntersectsArtboard(box, ab) {
        return box.left < ab.x + ab.w && box.left + box.width > ab.x
            && box.top < ab.y + ab.h && box.top + box.height > ab.y;
    }

    parentGlobalOrigin(parentId) {
        if (!parentId) return { x: 0, y: 0 };
        if (parentId.startsWith('ab_')) {
            const ab = this.artboards.find(a => a.id === parentId);
            return ab ? { x: ab.x, y: ab.y } : { x: 0, y: 0 };
        }
        const parent = this.elements.find(e => e.id === parentId);
        if (!parent) return { x: 0, y: 0 };
        const b = this.getGlobalBounds(parent);
        return { x: b.left, y: b.top };
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
        const vr = this.viewport.getBoundingClientRect();
        // Marquee in world coordinates.
        const world = {
            left: (mRect.left - vr.left - this.panX) / this.scale,
            top: (mRect.top - vr.top - this.panY) / this.scale,
            right: (mRect.right - vr.left - this.panX) / this.scale,
            bottom: (mRect.bottom - vr.top - this.panY) / this.scale
        };
        const newSelection = new Set(shift ? this.selection : []);
        this.elements.forEach(el => {
            if (!el.visible || el.locked) return;
            if (el.type === 'group') return; // groups select via their children
            if (!this.marqueeHitsElement(el, world)) return;
            // Group children resolve to their top-level group, so a marquee
            // never selects a group and its contents as separate objects.
            const topId = this.topLevelIdFor(el);
            const top = topId && this.elements.find(x => x.id === topId);
            if (top && !top.locked && top.visible !== false) newSelection.add(top.id);
        });
        this.setSelection(Array.from(newSelection));
    }

    // True-shape marquee: vector objects must actually be touched by the
    // marquee — their sampled outline, or their interior when filled. Text,
    // images and booleans keep frame-based marquee (text intentionally so).
    marqueeHitsElement(el, rect) {
        const b = this.worldAABB(el);
        if (rect.left >= b.left + b.width || rect.right <= b.left
            || rect.top >= b.top + b.height || rect.bottom <= b.top) return false;
        if (!['rect', 'circle', 'path'].includes(el.type)) return true;

        const outline = this.elementOutlinePolygon(el);
        if (!outline || outline.pts.length < 2) return true;
        const { pts, closed } = outline;

        // Any sampled outline point inside the marquee?
        if (pts.some(p => p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom)) return true;
        // Any outline edge crossing the marquee boundary?
        if (this.polylineIntersectsRect(pts, closed, rect)) return true;
        // Marquee entirely inside a filled shape?
        if (closed && el.fillEnabled !== false) {
            const center = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
            if (this.pointInPolygon(center, pts)) return true;
        }
        return false;
    }

    // World-space sampled outline of a vector element (rotation applied).
    elementOutlinePolygon(el) {
        const b = this.getGlobalBounds(el);
        const rad = (el.rotation || 0) * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const cx = b.left + el.w / 2, cy = b.top + el.h / 2;
        const toW = (lx, ly) => ({
            x: cx + (lx - el.w / 2) * cos - (ly - el.h / 2) * sin,
            y: cy + (lx - el.w / 2) * sin + (ly - el.h / 2) * cos
        });
        if (el.type === 'rect') {
            return { pts: [toW(0, 0), toW(el.w, 0), toW(el.w, el.h), toW(0, el.h)], closed: true };
        }
        if (el.type === 'circle') {
            const pts = [];
            for (let i = 0; i < 24; i++) {
                const a = i / 24 * Math.PI * 2;
                pts.push(toW(el.w / 2 + el.w / 2 * Math.cos(a), el.h / 2 + el.h / 2 * Math.sin(a)));
            }
            return { pts, closed: true };
        }
        if (el.type === 'path' && el.points && el.points.length) {
            const n = el.points.length;
            const P = el.points.map(p => ({
                x: p.x / 100 * el.w, y: p.y / 100 * el.h,
                hi: p.hi ? { x: p.hi.x / 100 * el.w, y: p.hi.y / 100 * el.h } : null,
                ho: p.ho ? { x: p.ho.x / 100 * el.w, y: p.ho.y / 100 * el.h } : null
            }));
            const evalB = (p0, p1, p2, p3, t) => {
                const mt = 1 - t;
                return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
            };
            const pts = [];
            const segCount = el.closed ? n : n - 1;
            for (let s = 0; s < segCount; s++) {
                const a = P[s], c = P[(s + 1) % n];
                const c1 = a.ho || a, c2 = c.hi || c;
                for (let k = 0; k < 10; k++) {
                    const t = k / 10;
                    pts.push(toW(evalB(a.x, c1.x, c2.x, c.x, t), evalB(a.y, c1.y, c2.y, c.y, t)));
                }
            }
            const last = P[el.closed ? 0 : n - 1];
            pts.push(toW(last.x, last.y));
            return { pts, closed: !!el.closed };
        }
        return null;
    }

    pointInPolygon(pt, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i], c = poly[j];
            if ((a.y > pt.y) !== (c.y > pt.y)
                && pt.x < (c.x - a.x) * (pt.y - a.y) / (c.y - a.y) + a.x) inside = !inside;
        }
        return inside;
    }

    polylineIntersectsRect(pts, closed, rect) {
        const edges = [
            [{ x: rect.left, y: rect.top }, { x: rect.right, y: rect.top }],
            [{ x: rect.right, y: rect.top }, { x: rect.right, y: rect.bottom }],
            [{ x: rect.right, y: rect.bottom }, { x: rect.left, y: rect.bottom }],
            [{ x: rect.left, y: rect.bottom }, { x: rect.left, y: rect.top }]
        ];
        const segs = (a, b, c, d) => {
            const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
            return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
        };
        const count = closed ? pts.length : pts.length - 1;
        for (let i = 0; i < count; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            for (const [c, d] of edges) if (segs(a, b, c, d)) return true;
        }
        return false;
    }

    // --- Layers ---------------------------------------------------------------
    renderLayersPanel() {
        if (!this.layersContent) return;
        this.layersContent.innerHTML = '';
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
        this.artboards.forEach(ab => {
            const groupTitle = document.createElement('div');
            groupTitle.className = 'layer-group-header';
            groupTitle.textContent = ab.label || 'Artboard';
            this.layersContent.appendChild(groupTitle);
            renderTree(ab.id, 0);
        });
        // Free elements living on the pasteboard, outside any artboard.
        if (this.elements.some(e => e.parentId === 'workspace')) {
            const groupTitle = document.createElement('div');
            groupTitle.className = 'layer-group-header';
            groupTitle.textContent = 'Canvas';
            this.layersContent.appendChild(groupTitle);
            renderTree('workspace', 0);
        }
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
        // Stamp the OS clipboard so a later Ctrl+V prefers these elements over
        // a stale OS image; also clears any previously copied image.
        if (this.clipboard.length && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText('craf-internal-clipboard').catch(() => {});
        }
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

    // --- Image import (clipboard paste & file drop) -------------------------------
    handlePaste(e) {
        if (document.getElementById('editor-view').classList.contains('hidden')) return;
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

        const cd = e.clipboardData;
        const text = cd ? cd.getData('text/plain') : '';
        // Our own marker means the last copy was internal — paste elements.
        if (text !== 'craf-internal-clipboard' && cd) {
            const imageItem = Array.from(cd.items || []).find(it => it.type && it.type.startsWith('image/'));
            const file = imageItem && imageItem.getAsFile();
            if (file) {
                e.preventDefault();
                const reader = new FileReader();
                reader.onload = () => this.placeImageFromSrc(reader.result, { title: file.name || 'Pasted image' });
                reader.readAsDataURL(file);
                return;
            }
            // Browser copies often arrive as HTML markup referencing the image.
            const html = cd.getData('text/html') || '';
            const match = html.match(/<img[^>]*src=["']([^"']+)["']/i);
            if (match) {
                e.preventDefault();
                this.placeImageFromSrc(match[1], { title: 'Pasted image' });
                return;
            }
        }
        if (this.clipboard.length) {
            e.preventDefault();
            this.paste();
        }
    }

    handleImageDrop(e) {
        const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
        if (!files.length) return;
        e.preventDefault();
        const p = this.worldPoint(e);
        files.forEach((file, i) => {
            const reader = new FileReader();
            reader.onload = () => this.placeImageFromSrc(reader.result, {
                point: { x: p.x + i * 24, y: p.y + i * 24 },
                title: file.name
            });
            reader.readAsDataURL(file);
        });
    }

    // Loads the image to read its natural size, scales it to fit the target
    // container, and drops it centered on the given world point (or the active
    // artboard's center).
    placeImageFromSrc(src, opts = {}) {
        const img = new Image();
        img.onload = () => {
            let center = opts.point;
            if (!center) {
                const ab = this.artboards.find(a => a.id === this.activeArtboardId) || this.artboards[0];
                center = ab
                    ? { x: ab.x + ab.w / 2, y: ab.y + ab.h / 2 }
                    : {
                        x: (this.viewport.clientWidth / 2 - this.panX) / this.scale,
                        y: (this.viewport.clientHeight / 2 - this.panY) / this.scale
                    };
            }
            const c = this.containerAtPoint(center);
            const ab = this.artboards.find(a => a.id === c.id);
            const natW = img.naturalWidth || 320, natH = img.naturalHeight || 240;
            const maxW = ab ? ab.w * 0.8 : 900, maxH = ab ? ab.h * 0.8 : 900;
            const sc = Math.min(1, maxW / natW, maxH / natH);
            const w = Math.max(8, Math.round(natW * sc)), h = Math.max(8, Math.round(natH * sc));

            const el = this.createElementData('image', center.x - c.x - w / 2, center.y - c.y - h / 2, c.id);
            el.w = w; el.h = h;
            el.src = src;
            el.title = opts.title || 'Image';
            this.elements.push(el);
            this.buildElementDom(el);
            this.setSelection([el.id]);
            this.renderLayersPanel();
            this.markDirty();
        };
        img.onerror = () => console.warn('Craf: could not load pasted/dropped image');
        img.src = src;
    }

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

    // Artboard that (transitively) contains an element, or null for pasteboard.
    owningArtboard(el) {
        let current = el;
        while (current && current.parentId && !current.parentId.startsWith('ab_')) {
            if (current.parentId === 'workspace') return null;
            current = this.elements.find(e => e.id === current.parentId);
        }
        return current ? (this.artboards.find(a => a.id === current.parentId) || null) : null;
    }

    // Alignment works on rotation-aware world-space AABBs, so mixed selections
    // (different artboards, nested groups, rotated objects) keep stable bounds.
    alignElements(mode) {
        const els = Array.from(this.selection)
            .map(id => this.elements.find(e => e.id === id))
            .filter(e => e && !e.locked);
        if (!els.length) return;
        const boxes = new Map(els.map(e => [e.id, this.worldAABB(e)]));

        let bounds;
        if (els.length === 1) {
            const ab = this.owningArtboard(els[0]);
            if (!ab) return;
            bounds = ab.marginEnabled
                ? { minX: ab.x + ab.marginLeft, minY: ab.y + ab.marginTop, maxX: ab.x + ab.w - ab.marginRight, maxY: ab.y + ab.h - ab.marginBottom }
                : { minX: ab.x, minY: ab.y, maxX: ab.x + ab.w, maxY: ab.y + ab.h };
        } else {
            bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
            boxes.forEach(b => {
                bounds.minX = Math.min(bounds.minX, b.left); bounds.minY = Math.min(bounds.minY, b.top);
                bounds.maxX = Math.max(bounds.maxX, b.left + b.width); bounds.maxY = Math.max(bounds.maxY, b.top + b.height);
            });
        }
        const centerX = (bounds.minX + bounds.maxX) / 2, centerY = (bounds.minY + bounds.maxY) / 2;
        els.forEach(e => {
            const b = boxes.get(e.id);
            let dx = 0, dy = 0;
            if (mode === 'left') dx = bounds.minX - b.left;
            if (mode === 'center') dx = centerX - (b.left + b.width / 2);
            if (mode === 'right') dx = bounds.maxX - (b.left + b.width);
            if (mode === 'top') dy = bounds.minY - b.top;
            if (mode === 'middle') dy = centerY - (b.top + b.height / 2);
            if (mode === 'bottom') dy = bounds.maxY - (b.top + b.height);
            e.x += dx; e.y += dy;
            this.applyElementStyles(e);
        });
        this.renderGizmo(); this.refreshPanelValues(); this.markDirty();
    }

    distributeElements(axis) {
        const els = Array.from(this.selection)
            .map(id => this.elements.find(e => e.id === id))
            .filter(e => e && !e.locked);
        if (els.length < 3) return;
        const boxes = new Map(els.map(e => [e.id, this.worldAABB(e)]));
        const key = axis === 'h' ? 'left' : 'top';
        const size = axis === 'h' ? 'width' : 'height';
        els.sort((a, b) => boxes.get(a.id)[key] - boxes.get(b.id)[key]);
        const first = boxes.get(els[0].id), last = boxes.get(els[els.length - 1].id);
        const total = els.reduce((sum, e) => sum + boxes.get(e.id)[size], 0);
        const gap = ((last[key] + last[size]) - first[key] - total) / (els.length - 1);
        let cursor = first[key] + first[size] + gap;
        els.slice(1, -1).forEach(e => {
            const b = boxes.get(e.id);
            if (axis === 'h') e.x += cursor - b.left; else e.y += cursor - b.top;
            cursor += b[size] + gap;
            this.applyElementStyles(e);
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

    // --- Units & measurement -------------------------------------------------------
    // Geometry is always stored in px; units are a pure display/input layer,
    // so switching units never changes the actual document size. Print units
    // convert through the document resolution (PPI).
    unitFactor(unit) {
        // inches per 1 unit
        return {
            in: 1, ft: 12, yd: 36,
            mm: 1 / 25.4, cm: 1 / 2.54, m: 39.37007874,
            pt: 1 / 72, pc: 1 / 6
        }[unit] || null;
    }

    docUnit() { return (this.documentSettings && this.documentSettings.unit) || 'px'; }
    docResolution() { return (this.documentSettings && this.documentSettings.resolution) || 96; }

    pxToUnit(px) {
        const f = this.unitFactor(this.docUnit());
        return f ? px / this.docResolution() / f : px;
    }

    unitToPx(v) {
        const f = this.unitFactor(this.docUnit());
        return f ? v * f * this.docResolution() : v;
    }

    // "689" (px) or "24.5" (print units, trimmed to 2 decimals)
    fmtDim(px) {
        const v = this.pxToUnit(px);
        return this.docUnit() === 'px' ? String(Math.round(v)) : String(parseFloat(v.toFixed(2)));
    }

    fmtSize(wPx, hPx) {
        return `${this.fmtDim(wPx)} × ${this.fmtDim(hPx)} ${this.docUnit()}`;
    }

    setDocumentUnit(unit) {
        if (!this.documentSettings) this.documentSettings = {};
        this.documentSettings.unit = unit;
        this.updatePropPanel();
        this.markDirty();
    }

    setDocumentResolution(res) {
        if (!this.documentSettings) this.documentSettings = {};
        this.documentSettings.resolution = Math.max(1, parseFloat(res) || 96);
        this.updatePropPanel();
        this.markDirty();
    }

    // --- Live measurement HUD -------------------------------------------------------
    ensureHud() {
        if (!this._hud) {
            this._hud = document.createElement('div');
            this._hud.id = 'size-hud';
            document.body.appendChild(this._hud);
        }
        return this._hud;
    }

    showHud(text, clientX, clientY) {
        const hud = this.ensureHud();
        clearTimeout(this._hudTimer);
        hud.textContent = text;
        hud.style.display = 'block';
        hud.style.left = Math.min(clientX + 14, window.innerWidth - 120) + 'px';
        hud.style.top = Math.min(clientY + 18, window.innerHeight - 30) + 'px';
    }

    hideHud() {
        clearTimeout(this._hudTimer);
        if (this._hud) this._hud.style.display = 'none';
    }

    flashHud(text, clientX, clientY, ms = 900) {
        this.showHud(text, clientX, clientY);
        this._hudTimer = setTimeout(() => this.hideHud(), ms);
    }

    // --- Persistence hooks -----------------------------------------------------
    // Every mutation funnels through markDirty, which makes it the natural
    // checkpoint for undo history as well as the debounced autosave.
    markDirty() {
        if (!this._restoring) this.pushHistory();
        this.scheduleSave();
    }

    scheduleSave() {
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

    // --- Undo / redo -------------------------------------------------------------
    captureSnapshot() {
        return JSON.stringify({
            artboards: this.artboards,
            elements: this.elements,
            swatches: this.swatches,
            guides: this.guides
        });
    }

    resetHistory() {
        this.history = [this.captureSnapshot()];
        this.historyIndex = 0;
    }

    pushHistory() {
        const snap = this.captureSnapshot();
        if (this.history[this.historyIndex] === snap) return;
        this.history.length = this.historyIndex + 1; // drop any redo tail
        this.history.push(snap);
        if (this.history.length > this.historyLimit) this.history.shift();
        this.historyIndex = this.history.length - 1;
    }

    undo() {
        if (this.historyIndex <= 0) return;
        this.historyIndex--;
        this.applySnapshot(JSON.parse(this.history[this.historyIndex]));
        this.scheduleSave();
        this.hideContextMenu();
    }

    redo() {
        if (this.historyIndex >= this.history.length - 1) return;
        this.historyIndex++;
        this.applySnapshot(JSON.parse(this.history[this.historyIndex]));
        this.scheduleSave();
        this.hideContextMenu();
    }

    // Rebuilds the workspace from a history snapshot without touching history.
    applySnapshot(data) {
        this._restoring = true;
        const prevActive = this.activeArtboardId;
        this.setSelection([]);
        this.cancelPen();
        this.elements.forEach(el => document.getElementById(el.id)?.remove());
        this.artboards.forEach(ab => {
            document.getElementById(ab.id)?.remove();
            document.getElementById(ab.id + '_label')?.remove();
        });
        this.artboards = [];
        this.elements = [];
        (data.artboards || []).forEach(ab => this.createArtboard(ab));
        // Build elements parents-first so group containers exist before children.
        const pending = (data.elements || []).slice();
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
        this.guides = data.guides || [];
        this.renderGuides();
        this.activeArtboardId = this.artboards.find(a => a.id === prevActive)
            ? prevActive : (this.artboards[0]?.id || null);
        this.renderLayersPanel();
        this.updatePropPanel();
        this._restoring = false;
    }
}
