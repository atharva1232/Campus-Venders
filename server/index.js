/* Campus Vendors: one service that serves the website and its API.
   Data: MongoDB (MONGODB_URI). Emails: Brevo (BREVO_API_KEY, BREVO_SENDER_EMAIL).
   Students: Gmail + emailed code to create an account, then Gmail + phone to sign in.
   Vendors:  shop name + pincode + phone.
   One uncollected order = warning, two = permanent block (by canonical Gmail). */
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const cors = require("cors");
const DB = require("./db");
const { sendCode } = require("./mail");

const PORT = Number(process.env.PORT) || 10000;
const ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:8000").split(",").map((s) => s.trim()).filter(Boolean);
const CODE_TTL_MIN = 10;
const SESSION_DAYS = 30;
// Local only (never on Render): with no Brevo key, the code is shown in the response so you can test.
const DEV = !process.env.RENDER && !process.env.BREVO_API_KEY;

const app = express();
app.set("trust proxy", 1);
// the site is normally on this same address; CORS only matters for other origins (e.g. python serve.py)
app.use(cors({ origin: ORIGINS, allowedHeaders: ["content-type", "authorization", "x-vendor-token"] }));
app.use(express.json({ limit: "15mb" })); // print files arrive as data URLs (≤10 MB)

/* ---------- helpers ---------- */
const C = DB.col;
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const newToken = () => crypto.randomBytes(32).toString("base64url");
const newId = (p) => p + Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
const GMAIL = /^[a-z0-9](?:[a-z0-9.+_-]*[a-z0-9])?@(gmail|googlemail)\.com$/i;
const PHONE = /^[6-9]\d{9}$/;
const cleanPhone = (p) => String(p || "").replace(/\D/g, "").replace(/^(91|0)(?=[6-9]\d{9}$)/, "");
/* a.b.c+x@gmail.com and abc@gmail.com are the same inbox */
function canonicalGmail(e) {
  const [local, domain] = String(e || "").trim().toLowerCase().split("@");
  if (!domain || !/^(gmail|googlemail)\.com$/.test(domain)) return String(e || "").trim().toLowerCase();
  return local.split("+")[0].replace(/\./g, "") + "@gmail.com";
}
const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const fail = (res, status, error, extra) => res.status(status).json({ error, ...(extra || {}) });
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); fail(res, 500, "Something went wrong on the server. Please try again."); });
const days = (n) => new Date(Date.now() + n * 864e5);

const isBlocked = async (email) => !!(await C.blockedEmails.findOne({ _id: canonicalGmail(email) }));
async function newSession(kind, subject, ttlDays = SESSION_DAYS) {
  const token = newToken();
  await C.sessions.insertOne({ _id: sha(token), kind, subject: String(subject), createdAt: new Date(), expiresAt: days(ttlDays) });
  return token;
}
async function sessionSubject(token, kind) {
  if (!token) return null;
  const s = await C.sessions.findOne({ _id: sha(token), kind, expiresAt: { $gt: new Date() } });
  return s ? s.subject : null;
}
const bearer = (req) => { const h = req.get("authorization") || ""; return h.startsWith("Bearer ") ? h.slice(7) : null; };

const studentOut = (s) => ({ id: s._id, email: s.email, name: s.name, cls: s.cls, phone: s.phone, strikes: s.strikes || 0, blocked: !!s.blocked });
async function loadStudent(req) {
  const id = await sessionSubject(bearer(req), "student");
  return id ? C.students.findOne({ _id: id }) : null;
}
/* route guard: a signed-in, not-blocked student */
async function needStudent(req, res) {
  const s = await loadStudent(req);
  if (!s) { fail(res, 401, "Please sign in again."); return null; }
  if (s.blocked) { fail(res, 403, "This Gmail account has been permanently blocked.", { blocked: true }); return null; }
  return s;
}
async function needVendor(req, res) {
  const id = await sessionSubject(req.get("x-vendor-token"), "vendor");
  const v = id && (await C.vendors.findOne({ _id: id }));
  if (!v) { fail(res, 401, "Please log in to your shop again."); return null; }
  return v;
}
/* what students see: everything except the login pincode */
function vendorOut(v) { const d = { ...v.data, id: v._id }; delete d.pincode; return d; }
const orderOut = (o) => ({ ...o.data, id: o._id, status: o.status });
const feedbackOut = (f) => ({ ...f.data, id: f._id, status: f.status });
const noShowsOf = async (studentId) => (await C.noShows.find({ studentId }).sort({ at: -1 }).toArray())
  .map((n) => ({ order_id: n._id, token: n.token, shop: n.shop, at: n.at }));

/* ---------- the website (only its own files are public) ---------- */
const ROOT = path.join(__dirname, "..");
const noCache = { setHeaders: (res) => res.set("Cache-Control", "no-cache") }; // always load the latest version
app.use("/css", express.static(path.join(ROOT, "css"), noCache));
app.use("/js", express.static(path.join(ROOT, "js"), noCache));
app.get(["/", "/index.html"], (req, res) => { res.set("Cache-Control", "no-cache"); res.sendFile(path.join(ROOT, "index.html")); });
app.get("/api/health", (req, res) => res.json({ ok: true, service: "campus-vendors", db: DB.kind, email: process.env.BREVO_API_KEY ? "brevo" : "not set" }));

/* ---------- student sign-up / sign-in ---------- */
// 1. Email a 6-digit code. `details` (name, class, phone) come with it when creating an account.
app.post("/api/auth/send-code", wrap(async (req, res) => {
  const raw = str(req.body.email, 120).toLowerCase();
  if (!GMAIL.test(raw)) return fail(res, 400, "Please use a Gmail address (ending in @gmail.com).");
  const email = canonicalGmail(raw);
  if (await isBlocked(email)) return fail(res, 403, "This Gmail account has been permanently blocked.", { blocked: true });
  let details = null;
  if (req.body.details) {
    const d = req.body.details;
    details = { name: str(d.name, 40).replace(/\s+/g, " "), cls: str(d.cls, 30), phone: cleanPhone(d.phone) };
    if (details.name.length < 2) return fail(res, 400, "Please enter your full name.");
    if (!details.cls) return fail(res, 400, "Please enter your class.");
    if (!PHONE.test(details.phone)) return fail(res, 400, "Enter a valid 10-digit mobile number.");
  }
  const prev = await C.loginCodes.findOne({ _id: email });
  if (prev && Date.now() - prev.sentAt.getTime() < 60000) return fail(res, 429, "Please wait a minute before asking for another code.");
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await C.loginCodes.updateOne({ _id: email }, {
    $set: { codeHash: sha(email + ":" + code), attempts: 0, sentAt: new Date(), expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60000),
      ...(details ? { details } : {}) },
  }, { upsert: true });
  try { await sendCode(raw, code); } catch (e) { return fail(res, 502, "We couldn't send the email. Please try again in a minute."); }
  res.json({ ok: true, ...(DEV ? { devCode: code } : {}) });
}));

// 2. Check the code: signs in an existing student, or creates the account from the saved details.
app.post("/api/auth/verify", wrap(async (req, res) => {
  const email = canonicalGmail(str(req.body.email, 120));
  const code = str(req.body.code, 10).replace(/\D/g, "");
  const c = await C.loginCodes.findOne({ _id: email });
  if (!c || c.expiresAt < new Date()) return fail(res, 400, "That code has expired. Please ask for a new one.");
  if (c.attempts >= 5) return fail(res, 429, "Too many wrong tries. Please ask for a new code.");
  if (c.codeHash !== sha(email + ":" + code)) {
    await C.loginCodes.updateOne({ _id: email }, { $inc: { attempts: 1 } });
    return fail(res, 400, "That code is wrong. Check the latest email and try again.");
  }
  await C.loginCodes.deleteOne({ _id: email });
  if (await isBlocked(email)) return fail(res, 403, "This Gmail account has been permanently blocked.", { blocked: true });
  let s = await C.students.findOne({ email });
  const b = req.body.details;
  const d = c.details || (b ? { name: str(b.name, 40), cls: str(b.cls, 30), phone: cleanPhone(b.phone) } : null);
  const complete = d && d.name.length >= 2 && d.cls && PHONE.test(d.phone);
  if (!s) {
    if (!complete) {
      // verified, but we don't know who they are yet: a short-lived token to finish the profile
      return res.json({ needsProfile: true, pendingToken: await newSession("pending", email, 1), email });
    }
    s = { _id: newId("s"), email, name: d.name, cls: d.cls, phone: d.phone, strikes: 0, blocked: false, createdAt: new Date() };
    await C.students.insertOne(s);
  } else if (complete) {
    await C.students.updateOne({ _id: s._id }, { $set: { name: d.name, cls: d.cls, phone: d.phone } });
    s = { ...s, name: d.name, cls: d.cls, phone: d.phone };
  }
  res.json({ token: await newSession("student", s._id), student: studentOut(s) });
}));

// 2b. Finish a verified account that had no details yet.
app.post("/api/auth/finish", wrap(async (req, res) => {
  const email = await sessionSubject(req.body.pendingToken, "pending");
  if (!email) return fail(res, 401, "Please start again and ask for a new code.");
  const name = str(req.body.name, 40).replace(/\s+/g, " "), cls = str(req.body.cls, 30), phone = cleanPhone(req.body.phone);
  if (name.length < 2 || !cls || !PHONE.test(phone)) return fail(res, 400, "Please fill in your name, class and a valid 10-digit mobile number.");
  if (await isBlocked(email)) return fail(res, 403, "This Gmail account has been permanently blocked.", { blocked: true });
  await C.students.updateOne({ email },
    { $set: { name, cls, phone }, $setOnInsert: { _id: newId("s"), email, strikes: 0, blocked: false, createdAt: new Date() } },
    { upsert: true });
  const s = await C.students.findOne({ email });
  await C.sessions.deleteOne({ _id: sha(req.body.pendingToken) });
  res.json({ token: await newSession("student", s._id), student: studentOut(s) });
}));

// 3. Returning students: Gmail + the phone number they registered with.
const signinTries = new Map(); // email -> [timestamps]; slows down guessing phone numbers
app.post("/api/auth/signin", wrap(async (req, res) => {
  const raw = str(req.body.email, 120);
  if (!GMAIL.test(raw)) return fail(res, 400, "Please use a Gmail address (ending in @gmail.com).");
  const email = canonicalGmail(raw);
  const recent = (signinTries.get(email) || []).filter((t) => Date.now() - t < 15 * 60000);
  if (recent.length >= 10) return fail(res, 429, "Too many tries. Please wait 15 minutes, or sign in with a code.");
  if (await isBlocked(email)) return fail(res, 403, "This Gmail account has been permanently blocked.", { blocked: true });
  const s = await C.students.findOne({ email });
  if (!s || s.phone !== cleanPhone(req.body.phone)) {
    recent.push(Date.now()); signinTries.set(email, recent);
    return fail(res, 401, "That Gmail and phone number don't match an account. New here? Create an account instead.");
  }
  signinTries.delete(email);
  res.json({ token: await newSession("student", s._id), student: studentOut(s) });
}));

app.post("/api/auth/logout", wrap(async (req, res) => {
  const t = bearer(req); if (t) await C.sessions.deleteOne({ _id: sha(t) });
  res.json({ ok: true });
}));

/* ---------- the signed-in student ---------- */
app.get("/api/me", wrap(async (req, res) => {
  const s = await loadStudent(req);
  if (!s) return fail(res, 401, "Not signed in.");
  if (s.blocked) return fail(res, 403, "This Gmail account has been permanently blocked.", { blocked: true });
  res.json({ student: studentOut(s), noShows: await noShowsOf(s._id) });
}));
app.put("/api/me", wrap(async (req, res) => {
  const s = await needStudent(req, res); if (!s) return;
  const cls = str(req.body.cls, 30) || s.cls, phone = cleanPhone(req.body.phone || s.phone);
  if (!PHONE.test(phone)) return fail(res, 400, "Enter a valid 10-digit mobile number.");
  await C.students.updateOne({ _id: s._id }, { $set: { cls, phone } });
  res.json({ student: studentOut({ ...s, cls, phone }) });
}));

/* ---------- one call for the website's live refresh ---------- */
app.get("/api/sync", wrap(async (req, res) => {
  const out = { vendors: (await C.vendors.find({}).sort({ createdAt: 1, _id: 1 }).toArray()).map(vendorOut) };
  const s = await loadStudent(req);
  if (s && s.blocked) out.blocked = true;
  else if (s) {
    out.me = studentOut(s);
    out.noShows = await noShowsOf(s._id);
    out.myOrders = (await C.orders.find({ studentId: s._id }).sort({ createdAt: -1 }).limit(100).toArray()).map(orderOut);
    out.myFeedback = (await C.feedback.find({ studentId: s._id }).sort({ createdAt: -1 }).toArray()).map(feedbackOut);
  }
  const vid = await sessionSubject(req.get("x-vendor-token"), "vendor");
  if (vid) {
    out.vendorId = vid;
    out.vendorOrders = (await C.orders.find({ vendorId: vid }).sort({ createdAt: -1 }).limit(200).toArray()).map(orderOut);
    out.vendorFeedback = (await C.feedback.find({ vendorId: vid }).sort({ createdAt: -1 }).toArray()).map(feedbackOut);
  }
  res.json(out);
}));

/* ---------- orders (students) ---------- */
app.post("/api/orders", wrap(async (req, res) => {
  const s = await needStudent(req, res); if (!s) return;
  const b = req.body;
  const row = await C.vendors.findOne({ _id: str(b.vendorId, 60) });
  const v = row && row.data;
  if (!v) return fail(res, 404, "Shop not found.");
  if (v.status === "closed") return fail(res, 409, `${v.name} is closed right now.`);
  let items, total, print = null, file = null;
  if (b.type === "print") {
    if (!v.print) return fail(res, 400, "This shop doesn't take print jobs.");
    const p = b.print || {};
    const pages = Math.min(999, Math.max(1, Number(p.pages) || 1)), copies = Math.min(50, Math.max(1, Number(p.copies) || 1));
    const color = p.color === "color" ? "color" : "bw", sides = p.sides === "double" ? "double" : "single", binding = p.binding === "spiral" ? "spiral" : "none";
    const rate = color === "color" ? v.print.color : v.print.bw;
    const printing = pages * copies * rate;
    total = Math.round(printing - (sides === "double" ? printing * (v.print.doubleSidedDiscount || 0) : 0) + (binding === "spiral" ? v.print.binding * copies : 0));
    items = [{ name: `${pages} pg × ${copies} · ${color === "color" ? "Colour" : "B/W"} · ${sides === "double" ? "Double" : "Single"}-sided${binding === "spiral" ? " · Spiral" : ""}`, price: total, qty: 1 }];
    file = typeof b.file === "string" && b.file.startsWith("data:") ? b.file : null;
    if (file && file.length > 14 * 1024 * 1024) return fail(res, 413, "File is larger than 10 MB.");
    print = { fileName: str(p.fileName, 120) || "file", size: Number(p.size) || 0, pages, copies, color, sides, binding, hasFile: !!file };
  } else {
    // prices come from the shop's menu, not from the browser
    items = [];
    for (const it of Array.isArray(b.items) ? b.items.slice(0, 50) : []) {
      const m = (v.menu || []).find((x) => x.id === it.id);
      const qty = Math.min(50, Math.max(1, Number(it.qty) || 0));
      if (!m || !m.inStock || !qty) continue;
      items.push({ id: m.id, name: m.name, price: m.price, qty });
    }
    if (!items.length) return fail(res, 400, "Your cart is empty or those items are out of stock.");
    total = items.reduce((a, i) => a + i.price * i.qty, 0);
  }
  const id = newId("o");
  const token = (v.name.replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase() || "T") + "-" + (await DB.nextSeq("order", 101));
  const data = {
    id, token, type: b.type === "print" ? "print" : "food", vendorId: row._id, items, total,
    pickup: /^(ASAP|\d{2}:\d{2})$/.test(b.pickup) ? b.pickup : "ASAP", note: str(b.note, 100),
    student: { id: s._id, name: s.name, cls: s.cls, phone: s.phone, email: s.email },
    createdAt: Date.now(), ...(print ? { print } : {}),
  };
  await C.orders.insertOne({ _id: id, vendorId: row._id, studentId: s._id, status: "placed", data, createdAt: new Date() });
  if (file) await C.printFiles.insertOne({ _id: id, dataUrl: file });
  res.json({ order: { ...data, status: "placed" } });
}));

app.post("/api/orders/:id/rate", wrap(async (req, res) => {
  const s = await needStudent(req, res); if (!s) return;
  const o = await C.orders.findOne({ _id: req.params.id, studentId: s._id });
  if (!o || o.status !== "collected" || o.data.rating) return fail(res, 400, "You can rate an order once, after collecting it.");
  const stars = Math.min(5, Math.max(1, Number(req.body.stars) || 0)), comment = str(req.body.comment, 100);
  await C.orders.updateOne({ _id: o._id }, { $set: { "data.rating": { stars, comment } } });
  await C.vendors.updateOne({ _id: o.vendorId }, { $push: { "data.ratings": { $each: [{ stars, comment, at: Date.now() }], $slice: -200 } } });
  res.json({ ok: true });
}));

/* ---------- feedback & complaints ---------- */
app.post("/api/feedback", wrap(async (req, res) => {
  const s = await needStudent(req, res); if (!s) return;
  const message = str(req.body.message, 600);
  if (message.length < 5) return fail(res, 400, "Please write a little more.");
  const type = ["feedback", "complaint", "suggestion"].includes(req.body.type) ? req.body.type : "feedback";
  const vendorId = str(req.body.vendorId, 60) || null;
  const order = req.body.orderId ? await C.orders.findOne({ _id: String(req.body.orderId), studentId: s._id }) : null;
  const id = newId("f");
  const data = { id, ref: "FB-" + (await DB.nextSeq("feedback", 1001)), type, vendorId, orderId: order ? order._id : null, token: order ? order.data.token : null,
    message, studentId: s._id, name: s.name, cls: s.cls, contact: `${s.phone} · ${s.email}`, at: Date.now() };
  await C.feedback.insertOne({ _id: id, vendorId, studentId: s._id, status: "open", data, createdAt: new Date() });
  res.json({ feedback: { ...data, status: "open" } });
}));

/* ---------- vendors ---------- */
app.post("/api/vendor/login", wrap(async (req, res) => {
  const v = await C.vendors.findOne({ nameKey: DB.nameKey(req.body.shop) });
  const pincode = str(req.body.pincode, 6), phone = cleanPhone(req.body.phone);
  if (!v) return fail(res, 404, "No shop with that name. Check the spelling, or open a new shop.");
  if (!/^\d{6}$/.test(pincode)) return fail(res, 400, "Pincode must be 6 digits.");
  if (!/^\d{10}$/.test(phone)) return fail(res, 400, "Enter the shop's 10-digit phone number.");
  if (pincode !== v.pincode || (v.phone && v.phone !== phone)) return fail(res, 401, "Shop name, pincode and phone number don't match.");
  let claimed = false;
  if (!v.phone) { // first login to a shop listed without a number: that number becomes the shop's
    await C.vendors.updateOne({ _id: v._id, phone: "" }, { $set: { phone, "data.phone": phone, "data.whatsapp": v.data.whatsapp || "91" + phone } });
    claimed = true;
  }
  res.json({ token: await newSession("vendor", v._id), vendorId: v._id, claimed });
}));

app.post("/api/vendors", wrap(async (req, res) => {
  const b = req.body;
  const name = str(b.name, 40);
  if (name.length < 2) return fail(res, 400, "Please enter the shop name.");
  if (await C.vendors.findOne({ nameKey: DB.nameKey(name) })) return fail(res, 409, "A shop with this name is already listed.");
  const phone = cleanPhone(b.phone), pincode = str(b.pincode, 6);
  if (!/^\d{10}$/.test(phone)) return fail(res, 400, "Enter a valid 10-digit phone number.");
  if (!/^\d{6}$/.test(pincode)) return fail(res, 400, "Pincode must be 6 digits.");
  const hours = (Array.isArray(b.hours) ? b.hours : []).slice(0, 3).filter((h) => Array.isArray(h) && /^\d{2}:\d{2}$/.test(h[0]) && /^\d{2}:\d{2}$/.test(h[1]));
  if (!hours.length) return fail(res, 400, "Please add your opening hours.");
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "shop";
  let id = base;
  for (let n = 2; id === "new" || (await C.vendors.findOne({ _id: id })); n++) id = base + "-" + n;
  const p = b.print;
  const data = {
    id, name, category: str(b.category, 24) || "Shops", emoji: str(b.emoji, 4) || "🏪", location: str(b.location, 40),
    distance: Math.max(0, Math.min(5000, Number(b.distance) || 0)), phone, whatsapp: "91" + (cleanPhone(b.whatsapp) || phone),
    hours, pincode, status: b.status === "open" ? "open" : "closed", queue: 0, avgServe: 2, note: "", menu: [], ratings: [],
    custom: true, createdAt: Date.now(), updatedAt: Date.now(),
    ...(p ? { print: { bw: Number(p.bw) || 0, color: Number(p.color) || 0, doubleSidedDiscount: 0.2, binding: Number(p.binding) || 0 } } : {}),
  };
  try {
    await C.vendors.insertOne({ _id: id, nameKey: DB.nameKey(name), pincode, phone, data, createdAt: new Date() });
  } catch (e) {
    if (e.code === 11000) return fail(res, 409, "A shop with this name is already listed.");
    throw e;
  }
  res.json({ token: await newSession("vendor", id), vendor: vendorOut({ _id: id, data }) });
}));

// the shop updates itself: status, queue, announcement, menu, prices, stock
app.put("/api/vendor/me", wrap(async (req, res) => {
  const v = await needVendor(req, res); if (!v) return;
  const b = req.body, set = { "data.updatedAt": Date.now() };
  if (["open", "busy", "closed"].includes(b.status)) set["data.status"] = b.status;
  if (b.queue !== undefined) set["data.queue"] = Math.max(0, Math.min(200, Number(b.queue) || 0));
  if (b.note !== undefined) set["data.note"] = str(b.note, 80);
  if (Array.isArray(b.menu)) set["data.menu"] = b.menu.slice(0, 200).map((m, i) => ({
    id: str(m.id, 40) || "x" + Date.now() + i, name: str(m.name, 40), price: Math.max(0, Number(m.price) || 0),
    inStock: m.inStock !== false, cat: str(m.cat, 20) || "Menu",
  })).filter((m) => m.name);
  await C.vendors.updateOne({ _id: v._id }, { $set: set });
  res.json({ vendor: vendorOut(await C.vendors.findOne({ _id: v._id })) });
}));

const NEXT = { placed: ["accepted", "rejected"], accepted: ["ready"], ready: ["collected", "no_show"] };
app.put("/api/vendor/orders/:id", wrap(async (req, res) => {
  const v = await needVendor(req, res); if (!v) return;
  const o = await C.orders.findOne({ _id: req.params.id, vendorId: v._id });
  if (!o) return fail(res, 404, "Order not found.");
  const status = String(req.body.status || "");
  if (!(NEXT[o.status] || []).includes(status)) return fail(res, 409, `Can't change this order from "${o.status}" to "${status}".`);
  // only if nobody changed it in the meantime
  const upd = await C.orders.updateOne({ _id: o._id, status: o.status }, { $set: { status, "data.updatedAt": Date.now() } });
  if (!upd.modifiedCount) return fail(res, 409, "This order was just changed. Refresh and try again.");
  // keep the free database small: a print file isn't needed once the job is finished
  if (["collected", "rejected", "no_show"].includes(status)) await C.printFiles.deleteOne({ _id: o._id });
  let strike = null;
  if (status === "no_show") {
    // 1st uncollected order: warning. 2nd: permanent block of the Gmail.
    await C.noShows.updateOne({ _id: o._id }, { $setOnInsert: { studentId: o.studentId, token: o.data.token, shop: v.data.name, at: new Date() } }, { upsert: true });
    const strikes = await C.noShows.countDocuments({ studentId: o.studentId });
    await C.students.updateOne({ _id: o.studentId }, { $set: { strikes, blocked: strikes >= 2 } });
    const s = await C.students.findOne({ _id: o.studentId });
    // the student's session stays so their next refresh can show "Account blocked";
    // every student action already refuses blocked accounts
    if (s.blocked) await C.blockedEmails.updateOne({ _id: s.email }, { $setOnInsert: { reason: "Did not collect orders twice", at: new Date() } }, { upsert: true });
    strike = { strikes: s.strikes, blocked: s.blocked, name: s.name };
  }
  res.json({ ok: true, strike });
}));

app.get("/api/vendor/files/:orderId", wrap(async (req, res) => {
  const v = await needVendor(req, res); if (!v) return;
  const o = await C.orders.findOne({ _id: req.params.orderId, vendorId: v._id });
  const f = o && (await C.printFiles.findOne({ _id: o._id }));
  if (!f) return fail(res, 404, "File not available.");
  res.json({ dataUrl: f.dataUrl });
}));

app.put("/api/vendor/feedback/:id", wrap(async (req, res) => {
  const v = await needVendor(req, res); if (!v) return;
  const status = ["seen", "resolved"].includes(req.body.status) ? req.body.status : null;
  if (!status) return fail(res, 400, "Unknown status.");
  const set = { status, ...(req.body.reply ? { "data.reply": str(req.body.reply, 200) } : {}) };
  await C.feedback.updateOne({ _id: req.params.id, vendorId: v._id, status: { $ne: "resolved" } }, { $set: set });
  res.json({ ok: true });
}));

app.post("/api/vendor/logout", wrap(async (req, res) => {
  const t = req.get("x-vendor-token"); if (t) await C.sessions.deleteOne({ _id: sha(t) });
  res.json({ ok: true });
}));

/* ---------- start ---------- */
DB.connect().then(() => {
  app.listen(PORT, () => console.log(`Campus Vendors on :${PORT} (${DB.kind}; email: ${process.env.BREVO_API_KEY ? "Brevo" : "codes printed here"})`));
}).catch((e) => { console.error("Database setup failed:", e.message); process.exit(1); });

module.exports = { app, canonicalGmail };
