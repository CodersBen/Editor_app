// Vector & node editing: pen tool (bezier paths), direct selection,
// pathfinder boolean operations, and clipping / inverted masks.
Object.assign(MiniCanva.prototype, {

    // --- Path geometry -----------------------------------------------------
    // Points are stored in percentages of the element box so paths scale freely.
    pathD(points, closed, w, h) {
        if (!points || !points.length) return '';
        const px = p => `${(p.x / 100 * w).toFixed(2)} ${(p.y / 100 * h).toFixed(2)}`;
        let d = `M ${px(points[0])}`;
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i];
            d += ` C ${px(a.ho || a)}, ${px(b.hi || b)}, ${px(b)}`;
        }
        if (closed && points.length > 2) {
            const a = points[points.length - 1], b = points[0];
            d += ` C ${px(a.ho || a)}, ${px(b.hi || b)}, ${px(b)} Z`;
        }
        return d;
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

        // Outside strokes: cumulative rings painted behind the fill (widest first).
        const strokes = (a.strokes || []).filter(s => (s.width || 0) > 0);
        const outRings = [];
        let cum = 0;
        strokes.filter(s => s.align !== 'inside').forEach(s => {
            cum += s.align === 'center' ? s.width / 2 : s.width;
            outRings.push({ width: cum * 2, color: s.color });
        });
        outRings.reverse().forEach(r => {
            parts.push(`<path d="${d}" fill="none" stroke="${r.color}" stroke-width="${r.width}" stroke-linejoin="round" stroke-linecap="round"/>`);
        });

        parts.push(`<path d="${d}" fill="${el.bgColor}"/>`);

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

        svg.innerHTML = parts.join('');
        dom.style.filter = this.dropShadowFilter(el);
        dom.style.backgroundColor = 'transparent';
    },

    // --- Pen tool ------------------------------------------------------------
    penMouseDown(e) {
        const p = this.worldPoint(e);
        if (!this.penDraft) this.penDraft = { points: [], closed: false };
        const first = this.penDraft.points[0];
        if (first && this.penDraft.points.length > 2 &&
            Math.hypot(p.x - first.x, p.y - first.y) < 8 / this.scale) {
            this.penDraft.closed = true;
            this.finishPen(true);
            return;
        }
        this.penDraft.points.push({ x: p.x, y: p.y, hi: null, ho: null });
        this.mode = 'pen-drag';
        this.renderPenPreview(p);
    },

    penMouseMove(e) {
        if (!this.penDraft) return;
        const p = this.worldPoint(e);
        if (this.mode === 'pen-drag') {
            // Dragging after placing an anchor pulls out symmetric direction handles.
            const pt = this.penDraft.points[this.penDraft.points.length - 1];
            if (Math.hypot(p.x - pt.x, p.y - pt.y) > 2 / this.scale) {
                pt.ho = { x: p.x, y: p.y };
                pt.hi = { x: 2 * pt.x - p.x, y: 2 * pt.y - p.y };
            } else {
                pt.ho = null; pt.hi = null;
            }
        }
        this.renderPenPreview(p);
    },

    penMouseUp() { this.renderPenPreview(); },

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
        let rubber = '';
        if (cursor && this.mode !== 'pen-drag') {
            const last = pts[pts.length - 1];
            rubber = `<path d="M ${px(last.ho || last)} L ${px(cursor)}" stroke="var(--guide-color)" stroke-width="${1 / this.scale}" stroke-dasharray="4 3" fill="none"/>`;
        }
        const dots = pts.map(p =>
            `<circle cx="${p.x}" cy="${p.y}" r="${3 / this.scale}" fill="#fff" stroke="var(--vertex-color)" stroke-width="${1 / this.scale}"/>`).join('');
        const handles = pts.filter(p => p.ho).map(p =>
            `<path d="M ${px(p.hi)} L ${px(p)} L ${px(p.ho)}" stroke="var(--vertex-color)" stroke-width="${1 / this.scale}" fill="none"/>`).join('');
        svg.innerHTML = `<path d="${d}" stroke="var(--selection-color)" stroke-width="${1.5 / this.scale}" fill="none"/>${rubber}${handles}${dots}`;
    },

    finishPen(closed) {
        const draft = this.penDraft;
        this.penDraft = null;
        const svg = document.getElementById('pen-preview');
        if (svg) svg.innerHTML = '';
        if (!draft || draft.points.length < 2) { this.setTool('select'); return; }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        draft.points.forEach(p => {
            [p, p.hi, p.ho].forEach(q => {
                if (!q) return;
                minX = Math.min(minX, q.x); minY = Math.min(minY, q.y);
                maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y);
            });
        });
        const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
        const ab = this.artboardAtPoint(draft.points[0]);
        if (!ab) { this.setTool('select'); return; }

        const norm = q => q ? { x: (q.x - minX) / w * 100, y: (q.y - minY) / h * 100 } : null;
        const el = this.createElementData('path', minX - ab.x, minY - ab.y, ab.id);
        el.w = w; el.h = h;
        el.closed = !!(closed === true || draft.closed);
        el.points = draft.points.map(p => Object.assign(norm(p), { hi: norm(p.hi), ho: norm(p.ho) }));
        this.elements.push(el);
        this.buildElementDom(el);
        this.setTool('select');
        this.setSelection([el.id]);
        this.renderLayersPanel();
        this.markDirty();
    },

    cancelPen() {
        this.penDraft = null;
        const svg = document.getElementById('pen-preview');
        if (svg) svg.innerHTML = '';
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
            borderStyle: 'dashed', borderWidth: '1px'
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
            v.className = 'handle-vertex' + (i === this.selectedVertex ? ' selected-vertex' : '');
            v.dataset.index = i;
            Object.assign(v.style, { left: wpt.x + 'px', top: wpt.y + 'px' });
            this.gizmoLayer.appendChild(v);
        });
    },

    beginVertexDrag(e) {
        const index = parseInt(e.target.dataset.index);
        const elId = Array.from(this.selection)[0];
        const elData = this.elements.find(x => x.id === elId);
        if (!elData || elData.locked || !elData.points) return;
        this.selectedVertex = index;
        const b = this.getGlobalBounds(elData);
        this.mode = 'moving-vertex';
        this.startState = {
            pointIndex: index, elId,
            cx: b.left + elData.w / 2, cy: b.top + elData.h / 2,
            rad: elData.rotation * (Math.PI / 180), w: elData.w, h: elData.h
        };
        this.renderGizmo();
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
        if (!el) return;
        const pct = this.localPct(e, s);
        const pt = el.points[s.pointIndex];
        const ddx = pct.x - pt.x, ddy = pct.y - pt.y;
        pt.x = pct.x; pt.y = pct.y;
        if (pt.hi) { pt.hi.x += ddx; pt.hi.y += ddy; }
        if (pt.ho) { pt.ho.x += ddx; pt.ho.y += ddy; }
        this.applyElementStyles(el);
        this.renderGizmo();
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
        const fill = el.bgColor;
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
            inner = `<defs><mask id="${mid}"><rect width="100%" height="100%" fill="#000"/><path d="${dBase}" fill="#fff"/><path d="${dCut}" fill="#000"/></mask></defs>`
                + `<rect width="100%" height="100%" fill="${fill}" mask="url(#${mid})"/>`;
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
