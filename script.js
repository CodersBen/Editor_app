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
                this.panelProps = document.getElementById('panel-props');
                this.panelLayers = document.getElementById('panel-layers');
                this.tabProps = document.getElementById('tab-props');
                this.tabLayers = document.getElementById('tab-layers');
                this.selCountLabel = document.getElementById('selection-count');
                
                this.scale = 1; this.panX = 0; this.panY = 0;
                this.currentTool = 'select';
                this.mode = 'idle'; 
                this.snapThreshold = 5;
                this.activeTab = 'props';
                this.clipboard = [];
                this.draggedLayerId = null;
                this.activeArtboardId = null; 
                
                this.artboards = [];
                this.elements = [];
                this.selection = new Set();

                this.init();
            }

            init() {
                if (typeof lucide !== 'undefined') lucide.createIcons();
                this.panX = this.viewport.clientWidth/2 - 400;
                this.panY = this.viewport.clientHeight/2 - 300;
                this.updateTransform();
                this.createArtboard(0, 0, 800, 600, 'Artboard 1');

                window.addEventListener('resize', () => this.updateTransform());
                document.addEventListener('keydown', this.handleKeyDown.bind(this));
                document.addEventListener('keyup', this.handleKeyUp.bind(this));
                document.addEventListener('click', (e) => {
                    if (!this.contextMenu.contains(e.target)) this.hideContextMenu();
                });
                
                this.viewport.addEventListener('contextmenu', this.handleContextMenu.bind(this));
                this.viewport.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });
                this.viewport.addEventListener('mousedown', this.handleMouseDown.bind(this));
                window.addEventListener('mousemove', this.handleMouseMove.bind(this));
                window.addEventListener('mouseup', this.handleMouseUp.bind(this));
                
                this.renderLayersPanel();
                this.updatePropPanel(); 
            }

            updateTransform() {
                this.workspace.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
                const zoomLevel = document.getElementById('zoom-level');
                if(zoomLevel) zoomLevel.textContent = Math.round(this.scale * 100) + '%';
                
                const s = 20 * this.scale;
                this.viewport.style.backgroundSize = `${s}px ${s}px`;
                this.viewport.style.backgroundPosition = `${this.panX}px ${this.panY}px`;
            }

            switchTab(tab) {
                this.activeTab = tab;
                if (tab === 'props') {
                    this.panelProps.classList.remove('hidden');
                    this.panelLayers.classList.add('hidden');
                    this.tabProps.className = "flex-1 py-3 text-xs font-semibold text-purple-600 border-b-2 border-purple-600 bg-purple-50 transition-colors";
                    this.tabLayers.className = "flex-1 py-3 text-xs font-semibold text-slate-500 hover:bg-slate-50 transition-colors";
                } else {
                    this.panelProps.classList.add('hidden');
                    this.panelLayers.classList.remove('hidden');
                    this.tabLayers.className = "flex-1 py-3 text-xs font-semibold text-purple-600 border-b-2 border-purple-600 bg-purple-50 transition-colors";
                    this.tabProps.className = "flex-1 py-3 text-xs font-semibold text-slate-500 hover:bg-slate-50 transition-colors";
                    this.renderLayersPanel();
                }
            }

            getCursorForHandle(handle, rotation) {
                const baseAngles = { 'tc': 0, 'tr': 45, 'mr': 90, 'br': 135, 'bc': 180, 'bl': 225, 'ml': 270, 'tl': 315 };
                let angle = baseAngles[handle];
                if (angle === undefined) return 'default';
                let totalRot = (angle + rotation) % 360;
                if (totalRot < 0) totalRot += 360;
                if (totalRot >= 337.5 || totalRot < 22.5) return 'ns-resize';
                if (totalRot >= 22.5 && totalRot < 67.5) return 'nesw-resize';
                if (totalRot >= 67.5 && totalRot < 112.5) return 'ew-resize';
                if (totalRot >= 112.5 && totalRot < 157.5) return 'nwse-resize';
                if (totalRot >= 157.5 && totalRot < 202.5) return 'ns-resize';
                if (totalRot >= 202.5 && totalRot < 247.5) return 'nesw-resize';
                if (totalRot >= 247.5 && totalRot < 292.5) return 'ew-resize';
                if (totalRot >= 292.5 && totalRot < 337.5) return 'nwse-resize';
                return 'default';
            }

            renderTextVisuals(dom, data) {
                dom.style.fontSize = data.fontSize + 'px';
                dom.style.fontWeight = data.fontWeight;
                dom.style.color = data.color;
                
                if (data.strokeWidth > 0) {
                    if (data.strokeAlign === 'outside') {
                        dom.style.webkitTextStroke = `${data.strokeWidth * 2}px ${data.strokeColor}`;
                        dom.style.paintOrder = 'stroke fill';
                    } else {
                        dom.style.webkitTextStroke = `${data.strokeWidth}px ${data.strokeColor}`;
                        dom.style.paintOrder = 'fill stroke';
                    }
                } else {
                    dom.style.webkitTextStroke = '0';
                    dom.style.paintOrder = 'normal';
                }

                let shadows = [];
                if (data.shadowBlur > 0 || data.shadowX !== 0 || data.shadowY !== 0) {
                    shadows.push(`${data.shadowX}px ${data.shadowY}px ${data.shadowBlur}px ${data.shadowColor}`);
                }
                if (data.contourSteps > 0) {
                    const cColor = data.contourColor || '#000000';
                    const offset = data.contourOffset * data.contourSteps; 
                    for (let i = 0; i < 36; i++) {
                        const angle = (i * 10) * Math.PI / 180;
                        const x = Math.cos(angle) * offset;
                        const y = Math.sin(angle) * offset;
                        shadows.push(`${x}px ${y}px 0 ${cColor}`);
                    }
                }
                dom.style.textShadow = shadows.join(', ') || 'none';

                const radius = parseInt(data.curveRadius || 0);
                if (radius !== 0 && data.text) {
                    dom.innerHTML = ''; 
                    const chars = data.text.split('');
                    const degreePerChar = Math.min(15, 360 / chars.length); 
                    const totalArc = degreePerChar * (chars.length - 1);
                    const startAngle = -totalArc / 2;

                    chars.forEach((char, i) => {
                        const span = document.createElement('span');
                        span.textContent = char;
                        span.className = 'curved-char';
                        const theta = startAngle + (i * degreePerChar);
                        const r = Math.abs(radius);
                        const dir = radius > 0 ? -1 : 1; 
                        span.style.transform = `rotate(${theta}deg) translate(0, ${dir * r}px)`;
                        if (radius < 0) {
                             span.style.transform += ` rotate(180deg)`;
                        }
                        dom.appendChild(span);
                    });
                    dom.style.whiteSpace = 'normal'; 
                    if(data.w < 50) dom.style.width = '200px'; 
                    if(data.h < 50) dom.style.height = '100px'; 
                } else {
                    dom.textContent = data.text;
                    dom.style.whiteSpace = 'nowrap';
                    dom.style.display = 'flex';
                    dom.style.alignItems = 'center';
                    dom.style.justifyContent = 'center';
                }
            }

            // --- Core Creation Methods ---

            createArtboard(x, y, w, h, label) {
                const id = 'ab_' + Date.now();
                const el = document.createElement('div');
                el.className = 'artboard';
                el.id = id;
                el.style.backgroundColor = '#ffffff'; 
                Object.assign(el.style, { left: x+'px', top: y+'px', width: w+'px', height: h+'px' });
                const title = document.createElement('div');
                title.className = 'artboard-label'; title.textContent = label; el.appendChild(title);
                
                // Margins
                const guides = ['top', 'bottom', 'left', 'right'];
                guides.forEach(side => {
                    const g = document.createElement('div');
                    g.className = `margin-guide margin-${side}`;
                    g.style.borderColor = '#00ffff'; // Default cyan
                    g.style.borderStyle = 'solid';
                    if (side === 'top') { g.style.top = '0px'; g.style.left = '0'; g.style.right = '0'; g.style.borderBottomWidth = '1px'; }
                    else if (side === 'bottom') { g.style.bottom = '0px'; g.style.left = '0'; g.style.right = '0'; g.style.borderTopWidth = '1px'; }
                    else if (side === 'left') { g.style.left = '0px'; g.style.top = '0'; g.style.bottom = '0'; g.style.borderRightWidth = '1px'; }
                    else if (side === 'right') { g.style.right = '0px'; g.style.top = '0'; g.style.bottom = '0'; g.style.borderLeftWidth = '1px'; }
                    el.appendChild(g);
                });

                this.workspace.insertBefore(el, this.gizmoLayer);
                
                this.artboards.push({ 
                    id, x, y, w, h, bgColor: '#ffffff',
                    marginTop: 20, marginBottom: 20, marginLeft: 20, marginRight: 20, 
                    marginEnabled: false, marginColor: '#00ffff' 
                });
                
                this.activeArtboardId = id; 
                this.renderLayersPanel();
                this.updatePropPanel(); 
                this.renderMarginGuides(id);
                return id;
            }
            
            renderMarginGuides(id) {
                const abData = this.artboards.find(a => a.id === id);
                if(!abData) return;
                const el = document.getElementById(id);
                if(!el) return;
                
                el.classList.toggle('show-margins', abData.marginEnabled);
                
                const top = el.querySelector('.margin-top');
                const bottom = el.querySelector('.margin-bottom');
                const left = el.querySelector('.margin-left');
                const right = el.querySelector('.margin-right');
                
                if(top) { top.style.top = abData.marginTop + 'px'; top.style.borderColor = abData.marginColor; }
                if(bottom) { bottom.style.bottom = abData.marginBottom + 'px'; bottom.style.borderColor = abData.marginColor; }
                if(left) { left.style.left = abData.marginLeft + 'px'; left.style.borderColor = abData.marginColor; }
                if(right) { right.style.right = abData.marginRight + 'px'; right.style.borderColor = abData.marginColor; }
            }

            createElement(type, x, y, parentId) {
                const id = 'el_' + Date.now() + Math.floor(Math.random()*1000);
                const el = document.createElement('div');
                el.className = 'element'; el.id = id;
                let w = 100, h = 100;
                let data = { 
                    id, type: (type.includes('head') || type.includes('para')) ? 'text' : type, 
                    parentId, x, y, w, h, rotation: 0, opacity: 100, 
                    zIndex: this.elements.filter(e => e.parentId === parentId).length + 1, 
                    visible: true, locked: false,
                    strokeWidth: 0, strokeColor: '#000000', strokeAlign: 'center',
                    shadowBlur: 0, shadowColor: '#000000', shadowX: 0, shadowY: 0,
                    curveRadius: 0,
                    contourSteps: 0, contourOffset: 5, contourColor: '#8b5cf6',
                    borderRadius: 0,
                    layoutMode: 'none', gap: 10, padding: 10, alignItems: 'center'
                };

                if(type === 'rect') { data.bgColor = '#a855f7'; el.style.backgroundColor = data.bgColor; el.style.borderRadius = '0px'; }
                else if(type === 'circle') { data.bgColor = '#3b82f6'; el.style.backgroundColor = data.bgColor; el.style.borderRadius = '50%'; }
                else if(type === 'triangle') { data.bgColor = '#ef4444'; el.style.backgroundColor = data.bgColor; data.points = [{x:50,y:0},{x:0,y:100},{x:100,y:100}]; this.updatePolygonShape(el, data.points); }
                else if(type === 'header') { data.w=300; data.h=60; data.fontSize=32; data.text='Heading'; data.color='#0f172a'; data.fontWeight='700'; this.renderTextVisuals(el, data); }
                else if(type === 'paragraph') { data.w=200; data.h=40; data.fontSize=16; data.text='Body text'; data.color='#334155'; data.fontWeight='400'; this.renderTextVisuals(el, data); }
                
                Object.assign(el.style, { left: x+'px', top: y+'px', width: data.w+'px', height: data.h+'px', zIndex: data.zIndex });
                document.getElementById(parentId).appendChild(el);
                this.elements.push(data);
                if(data.type === 'text') this.autoResizeText(id);
                this.setSelection([id]);
                this.renderLayersPanel();
            }

            updatePolygonShape(el, points) { el.style.clipPath = `polygon(${points.map(p => `${p.x}% ${p.y}%`).join(', ')})`; }
            applyTextStyle(dom, data) { this.renderTextVisuals(dom, data); }

            autoResizeText(id) { 
                const e = this.elements.find(x => x.id === id); 
                if (!e || e.curveRadius !== 0) return; 
                const d = document.getElementById(id); 
                d.style.width = 'max-content'; 
                d.style.height = 'auto'; 
                e.w = d.offsetWidth; 
                e.h = d.offsetHeight; 
                d.style.width = e.w + 'px'; 
                d.style.height = e.h + 'px'; 
            }

            // --- Handlers ---
            handleMouseDown(e) {
                if (e.button === 2) return; this.hideContextMenu();
                
                const artboardTarget = e.target.closest('.artboard');
                if (artboardTarget) {
                    this.activeArtboardId = artboardTarget.id;
                    document.querySelectorAll('.artboard').forEach(ab => ab.classList.remove('active'));
                    artboardTarget.classList.add('active');
                    if(this.selection.size === 0) this.updatePropPanel(); 
                }

                if (e.target.classList.contains('handle')) {
                    e.stopPropagation();
                    const handle = e.target.dataset.handle;
                    const elId = Array.from(this.selection)[0];
                    const elData = this.elements.find(x => x.id === elId);
                    if (!elData) return;
                    if (handle === 'rot') {
                        this.mode = 'rotating';
                        const b = this.getGlobalBounds(elData);
                        this.startState = { cx: b.left + b.width/2, cy: b.top + b.height/2, startRotation: elData.rotation };
                    } else {
                        this.mode = 'resizing';
                        const descendants = [];
                        const captureDescendants = (parentId) => {
                            const children = this.elements.filter(el => el.parentId === parentId);
                            children.forEach(child => { descendants.push({ id: child.id, x: child.x, y: child.y, w: child.w, h: child.h, fontSize: child.fontSize || 16 }); if (child.type === 'group') captureDescendants(child.id); });
                        };
                        if (elData.type === 'group') captureDescendants(elData.id);
                        this.startState = { handle, mx: e.clientX, my: e.clientY, elData: JSON.parse(JSON.stringify(elData)), groupDescendants: descendants };
                    }
                    return;
                }
                
                if (e.target.classList.contains('handle-vertex')) {
                    e.stopPropagation();
                    const index = parseInt(e.target.dataset.index);
                    const elId = Array.from(this.selection)[0];
                    const elData = this.elements.find(x => x.id === elId);
                    if(elData.locked) return;
                    const b = this.getGlobalBounds(elData);
                    this.mode = 'moving-vertex';
                    this.startState = { pointIndex: index, elId: elId, elData: elData, cx: b.left + elData.w/2, cy: b.top + elData.h/2, rad: elData.rotation * (Math.PI / 180), w: elData.w, h: elData.h };
                    return;
                }
                
                if (e.code === 'Space' || e.button === 1 || this.currentTool === 'hand') { this.mode = 'panning'; this.startState = { mx: e.clientX, my: e.clientY, px: this.panX, py: this.panY }; return; }
                
                const elTarget = e.target.closest('.element');
                if (elTarget) {
                    let targetId = elTarget.id;
                    let elData = this.elements.find(e => e.id === targetId);
                    let current = elData;
                    while (current && current.parentId && !current.parentId.startsWith('ab_')) {
                        const parent = this.elements.find(p => p.id === current.parentId);
                        if (parent && parent.type === 'group') { current = parent; } else { break; }
                    }
                    if (current && current.id !== targetId) { targetId = current.id; elData = current; }
                    if(elData.locked) { if(!e.shiftKey) this.setSelection([]); return; }
                    if (!e.shiftKey && !this.selection.has(targetId)) this.setSelection([targetId]);
                    else if (e.shiftKey) this.toggleSelection(targetId);
                    this.mode = 'dragging';
                    this.startState = { mx: e.clientX, my: e.clientY, elements: Array.from(this.selection).map(id => { const d = this.elements.find(x => x.id === id); return { id, x: d.x, y: d.y }; })};
                } else {
                    if (!e.shiftKey) this.setSelection([]); 
                    this.mode = 'marquee'; this.startState = { ox: e.clientX, oy: e.clientY };
                    this.marquee.style.display = 'block'; this.updateMarquee(e.clientX, e.clientY);
                }
            }
            
            handleMouseMove(e) {
                if (this.mode === 'idle') return;
                const mx = e.clientX; const my = e.clientY;
                if (this.mode === 'panning') {
                    const dx = mx - this.startState.mx; const dy = my - this.startState.my;
                    this.panX = this.startState.px + dx; this.panY = this.startState.py + dy;
                    this.updateTransform(); return;
                }
                if (this.mode === 'dragging') {
                    const dx = (mx - this.startState.mx) / this.scale; const dy = (my - this.startState.my) / this.scale;
                    this.startState.elements.forEach((item) => {
                        const el = this.elements.find(x => x.id === item.id);
                        if(el.locked) return;
                        el.x = item.x + dx; el.y = item.y + dy;
                        const dom = document.getElementById(el.id);
                        dom.style.left = el.x + 'px'; dom.style.top = el.y + 'px';
                    });
                    this.renderGizmo(); 
                    if(this.selection.size === 1) this.refreshPanelValues(); 
                    return;
                }
                if (this.mode === 'resizing') {
                    const s = this.startState;
                    const elData = this.elements.find(x => x.id === s.elData.id);
                    const dxScreen = (mx - s.mx) / this.scale; const dyScreen = (my - s.my) / this.scale;
                    const rad = s.elData.rotation * (Math.PI / 180);
                    const dxLocal = dxScreen * Math.cos(rad) + dyScreen * Math.sin(rad);
                    const dyLocal = -dxScreen * Math.sin(rad) + dyScreen * Math.cos(rad);
                    let newW = s.elData.w; let newH = s.elData.h; let newX = s.elData.x; let newY = s.elData.y;
                    let dX = 0; let dY = 0;
                    if (s.handle.includes('r')) newW = Math.max(1, s.elData.w + dxLocal);
                    if (s.handle.includes('l')) { const change = Math.min(s.elData.w - 1, dxLocal); newW = s.elData.w - change; dX = change; }
                    if (s.handle.includes('b')) newH = Math.max(1, s.elData.h + dyLocal);
                    if (s.handle.includes('t')) { const change = Math.min(s.elData.h - 1, dyLocal); newH = s.elData.h - change; dY = change; }
                    const rotDX = dX * Math.cos(rad) - dY * Math.sin(rad);
                    const rotDY = dX * Math.sin(rad) + dY * Math.cos(rad);
                    newX += rotDX; newY += rotDY;
                    
                    if (elData.type === 'group' && s.groupDescendants) {
                        const scaleX = newW / s.elData.w; const scaleY = newH / s.elData.h;
                        s.groupDescendants.forEach(snap => {
                            const child = this.elements.find(c => c.id === snap.id);
                            if (child) {
                                child.x = snap.x * scaleX; child.y = snap.y * scaleY; child.w = snap.w * scaleX; child.h = snap.h * scaleY;
                                if(child.type === 'text') { child.fontSize = snap.fontSize * Math.min(scaleX, scaleY); this.renderTextVisuals(document.getElementById(child.id), child); }
                                else { const cDom = document.getElementById(child.id); cDom.style.left = child.x + 'px'; cDom.style.top = child.y + 'px'; cDom.style.width = child.w + 'px'; cDom.style.height = child.h + 'px'; }
                            }
                        });
                    }
                    if (elData.type === 'text') {
                        const scaleX = newW / s.elData.w; const scaleY = newH / s.elData.h;
                        const scale = s.handle.length === 2 ? Math.max(scaleX, scaleY) : (s.handle.includes('l') || s.handle.includes('r') ? scaleX : scaleY);
                        const newFS = Math.max(8, s.elData.fontSize * scale); elData.fontSize = newFS;
                        if(elData.curveRadius === 0) { const tempDom = document.getElementById(elData.id); this.renderTextVisuals(tempDom, elData); tempDom.style.width = 'max-content'; tempDom.style.height = 'auto'; newW = tempDom.offsetWidth; newH = tempDom.offsetHeight; }
                    }
                    elData.x = newX; elData.y = newY; elData.w = newW; elData.h = newH;
                    const domEl = document.getElementById(elData.id);
                    domEl.style.left = newX + 'px'; domEl.style.top = newY + 'px'; domEl.style.width = newW + 'px'; domEl.style.height = newH + 'px';
                    if (elData.type === 'text') this.renderTextVisuals(domEl, elData);
                    this.renderGizmo(); this.refreshPanelValues(); return;
                }
                if (this.mode === 'rotating') {
                    const rad = Math.atan2(my - this.startState.cy, mx - this.startState.cx);
                    let deg = rad * (180 / Math.PI) + 90;
                    const elId = Array.from(this.selection)[0]; const elData = this.elements.find(x => x.id === elId);
                    elData.rotation = deg; document.getElementById(elId).style.transform = `rotate(${deg}deg)`;
                    this.renderGizmo(); this.refreshPanelValues(); return;
                }
                if (this.mode === 'moving-vertex') {
                    const s = this.startState;
                    const wx = (mx - this.panX) / this.scale; const wy = (my - this.panY) / this.scale;
                    const dx = wx - s.cx; const dy = wy - s.cy;
                    const rotX = dx * Math.cos(-s.rad) - dy * Math.sin(-s.rad);
                    const rotY = dx * Math.sin(-s.rad) + dy * Math.cos(-s.rad);
                    const localX = rotX + s.w/2; const localY = rotY + s.h/2;
                    let pctX = (localX / s.w) * 100; let pctY = (localY / s.h) * 100;
                    s.elData.points[s.pointIndex] = {x: pctX, y: pctY};
                    const domEl = document.getElementById(s.elId);
                    this.updatePolygonShape(domEl, s.elData.points);
                    this.renderGizmo(); return;
                }
                if (this.mode === 'marquee') {
                    this.updateMarquee(mx, my);
                    this.checkMarqueeSelection(e.shiftKey);
                }
            }

            handleMouseUp() {
                this.mode = 'idle';
                this.marquee.style.display = 'none';
                this.clearGuides();
            }

            renderGizmo() {
                this.gizmoLayer.innerHTML = '';
                if (this.selection.size === 0) return;
                const firstId = Array.from(this.selection)[0];
                const firstEl = this.elements.find(e => e.id === firstId);
                if (firstEl && firstEl.locked) return;
                if (this.selection.size > 1) {
                     let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                     this.selection.forEach(id => {
                        const elData = this.elements.find(e => e.id === id);
                        if(!elData || !elData.visible) return;
                        const dom = document.getElementById(id);
                        const rect = dom.getBoundingClientRect();
                        const wx1 = (rect.left - this.panX) / this.scale; const wy1 = (rect.top - this.panY) / this.scale;
                        const wx2 = (rect.right - this.panX) / this.scale; const wy2 = (rect.bottom - this.panY) / this.scale;
                        minX = Math.min(minX, wx1); minY = Math.min(minY, wy1);
                        maxX = Math.max(maxX, wx2); maxY = Math.max(maxY, wy2);
                    });
                    const box = document.createElement('div');
                    box.style.position = 'absolute'; box.style.border = '1px solid var(--selection-color)';
                    box.style.left = minX + 'px'; box.style.top = minY + 'px';
                    box.style.width = (maxX - minX) + 'px'; box.style.height = (maxY - minY) + 'px';
                    this.gizmoLayer.appendChild(box);
                    return;
                }
                const elData = this.elements.find(e => e.id === firstId);
                if (!elData || !elData.visible) return;
                const b = this.getGlobalBounds(elData);
                const gizmo = document.createElement('div');
                gizmo.className = 'gizmo';
                Object.assign(gizmo.style, { left: b.left + 'px', top: b.top + 'px', width: elData.w + 'px', height: elData.h + 'px', transform: `rotate(${elData.rotation}deg)` });
                ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'].forEach(h => {
                    const div = document.createElement('div'); div.className = `handle handle-${h}`; div.dataset.handle = h;
                    div.style.cursor = this.getCursorForHandle(h, elData.rotation);
                    gizmo.appendChild(div);
                });
                const rotLine = document.createElement('div'); rotLine.className = 'handle-rot-connector'; gizmo.appendChild(rotLine);
                const rotHandle = document.createElement('div'); rotHandle.className = 'handle handle-rot'; rotHandle.dataset.handle = 'rot'; gizmo.appendChild(rotHandle);
                this.gizmoLayer.appendChild(gizmo);
            }

            getGlobalBounds(el) {
                let x = el.x; let y = el.y; let current = el;
                while(current.parentId && !current.parentId.startsWith('ab_')) {
                    const parent = this.elements.find(e => e.id === current.parentId);
                    if(parent) { x += parent.x; y += parent.y; current = parent; } else break;
                }
                const ab = this.artboards.find(a => a.id === current.parentId);
                if(ab) { x += ab.x; y += ab.y; }
                return { left: x, top: y, width: el.w, height: el.h };
            }

            // --- UI Rendering Methods ---
            renderLayersPanel() {
                if (!this.layersContent) return;
                this.layersContent.innerHTML = '';
                this.artboards.forEach(ab => {
                    const groupTitle = document.createElement('div');
                    groupTitle.className = 'layer-group-header';
                    groupTitle.textContent = "Artboard";
                    this.layersContent.appendChild(groupTitle);
                    const renderTree = (parentId, depth) => {
                        const children = this.elements.filter(e => e.parentId === parentId).sort((a,b) => b.zIndex - a.zIndex);
                        children.forEach(el => {
                            const item = document.createElement('div');
                            const isSelected = this.selection.has(el.id);
                            item.className = `layer-item ${isSelected ? 'active' : ''}`;
                            item.draggable = true;
                            item.style.paddingLeft = (12 + depth * 16) + 'px';
                            item.ondragstart = (e) => { this.draggedLayerId = el.id; item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
                            item.ondragend = () => { this.draggedLayerId = null; item.classList.remove('dragging'); document.querySelectorAll('.layer-item').forEach(i => i.classList.remove('drag-over-top', 'drag-over-bottom')); };
                            item.ondragover = (e) => { e.preventDefault(); if (this.draggedLayerId === el.id) return; const rect = item.getBoundingClientRect(); const mid = rect.top + rect.height/2; item.classList.remove('drag-over-top', 'drag-over-bottom'); if (e.clientY < mid) item.classList.add('drag-over-top'); else item.classList.add('drag-over-bottom'); };
                            item.ondragleave = () => { item.classList.remove('drag-over-top', 'drag-over-bottom'); };
                            item.ondrop = (e) => { e.preventDefault(); const rect = item.getBoundingClientRect(); const mid = rect.top + rect.height/2; const pos = e.clientY < mid ? 'before' : 'after'; this.reorderLayers(this.draggedLayerId, el.id, pos); };
                            let icon = 'box'; if(el.type==='group') icon = 'folder'; else if(el.type==='text') icon='type'; else if (el.type === 'circle') icon='circle'; else if(el.type === 'triangle') icon='triangle';
                            let name = el.type; if(el.type==='text') name = el.text ? el.text.substring(0,10) : 'Text';
                            item.innerHTML = `<i data-lucide="${icon}" class="layer-icon"></i><span class="truncate flex-1">${name}</span><div class="layer-actions"><button class="layer-action-btn" onclick="app.toggleVisibility('${el.id}')"><i data-lucide="${el.visible?'eye':'eye-off'}" style="width:12px"></i></button><button class="layer-action-btn ${el.locked?'text-red-500':''}" onclick="app.toggleLock('${el.id}')"><i data-lucide="${el.locked?'lock':'unlock'}" style="width:12px"></i></button></div>`;
                            item.onclick = (e) => { if(e.target.closest('.layer-action-btn')) return; if(e.shiftKey) this.toggleSelection(el.id); else this.setSelection([el.id]); };
                            this.layersContent.appendChild(item);
                            if(el.type === 'group') { renderTree(el.id, depth + 1); }
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
                const siblings = this.elements.filter(e => e.parentId === draggedEl.parentId).sort((a,b) => a.zIndex - b.zIndex);
                const fromIdx = siblings.findIndex(e => e.id === draggedId);
                siblings.splice(fromIdx, 1);
                const newIdx = siblings.findIndex(e => e.id === targetId);
                if (pos === 'before') siblings.splice(newIdx + 1, 0, draggedEl); else siblings.splice(newIdx, 0, draggedEl);
                siblings.forEach((el, i) => { el.zIndex = i + 1; const dom = document.getElementById(el.id); if(dom) dom.style.zIndex = el.zIndex; });
                this.renderLayersPanel(); this.renderGizmo();
            }

            refreshPanelValues() {
                if (this.selection.size !== 1) return;
                const id = Array.from(this.selection)[0];
                const el = this.elements.find(e => e.id === id);
                if (!el) return;
                
                const setVal = (pid, val) => { const inp = document.getElementById(pid); if (inp && document.activeElement !== inp) inp.value = val; };
                
                setVal('prop-x', Math.round(el.x));
                setVal('prop-y', Math.round(el.y));
                setVal('prop-w', Math.round(el.w));
                setVal('prop-h', Math.round(el.h));
                setVal('prop-rotation', Math.round(el.rotation));
                
                if (['rect', 'circle', 'triangle'].includes(el.type)) {
                    setVal('prop-bgColor', el.bgColor);
                } else if (el.type === 'text') {
                    setVal('prop-text', el.text);
                    setVal('prop-fontSize', el.fontSize);
                    setVal('prop-color', el.color);
                }
            }

            // ... (Context Menu Actions)
            handleContextMenu(e) { e.preventDefault(); this.contextMenu.style.display = 'block'; this.contextMenu.style.left = e.clientX + 'px'; this.contextMenu.style.top = e.clientY + 'px'; }
            hideContextMenu() { this.contextMenu.style.display = 'none'; }
            copySelected() { this.clipboard = Array.from(this.selection).map(id => { const el = this.elements.find(e => e.id === id); return JSON.parse(JSON.stringify(el)); }); this.hideContextMenu(); }
            paste() { if (this.clipboard.length === 0) return; this.clearSelection(); const newIds = []; this.clipboard.forEach(data => { const newId = 'el_' + Date.now() + Math.floor(Math.random() * 1000); const dom = document.createElement('div'); dom.className = 'element'; dom.id = newId; data.x += 20; data.y += 20; if (data.type === 'rect') { dom.style.backgroundColor = data.bgColor; dom.style.borderRadius = '0px'; } else if (data.type === 'circle') { dom.style.backgroundColor = data.bgColor; dom.style.borderRadius = '50%'; } else if (data.type === 'triangle') { dom.style.backgroundColor = data.bgColor; this.updatePolygonShape(dom, data.points); } else if (data.type === 'text') { this.renderTextVisuals(dom, data); } else if (data.type === 'group') { dom.dataset.type = 'group'; } Object.assign(dom.style, { left: data.x+'px', top: data.y+'px', width: data.w+'px', height: data.h+'px', zIndex: this.elements.length + 1, transform: `rotate(${data.rotation}deg)` }); let targetParent = document.getElementById(data.parentId); if (!targetParent) targetParent = document.getElementById(this.artboards[0].id); targetParent.appendChild(dom); const newEl = { ...data, id: newId }; this.elements.push(newEl); newIds.push(newId); }); this.setSelection(newIds); this.renderLayersPanel(); this.hideContextMenu(); }
            duplicateSelected() { this.copySelected(); this.paste(); }
            deleteSelected() { this.selection.forEach(id => { const dom = document.getElementById(id); if(dom) dom.remove(); this.elements = this.elements.filter(el => el.id !== id); }); this.clearSelection(); this.renderLayersPanel(); this.hideContextMenu(); }
            lockSelected() { this.selection.forEach(id => this.toggleLock(id)); this.hideContextMenu(); }
            arrange(action) { const ids = Array.from(this.selection); if(ids.length === 0) return; const els = ids.map(id => this.elements.find(e => e.id === id)); els.sort((a,b) => a.zIndex - b.zIndex); if (action === 'front') { const maxZ = Math.max(...this.elements.map(e => e.zIndex)) || 1; els.forEach((e, i) => { e.zIndex = maxZ + 1 + i; document.getElementById(e.id).style.zIndex = e.zIndex; }); } else if (action === 'back') { const minZ = Math.min(...this.elements.map(e => e.zIndex)) || 1; els.forEach((e, i) => { e.zIndex = Math.max(0, minZ - (els.length - i)); document.getElementById(e.id).style.zIndex = e.zIndex; }); } this.renderLayersPanel(); this.hideContextMenu(); }
            groupSelected() { if (this.selection.size < 2) return; const ids = Array.from(this.selection); const els = ids.map(id => this.elements.find(e => e.id === id)); const parentId = els[0].parentId; let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; els.forEach(e => { minX = Math.min(minX, e.x); minY = Math.min(minY, e.y); maxX = Math.max(maxX, e.x + e.w); maxY = Math.max(maxY, e.y + e.h); }); const w = maxX - minX; const h = maxY - minY; const groupId = 'grp_' + Date.now(); const groupDom = document.createElement('div'); groupDom.className = 'element'; groupDom.id = groupId; groupDom.dataset.type = 'group'; Object.assign(groupDom.style, { left: minX + 'px', top: minY + 'px', width: w + 'px', height: h + 'px', zIndex: Math.max(...els.map(e => e.zIndex)) + 1 }); document.getElementById(parentId).appendChild(groupDom); this.elements.push({ id: groupId, type: 'group', parentId, x: minX, y: minY, w, h, rotation: 0, opacity: 100, zIndex: 100, visible: true, locked: false, layoutMode: 'none', gap: 10, padding: 10, alignItems: 'center' }); els.forEach(e => { const dom = document.getElementById(e.id); e.parentId = groupId; e.x -= minX; e.y -= minY; dom.style.left = e.x + 'px'; dom.style.top = e.y + 'px'; groupDom.appendChild(dom); }); this.setSelection([groupId]); this.renderLayersPanel(); this.hideContextMenu(); }
            ungroupSelected() { const ids = Array.from(this.selection); const groups = ids.map(id => this.elements.find(e => e.id === id)).filter(e => e.type === 'group'); if (groups.length === 0) return; const newSelection = []; groups.forEach(grp => { const children = this.elements.filter(e => e.parentId === grp.id); const grandParent = document.getElementById(grp.parentId); const grpDom = document.getElementById(grp.id); children.forEach(child => { const dom = document.getElementById(child.id); child.parentId = grp.parentId; child.x += grp.x; child.y += grp.y; dom.style.left = child.x + 'px'; dom.style.top = child.y + 'px'; grandParent.appendChild(dom); newSelection.push(child.id); }); grpDom.remove(); this.elements = this.elements.filter(e => e.id !== grp.id); }); this.setSelection(newSelection); this.renderLayersPanel(); this.hideContextMenu(); }
            toggleLock(id) { const el = this.elements.find(e => e.id === id); if (el) { el.locked = !el.locked; const dom = document.getElementById(id); if (dom) dom.classList.toggle('locked', el.locked); if (el.locked && this.selection.has(id)) this.renderGizmo(); this.renderLayersPanel(); } }
            toggleVisibility(id) { const el = this.elements.find(e => e.id === id); if (el) { el.visible = !el.visible; const dom = document.getElementById(id); if (dom) dom.style.display = el.visible ? 'flex' : 'none'; if (!el.visible && this.selection.has(id)) { this.selection.delete(id); this.renderGizmo(); } this.renderLayersPanel(); } }
            clearSelection() { this.selection.clear(); this.renderGizmo(); this.renderLayersPanel(); this.updatePropPanel(); }
            updateMarquee(mx, my) { const ox = this.startState.ox; const oy = this.startState.oy; const x = Math.min(ox, mx); const y = Math.min(oy, my); Object.assign(this.marquee.style, { left: x+'px', top: y+'px', width: Math.abs(ox-mx)+'px', height: Math.abs(oy-my)+'px' }); }
            checkMarqueeSelection(shift) { const mRect = this.marquee.getBoundingClientRect(); const newSelection = new Set(shift ? this.selection : []); this.elements.forEach(el => { if (!el.visible || el.locked) return; const rect = document.getElementById(el.id).getBoundingClientRect(); if (mRect.left < rect.right && mRect.right > rect.left && mRect.top < rect.bottom && mRect.bottom > rect.top) { newSelection.add(el.id); } }); this.setSelection(Array.from(newSelection)); }
            toggleSelection(id) { if(this.selection.has(id)) this.selection.delete(id); else this.selection.add(id); this.renderGizmo(); this.renderLayersPanel(); this.updatePropPanel(); }
            setSelection(ids) { this.selection = new Set(ids); this.renderGizmo(); this.renderLayersPanel(); this.updatePropPanel(); }
            clearGuides() { this.guideLayer.innerHTML = ''; }
            addArtboard() { this.createArtboard(this.artboards.length*820,0,800,600, 'Page '+(this.artboards.length+1)); }
            addRect() { this.addEl('rect'); }
            addCircle() { this.addEl('circle'); }
            addTriangle() { this.addEl('triangle'); }
            addText(t) { this.addEl(t); }
            addEl(t) { let pid = this.artboards[0].id; if(this.selection.size > 0) { const sel = this.elements.find(e=>e.id===Array.from(this.selection)[0]); if(sel) pid = sel.type === 'group' ? sel.id : sel.parentId; } this.createElement(t, 50, 50, pid); }
            setTool(t) { this.currentTool = t; document.querySelectorAll('.tool-btn').forEach(b => { const a = b.id === 'btn-' + t; b.classList.toggle('text-purple-600', a); b.classList.toggle('bg-purple-50', a); b.classList.toggle('text-slate-500', !a); }); this.renderGizmo(); }
            handleWheel(e) { if (e.ctrlKey) { e.preventDefault(); const rect = this.viewport.getBoundingClientRect(); const mx = e.clientX - rect.left; const my = e.clientY - rect.top; const os = this.scale; this.scale = Math.max(0.1, Math.min(5, this.scale - e.deltaY * 0.001)); this.panX = mx - (mx - this.panX) * (this.scale / os); this.panY = my - (my - this.panY) * (this.scale / os); this.updateTransform(); } else { this.panX -= e.deltaX; this.panY -= e.deltaY; this.updateTransform(); } }
            handleKeyDown(e) { if (e.code === 'Space') this.viewport.classList.add('panning'); if (e.key === 'v') this.setTool('select'); if (e.key === 'a') this.setTool('node'); if (e.key === 'h') this.setTool('hand'); if (e.key === 'Delete' || e.key === 'Backspace') { this.selection.forEach(id => { document.getElementById(id)?.remove(); this.elements = this.elements.filter(el => el.id !== id); }); this.setSelection([]); this.renderLayersPanel(); } }
            handleKeyUp(e) { if (e.code === 'Space') this.viewport.classList.remove('panning'); }
            autoFit() { if (!this.artboards.length) return; const pad = 50; let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; this.artboards.forEach(a => { minX = Math.min(minX, a.x); minY = Math.min(minY, a.y); maxX = Math.max(maxX, a.x + a.w); maxY = Math.max(maxY, a.y + a.h); }); const w = maxX - minX; const h = maxY - minY; const sc = Math.min((this.viewport.clientWidth - pad * 2) / w, (this.viewport.clientHeight - pad * 2) / h); this.scale = Math.min(sc, 1.2); this.panX = (this.viewport.clientWidth - w * this.scale) / 2 - minX * this.scale; this.panY = (this.viewport.clientHeight - h * this.scale) / 2 - minY * this.scale; this.updateTransform(); }
            zoom(d) { this.scale = Math.max(0.1, Math.min(5, this.scale + d)); this.updateTransform(); }

            updatePropPanel() { 
                const count = this.selection.size; 
                if (this.selCountLabel) {
                    this.selCountLabel.style.display = count > 0 ? 'block' : 'none'; 
                    this.selCountLabel.textContent = `${count} selected`; 
                }
                
                if (count === 0) { 
                    // Show Artboard Settings
                    const activeArtboard = this.artboards.find(a => a.id === this.activeArtboardId) || this.artboards[0];
                    if (!activeArtboard) {
                        this.propPanel.innerHTML = `<div class="text-center py-10 text-slate-400 text-sm">No Artboards</div>`;
                        return;
                    }
                    
                    let html = `
                        <div class="p-4 flex flex-col gap-4">
                             <!-- Dimensions -->
                            <details open>
                                <summary>Dimensions</summary>
                                <div class="details-content grid grid-cols-2 gap-2 pt-2">
                                    <div><label class="text-[10px] text-slate-400">W</label><input type="number" value="${activeArtboard.w}" onchange="app.updateArtboardProp('${activeArtboard.id}', 'w', this.value)"></div>
                                    <div><label class="text-[10px] text-slate-400">H</label><input type="number" value="${activeArtboard.h}" onchange="app.updateArtboardProp('${activeArtboard.id}', 'h', this.value)"></div>
                                    <div class="col-span-2 mt-2">
                                        <label class="text-[10px] text-slate-400">Background</label>
                                        <div class="flex items-center gap-2 mt-1">
                                            <input type="color" value="${activeArtboard.bgColor}" oninput="app.updateArtboardProp('${activeArtboard.id}', 'bgColor', this.value)">
                                        </div>
                                    </div>
                                </div>
                            </details>
                            
                            <!-- Margins (New Guide Layout Style) -->
                            <details open>
                                <summary>
                                    Margins 
                                    <input type="checkbox" ${activeArtboard.marginEnabled ? 'checked' : ''} onclick="event.stopPropagation(); app.updateArtboardMargin('${activeArtboard.id}', 'enabled', this.checked)">
                                </summary>
                                <div class="details-content pt-2 ${!activeArtboard.marginEnabled ? 'opacity-50 pointer-events-none' : ''}">
                                    <div class="grid grid-cols-2 gap-2">
                                        <div><label class="text-[9px] text-slate-400">Top</label><input type="number" value="${activeArtboard.marginTop}" onchange="app.updateArtboardMargin('${activeArtboard.id}', 'marginTop', this.value)"></div>
                                        <div><label class="text-[9px] text-slate-400">Left</label><input type="number" value="${activeArtboard.marginLeft}" onchange="app.updateArtboardMargin('${activeArtboard.id}', 'marginLeft', this.value)"></div>
                                        <div><label class="text-[9px] text-slate-400">Bottom</label><input type="number" value="${activeArtboard.marginBottom}" onchange="app.updateArtboardMargin('${activeArtboard.id}', 'marginBottom', this.value)"></div>
                                        <div><label class="text-[9px] text-slate-400">Right</label><input type="number" value="${activeArtboard.marginRight}" onchange="app.updateArtboardMargin('${activeArtboard.id}', 'marginRight', this.value)"></div>
                                    </div>
                                    <div class="mt-2 flex items-center gap-2">
                                         <div style="width:14px; height:14px; background:#00ffff; border:1px solid #ddd;"></div>
                                         <span class="text-[9px] text-slate-400">Cyan Guide Color</span>
                                    </div>
                                </div>
                            </details>
                        </div>
                    `;
                    this.propPanel.innerHTML = html;
                    return; 
                } 
                
                const id = Array.from(this.selection)[0]; const el = this.elements.find(e => e.id === id); if(!el) return;

                let html = `
                <div class="p-4 flex flex-col gap-4">
                    <!-- Layout Section -->
                    <details open>
                        <summary>Layout</summary>
                        <div class="details-content grid grid-cols-2 gap-2 pt-2">
                            <div><label class="text-[10px] text-slate-400">X</label><input id="prop-x" type="number" value="${Math.round(el.x)}" onchange="app.updateProp('${id}', 'x', this.value)"></div>
                            <div><label class="text-[10px] text-slate-400">Y</label><input id="prop-y" type="number" value="${Math.round(el.y)}" onchange="app.updateProp('${id}', 'y', this.value)"></div>
                            <div><label class="text-[10px] text-slate-400">W</label><input id="prop-w" type="number" value="${Math.round(el.w)}" onchange="app.updateProp('${id}', 'w', this.value)"></div>
                            <div><label class="text-[10px] text-slate-400">H</label><input id="prop-h" type="number" value="${Math.round(el.h)}" onchange="app.updateProp('${id}', 'h', this.value)"></div>
                            <div class="col-span-2 flex items-center gap-2"><label class="text-[10px] text-slate-400 w-4">R°</label><input id="prop-rotation" type="number" value="${Math.round(el.rotation)}" onchange="app.updateProp('${id}', 'rotation', this.value)"></div>
                        </div>
                    </details>
                    
                    <div class="flex flex-col gap-2">
                         <div class="flex items-center justify-between gap-1 bg-slate-50 p-1 rounded-lg">
                            <button onclick="app.alignElements('left')" class="icon-btn" title="Align Left"><i data-lucide="align-left"></i></button>
                            <button onclick="app.alignElements('center')" class="icon-btn" title="Align Center"><i data-lucide="align-center"></i></button>
                            <button onclick="app.alignElements('right')" class="icon-btn" title="Align Right"><i data-lucide="align-right"></i></button>
                            <div class="w-px h-4 bg-slate-300"></div>
                            <button onclick="app.alignElements('top')" class="icon-btn" title="Align Top"><i data-lucide="align-vertical-justify-start"></i></button>
                            <button onclick="app.alignElements('middle')" class="icon-btn" title="Align Middle"><i data-lucide="align-vertical-justify-center"></i></button>
                            <button onclick="app.alignElements('bottom')" class="icon-btn" title="Align Bottom"><i data-lucide="align-vertical-justify-end"></i></button>
                        </div>
                    </div>
                `;

                if (el.type === 'text') {
                    html += `
                    <details open>
                        <summary>Typography</summary>
                        <div class="details-content flex flex-col gap-2 pt-2">
                            <div class="flex flex-col gap-1">
                                <label class="text-[9px] text-slate-400">Content</label>
                                <input id="prop-text" type="text" value="${el.text}" oninput="app.updateProp('${id}', 'text', this.value)">
                            </div>
                            <div class="grid grid-cols-2 gap-2">
                                <div><label class="text-[9px] text-slate-400">Size</label><input id="prop-fontSize" type="number" value="${el.fontSize}" onchange="app.updateProp('${id}', 'fontSize', this.value)"></div>
                                <div><label class="text-[9px] text-slate-400">Color</label><div class="mt-1"><input id="prop-color" type="color" value="${el.color}" oninput="app.updateProp('${id}', 'color', this.value)" style="width:100%;height:22px;"></div></div>
                            </div>
                        </div>
                    </details>
                    
                    <details>
                        <summary>Effects</summary>
                        <div class="details-content flex flex-col gap-3 pt-2">
                             <!-- Circular -->
                            <div>
                                <div class="flex justify-between mb-1"><span class="text-[10px] font-semibold text-slate-600">Curve</span></div>
                                <div class="flex items-center gap-2">
                                    <input type="range" min="-300" max="300" value="${el.curveRadius}" class="flex-1" oninput="app.updateProp('${id}', 'curveRadius', this.value)">
                                    <span id="val-curveRadius" class="text-[9px] text-slate-400 w-8 text-right">${el.curveRadius}</span>
                                </div>
                            </div>
                             <!-- Stroke -->
                            <div>
                                <div class="flex justify-between mb-1">
                                    <span class="text-[10px] font-semibold text-slate-600">Stroke</span>
                                    <select onchange="app.updateProp('${id}', 'strokeAlign', this.value)" class="w-16 text-[9px] p-0.5 border rounded h-5">
                                        <option value="center" ${el.strokeAlign === 'center' ? 'selected' : ''}>Center</option>
                                        <option value="outside" ${el.strokeAlign === 'outside' ? 'selected' : ''}>Out</option>
                                    </select>
                                </div>
                                <div class="flex items-center gap-2 mb-1">
                                    <input type="color" value="${el.strokeColor}" oninput="app.updateProp('${id}', 'strokeColor', this.value)" style="width:20px;height:20px;">
                                    <input type="number" value="${el.strokeWidth}" min="0" max="20" class="w-12" onchange="app.updateProp('${id}', 'strokeWidth', this.value)">
                                    <span class="text-[10px] text-slate-400">px</span>
                                </div>
                            </div>
                            <!-- Shadow -->
                            <div>
                                <div class="flex justify-between mb-1"><span class="text-[10px] font-semibold text-slate-600">Drop Shadow</span></div>
                                <div class="grid grid-cols-2 gap-2 mb-1">
                                    <div><label class="text-[9px] text-slate-400">Blur</label><input type="number" value="${el.shadowBlur}" class="w-full" onchange="app.updateProp('${id}', 'shadowBlur', this.value)"></div>
                                    <div><label class="text-[9px] text-slate-400">Color</label><div class="mt-1"><input type="color" value="${el.shadowColor}" oninput="app.updateProp('${id}', 'shadowColor', this.value)" style="width:100%;height:22px;"></div></div>
                                    <div><label class="text-[9px] text-slate-400">X</label><input type="number" value="${el.shadowX}" class="w-full" onchange="app.updateProp('${id}', 'shadowX', this.value)"></div>
                                    <div><label class="text-[9px] text-slate-400">Y</label><input type="number" value="${el.shadowY}" class="w-full" onchange="app.updateProp('${id}', 'shadowY', this.value)"></div>
                                </div>
                            </div>
                            <!-- Contour -->
                            <div>
                                <div class="flex justify-between mb-1"><span class="text-[10px] font-semibold text-slate-600">Contour</span></div>
                                <div class="grid grid-cols-2 gap-2 mb-1">
                                    <div><label class="text-[9px] text-slate-400">Steps</label><input type="number" value="${el.contourSteps}" min="0" max="10" class="w-full" onchange="app.updateProp('${id}', 'contourSteps', this.value)"></div>
                                    <div><label class="text-[9px] text-slate-400">Offset</label><input type="number" value="${el.contourOffset}" min="1" max="10" class="w-full" onchange="app.updateProp('${id}', 'contourOffset', this.value)"></div>
                                    <div class="col-span-2 flex items-center gap-2"><input type="color" value="${el.contourColor}" oninput="app.updateProp('${id}', 'contourColor', this.value)" style="width:20px;height:20px;"><span class="text-[9px] text-slate-400">Color</span></div>
                                </div>
                            </div>
                        </div>
                    </details>`;
                } else if (['rect', 'circle', 'triangle'].includes(el.type)) { 
                    html += `
                    <details open>
                        <summary>Style</summary>
                        <div class="details-content pt-2">
                             <div class="flex items-center justify-between mb-2">
                                <span class="text-xs text-slate-600">Fill Color</span>
                                <div class="flex items-center gap-2"><input id="prop-bgColor" type="color" value="${el.bgColor}" oninput="app.updateProp('${id}', 'bgColor', this.value)"></div>
                            </div>
                            ${el.type === 'rect' ? `<div><label class="text-[9px] text-slate-400">Corner Radius</label><input type="range" min="0" max="100" value="${parseInt(el.borderRadius)||0}" class="w-full" oninput="app.updateProp('${id}', 'borderRadius', this.value)"><span id="val-borderRadius" class="text-[9px] text-slate-400 block text-right">${parseInt(el.borderRadius)||0}</span></div>` : ''}
                        </div>
                    </details>
                    <details>
                        <summary>Effects</summary>
                        <div class="details-content flex flex-col gap-3 pt-2">
                            <!-- Contour for Shape -->
                            <div>
                                <div class="flex justify-between mb-1"><span class="text-[10px] font-semibold text-slate-600">Contour</span></div>
                                <div class="grid grid-cols-2 gap-2 mb-1">
                                    <div><label class="text-[9px] text-slate-400">Steps</label><input type="number" value="${el.contourSteps}" min="0" max="10" class="w-full" onchange="app.updateProp('${id}', 'contourSteps', this.value)"></div>
                                    <div><label class="text-[9px] text-slate-400">Offset</label><input type="number" value="${el.contourOffset}" min="1" max="10" class="w-full" onchange="app.updateProp('${id}', 'contourOffset', this.value)"></div>
                                    <div class="col-span-2 flex items-center gap-2"><input type="color" value="${el.contourColor}" oninput="app.updateProp('${id}', 'contourColor', this.value)" style="width:20px;height:20px;"><span class="text-[9px] text-slate-400">Color</span></div>
                                </div>
                            </div>
                        </div>
                    </details>`; 
                } 
                
                // Auto Layout UI for Groups
                if (el.type === 'group') {
                    html += `
                    <details open>
                        <summary>Auto Layout</summary>
                        <div class="details-content flex flex-col gap-3 pt-2">
                             <div class="flex justify-between items-center">
                                <span class="text-[10px] text-slate-600">Mode</span>
                                <div class="flex bg-slate-100 rounded p-0.5">
                                    <button onclick="app.updateProp('${id}', 'layoutMode', 'none')" class="p-1 rounded ${el.layoutMode==='none'?'bg-white shadow':''}"><i data-lucide="x" style="width:12px"></i></button>
                                    <button onclick="app.updateProp('${id}', 'layoutMode', 'horizontal')" class="p-1 rounded ${el.layoutMode==='horizontal'?'bg-white shadow':''}"><i data-lucide="arrow-right" style="width:12px"></i></button>
                                    <button onclick="app.updateProp('${id}', 'layoutMode', 'vertical')" class="p-1 rounded ${el.layoutMode==='vertical'?'bg-white shadow':''}"><i data-lucide="arrow-down" style="width:12px"></i></button>
                                </div>
                             </div>
                             ${el.layoutMode !== 'none' ? `
                             <div class="grid grid-cols-2 gap-2">
                                <div><label class="text-[9px] text-slate-400">Gap</label><input type="number" value="${el.gap}" onchange="app.updateProp('${id}', 'gap', this.value)"></div>
                                <div><label class="text-[9px] text-slate-400">Padding</label><input type="number" value="${el.padding}" onchange="app.updateProp('${id}', 'padding', this.value)"></div>
                             </div>
                             <div class="flex justify-between items-center">
                                <span class="text-[10px] text-slate-600">Align</span>
                                <select onchange="app.updateProp('${id}', 'alignItems', this.value)" class="w-24 text-[9px] p-1 border rounded">
                                    <option value="start" ${el.alignItems==='start'?'selected':''}>Start</option>
                                    <option value="center" ${el.alignItems==='center'?'selected':''}>Center</option>
                                    <option value="end" ${el.alignItems==='end'?'selected':''}>End</option>
                                </select>
                             </div>` : ''}
                        </div>
                    </details>`;
                }

                html += `</div>`;
                this.propPanel.innerHTML = html; 
                lucide.createIcons(); 
            }
            
            updateProp(id, key, value) { 
                const el = this.elements.find(e => e.id === id); 
                if (!el) return; 
                
                if (['x','y','w','h','rotation','fontSize','opacity', 'strokeWidth', 'shadowBlur', 'shadowX', 'shadowY', 'curveRadius', 'contourSteps', 'contourOffset', 'gap', 'padding'].includes(key)) value = parseFloat(value); 
                
                el[key] = value; 
                
                const dom = document.getElementById(id); 
                if (key === 'x') dom.style.left = value + 'px'; 
                if (key === 'y') dom.style.top = value + 'px'; 
                if (key === 'w') dom.style.width = value + 'px'; 
                if (key === 'h') dom.style.height = value + 'px'; 
                if (key === 'rotation') dom.style.transform = `rotate(${value}deg)`; 
                if (key === 'bgColor') dom.style.backgroundColor = value; 
                
                // Text specific updates handled by renderTextVisuals
                if (el.type === 'text') {
                     this.renderTextVisuals(dom, el);
                     if (key === 'text') this.autoResizeText(id);
                }

                if (key === 'opacity') dom.style.opacity = value / 100; 
                
                // Shape radius
                if (key === 'borderRadius' && el.type === 'rect') {
                    dom.style.borderRadius = value + 'px';
                }

                // Shape Contour
                if (['rect', 'circle', 'triangle'].includes(el.type) && (key === 'contourSteps' || key === 'contourOffset' || key === 'contourColor')) {
                     if (el.contourSteps > 0) {
                         const dist = el.contourSteps * el.contourOffset;
                         dom.style.boxShadow = `0 0 0 ${dist}px ${el.contourColor}`;
                     } else {
                         dom.style.boxShadow = 'none';
                     }
                }

                // Auto Layout Trigger
                if ((key === 'layoutMode' || key === 'gap' || key === 'padding' || key === 'alignItems') && el.type === 'group') {
                    this.applyAutoLayout(id);
                }

                this.renderGizmo(); 
                
                // Live update label values for sliders without full rebuild
                const valSpan = document.getElementById('val-' + key);
                if(valSpan) valSpan.textContent = value;
                
                if (!['curveRadius', 'strokeWidth', 'shadowBlur', 'contourSteps', 'borderRadius'].includes(key)) {
                    this.refreshPanelValues(); 
                }
                
                // Only full rebuild if necessary for structural changes
                if (key === 'text' || key === 'strokeAlign') this.renderLayersPanel(); 
                
                if (key === 'strokeAlign' || key === 'layoutMode') this.updatePropPanel();
            }
            
            alignElements(mode) { const ids = Array.from(this.selection); if(ids.length === 0) return; const els = ids.map(id => this.elements.find(e => e.id === id)); let bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }; if (ids.length === 1) { const parent = this.artboards.find(a => a.id === els[0].parentId); if(parent) { if (parent.marginEnabled) { bounds = { minX: parent.marginLeft, minY: parent.marginTop, maxX: parent.w - parent.marginRight, maxY: parent.h - parent.marginBottom }; } else { bounds = { minX: 0, minY: 0, maxX: parent.w, maxY: parent.h }; } } } else { els.forEach(e => { bounds.minX = Math.min(bounds.minX, e.x); bounds.minY = Math.min(bounds.minY, e.y); bounds.maxX = Math.max(bounds.maxX, e.x + e.w); bounds.maxY = Math.max(bounds.maxY, e.y + e.h); }); } const centerX = bounds.minX + (bounds.maxX - bounds.minX)/2; const centerY = bounds.minY + (bounds.maxY - bounds.minY)/2; els.forEach(e => { if(mode === 'left') e.x = bounds.minX; if(mode === 'center') e.x = centerX - e.w/2; if(mode === 'right') e.x = bounds.maxX - e.w; if(mode === 'top') e.y = bounds.minY; if(mode === 'middle') e.y = centerY - e.h/2; if(mode === 'bottom') e.y = bounds.maxY - e.h; const dom = document.getElementById(e.id); dom.style.left = e.x + 'px'; dom.style.top = e.y + 'px'; }); this.renderGizmo(); this.refreshPanelValues(); }
            distributeElements(axis) { const ids = Array.from(this.selection); if (ids.length < 3) return; const els = ids.map(id => this.elements.find(e => e.id === id)); if (axis === 'h') { els.sort((a,b) => a.x - b.x); const totalDist = els[els.length-1].x - els[0].x; const step = totalDist / (els.length - 1); els.forEach((e, i) => { e.x = els[0].x + (step * i); document.getElementById(e.id).style.left = e.x + 'px'; }); } else { els.sort((a,b) => a.y - b.y); const totalDist = els[els.length-1].y - els[0].y; const step = totalDist / (els.length - 1); els.forEach((e, i) => { e.y = els[0].y + (step * i); document.getElementById(e.id).style.top = e.y + 'px'; }); } this.renderGizmo(); this.refreshPanelValues(); }
            
            applyAutoLayout(groupId) {
                const group = this.elements.find(e => e.id === groupId);
                if (!group || group.layoutMode === 'none') return;
                const children = this.elements.filter(e => e.parentId === groupId);
                if (group.layoutMode === 'horizontal') children.sort((a, b) => a.x - b.x); else children.sort((a, b) => a.y - b.y);
                
                let currentPos = group.padding;
                let maxCrossSize = 0;
                children.forEach(child => {
                    if (group.layoutMode === 'horizontal') {
                        child.x = currentPos; currentPos += child.w + group.gap; maxCrossSize = Math.max(maxCrossSize, child.h);
                    } else {
                        child.y = currentPos; currentPos += child.h + group.gap; maxCrossSize = Math.max(maxCrossSize, child.w);
                    }
                    const cDom = document.getElementById(child.id); if(cDom) { cDom.style.left = child.x + 'px'; cDom.style.top = child.y + 'px'; }
                });
                
                if (group.layoutMode === 'horizontal') {
                    group.w = Math.max(10, currentPos - group.gap + group.padding); group.h = maxCrossSize + (group.padding * 2);
                    children.forEach(child => {
                         if (group.alignItems === 'center') child.y = group.padding + (maxCrossSize - child.h)/2;
                         else if (group.alignItems === 'end') child.y = group.h - group.padding - child.h;
                         else child.y = group.padding;
                         document.getElementById(child.id).style.top = child.y + 'px';
                    });
                } else {
                    group.h = Math.max(10, currentPos - group.gap + group.padding); group.w = maxCrossSize + (group.padding * 2);
                    children.forEach(child => {
                         if (group.alignItems === 'center') child.x = group.padding + (maxCrossSize - child.w)/2;
                         else if (group.alignItems === 'end') child.x = group.w - group.padding - child.w;
                         else child.x = group.padding;
                         document.getElementById(child.id).style.left = child.x + 'px';
                    });
                }
                const grpDom = document.getElementById(group.id); if (grpDom) { grpDom.style.width = group.w + 'px'; grpDom.style.height = group.h + 'px'; }
                this.renderGizmo();
            }
        }

        window.app = new MiniCanva();