// Color utilities: hex parsing, CMYK conversion and print-gamut approximation.
const ColorUtil = {
    hexToRgb(hex) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
        return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 };
    },

    rgbToCmyk(r, g, b) {
        const k = 1 - Math.max(r, g, b) / 255;
        if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 };
        return {
            c: (1 - r / 255 - k) / (1 - k),
            m: (1 - g / 255 - k) / (1 - k),
            y: (1 - b / 255 - k) / (1 - k),
            k
        };
    },

    cmykLabel(hex) {
        const { r, g, b } = this.hexToRgb(hex);
        const c = this.rgbToCmyk(r, g, b);
        const p = v => Math.round(v * 100);
        return `C${p(c.c)} M${p(c.m)} Y${p(c.y)} K${p(c.k)}`;
    },

    // Approximation of the coated-CMYK gamut: print cannot reproduce highly
    // saturated mid-luminance RGB colors (vivid blues, greens, oranges).
    outOfCmykGamut(hex) {
        const { r, g, b } = this.hexToRgb(hex);
        const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
        const l = (max + min) / 2;
        if (max === min) return false;
        const s = (max - min) / (1 - Math.abs(2 * l - 1));
        return s > 0.82 && l > 0.22 && l < 0.78;
    },

    // Small warning badge shown next to color inputs when out of print gamut.
    warnBadge(hex) {
        if (!hex || !this.outOfCmykGamut(hex)) return '';
        return `<span class="cmyk-warn" title="Out of CMYK print gamut — closest print value: ${this.cmykLabel(hex)}">!</span>`;
    }
};
