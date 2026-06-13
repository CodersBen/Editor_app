// Vector & node editing: pen tool (bezier paths), direct selection,
// pathfinder boolean operations, and clipping / inverted masks.
Object.assign(MiniCanva.prototype, {

    // --- Path geometry -----------------------------------------------------
    // Points are stored in percentages of the element box so paths scale
    // freely. Sharp corners (no handles, straight neighbors) may carry a
    // per-point radius `r` (px) rendered as a rounded join — smooth/Bézier
    // points never round.
    roundableCorner(P, i, closed) {
        const n = P.length;
        const p = P[i];
        if (!p.r || p.hi || p.ho) return null;
        if (!closed && (i === 0 || i === n - 1)) return null;
        const a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
        if (a.ho || b.hi) return null;
        const vIn = { x: p.x - a.x, y: p.y - a.y };
        const vOut = { x: b.x - p.x, y: b.y - p.y };
        const lIn = Math.hypot(vIn.x, vIn.y), lOut = Math.hypot(vOut.x, vOut.y);
        if (lIn < 0.01 || lOut < 0.01) return null;
        const t = Math.min(p.r, lIn / 2, lOut / 2);
        if (t < 0.01) return null;
        return {
            entry: { x: p.x - vIn.x / lIn * t, y: p.y - vIn.y / lIn * t },
            exit: { x: p.x + vOut.x / lOut * t, y: p.y + vOut.y / lOut * t }
        };
    },

    pathD(points, closed, w, h) {
        if (!points || !points.length) return '';
        const n = points.length;
        const P = points.map(p => ({
            x: p.x / 100 * w, y: p.y / 100 * h,
            hi: p.hi ? { x: p.hi.x / 100 * w, y: p.hi.y / 100 * h } : null,
            ho: p.ho ? { x: p.ho.x / 100 * w, y: p.ho.y / 100 * h } : null,
            r: p.r || 0
        }));
        const pt = q => `${q.x.toFixed(2)} ${q.y.toFixed(2)}`;
        const R = P.map((_, i) => this.roundableCorner(P, i, closed));

        let d = `M ${pt(closed && R[0] ? R[0].exit : P[0])}`;
        const segCount = closed ? n : n - 1;
        for (let s = 0; s < segCount; s++) {
            const i = s, j = (s + 1) % n;
            const a = P[i], b = P[j];
            if (a.ho || b.hi) {
                d += ` C ${pt(a.ho || a)}, ${pt(b.hi || b)}, ${pt(b)}`;
            } else if (R[j]) {
                // Straight run into a rounded corner: line to the entry point,
                // quadratic through the corner to the exit point.
                d += ` L ${pt(R[j].entry)} Q ${pt(b)} ${pt(R[j].exit)}`;
            } else {
                d += ` L ${pt(b)}`;
            }
        }
        if (closed && n > 2) d += ' Z';
        return d;
    },

    // Interior parameter values where a cubic Bézier reaches an extremum on
    // one axis (roots of the derivative, a quadratic in t).
    bezierAxisExtrema(p0, p1, p2, p3) {
        const d0 = p1 - p0, d1 = p2 - p1, d2 = p3 - p2;
        const a = d0 - 2 * d1 + d2, b = 2 * (d1 - d0), c = d0;
        const ts = [];
        if (Math.abs(a) < 1e-9) {
            if (Math.abs(b) > 1e-9) ts.push(-c / b);
        } else {
            const disc = b * b - 4 * a * c;
            if (disc >= 0) {
                const sq = Math.sqrt(disc);
                ts.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
            }
        }
        return ts.filter(t => t > 1e-6 && t < 1 - 1e-6);
    },

    // True visual bounds of a path: anchors plus the curve extrema of every
    // segment — control handles themselves do NOT inflate the box.
    tightPathBounds(pts, closed) {
        if (!pts || !pts.length) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const include = (x, y) => {
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        };
        pts.forEach(p => include(p.x, p.y));
        const evalB = (p0, p1, p2, p3, t) => {
            const mt = 1 - t;
            return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
        };
        const segs = [];
        for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
        if (closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
        segs.forEach(([a, b]) => {
            const c1 = a.ho || a, c2 = b.hi || b;
            this.bezierAxisExtrema(a.x, c1.x, c2.x, b.x).forEach(t => include(evalB(a.x, c1.x, c2.x, b.x, t), evalB(a.y, c1.y, c2.y, b.y, t)));
            this.bezierAxisExtrema(a.y, c1.y, c2.y, b.y).forEach(t => include(evalB(a.x, c1.x, c2.x, b.x, t), evalB(a.y, c1.y, c2.y, b.y, t)));
        });
        return { minX, minY, maxX, maxY };
    },

    // Refits the element box to the path's true curve bounds (e.g. after node
    // or handle edits) and re-normalizes the percent-based points so the
    // geometry doesn't move on screen — rotation-safe (pivots about center).
    refitPathBounds(el) {
        if (el.type !== 'path' || !el.points || !el.points.length) return;
        const toPx = q => q ? { x: q.x / 100 * el.w, y: q.y / 100 * el.h } : null;
        const pts = el.points.map(p => Object.assign(toPx(p), { hi: toPx(p.hi), ho: toPx(p.ho) }));
        const b = this.tightPathBounds(pts, el.closed);
        if (!b) return;
        const bw = Math.max(1, b.maxX - b.minX), bh = Math.max(1, b.maxY - b.minY);
        if (Math.abs(b.minX) < 0.01 && Math.abs(b.minY) < 0.01
            && Math.abs(bw - el.w) < 0.01 && Math.abs(bh - el.h) < 0.01) return;

        // Keep the world position stable: the box center moves in local space,
        // and rotation happens about the center, so rotate the center shift.
        const rad = (el.rotation || 0) * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const dxLocal = (b.minX + bw / 2) - el.w / 2;
        const dyLocal = (b.minY + bh / 2) - el.h / 2;
        el.x += el.w / 2 + (dxLocal * cos - dyLocal * sin) - bw / 2;
        el.y += el.h / 2 + (dxLocal * sin + dyLocal * cos) - bh / 2;
        el.w = bw; el.h = bh;

        const conv = c => c ? { x: (c.x - b.minX) / bw * 100, y: (c.y - b.minY) / bh * 100 } : null;
        el.points = pts.map((q, i) => Object.assign(conv(q), {
            hi: conv(q.hi), ho: conv(q.ho),
            r: el.points[i] && el.points[i].r ? el.points[i].r : undefined
        }));
        this.applyElementStyles(el);
    },

    renderPathSvg(el, dom) {
        const svg = dom.querySelector('svg');
        if (!svg) return;
        const w = Math.max(1, el.w), h = Math.max(1, el.h);
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        const d = this.pathD(el.points, el.closed, w, h);
        const a = el.appearance || this.defaultAppearance();
        const parts = [];

        // Block-shadow extrudes: hard-edged translated copies behind the fill.
        (a.extrudes || []).forEach(x => {
            const ex = x.x || 0, ey = x.y || 0;
            const steps = Math.min(80, Math.max(Math.abs(ex), Math.abs(ey), 1));
            for (let i = steps; i >= 1; i--) {
                parts.push(`<path d="${d}" transform="translate(${(ex * i / steps).toFixed(2)},${(ey * i / steps).toFixed(2)})" fill="${x.color}"/>`);
            }
        });

        const strokes = (a.strokes || []).filter(s => (s.width || 0) > 0);

        if (!el.closed) {
            // Open path: inside/outside alignment is meaningless and the
            // doubled-width + fill-overdraw trick breaks down — the implicit
            // fill region closes along the endpoint chord, so wherever the
            // curve crosses that chord the covered half flips (a visible
            // "slice"). Plain centered strokes render a continuous line.
            if (el.fillEnabled !== false) parts.push(`<path d="${d}" fill="${el.bgColor}"/>`);
            strokes.forEach(s => {
                parts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-linejoin="round" stroke-linecap="round"/>`);
            });
        } else {
            // Outside strokes: cumulative rings painted behind the fill (widest first).
            const outRings = [];
            let cum = 0;
            strokes.filter(s => s.align !== 'inside').forEach(s => {
                cum += s.align === 'center' ? s.width / 2 : s.width;
                outRings.push({ width: cum * 2, color: s.color });
            });
            outRings.reverse().forEach(r => {
                parts.push(`<path d="${d}" fill="none" stroke="${r.color}" stroke-width="${r.width}" stroke-linejoin="round" stroke-linecap="round"/>`);
            });

            // No Fill: interior disappears AND stops hit-testing — clicks pass
            // through to whatever is underneath; strokes remain clickable.
            parts.push(`<path d="${d}" fill="${el.fillEnabled === false ? 'none' : el.bgColor}"/>`);

            // Inside strokes: doubled-width strokes clipped to the shape, on top.
            const inRings = [];
            let icum = 0;
            strokes.filter(s => s.align !== 'outside').forEach(s => {
                icum += s.align === 'center' ? s.width / 2 : s.width;
                inRings.push({ width: icum * 2, color: s.color });
            });
            if (inRings.length) {
                const clipId = 'clip_' + el.id;
                parts.push(`<defs><clipPath id="${clipId}"><path d="${d}"/></clipPath></defs>`);
                inRings.reverse().forEach(r => {
                    parts.push(`<path d="${d}" fill="none" stroke="${r.color}" stroke-width="${r.width}" clip-path="url(#${clipId})"/>`);
                });
            }
        }

        svg.innerHTML = parts.join('');
        dom.style.filter = this.dropShadowFilter(el);
        dom.style.backgroundColor = 'transparent';
    },

    // --- Pen tool ------------------------------------------------------------
    // Snap targets while drawing: anchors and endpoints of existing paths,
    // shape corners (point targets), guides and artboard edges (axis targets),
    // and grid intersections.
    penSnapCandidates() {
        const pts = [], vx = [], hy = [];
        this.elements.forEach(el => {
            if (el.visible === false) return;
            const b = this.getGlobalBounds(el);
            const rad = (el.rotation || 0) * Math.PI / 180;
            const cos = Math.cos(rad), sin = Math.sin(rad);
            const cx = b.left + el.w / 2, cy = b.top + el.h / 2;
            const toWorld = (lx, ly) => {
                const ox = lx - el.w / 2, oy = ly - el.h / 2;
                return { x: cx + ox * cos - oy * sin, y: cy + ox * sin + oy * cos };
            };
            if (el.type === 'path' && el.points) {
                el.points.forEach((p, i) => {
                    const w = toWorld(p.x / 100 * el.w, p.y / 100 * el.h);
                    const endpoint = !el.closed && (i === 0 || i === el.points.length - 1);
                    pts.push({ x: w.x, y: w.y, kind: endpoint ? 'endpoint' : 'anchor' });
                });
            } else if (['rect', 'image', 'bool'].includes(el.type)) {
                [[0, 0], [el.w, 0], [el.w, el.h], [0, el.h]].forEach(([lx, ly]) => {
                    const w = toWorld(lx, ly);
                    pts.push({ x: w.x, y: w.y, kind: 'corner' });
                });
            }
        });
        this.guides.forEach(g => (g.axis === 'v' ? vx : hy).push(g.pos));
        this.artboards.forEach(a => { vx.push(a.x, a.x + a.w); hy.push(a.y, a.y + a.h); });
        return { pts, vx, hy };
    },

    penSnap(p) {
        this.penSnapTarget = null;
        if (!this.snapEnabled) return p;
        const th = 7 / this.scale;
        const { pts, vx, hy } = this.penSnapCandidates();
        let best = null;
        pts.forEach(t => {
            const d = Math.hypot(t.x - p.x, t.y - p.y);
            if (d <= th && (!best || d < best.d)) best = { x: t.x, y: t.y, kind: t.kind, d };
        });
        if (best) { this.penSnapTarget = best; return { x: best.x, y: best.y }; }
        let sx = null, sy = null;
        vx.forEach(x => { const d = Math.abs(x - p.x); if (d <= th && (!sx || d < sx.d)) sx = { x, d }; });
        hy.forEach(y => { const d = Math.abs(y - p.y); if (d <= th && (!sy || d < sy.d)) sy = { y, d }; });
        const out = { x: sx ? sx.x : p.x, y: sy ? sy.y : p.y };
        if (this.gridMode === 'square' && this.gridSize >= 2) {
            const gx = Math.round(p.x / this.gridSize) * this.gridSize;
            const gy = Math.round(p.y / this.gridSize) * this.gridSize;
            if (!sx && Math.abs(gx - p.x) <= th) { out.x = gx; sx = { x: gx }; }
            if (!sy && Math.abs(gy - p.y) <= th) { out.y = gy; sy = { y: gy }; }
        }
        if (sx || sy) this.penSnapTarget = { x: out.x, y: out.y, kind: 'line' };
        return out;
    },

    // Draft-level history: every completed pen action (anchor added, handles
    // dragged, corner converted) is one undo step, so Ctrl+Z walks the path
    // back point by point instead of deleting it wholesale.
    penCommit() {
        if (!this.penDraft) return;
        this.penHistory = this.penHistory || [];
        const snap = JSON.stringify(this.penDraft.points);
        if (this.penHistory[this.penHistory.length - 1] === snap) return;
        this.penHistory.push(snap);
        this.penRedoStack = [];
    },

    penUndo() {
        if (!this.penDraft || !this.penHistory || !this.penHistory.length) return;
        this.penRedoStack = this.penRedoStack || [];
        this.penRedoStack.push(this.penHistory.pop());
        const prev = this.penHistory[this.penHistory.length - 1];
        if (!prev) { const redo = this.penRedoStack; this.cancelPen(); this.penRedoStack = redo; return; }
        this.penDraft.points = JSON.parse(prev);
        this.renderPenPreview();
    },

    penRedo() {
        if (!this.penRedoStack || !this.penRedoStack.length) return;
        const snap = this.penRedoStack.pop();
        if (!this.penDraft) this.penDraft = { points: [], closed: false };
        this.penHistory = this.penHistory || [];
        this.penHistory.push(snap);
        this.penDraft.points = JSON.parse(snap);
        this.renderPenPreview();
    },

    penMouseDown(e) {
        const raw = this.worldPoint(e);
        if (!this.penDraft) this.penDraft = { points: [], closed: false };
        const pts = this.penDraft.points;
        const first = pts[0];
        const last = pts[pts.length - 1];

        // Alt+click on the last anchor: convert to a corner point — the
        // out-handle is dropped so the next segment leaves straight, while the
        // incoming curve keeps its shape.
        if (e.altKey && last && Math.hypot(raw.x - last.x, raw.y - last.y) < 8 / this.scale) {
            last.ho = null;
            this.penCommit();
            this.renderPenPreview(raw);
            return;
        }

        if (first && pts.length > 2 &&
            Math.hypot(raw.x - first.x, raw.y - first.y) < 8 / this.scale) {
            // Closing click: hold and drag to shape the closing curve; the
            // path is committed on release.
            this.penDraft.closed = true;
            this.penDraft.closing = true;
            this.mode = 'pen-drag';
            this.renderPenPreview(raw);
            return;
        }
        const p = this.penSnap(raw);
        pts.push({ x: p.x, y: p.y, hi: null, ho: null });
        this.penCommit();
        this.mode = 'pen-drag';
        this.renderPenPreview(p);
    },

    penMouseMove(e) {
        if (!this.penDraft) return;
        let p = this.worldPoint(e);
        const pts = this.penDraft.points;
        const first = pts[0];
        this.penCloseReady = !!(first && pts.length > 2 && !this.penDraft.closing &&
            Math.hypot(p.x - first.x, p.y - first.y) < 10 / this.scale);
        if (this.mode === 'pen-drag') {
            this.penSnapTarget = null;
            if (this.penDraft.closing) {
                // Shaping the close: only the closing segment's incoming handle
                // moves — the first anchor's out-handle (and with it the path's
                // opening segment) stays exactly as drawn.
                if (Math.hypot(p.x - first.x, p.y - first.y) > 2 / this.scale) {
                    first.hi = { x: 2 * first.x - p.x, y: 2 * first.y - p.y };
                }
            } else {
                // Dragging after placing an anchor pulls out symmetric handles.
                const pt = pts[pts.length - 1];
                if (Math.hypot(p.x - pt.x, p.y - pt.y) > 2 / this.scale) {
                    pt.ho = { x: p.x, y: p.y };
                    pt.hi = { x: 2 * pt.x - p.x, y: 2 * pt.y - p.y };
                } else {
                    pt.ho = null; pt.hi = null;
                }
            }
        } else if (!this.penCloseReady) {
            p = this.penSnap(p); // snapped rubber-band target preview
        }
        this.renderPenPreview(p);
    },

    penMouseUp() {
        if (this.penDraft && this.penDraft.closing) { this.finishPen(true); return; }
        this.penCommit();
        this.renderPenPreview();
    },

    renderPenPreview(cursor) {
        const svg = document.getElementById('pen-preview');
        if (!svg) return;
        if (!this.penDraft || !this.penDraft.points.length) { svg.innerHTML = ''; return; }
        const pts = this.penDraft.points;
        const px = p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
        let d = `M ${px(pts[0])}`;
        for (let i = 1; i < pts.length; i++) {
            d += ` C ${px(pts[i - 1].ho || pts[i - 1])}, ${px(pts[i].hi || pts[i])}, ${px(pts[i])}`;
        }
        // While close-dragging, render the closing segment so the curve being
        // shaped is visible before release commits it.
        if (this.penDraft.closing && pts.length > 2) {
            const a = pts[pts.length - 1], b = pts[0];
            d += ` C ${px(a.ho || a)}, ${px(b.hi || b)}, ${px(b)} Z`;
        }
        let rubber = '';
        if (cursor && this.mode !== 'pen-drag') {
            const last = pts[pts.length - 1];
            const target = this.penCloseReady ? pts[0] : cursor;
            // Preview the actual prospective segment: a cubic that leaves the
            // last anchor along its out-handle — not a straight line.
            const c1 = last.ho || last;
            const c2 = target.hi || target;
            rubber = `<path d="M ${px(last)} C ${px(c1)}, ${px(c2)}, ${px(target)}" stroke="${this.penCloseReady ? 'var(--accent)' : 'var(--guide-color)'}" stroke-width="${1 / this.scale}" stroke-dasharray="4 3" fill="none"/>`;
        }
        const dots = pts.map((p, i) =>
            `<circle cx="${p.x}" cy="${p.y}" r="${(this.penCloseReady && i === 0 ? 6 : 3) / this.scale}" fill="${this.penCloseReady && i === 0 ? 'var(--accent)' : '#fff'}" stroke="var(--vertex-color)" stroke-width="${1 / this.scale}"/>`).join('');
        const handles = pts.filter(p => p.ho).map(p =>
            `<path d="M ${px(p.hi)} L ${px(p)} L ${px(p.ho)}" stroke="var(--vertex-color)" stroke-width="${1 / this.scale}" fill="none"/>`).join('');
        // Snap indicator: ring on point targets (anchor/endpoint/corner),
        // crosshair on axis targets (guide/edge/grid).
        let snapMark = '';
        const t = this.penSnapTarget;
        if (t && this.mode !== 'pen-drag') {
            if (t.kind === 'line') {
                const s = 6 / this.scale;
                snapMark = `<path d="M ${t.x - s} ${t.y} H ${t.x + s} M ${t.x} ${t.y - s} V ${t.y + s}" stroke="var(--accent)" stroke-width="${1.5 / this.scale}"/>`;
            } else {
                snapMark = `<circle cx="${t.x}" cy="${t.y}" r="${(t.kind === 'endpoint' ? 7 : 5.5) / this.scale}" fill="none" stroke="var(--accent)" stroke-width="${1.5 / this.scale}"/>`;
            }
        }
        svg.innerHTML = `<path d="${d}" stroke="var(--selection-color)" stroke-width="${1.5 / this.scale}" fill="none"/>${rubber}${handles}${dots}${snapMark}`;
    },

    finishPen(closed) {
        const draft = this.penDraft;
        this.penDraft = null;
        this.penHistory = [];
        this.penRedoStack = [];
        this.penSnapTarget = null;
        const svg = document.getElementById('pen-preview');
        if (svg) svg.innerHTML = '';
        if (!draft || draft.points.length < 2) { this.setTool('select'); return; }

        // Tight box from true curve extrema — handles don't inflate the bounds.
        const tb = this.tightPathBounds(draft.points, draft.closed);
        const minX = tb.minX, minY = tb.minY;
        const w = Math.max(1, tb.maxX - tb.minX), h = Math.max(1, tb.maxY - tb.minY);
        const c = this.containerAtPoint(draft.points[0]);

        const norm = q => q ? { x: (q.x - minX) / w * 100, y: (q.y - minY) / h * 100 } : null;
        const el = this.createElementData('path', minX - c.x, minY - c.y, c.id);
        el.w = w; el.h = h;
        el.closed = !!(closed === true || draft.closed);
        el.points = draft.points.map(p => Object.assign(norm(p), { hi: norm(p.hi), ho: norm(p.ho) }));
        if (!el.closed) {
            // An unclosed pen path is a line: no fill (no chord-shaped blob),
            // visible through a default centered stroke instead.
            el.fillEnabled = false;
            if (!el.appearance) el.appearance = this.defaultAppearance();
            if (!el.appearance.strokes.length) {
                el.appearance.strokes.push({ width: 2, color: '#111111', align: 'center' });
            }
        }
        this.elements.push(el);
        this.buildElementDom(el);
        this.setTool('select');
        this.setSelection([el.id]);
        this.renderLayersPanel();
        this.markDirty();
    },

    cancelPen() {
        this.penDraft = null;
        this.penHistory = [];
        this.penRedoStack = [];
        this.penSnapTarget = null;
        const svg = document.getElementById('pen-preview');
        if (svg) svg.innerHTML = '';
    },

    // Double-clicking a vertex (direct selection tool) deletes the anchor and
    // auto-smooths the surviving neighbors so the joined segment stays curved.
    removeVertexAt(index) {
        const elId = Array.from(this.selection)[0];
        const el = this.elements.find(x => x.id === elId);
        if (!el || el.type !== 'path' || !el.points) return;
        if (index < 0 || index >= el.points.length) return;
        if (el.points.length <= (el.closed ? 3 : 2)) return;
        el.points.splice(index, 1);
        const n = el.points.length;
        let prev, next;
        if (el.closed) {
            prev = el.points[(index - 1 + n) % n];
            next = el.points[index % n];
        } else {
            prev = index > 0 ? el.points[index - 1] : null;
            next = index < n ? el.points[index] : null;
        }
        if (prev && next && prev !== next) {
            const dx = next.x - prev.x, dy = next.y - prev.y;
            if (!prev.ho) prev.ho = { x: prev.x + dx / 3, y: prev.y + dy / 3 };
            if (!next.hi) next.hi = { x: next.x - dx / 3, y: next.y - dy / 3 };
        }
        this.selectedVertex = -1;
        this.selectedVertices = new Set();
        this.refitPathBounds(el);
        this.renderGizmo();
        this.markDirty();
    },

    convertSelectedToPaths() {
        const converted = [];
        Array.from(this.selection).forEach(id => {
            const el = this.elements.find(e => e.id === id);
            if (!el || !['rect', 'circle'].includes(el.type)) return;
            if (el.type === 'rect') {
                el.points = [
                    { x: 0, y: 0, hi: null, ho: null },
                    { x: 100, y: 0, hi: null, ho: null },
                    { x: 100, y: 100, hi: null, ho: null },
                    { x: 0, y: 100, hi: null, ho: null }
                ];
            } else {
                const k = 55.22847498;
                el.points = [
                    { x: 50, y: 0, hi: { x: 50 - k / 2, y: 0 }, ho: { x: 50 + k / 2, y: 0 } },
                    { x: 100, y: 50, hi: { x: 100, y: 50 - k / 2 }, ho: { x: 100, y: 50 + k / 2 } },
                    { x: 50, y: 100, hi: { x: 50 + k / 2, y: 100 }, ho: { x: 50 - k / 2, y: 100 } },
                    { x: 0, y: 50, hi: { x: 0, y: 50 + k / 2 }, ho: { x: 0, y: 50 - k / 2 } }
                ];
            }
            el.type = 'path';
            el.closed = true;
            const dom = document.getElementById(el.id);
            if (dom) {
                dom.dataset.type = 'path';
                dom.innerHTML = '';
                dom.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
            }
            this.applyElementStyles(el);
            converted.push(id);
        });
        if (!converted.length) return;
        this.setTool('node');
        this.setSelection(converted);
        this.hideContextMenu();
        this.markDirty();
    },

    // --- Direct selection (node editing) ----------------------------------------
    renderNodeGizmo(el) {
        const b = this.getGlobalBounds(el);
        const rad = el.rotation * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const cx = b.left + el.w / 2, cy = b.top + el.h / 2;
        const toWorld = (px, py) => {
            const lx = px / 100 * el.w - el.w / 2, ly = py / 100 * el.h - el.h / 2;
            return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
        };

        const outline = document.createElement('div');
        outline.className = 'gizmo';
        Object.assign(outline.style, {
            left: b.left + 'px', top: b.top + 'px',
            width: el.w + 'px', height: el.h + 'px',
            transform: `rotate(${el.rotation}deg)`,
            borderStyle: 'dashed', borderWidth: 'calc(1px * var(--inv-zoom, 1))'
        });
        this.gizmoLayer.appendChild(outline);

        (el.points || []).forEach((p, i) => {
            if (i === this.selectedVertex) {
                ['hi', 'ho'].forEach(hk => {
                    const hpt = p[hk];
                    if (!hpt) return;
                    const hw = toWorld(hpt.x, hpt.y);
                    const aw = toWorld(p.x, p.y);
                    const arm = document.createElement('div');
                    arm.className = 'bezier-arm';
                    const len = Math.hypot(hw.x - aw.x, hw.y - aw.y);
                    const ang = Math.atan2(hw.y - aw.y, hw.x - aw.x) * 180 / Math.PI;
                    Object.assign(arm.style, { left: aw.x + 'px', top: aw.y + 'px', width: len + 'px', transform: `rotate(${ang}deg)` });
                    this.gizmoLayer.appendChild(arm);
                    const dot = document.createElement('div');
                    dot.className = 'handle-bezier';
                    dot.dataset.index = i;
                    dot.dataset.bezier = hk;
                    Object.assign(dot.style, { left: hw.x + 'px', top: hw.y + 'px' });
                    this.gizmoLayer.appendChild(dot);
                });
            }
            const wpt = toWorld(p.x, p.y);
            const v = document.createElement('div');
            const isSel = i === this.selectedVertex || (this.selectedVertices && this.selectedVertices.has(i));
            v.className = 'handle-vertex' + (isSel ? ' selected-vertex' : '');
            v.dataset.index = i;
            Object.assign(v.style, { left: wpt.x + 'px', top: wpt.y + 'px' });
            this.gizmoLayer.appendChild(v);
        });
        this.renderVertexRadiusHandle(el, toWorld);
    },

    // Radius dot for the selected vertex — shown only on sharp corners with
    // straight neighbors (never on smooth/Bézier points), sitting on the
    // corner's interior bisector.
    renderVertexRadiusHandle(el, toWorld) {
        const i = this.selectedVertex;
        if (i < 0 || !el.points || !el.points[i]) return;
        const n = el.points.length;
        const p = el.points[i];
        if (p.hi || p.ho) return;
        if (!el.closed && (i === 0 || i === n - 1)) return;
        const prev = el.points[(i - 1 + n) % n], next = el.points[(i + 1) % n];
        if (prev.ho || next.hi) return;

        // Work in local px space, then convert via pct -> world.
        const toPx = q => ({ x: q.x / 100 * el.w, y: q.y / 100 * el.h });
        const c = toPx(p), a = toPx(prev), b = toPx(next);
        const u1 = { x: a.x - c.x, y: a.y - c.y }, l1 = Math.hypot(u1.x, u1.y);
        const u2 = { x: b.x - c.x, y: b.y - c.y }, l2 = Math.hypot(u2.x, u2.y);
        if (l1 < 0.01 || l2 < 0.01) return;
        let bis = { x: u1.x / l1 + u2.x / l2, y: u1.y / l1 + u2.y / l2 };
        const bl = Math.hypot(bis.x, bis.y);
        if (bl < 0.01) return; // collinear: no corner to round
        bis = { x: bis.x / bl, y: bis.y / bl };

        const offset = (p.r || 0) + 14 / this.scale;
        const pos = { x: c.x + bis.x * offset, y: c.y + bis.y * offset };
        const wpt = toWorld(pos.x / el.w * 100, pos.y / el.h * 100);

        const dot = document.createElement('div');
        dot.className = 'handle-radius';
        dot.dataset.vertexRadius = '1';
        dot.dataset.index = i;
        dot.title = 'Drag to round this corner';
        Object.assign(dot.style, { left: wpt.x + 'px', top: wpt.y + 'px' });
        this.gizmoLayer.appendChild(dot);

        this._vertexRadiusGeom = {
            elId: el.id, index: i,
            cornerWorld: toWorld(p.x, p.y),
            bisWorld: this.rotateVec(bis, el.rotation || 0),
            maxR: Math.min(l1, l2) / 2
        };
    },

    rotateVec(v, deg) {
        const rad = deg * Math.PI / 180;
        return { x: v.x * Math.cos(rad) - v.y * Math.sin(rad), y: v.x * Math.sin(rad) + v.y * Math.cos(rad) };
    },

    beginVertexRadiusDrag(e) {
        if (!this._vertexRadiusGeom) return;
        this.mode = 'vertex-radius';
        this.startState = Object.assign({}, this._vertexRadiusGeom);
    },

    moveVertexRadius(e) {
        const s = this.startState;
        const el = this.elements.find(x => x.id === s.elId);
        if (!el || !el.points[s.index]) return;
        const p = this.worldPoint(e);
        const along = (p.x - s.cornerWorld.x) * s.bisWorld.x + (p.y - s.cornerWorld.y) * s.bisWorld.y;
        const r = Math.max(0, Math.min(s.maxR, along - 14 / this.scale));
        el.points[s.index].r = Math.round(r);
        this.applyElementStyles(el);
        this.renderGizmo();
        this.showHud(`Radius ${Math.round(r)}`, e.clientX, e.clientY);
    },

    removeSelectedVertices() {
        const elId = Array.from(this.selection)[0];
        const el = this.elements.find(x => x.id === elId);
        if (!el || el.type !== 'path' || !el.points) return;
        if (!this.selectedVertices || !this.selectedVertices.size) return;
        const minPts = el.closed ? 3 : 2;
        const idxs = Array.from(this.selectedVertices).sort((a, b) => b - a);
        let removed = false;
        for (const i of idxs) {
            if (el.points.length <= minPts) break;
            if (i >= 0 && i < el.points.length) { el.points.splice(i, 1); removed = true; }
        }
        if (!removed) return;
        this.selectedVertex = -1;
        this.selectedVertices = new Set();
        this.refitPathBounds(el);
        this.renderGizmo();
        this.updatePropPanel();
        this.markDirty();
    },

    // Insert an anchor on the nearest segment at the clicked position by
    // splitting the cubic with de Casteljau — the rendered curve is unchanged.
    insertPointAt(el, worldPt) {
        if (!el.points || el.points.length < 2) return false;
        const n = el.points.length;
        // World -> local pct (inverse of the element's rotation about center).
        const b = this.getGlobalBounds(el);
        const rad = (el.rotation || 0) * Math.PI / 180;
        const cx = b.left + el.w / 2, cy = b.top + el.h / 2;
        const dx = worldPt.x - cx, dy = worldPt.y - cy;
        const lx = dx * Math.cos(-rad) - dy * Math.sin(-rad) + el.w / 2;
        const ly = dx * Math.sin(-rad) + dy * Math.cos(-rad) + el.h / 2;

        const toPx = q => q ? { x: q.x / 100 * el.w, y: q.y / 100 * el.h } : null;
        const P = el.points.map(p => Object.assign(toPx(p), { hi: toPx(p.hi), ho: toPx(p.ho) }));
        const evalB = (p0, p1, p2, p3, t) => {
            const mt = 1 - t;
            return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
        };

        // Find the closest (segment, t) by sampling.
        let best = null;
        const segCount = el.closed ? n : n - 1;
        for (let s = 0; s < segCount; s++) {
            const a = P[s], c = P[(s + 1) % n];
            const c1 = a.ho || a, c2 = c.hi || c;
            for (let k = 1; k < 24; k++) {
                const t = k / 24;
                const x = evalB(a.x, c1.x, c2.x, c.x, t);
                const y = evalB(a.y, c1.y, c2.y, c.y, t);
                const dist = Math.hypot(x - lx, y - ly);
                if (!best || dist < best.dist) best = { seg: s, t, dist };
            }
        }
        if (!best || best.dist > 10 / this.scale) return false;

        const i = best.seg, j = (best.seg + 1) % n, t = best.t;
        const a = el.points[i], c = el.points[j]; // split in pct space (affine-invariant)
        const lerp = (p, q) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        const wasCurve = !!(a.ho || c.hi);
        let mid;
        if (wasCurve) {
            const p0 = { x: a.x, y: a.y }, p1 = a.ho || p0, p3 = { x: c.x, y: c.y }, p2 = c.hi || p3;
            const p01 = lerp(p0, p1), p12 = lerp(p1, p2), p23 = lerp(p2, p3);
            const p012 = lerp(p01, p12), p123 = lerp(p12, p23);
            const m = lerp(p012, p123);
            // Materialize all four sub-handles: required for an exact split
            // even when the original segment had only one handle.
            mid = { x: m.x, y: m.y, hi: p012, ho: p123 };
            a.ho = p01;
            c.hi = p23;
        } else {
            const m = lerp({ x: a.x, y: a.y }, { x: c.x, y: c.y });
            mid = { x: m.x, y: m.y, hi: null, ho: null };
        }
        const insertIdx = i + 1;
        el.points.splice(insertIdx, 0, mid);
        this.selectedVertex = insertIdx;
        this.selectedVertices = new Set([insertIdx]);
        this.applyElementStyles(el);
        this.renderGizmo();
        this.updatePropPanel();
        this.markDirty();
        return true;
    },

    setVertexRadius(id, index, value) {
        const el = this.elements.find(x => x.id === id);
        if (!el || !el.points || !el.points[index]) return;
        el.points[index].r = Math.max(0, parseFloat(value) || 0);
        this.applyElementStyles(el);
        this.renderGizmo();
        this.markDirty();
    },

    beginVertexDrag(e) {
        const index = parseInt(e.target.dataset.index);
        const elId = Array.from(this.selection)[0];
        const elData = this.elements.find(x => x.id === elId);
        if (!elData || elData.locked || !elData.points) return;
        if (!this.selectedVertices) this.selectedVertices = new Set();

        // Alt+click converts the anchor type (corner <-> smooth).
        if (e.altKey) { this.toggleVertexType(index); return; }

        // Shift+click toggles membership in the multi-selection.
        if (e.shiftKey) {
            if (this.selectedVertices.has(index)) this.selectedVertices.delete(index);
            else this.selectedVertices.add(index);
            this.selectedVertex = index;
            this.renderGizmo();
            this.updatePropPanel();
            return;
        }

        if (!this.selectedVertices.has(index)) this.selectedVertices = new Set([index]);
        this.selectedVertex = index;
        const b = this.getGlobalBounds(elData);
        this.mode = 'moving-vertex';
        this.startState = {
            pointIndex: index, elId,
            cx: b.left + elData.w / 2, cy: b.top + elData.h / 2,
            rad: elData.rotation * (Math.PI / 180), w: elData.w, h: elData.h
        };
        this.startState.startPct = this.localPct(e, this.startState);
        // Snapshot every selected point so multi-drags move them as one rig.
        this.startState.snapshot = Array.from(this.selectedVertices)
            .filter(i => elData.points[i])
            .map(i => ({ i, p: JSON.parse(JSON.stringify(elData.points[i])) }));
        this.renderGizmo();
        this.updatePropPanel();
    },

    localPct(e, s) {
        const p = this.worldPoint(e);
        const dx = p.x - s.cx, dy = p.y - s.cy;
        const rx = dx * Math.cos(-s.rad) - dy * Math.sin(-s.rad);
        const ry = dx * Math.sin(-s.rad) + dy * Math.cos(-s.rad);
        return { x: (rx + s.w / 2) / s.w * 100, y: (ry + s.h / 2) / s.h * 100 };
    },

    moveVertex(e) {
        const s = this.startState;
        const el = this.elements.find(x => x.id === s.elId);
        if (!el || !s.snapshot) return;
        const pct = this.localPct(e, s);
        const dx = pct.x - s.startPct.x, dy = pct.y - s.startPct.y;
        s.snapshot.forEach(({ i, p }) => {
            const pt = el.points[i];
            if (!pt) return;
            pt.x = p.x + dx; pt.y = p.y + dy;
            pt.hi = p.hi ? { x: p.hi.x + dx, y: p.hi.y + dy } : null;
            pt.ho = p.ho ? { x: p.ho.x + dx, y: p.ho.y + dy } : null;
        });
        this.applyElementStyles(el);
        this.renderGizmo();
    },

    // Alt+click on an anchor: corner <-> smooth conversion. Smooth points get
    // symmetric handles along the tangent through the neighbors.
    toggleVertexType(index) {
        const elId = Array.from(this.selection)[0];
        const el = this.elements.find(x => x.id === elId);
        if (!el || el.type !== 'path' || !el.points || !el.points[index]) return;
        const pt = el.points[index];
        if (pt.hi || pt.ho) {
            pt.hi = null; pt.ho = null;          // smooth -> corner
        } else {
            const n = el.points.length;
            const prev = el.closed ? el.points[(index - 1 + n) % n] : el.points[Math.max(0, index - 1)];
            const next = el.closed ? el.points[(index + 1) % n] : el.points[Math.min(n - 1, index + 1)];
            const tx = (next.x - prev.x) / 6, ty = (next.y - prev.y) / 6;
            pt.ho = { x: pt.x + tx, y: pt.y + ty };
            pt.hi = { x: pt.x - tx, y: pt.y - ty };
            delete pt.r;                          // smooth corners carry no radius
        }
        this.selectedVertex = index;
        this.refitPathBounds(el);
        this.renderGizmo();
        this.updatePropPanel();
        this.markDirty();
    },

    beginBezierDrag(e) {
        const index = parseInt(e.target.dataset.index);
        const which = e.target.dataset.bezier;
        const elId = Array.from(this.selection)[0];
        const elData = this.elements.find(x => x.id === elId);
        if (!elData || elData.locked) return;
        const b = this.getGlobalBounds(elData);
        this.mode = 'moving-bezier';
        this.startState = {
            pointIndex: index, which, elId,
            cx: b.left + elData.w / 2, cy: b.top + elData.h / 2,
            rad: elData.rotation * (Math.PI / 180), w: elData.w, h: elData.h
        };
    },

    moveBezier(e) {
        const s = this.startState;
        const el = this.elements.find(x => x.id === s.elId);
        if (!el) return;
        const pct = this.localPct(e, s);
        const pt = el.points[s.pointIndex];
        pt[s.which] = { x: pct.x, y: pct.y };
        // Keep handles symmetric unless Alt is held (corner conversion).
        if (!e.altKey) {
            const other = s.which === 'hi' ? 'ho' : 'hi';
            pt[other] = { x: 2 * pt.x - pct.x, y: 2 * pt.y - pct.y };
        }
        this.applyElementStyles(el);
        this.renderGizmo();
    },

    // --- Pathfinder boolean operations ----------------------------------------
    // Converts shapes to absolute path data (rotation baked in) and composites
    // them in a single SVG: Add, Subtract (punch), Intersect, Exclude.
    toAbsPathD(el, offsetX, offsetY) {
        const rad = (el.rotation || 0) * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
        const T = (lx, ly) => {
            const ox = lx - el.w / 2, oy = ly - el.h / 2;
            return {
                x: cx + ox * cos - oy * sin - offsetX,
                y: cy + ox * sin + oy * cos - offsetY
            };
        };
        const pt = p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;

        if (el.type === 'rect') {
            const c = [T(0, 0), T(el.w, 0), T(el.w, el.h), T(0, el.h)];
            return `M ${pt(c[0])} L ${pt(c[1])} L ${pt(c[2])} L ${pt(c[3])} Z`;
        }
        if (el.type === 'circle') {
            const k = 0.5523;
            const rx = el.w / 2, ry = el.h / 2;
            const P = (x, y) => T(rx + x, ry + y);
            const p0 = P(rx, 0), p1 = P(0, ry), p2 = P(-rx, 0), p3 = P(0, -ry);
            return `M ${pt(p0)}`
                + ` C ${pt(P(rx, ry * k))}, ${pt(P(rx * k, ry))}, ${pt(p1)}`
                + ` C ${pt(P(-rx * k, ry))}, ${pt(P(-rx, ry * k))}, ${pt(p2)}`
                + ` C ${pt(P(-rx, -ry * k))}, ${pt(P(-rx * k, -ry))}, ${pt(p3)}`
                + ` C ${pt(P(rx * k, -ry))}, ${pt(P(rx, -ry * k))}, ${pt(p0)} Z`;
        }
        if (el.type === 'path') {
            const abs = q => q ? T(q.x / 100 * el.w, q.y / 100 * el.h) : null;
            const pts = el.points.map(p => ({ a: abs(p), hi: abs(p.hi), ho: abs(p.ho) }));
            if (!pts.length) return '';
            let d = `M ${pt(pts[0].a)}`;
            for (let i = 1; i < pts.length; i++) {
                d += ` C ${pt(pts[i - 1].ho || pts[i - 1].a)}, ${pt(pts[i].hi || pts[i].a)}, ${pt(pts[i].a)}`;
            }
            const a = pts[pts.length - 1], b = pts[0];
            d += ` C ${pt(a.ho || a.a)}, ${pt(b.hi || b.a)}, ${pt(b.a)} Z`;
            return d;
        }
        return '';
    },

    rotatedAABB(el) {
        const rad = (el.rotation || 0) * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
        const corners = [[-el.w / 2, -el.h / 2], [el.w / 2, -el.h / 2], [el.w / 2, el.h / 2], [-el.w / 2, el.h / 2]]
            .map(([ox, oy]) => ({ x: cx + ox * cos - oy * sin, y: cy + ox * sin + oy * cos }));
        return {
            minX: Math.min(...corners.map(c => c.x)), minY: Math.min(...corners.map(c => c.y)),
            maxX: Math.max(...corners.map(c => c.x)), maxY: Math.max(...corners.map(c => c.y))
        };
    },

    pathfinder(op) {
        this.hideContextMenu();
        const els = Array.from(this.selection)
            .map(id => this.elements.find(e => e.id === id))
            .filter(e => e && ['rect', 'circle', 'path'].includes(e.type));
        if (els.length < 2) return;
        const parentId = els[0].parentId;
        if (!parentId.startsWith('ab_') || els.some(e => e.parentId !== parentId)) return;

        els.sort((a, b) => a.zIndex - b.zIndex);
        const base = els[0];

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        els.forEach(e => {
            const bb = this.rotatedAABB(e);
            minX = Math.min(minX, bb.minX); minY = Math.min(minY, bb.minY);
            maxX = Math.max(maxX, bb.maxX); maxY = Math.max(maxY, bb.maxY);
        });

        const result = this.createElementData('rect', minX, minY, parentId);
        result.type = 'bool';
        result.op = op;
        result.w = Math.max(1, maxX - minX);
        result.h = Math.max(1, maxY - minY);
        result.vbW = result.w; result.vbH = result.h;
        result.bgColor = base.bgColor;
        result.zIndex = base.zIndex;
        result.paths = els.map(e => this.toAbsPathD(e, minX, minY));

        els.forEach(e => {
            document.getElementById(e.id)?.remove();
            this.elements = this.elements.filter(x => x.id !== e.id);
        });
        this.elements.push(result);
        this.buildElementDom(result);
        this.setSelection([result.id]);
        this.renderLayersPanel();
        this.markDirty();
    },

    renderBoolSvg(el, dom) {
        const svg = dom.querySelector('svg');
        if (!svg) return;
        svg.setAttribute('viewBox', `0 0 ${el.vbW} ${el.vbH}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        const fill = el.fillEnabled === false ? 'none' : el.bgColor;
        const [dBase, ...cutters] = el.paths;
        const dAll = el.paths.join(' ');
        const dCut = cutters.join(' ');
        let inner = '';
        if (el.op === 'add') {
            inner = `<path d="${dAll}" fill="${fill}" fill-rule="nonzero"/>`;
        } else if (el.op === 'exclude') {
            inner = `<path d="${dAll}" fill="${fill}" fill-rule="evenodd"/>`;
        } else if (el.op === 'subtract') {
            const mid = 'pfm_' + el.id;
            // The masked rect must not hit-test (masks don't affect pointer
            // events); a transparent copy of the base shape carries the hits.
            inner = `<defs><mask id="${mid}"><rect width="100%" height="100%" fill="#000"/><path d="${dBase}" fill="#fff"/><path d="${dCut}" fill="#000"/></mask></defs>`
                + `<rect width="100%" height="100%" fill="${fill}" mask="url(#${mid})" style="pointer-events:none"/>`
                + `<path d="${dBase}" fill="${el.fillEnabled === false ? 'none' : 'transparent'}"/>`;
        } else if (el.op === 'intersect') {
            const cid = 'pfc_' + el.id;
            inner = `<defs><clipPath id="${cid}"><path d="${dCut}"/></clipPath></defs>`
                + `<path d="${dBase}" fill="${fill}" clip-path="url(#${cid})"/>`;
        }
        svg.innerHTML = inner;
        dom.style.filter = this.dropShadowFilter(el);
        dom.style.backgroundColor = 'transparent';
    },

    // --- Masking ---------------------------------------------------------------
    wrapInGroup(el) {
        const group = this.createElementData('group', el.x, el.y, el.parentId);
        group.w = el.w; group.h = el.h;
        group.zIndex = el.zIndex;
        this.elements.push(group);
        this.buildElementDom(group);
        el.parentId = group.id;
        el.x = 0; el.y = 0;
        document.getElementById(group.id).appendChild(document.getElementById(el.id));
        this.applyElementStyles(el);
        return group;
    },

    // Topmost selected shape becomes the mask. Standard mode clips content to
    // the shape; inverted mode uses the shape as a blocker (punches a hole).
    makeMask(inverted) {
        this.hideContextMenu();
        const els = Array.from(this.selection).map(id => this.elements.find(e => e.id === id)).filter(Boolean);
        if (els.length < 2) return;
        const shape = els.reduce((a, b) => (a.zIndex >= b.zIndex ? a : b));
        if (!['rect', 'circle', 'path'].includes(shape.type)) return;
        const content = els.filter(e => e !== shape);
        if (content.some(e => e.parentId !== shape.parentId)) return;

        let group;
        if (content.length === 1 && content[0].type === 'group') {
            group = content[0];
        } else if (content.length === 1) {
            group = this.wrapInGroup(content[0]);
        } else {
            this.setSelection(content.map(c => c.id));
            group = this.groupSelected();
        }
        if (!group) return;

        const d = this.toAbsPathD(shape, group.x, group.y);
        const gw = group.w.toFixed(2), gh = group.h.toFixed(2);
        group.maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${gw} ${gh}" preserveAspectRatio="none">`
            + (inverted
                ? `<path d="M0 0 H${gw} V${gh} H0 Z ${d}" fill="#fff" fill-rule="evenodd"/>`
                : `<path d="${d}" fill="#fff"/>`)
            + `</svg>`;
        group.maskInverted = !!inverted;
        group.maskSource = JSON.parse(JSON.stringify(shape));

        document.getElementById(shape.id)?.remove();
        this.elements = this.elements.filter(x => x.id !== shape.id);

        this.applyElementStyles(group);
        this.setSelection([group.id]);
        this.renderLayersPanel();
        this.markDirty();
    },

    releaseMask() {
        this.hideContextMenu();
        const group = Array.from(this.selection)
            .map(id => this.elements.find(e => e.id === id))
            .find(e => e && e.type === 'group' && e.maskSvg);
        if (!group) return;
        const ids = [group.id];
        if (group.maskSource) {
            const restored = JSON.parse(JSON.stringify(group.maskSource));
            restored.id = 'el_' + Date.now() + '_' + Math.floor(Math.random() * 1e4);
            restored.parentId = group.parentId;
            this.elements.push(restored);
            this.buildElementDom(restored);
            ids.push(restored.id);
        }
        delete group.maskSvg;
        delete group.maskInverted;
        delete group.maskSource;
        this.applyElementStyles(group);
        this.setSelection(ids);
        this.renderLayersPanel();
        this.markDirty();
    },

    applyGroupMask(el, dom) {
        if (el.maskSvg) {
            const url = `url("data:image/svg+xml,${encodeURIComponent(el.maskSvg)}")`;
            dom.style.webkitMaskImage = url; dom.style.maskImage = url;
            dom.style.webkitMaskSize = '100% 100%'; dom.style.maskSize = '100% 100%';
            dom.style.webkitMaskRepeat = 'no-repeat'; dom.style.maskRepeat = 'no-repeat';
        } else {
            dom.style.webkitMaskImage = ''; dom.style.maskImage = '';
        }
    }
});
