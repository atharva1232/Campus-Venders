/* Data layer: everything shared (shops, menus, orders, print jobs, feedback) lives on the
   Campus Vendors API (Render + Postgres). This keeps a local copy for fast drawing,
   refreshes it every few seconds, and sends changes to the server.
   Only the cart stays in this browser. */
(function () {
  const CFG = window.CVD_CONFIG || {};
  const API = (CFG.API_URL || "").replace(/\/$/, "");
  const CACHE_KEY = "cvd_cache_v2";   // last copy of the shop list, so the page draws instantly
  const CART_KEY = "cvd_cart_v2";
  const VENDOR_KEY = "cvd_vendor_token";
  const ADMIN_KEY = "cvd_admin_token";
  const listeners = new Set();
  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

  /* fetch wrapper: adds the student / shop sign-in and turns errors into { error } */
  async function api(method, path, body) {
    const headers = { "content-type": "application/json" };
    const adminPath = path.startsWith("/api/admin");
    const st = adminPath ? get(ADMIN_KEY) : window.Auth && window.Auth.token();
    if (st) headers.authorization = "Bearer " + st;
    const vt = get(VENDOR_KEY);
    if (vt) headers["x-vendor-token"] = vt;
    let res;
    try { res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { return { error: "Can't reach the server. Check your internet. (If the site was idle, the server may take up to a minute to wake up.)", offline: true }; }
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) return { ...data, error: data.error || "Something went wrong (" + res.status + ").", status: res.status };
    return data;
  }

  const Store = {
    state: { vendors: [], orders: [], feedback: [], cart: { vendorId: null, items: {} }, source: "server" },
    api,
    ready: false,

    load() {
      try { const c = JSON.parse(get(CACHE_KEY) || "null"); if (c && Array.isArray(c.vendors)) this.state.vendors = c.vendors; } catch (e) {}
      try { const c = JSON.parse(get(CART_KEY) || "null"); if (c && c.items) this.state.cart = c; } catch (e) {}
    },
    save() {
      set(CART_KEY, JSON.stringify(this.state.cart));
      listeners.forEach((fn) => fn());
    },
    onChange(fn) { listeners.add(fn); },

    /* Pull the latest from the server. Returns true when something visible changed. */
    async sync() {
      const started = Date.now();
      const d = await api("GET", "/api/sync");
      if (d.error) { this.lastError = d.error; return false; }
      this.lastError = null;
      if (window.Auth) window.Auth.applySync(d);
      if (get(VENDOR_KEY) && !d.vendorId) set(VENDOR_KEY, null); // shop session expired
      const orders = new Map();
      (d.myOrders || []).concat(d.vendorOrders || []).forEach((o) => orders.set(o.id, o));
      const feedback = new Map();
      (d.myFeedback || []).concat(d.vendorFeedback || []).forEach((f) => feedback.set(f.id, f));
      // a shop with edits still being saved keeps its local copy, so a refresh can't undo them
      const keepLocal = (id) => this.saving[id] || (this.savedAt[id] || 0) >= started;
      const vendors = (d.vendors || []).map((v) => (keepLocal(v.id) ? this.vendor(v.id) || v : v));
      const next = { vendors, orders: [...orders.values()], feedback: [...feedback.values()] };
      const before = JSON.stringify([this.state.vendors, this.state.orders, this.state.feedback]);
      Object.assign(this.state, next);
      set(CACHE_KEY, JSON.stringify({ vendors: next.vendors }));
      this.vendorId = d.vendorId || null;
      this.ready = true;
      return before !== JSON.stringify([next.vendors, next.orders, next.feedback]);
    },

    vendor(id) { return this.state.vendors.find((v) => v.id === id); },
    student() { return (window.Auth && window.Auth.me) || null; },

    /* ---------- cart (this browser only) ---------- */
    cartCount() { return Object.values(this.state.cart.items).reduce((a, b) => a + b, 0); },
    setQty(vendorId, itemId, qty) {
      const c = this.state.cart;
      if (c.vendorId && c.vendorId !== vendorId) c.items = {};
      c.vendorId = vendorId;
      if (qty <= 0) delete c.items[itemId]; else c.items[itemId] = qty;
      if (!Object.keys(c.items).length) c.vendorId = null;
      this.save();
    },
    clearCart() { this.state.cart = { vendorId: null, items: {} }; this.save(); },

    /* ---------- orders ---------- */
    myOrders() {
      const me = this.student();
      return me ? this.state.orders.filter((o) => o.student && o.student.id === me.id).sort((a, b) => b.createdAt - a.createdAt) : [];
    },
    vendorOrders(vendorId) { return this.state.orders.filter((o) => o.vendorId === vendorId).sort((a, b) => b.createdAt - a.createdAt); },
    /* returns the saved order, or { error } */
    async placeOrder(order, file) {
      const d = await api("POST", "/api/orders", { ...order, file });
      if (d.error) return d;
      this.state.orders.unshift(d.order);
      this.save();
      if (d.order.warningFee && window.Auth) await window.Auth.refresh();
      return d.order;
    },
    async cancelOrder(id) {
      const d = await api("PUT", "/api/orders/" + encodeURIComponent(id) + "/cancel", {});
      if (d.error) return d;
      const o = this.state.orders.find((x) => x.id === id);
      if (o) o.status = "cancelled";
      this.save();
      if (window.Auth) await window.Auth.refresh();
      return d;
    },
    /* shop changes an order's status; for "no_show" the result says whether the student was warned or blocked */
    async setOrderStatus(id, status) {
      const d = await api("PUT", "/api/vendor/orders/" + encodeURIComponent(id), { status });
      if (d.error) return d;
      const o = this.state.orders.find((x) => x.id === id);
      if (o) { o.status = status; o.updatedAt = Date.now(); }
      this.save();
      return d;
    },
    async rate(orderId, stars, comment) {
      const d = await api("POST", "/api/orders/" + encodeURIComponent(orderId) + "/rate", { stars, comment });
      if (!d.error) { const o = this.state.orders.find((x) => x.id === orderId); if (o) o.rating = { stars, comment }; this.save(); }
      return d;
    },
    async getFile(orderId) {
      const d = await api("GET", "/api/vendor/files/" + encodeURIComponent(orderId));
      return d.error ? null : d.dataUrl;
    },

    /* ---------- shops ---------- */
    vendorToken() { return get(VENDOR_KEY); },
    async vendorLogin(shop, pincode, phone) {
      const d = await api("POST", "/api/vendor/login", { shop, pincode, phone });
      if (!d.error) { set(VENDOR_KEY, d.token); await this.sync(); }
      return d;
    },
    async vendorLogout() { await api("POST", "/api/vendor/logout"); set(VENDOR_KEY, null); this.vendorId = null; },
    async addVendor(v) {
      return api("POST", "/api/vendors", v);
    },
    async adminSendCode(email) { return api("POST", "/api/admin/send-code", { email }); },
    async adminVerify(code) {
      const d = await api("POST", "/api/admin/verify", { code });
      if (!d.error) set(ADMIN_KEY, d.token);
      return d;
    },
    adminToken() { return get(ADMIN_KEY); },
    async adminApplications() { return api("GET", "/api/admin/applications"); },
    async reviewApplication(id, action) { return api("PATCH", "/api/admin/applications/" + encodeURIComponent(id), { action }); },
    async adminSettings() { return api("GET", "/api/admin/settings"); },
    async saveAdminSettings(settings) { return api("PUT", "/api/admin/settings", settings); },
    async adminSecurityEvents() { return api("GET", "/api/admin/security-events"); },
    async adminLogout() { await api("GET", "/api/admin/logout"); set(ADMIN_KEY, null); },
    /* the signed-in shop edits itself (status, queue, announcement, menu). Shown at once, saved in the
       background, one save after another so quick edits arrive in order. */
    saving: {},          // shop id -> number of saves still on their way
    savedAt: {},         // shop id -> when its last save finished
    saveChain: Promise.resolve(),
    updateVendor(id, patch) {
      const v = this.vendor(id);
      if (!v) return Promise.resolve({ error: "Shop not found" });
      Object.assign(v, patch, { updatedAt: Date.now() });
      this.save();
      const body = {};
      ["status", "queue", "note", "menu"].forEach((k) => { if (k in patch) body[k] = JSON.parse(JSON.stringify(patch[k])); });
      if (!Object.keys(body).length) body.menu = JSON.parse(JSON.stringify(v.menu)); // stock / price edits change the menu in place
      this.saving[id] = (this.saving[id] || 0) + 1;
      const run = () => api("PUT", "/api/vendor/me", body).then((d) => {
        if (--this.saving[id] <= 0) delete this.saving[id];
        this.savedAt[id] = Date.now();
        if (d.error && window.toast) window.toast("Couldn't save: " + d.error, "err");
        return d;
      });
      this.saveChain = this.saveChain.then(run, run);
      return this.saveChain;
    },

    /* ---------- feedback & complaints ---------- */
    async addFeedback(f) {
      const d = await api("POST", "/api/feedback", f);
      if (d.error) return d;
      this.state.feedback.unshift(d.feedback);
      this.save();
      return d.feedback;
    },
    myFeedback() {
      const me = this.student();
      return me ? this.state.feedback.filter((f) => f.studentId === me.id).sort((a, b) => b.at - a.at) : [];
    },
    vendorFeedback(vendorId) { return this.state.feedback.filter((f) => f.vendorId === vendorId).sort((a, b) => b.at - a.at); },
    async setFeedbackStatus(id, status, reply) {
      const f = this.state.feedback.find((x) => x.id === id);
      if (f) { f.status = status; if (reply) f.reply = reply; }
      this.save();
      return api("PUT", "/api/vendor/feedback/" + encodeURIComponent(id), { status, reply });
    },
  };

  window.Store = Store;
})();
