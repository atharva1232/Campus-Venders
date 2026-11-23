/* State, persistence (localStorage) and the optional Google Sheets data layer. */
(function () {
  const KEY = "cvd_state_v1";
  const FILE_PREFIX = "cvd_file_";
  const listeners = new Set();

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const now = () => Date.now();

  function freshState() {
    const vendors = clone(window.SEED_VENDORS).map((v) => ({
      ...v, updatedAt: now() - Math.floor(Math.random() * 20) * 60000, ratings: [],
    }));
    return { vendors, orders: [], cart: { vendorId: null, items: {} }, myOrderIds: [], tokenSeq: 100, students: [], source: "demo" };
  }

  const Store = {
    state: null,

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) this.state = JSON.parse(raw);
      } catch (e) { /* storage unavailable: run in memory */ }
      if (!this.state || !Array.isArray(this.state.vendors)) this.state = freshState();
      // drop the old made-up sample shops (and their orders) from data saved before they were removed
      const RETIRED = ["chai-adda", "raju-prints", "amma-tiffin", "sharma-stationery", "kaveri-juice", "quick-stitch", "benne-dosa", "campus-cyber"];
      const retired = this.state.vendors.some((v) => RETIRED.includes(v.id));
      if (retired) {
        this.state.vendors = this.state.vendors.filter((v) => !RETIRED.includes(v.id));
        this.state.orders = (this.state.orders || []).filter((o) => !RETIRED.includes(o.vendorId));
        if (RETIRED.includes(this.state.cart && this.state.cart.vendorId)) this.state.cart = { vendorId: null, items: {} };
      }
      // add shops that were added to the seed list after this browser first saved its data
      const have = new Set(this.state.vendors.map((v) => v.id));
      const missing = window.SEED_VENDORS.filter((v) => !have.has(v.id));
      missing.forEach((v) => this.state.vendors.push({ ...clone(v), updatedAt: now(), ratings: [] }));
      if (retired || missing.length) {
        try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) {}
      }
    },

    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.state)); }
      catch (e) { console.warn("Could not save state", e); }
      listeners.forEach((fn) => fn());
    },

    reset() {
      try {
        Object.keys(localStorage).filter((k) => k.startsWith(FILE_PREFIX)).forEach((k) => localStorage.removeItem(k));
      } catch (e) {}
      this.state = freshState();
      this.save();
    },

    onChange(fn) { listeners.add(fn); },

    vendor(id) { return this.state.vendors.find((v) => v.id === id); },

    addVendor(v) {
      const base = v.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "shop";
      let id = base, n = 2;
      while (this.vendor(id) || id === "new") id = base + "-" + n++;
      const nv = { id, queue: 0, avgServe: 2, note: "", menu: [], ratings: [], custom: true, createdAt: now(), updatedAt: now(), ...v };
      this.state.vendors.push(nv);
      this.save();
      return nv;
    },

    /* ---------- feedback & complaints ---------- */
    addFeedback(f) {
      this.state.feedback = this.state.feedback || [];
      this.state.myFeedbackIds = this.state.myFeedbackIds || [];
      const item = { id: "f" + now(), ref: "FB-" + String(1000 + this.state.feedback.length + 1), status: "open", at: now(), ...f };
      this.state.feedback.unshift(item);
      this.state.myFeedbackIds.unshift(item.id);
      this.save();
      return item;
    },
    myFeedback() {
      const me = this.student();
      return me ? (this.state.feedback || []).filter((f) => f.studentId === me.id) : [];
    },
    vendorFeedback(vendorId) { return (this.state.feedback || []).filter((f) => f.vendorId === vendorId); },
    setFeedbackStatus(id, status, reply) {
      const f = (this.state.feedback || []).find((x) => x.id === id);
      if (!f) return;
      f.status = status;
      if (reply !== undefined) f.reply = reply;
      this.save();
    },

    updateVendor(id, patch) {
      const v = this.vendor(id);
      if (!v) return;
      Object.assign(v, patch, { updatedAt: now() });
      this.save();
    },

    /* ---------- cart ---------- */
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
    nextToken(vendor) {
      this.state.tokenSeq = (this.state.tokenSeq || 100) + 1;
      const prefix = vendor.name.replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase() || "T";
      return prefix + "-" + this.state.tokenSeq;
    },
    placeOrder(order) {
      const v = this.vendor(order.vendorId);
      const o = { id: "o" + now() + Math.floor(Math.random() * 1000), token: this.nextToken(v), status: "placed", createdAt: now(), ...order };
      this.state.orders.unshift(o);
      this.state.myOrderIds.unshift(o.id);
      this.save();
      return o;
    },
    setOrderStatus(id, status) {
      const o = this.state.orders.find((x) => x.id === id);
      if (!o) return;
      o.status = status;
      o.updatedAt = now();
      this.save();
    },
    myOrders() {
      const me = this.student();
      return me ? this.state.orders.filter((o) => o.student && o.student.id === me.id) : [];
    },

    /* ---------- the signed-in student (Gmail account, see auth.js) ---------- */
    student() { return (window.Auth && window.Auth.me) || null; },
    vendorOrders(vendorId) { return this.state.orders.filter((o) => o.vendorId === vendorId); },

    rate(orderId, stars, comment) {
      const o = this.state.orders.find((x) => x.id === orderId);
      if (!o) return;
      o.rating = { stars, comment };
      const v = this.vendor(o.vendorId);
      v.ratings = v.ratings || [];
      v.ratings.push({ stars, comment, at: now() });
      this.save();
    },

    /* ---------- print files (kept separately; demo only) ---------- */
    saveFile(orderId, dataUrl) {
      try { localStorage.setItem(FILE_PREFIX + orderId, dataUrl); return true; }
      catch (e) { return false; }
    },
    getFile(orderId) {
      try { return localStorage.getItem(FILE_PREFIX + orderId); } catch (e) { return null; }
    },
  };

  /* ---------- Google Sheets (published CSV) ---------- */
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') q = false;
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
    return rows.filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
  }

  const yes = (s) => /^(y|yes|true|1)$/i.test(String(s || "").trim());

  async function syncFromSheets() {
    const cfg = window.CVD_CONFIG || {};
    if (!cfg.SHEET_VENDORS_CSV) return false;
    const [vRes, mRes] = await Promise.all([
      fetch(cfg.SHEET_VENDORS_CSV, { cache: "no-store" }),
      cfg.SHEET_MENU_CSV ? fetch(cfg.SHEET_MENU_CSV, { cache: "no-store" }) : Promise.resolve(null),
    ]);
    if (!vRes.ok) throw new Error("Vendors sheet returned " + vRes.status);
    const vRows = parseCSV(await vRes.text());
    const mRows = mRes && mRes.ok ? parseCSV(await mRes.text()) : [];

    const old = Object.fromEntries(Store.state.vendors.map((v) => [v.id, v]));
    Store.state.vendors = vRows.filter((r) => r.id && r.name).map((r) => {
      const prev = old[r.id] || {};
      const menu = mRows.filter((m) => m.vendor_id === r.id).map((m, i) => ({
        id: r.id + "-" + i, name: m.item, price: Number(m.price) || 0,
        inStock: m.in_stock === "" ? true : yes(m.in_stock), cat: m.category || "Menu",
      }));
      const v = {
        id: r.id, name: r.name, category: r.category || "Other", emoji: r.emoji || "🏪",
        status: ["open", "busy", "closed"].includes((r.status || "").toLowerCase()) ? r.status.toLowerCase() : "open",
        queue: Number(r.queue) || 0, avgServe: Number(r.avg_serve_min) || 2,
        hours: (r.hours || "").split(";").map((s) => s.trim().split("-")).filter((p) => p.length === 2),
        phone: r.phone || prev.phone || "", whatsapp: r.whatsapp || prev.whatsapp || "", location: r.location || "",
        distance: Number(r.distance_m) || 0, note: r.note || "", pincode: r.pincode || prev.pincode || "",
        menu: menu.length ? menu : prev.menu || [],
        ratings: prev.ratings || [], updatedAt: r.updated_at ? Date.parse(r.updated_at) || now() : now(),
      };
      if (r.print_bw) v.print = { bw: Number(r.print_bw) || 2, color: Number(r.print_color) || 10, doubleSidedDiscount: 0.2, binding: Number(r.print_binding) || 30 };
      return v;
    });
    // keep shops registered in this browser that are not in the sheet yet
    const ids = new Set(Store.state.vendors.map((v) => v.id));
    Object.values(old).filter((v) => v.custom && !ids.has(v.id)).forEach((v) => Store.state.vendors.push(v));
    Store.state.source = "sheets";
    Store.save();
    return true;
  }

  window.Store = Store;
  window.syncFromSheets = syncFromSheets;
  window.parseCSV = parseCSV;
})();
