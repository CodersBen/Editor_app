// Persistent storage for projects and templates (localStorage-backed).
const Store = {
    PROJECTS_KEY: 'craf.projects.v1',
    TEMPLATES_KEY: 'craf.templates.v1',

    _read(key) {
        try { return JSON.parse(localStorage.getItem(key)) || []; }
        catch { return []; }
    },
    _write(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); }
        catch (e) { console.warn('Storage write failed', e); }
    },

    loadProjects() { return this._read(this.PROJECTS_KEY); },
    saveProjects(list) { this._write(this.PROJECTS_KEY, list); },

    getProject(id) { return this.loadProjects().find(p => p.id === id) || null; },

    createProject(name, client, data) {
        const now = Date.now();
        const project = {
            id: 'proj_' + now + '_' + Math.floor(Math.random() * 1e4),
            name: name || 'Untitled design',
            client: client || '',
            createdAt: now,
            modifiedAt: now,
            data: data || null
        };
        const list = this.loadProjects();
        list.push(project);
        this.saveProjects(list);
        return project;
    },

    updateProject(id, patch) {
        const list = this.loadProjects();
        const p = list.find(x => x.id === id);
        if (!p) return null;
        Object.assign(p, patch, { modifiedAt: Date.now() });
        this.saveProjects(list);
        return p;
    },

    deleteProject(id) {
        this.saveProjects(this.loadProjects().filter(p => p.id !== id));
    },

    duplicateProject(id) {
        const src = this.getProject(id);
        if (!src) return null;
        return this.createProject(src.name + ' copy', src.client, JSON.parse(JSON.stringify(src.data)));
    },

    projectSize(p) { return JSON.stringify(p.data || {}).length; },

    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    },

    formatDate(ts) {
        const d = new Date(ts);
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
            + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    },

    // --- Templates: reusable blueprints (guides, swatches, artboards, content) ---
    loadTemplates() { return this._read(this.TEMPLATES_KEY); },

    saveTemplate(name, data) {
        const list = this.loadTemplates();
        list.push({
            id: 'tpl_' + Date.now(),
            name: name || 'Untitled template',
            createdAt: Date.now(),
            data: JSON.parse(JSON.stringify(data))
        });
        this._write(this.TEMPLATES_KEY, list);
    },

    deleteTemplate(id) {
        this._write(this.TEMPLATES_KEY, this.loadTemplates().filter(t => t.id !== id));
    }
};
