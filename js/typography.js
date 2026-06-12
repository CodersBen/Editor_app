// Advanced typography: numeric kerning/tracking/leading/baseline shift,
// OpenType features, envelope distort warps and type-on-a-path (arc).
Object.assign(MiniCanva.prototype, {

    renderTextVisuals(dom, data) {
        let inner = dom.querySelector('.text-inner');
        if (!inner) {
            inner = document.createElement('span');
            inner.className = 'text-inner';
            dom.innerHTML = '';
            dom.appendChild(inner);
        }

        dom.style.fontSize = data.fontSize + 'px';
        dom.style.fontWeight = data.fontWeight;
        dom.style.color = data.color;
        dom.style.minWidth = '';
        dom.style.minHeight = '';

        // Kerning + tracking, both in thousandths of an em (Illustrator-style),
        // combined into precise letter-spacing. Leading in px (0 = auto).
        const spacing = ((data.tracking || 0) + (data.kerning || 0)) / 1000 * data.fontSize;
        dom.style.letterSpacing = spacing ? spacing + 'px' : 'normal';
        dom.style.lineHeight = data.leading ? data.leading + 'px' : '1.2';
        dom.style.fontKerning = 'normal';

        // OpenType features: standard/discretionary ligatures and swashes.
        const f = data.features || {};
        dom.style.fontFeatureSettings = `"liga" ${f.liga ? 1 : 0}, "dlig" ${f.dlig ? 1 : 0}, "swsh" ${f.swsh ? 1 : 0}`;

        // Baseline shift (positive = up).
        inner.style.transform = data.baselineShift ? `translateY(${-data.baselineShift}px)` : '';

        this.applyTextAppearance(dom, data);

        const radius = parseInt(data.curveRadius || 0);
        const warp = data.warp || { mode: 'none', amount: 0 };

        if (radius !== 0 && data.text) {
            this.renderTypeOnPath(dom, inner, data, radius);
        } else if (warp.mode !== 'none' && data.text) {
            this.renderWarpedText(inner, data, warp);
            dom.style.whiteSpace = 'nowrap';
        } else {
            inner.textContent = data.text;
            dom.style.whiteSpace = 'nowrap';
            dom.style.display = 'flex';
            dom.style.alignItems = 'center';
            dom.style.justifyContent = 'center';
        }
    },

    // Appearance stack for live text: first stroke via text-stroke, additional
    // strokes as shadow rings, extrudes as stepped offsets, then drop shadows —
    // every effect keeps independent X/Y inputs.
    applyTextAppearance(dom, data) {
        const a = data.appearance || { strokes: [], shadows: [], extrudes: [] };
        const shadows = [];

        const strokes = (a.strokes || []).filter(s => (s.width || 0) > 0);
        if (strokes.length) {
            const first = strokes[0];
            if (first.align === 'outside') {
                dom.style.webkitTextStroke = `${first.width * 2}px ${first.color}`;
                dom.style.paintOrder = 'stroke fill';
            } else {
                dom.style.webkitTextStroke = `${first.width}px ${first.color}`;
                dom.style.paintOrder = 'fill stroke';
            }
            strokes.slice(1).forEach(s => {
                const w = s.align === 'outside' ? s.width * 2 : s.width;
                for (let i = 0; i < 36; i++) {
                    const ang = i * 10 * Math.PI / 180;
                    shadows.push(`${(Math.cos(ang) * w).toFixed(2)}px ${(Math.sin(ang) * w).toFixed(2)}px 0 ${s.color}`);
                }
            });
        } else {
            dom.style.webkitTextStroke = '0';
            dom.style.paintOrder = 'normal';
        }

        (a.extrudes || []).forEach(x => {
            const ex = x.x || 0, ey = x.y || 0;
            const steps = Math.min(120, Math.max(Math.abs(ex), Math.abs(ey), 1));
            for (let i = 1; i <= steps; i++) {
                shadows.push(`${(ex * i / steps).toFixed(2)}px ${(ey * i / steps).toFixed(2)}px 0 ${x.color}`);
            }
        });

        (a.shadows || []).forEach(s => {
            shadows.push(`${s.x || 0}px ${s.y || 0}px ${Math.max(0, s.blur || 0)}px ${s.color}`);
        });

        dom.style.textShadow = shadows.join(', ') || 'none';
    },

    // Type on a Path (arc): characters laid out radially around a circle.
    renderTypeOnPath(dom, inner, data, radius) {
        inner.innerHTML = '';
        const chars = data.text.split('');
        const degreePerChar = Math.min(15, 360 / chars.length);
        const totalArc = degreePerChar * (chars.length - 1);
        const startAngle = -totalArc / 2;

        chars.forEach((char, i) => {
            const span = document.createElement('span');
            span.textContent = char === ' ' ? ' ' : char;
            span.className = 'curved-char';
            const theta = startAngle + i * degreePerChar;
            const r = Math.abs(radius);
            const dir = radius > 0 ? -1 : 1;
            let t = `rotate(${theta}deg) translate(0, ${dir * r}px)`;
            if (radius < 0) t += ' rotate(180deg)';
            span.style.transform = t;
            inner.appendChild(span);
        });
        inner.style.transform = '';
        dom.style.whiteSpace = 'normal';
        dom.style.minWidth = '200px';
        dom.style.minHeight = '100px';
    },

    // Envelope distort: warp live text into arcs, arches, flags, waves, rises.
    renderWarpedText(inner, data, warp) {
        inner.innerHTML = '';
        const chars = data.text.split('');
        const n = Math.max(1, chars.length - 1);
        const amt = warp.amount || 0;
        chars.forEach((char, i) => {
            const t = i / n;
            const span = document.createElement('span');
            span.className = 'warp-char';
            span.textContent = char === ' ' ? ' ' : char;
            let ty = 0, rot = 0;
            switch (warp.mode) {
                case 'arc':    ty = -Math.sin(Math.PI * t) * amt; rot = (t - 0.5) * amt * 0.6; break;
                case 'arch':   ty = -Math.sin(Math.PI * t) * amt; break;
                case 'flag':   ty = Math.sin(2 * Math.PI * t) * amt * 0.5; break;
                case 'wave':   ty = Math.sin(2 * Math.PI * t) * amt * 0.5; rot = Math.cos(2 * Math.PI * t) * amt * 0.4; break;
                case 'rise':   ty = -t * amt; break;
            }
            span.style.transform = `translateY(${ty.toFixed(2)}px) rotate(${rot.toFixed(2)}deg)`;
            inner.appendChild(span);
        });
    },

    autoResizeText(id) {
        const e = this.elements.find(x => x.id === id);
        if (!e || (e.curveRadius && e.curveRadius !== 0)) return;
        const d = document.getElementById(id);
        if (!d) return;
        d.style.width = 'max-content';
        d.style.height = 'auto';
        const pad = e.warp && e.warp.mode !== 'none' ? Math.abs(e.warp.amount || 0) : 0;
        e.w = d.offsetWidth + 2;
        e.h = d.offsetHeight + pad * 2;
        d.style.width = e.w + 'px';
        d.style.height = e.h + 'px';
    }
});
