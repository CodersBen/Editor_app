// Drafting aids: draggable rulers & custom guides, square / isometric /
// baseline grids, and smart magnetic snapping.
Object.assign(MiniCanva.prototype, {

    initDrafting() {
        this.rulerTop = document.getElementById('ruler-top');
        this.rulerLeft = document.getElementById('ruler-left');
        this.gridCanvas = document.getElementById('grid-canvas');

        // Dragging out of a ruler creates a guide.
        this.rulerTop.addEventListener('mousedown', (e) => this.beginGuideCreate(e, 'h'));
        this.rulerLeft.addEventListener('mousedown', (e) => this.beginGuideCreate(e, 'v'));

        this.resizeOverlays();
    },

    resizeOverlays() {
        const fit = (cnv, w, h) => { if (cnv) { cnv.width = w; cnv.height = h; } };
        fit(this.rulerTop, this.rulerTop?.clientWidth || 0, this.rulerTop?.clientHeight || 0);
        fit(this.rulerLeft, this.rulerLeft?.clientWidth || 0, this.rulerLeft?.clientHeight || 0);
        fit(this.gridCanvas, this.viewport.clientWidth, this.viewport.clientHeight);
        this.drawRulers();
        this.drawGrid();
    },

    rulerStep() {
        const target = 80 / this.scale; // aim for a major tick every ~80 screen px
        const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
        return steps.find(s => s >= target) || 5000;
    },

    drawRulers() {
        if (!this.rulerTop || !this.rulerTop.width) return;
        const style = getComputedStyle(document.documentElement);
        const bg = style.getPropertyValue('--bg-1').trim() || '#16161a';
        const fg = style.getPropertyValue('--text-3').trim() || '#6c6c76';
        const step = this.rulerStep();

        const drawAxis = (cnv, horizontal) => {
            const ctx = cnv.getContext('2d');
            ctx.clearRect(0, 0, cnv.width, cnv.height);
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, cnv.width, cnv.height);
            ctx.strokeStyle = fg; ctx.fillStyle = fg;
            ctx.font = '9px ui-monospace, monospace';
            ctx.lineWidth = 1;
            const pan = horizontal ? this.panX : this.panY;
            const len = horizontal ? cnv.width : cnv.height;
            const start = Math.floor((-pan / this.scale) / step) * step;
            const end = (len - pan) / this.scale;
            ctx.beginPath();
            for (let v = start; v <= end; v += step) {
                const s = v * this.scale + pan;
                if (horizontal) {
                    ctx.moveTo(s + 0.5, 14); ctx.lineTo(s + 0.5, 24);
                    ctx.fillText(String(v), s + 3, 10);
                } else {
                    ctx.moveTo(14, s + 0.5); ctx.lineTo(24, s + 0.5);
                    ctx.save();
                    ctx.translate(9, s + 3);
                    ctx.rotate(-Math.PI / 2);
                    ctx.fillText(String(v), -ctx.measureText(String(v)).width, 0);
                    ctx.restore();
                }
                // minor ticks
                for (let m = 1; m < 4; m++) {
                    const ms = (v + step * m / 4) * this.scale + pan;
                    if (horizontal) { ctx.moveTo(ms + 0.5, 19); ctx.lineTo(ms + 0.5, 24); }
                    else { ctx.moveTo(19, ms + 0.5); ctx.lineTo(24, ms + 0.5); }
                }
            }
            ctx.stroke();
        };
        drawAxis(this.rulerTop, true);
        drawAxis(this.rulerLeft, false);
    },

    setGridMode(mode) {
        this.gridMode = mode;
        const sel = document.getElementById('grid-mode');
        if (sel && sel.value !== mode) sel.value = mode;
        this.drawGrid();
        this.markDirty();
    },

    drawGrid() {
        const cnv = this.gridCanvas;
        if (!cnv || !cnv.width) return;
        const ctx = cnv.getContext('2d');
        ctx.clearRect(0, 0, cnv.width, cnv.height);
        if (this.gridMode === 'none') return;

        ctx.lineWidth = 1;
        const w = cnv.width, h = cnv.height;

        if (this.gridMode === 'square') {
            const s = this.gridSize * this.scale;
            if (s < 4) return;
            ctx.strokeStyle = 'rgba(139, 92, 246, 0.12)';
            ctx.beginPath();
            for (let x = this.panX % s; x < w; x += s) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
            for (let y = this.panY % s; y < h; y += s) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
            ctx.stroke();
        } else if (this.gridMode === 'isometric') {
            const s = this.gridSize * 2 * this.scale;
            if (s < 6) return;
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
            ctx.beginPath();
            const slope = Math.tan(Math.PI / 6); // 30°
            const dxAcross = h / slope;
            const spacingX = s / Math.sin(Math.PI / 6) / 2;
            for (let x = (this.panX % spacingX) - dxAcross; x < w + dxAcross; x += spacingX) {
                ctx.moveTo(x, 0); ctx.lineTo(x + dxAcross, h);   // down-right 30°
                ctx.moveTo(x, 0); ctx.lineTo(x - dxAcross, h);   // down-left 30°
            }
            for (let x = this.panX % spacingX; x < w; x += spacingX) {
                ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h);  // verticals
            }
            ctx.stroke();
        } else if (this.gridMode === 'baseline') {
            const s = this.baselineSize * this.scale;
            if (s < 4) return;
            ctx.strokeStyle = 'rgba(248, 113, 113, 0.14)';
            ctx.beginPath();
            for (let y = this.panY % s; y < h; y += s) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
            ctx.stroke();
        }
    },

    toggleSnap() {
        this.snapEnabled = !this.snapEnabled;
        document.getElementById('snap-btn')?.classList.toggle('toggled', this.snapEnabled);
    },

    // --- Guides -----------------------------------------------------------------
    beginGuideCreate(e, axis) {
        e.preventDefault();
        const id = 'guide_' + Date.now();
        const p = this.worldPoint(e);
        this.guides.push({ id, axis, pos: axis === 'v' ? p.x : p.y });
        this.renderGuides();
        this.mode = 'guide-create';
        this.startState = { guideId: id };
    },

    moveGuide(e) {
        const g = this.guides.find(x => x.id === this.startState.guideId);
        if (!g) return;
        const p = this.worldPoint(e);
        g.pos = g.axis === 'v' ? p.x : p.y;
        this.renderGuides();
    },

    finishGuideCreate(e) {
        // Dropping a guide back over its ruler discards it.
        const r = this.viewport.getBoundingClientRect();
        if (e.clientX < r.left || e.clientY < r.top) {
            this.guides = this.guides.filter(g => g.id !== this.startState.guideId);
            this.renderGuides();
        }
        this.markDirty();
    },

    removeGuide(id) {
        this.guides = this.guides.filter(g => g.id !== id);
        this.renderGuides();
        this.markDirty();
    },

    clearAllGuides() {
        if (!this.guides.length) return;
        this.guides = [];
        this.renderGuides();
        this.markDirty();
    },

    renderGuides() {
        this.guideLayer.querySelectorAll('.guide-line').forEach(n => n.remove());
        this.guides.forEach(g => {
            const line = document.createElement('div');
            line.className = 'guide-line ' + g.axis;
            line.dataset.guideId = g.id;
            line.title = 'Drag to move — double-click to remove';
            if (g.axis === 'v') line.style.left = g.pos + 'px';
            else line.style.top = g.pos + 'px';
            this.guideLayer.appendChild(line);
        });
    },

    // --- Magnetic snapping ---------------------------------------------------------
    // Snaps the dragged selection's union AABB (edges + centers) to guides,
    // other objects' edges & centers (smart guides), the active grid, and
    // artboard edges & margins.
    applyDragSnap(dx, dy) {
        if (!this.snapEnabled || this.startState.elements.length === 0) return { dx, dy };

        // Proposed union AABB of everything being dragged, at this delta.
        const draggedIds = new Set(this.startState.elements.map(it => it.id));
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.startState.elements.forEach(item => {
            const el = this.elements.find(x => x.id === item.id);
            if (!el) return;
            const origin = this.parentGlobalOrigin(el.parentId);
            const b = this.rectAABB(origin.x + item.x + dx, origin.y + item.y + dy, el.w, el.h, el.rotation || 0);
            minX = Math.min(minX, b.left); minY = Math.min(minY, b.top);
            maxX = Math.max(maxX, b.left + b.width); maxY = Math.max(maxY, b.top + b.height);
        });
        if (!Number.isFinite(minX)) return { dx, dy };
        const candX = [minX, (minX + maxX) / 2, maxX];
        const candY = [minY, (minY + maxY) / 2, maxY];
        const gx = minX, gy = minY;

        const targetsX = this.guides.filter(g => g.axis === 'v').map(g => g.pos);
        const targetsY = this.guides.filter(g => g.axis === 'h').map(g => g.pos);
        this.artboards.forEach(a => {
            targetsX.push(a.x, a.x + a.w, a.x + a.w / 2);
            targetsY.push(a.y, a.y + a.h, a.y + a.h / 2);
            if (a.marginEnabled) {
                targetsX.push(a.x + a.marginLeft, a.x + a.w - a.marginRight);
                targetsY.push(a.y + a.marginTop, a.y + a.h - a.marginBottom);
            }
        });
        // Other objects: edges and centers of every visible top-level element
        // not taking part in the drag.
        this.elements.forEach(el => {
            if (draggedIds.has(el.id) || el.visible === false) return;
            const pid = el.parentId;
            if (pid !== 'workspace' && !(pid && pid.startsWith('ab_'))) return;
            const b = this.worldAABB(el);
            targetsX.push(b.left, b.left + b.width / 2, b.left + b.width);
            targetsY.push(b.top, b.top + b.height / 2, b.top + b.height);
        });

        const th = this.snapThreshold / this.scale;
        let bestX = null, bestY = null;

        const consider = (cands, targets, setter) => {
            let best = null;
            cands.forEach(c => {
                targets.forEach(t => {
                    const d = t - c;
                    if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t };
                });
            });
            return best;
        };
        bestX = consider(candX, targetsX);
        bestY = consider(candY, targetsY);

        // Grid snapping (square grid: both axes; baseline: Y only).
        if (this.gridMode === 'square' || this.gridMode === 'baseline') {
            const size = this.gridMode === 'square' ? this.gridSize : this.baselineSize;
            const snapGrid = (v) => {
                const t = Math.round(v / size) * size;
                return Math.abs(t - v) <= th ? { d: t - v, t } : null;
            };
            if (this.gridMode === 'square' && !bestX) bestX = snapGrid(gx);
            if (!bestY) bestY = snapGrid(gy);
        }

        this.clearSnapFlash();
        if (bestX) { dx += bestX.d; this.showSnapFlash('v', bestX.t); }
        if (bestY) { dy += bestY.d; this.showSnapFlash('h', bestY.t); }
        return { dx, dy };
    },

    showSnapFlash(axis, pos) {
        const f = document.createElement('div');
        f.className = 'snap-flash';
        if (axis === 'v') Object.assign(f.style, { left: pos + 'px', top: '-1000000px', width: 1 / this.scale + 'px', height: '2000000px' });
        else Object.assign(f.style, { top: pos + 'px', left: '-1000000px', height: 1 / this.scale + 'px', width: '2000000px' });
        this.guideLayer.appendChild(f);
    },

    clearSnapFlash() {
        this.guideLayer.querySelectorAll('.snap-flash').forEach(n => n.remove());
    }
});
