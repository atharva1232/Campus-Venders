/* Campus Vendors API
   Students: Gmail + emailed code (Brevo) to create an account, then Gmail + phone to sign in.
   Vendors:  shop name + pincode + phone.
   One uncollected order = warning, two = permanent block (by canonical Gmail). */
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const DB = require("./db");
const { sendCode } = require("./mail");

const PORT = Number(process.env.PORT) || 10000;
const ORIGINS = (process.env.ALLOWED_ORIGINS || "https://campus-vendors.onrender.com,http://localhost:8000")
  .split(",").map((s) => s.trim()).filter(Boolean);
const CODE_TTL_MIN = 10;
const SESSION_DAYS = 30;
// Local only (never on Render): with no Brevo key, the code is shown in the response so you can test.
const DEV = !process.env.RENDER && !process.env.BREVO_API_KEY;

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: ORIGINS, allowedHeaders: ["content-type", "authorization", "x-vendor-token"] }));
app.use(express.json({ limit: "15mb" })); // print files arrive as data URLs (≤10 MB)

/* ---------- helpers ---------- */
const q = DB.query;
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const newToken = () => crypto.randomBytes(32).toString("base64url");
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

async function isBlocked(email) {
  const { rows } = await q(`select 1 from blocked_emails where email = $1`, [canonicalGmail(email)]);
  return rows.length > 0;
}
async function newSession(kind, subject) {
  const token = newToken();
  await q(`insert into sessions (token_hash, kind, subject, expires_at) values ($1, $2, $3, now() + interval '${SESSION_DAYS} days')`, [sha(token), kind, String(subject)]);
  return token;
}
async function sessionSubject(token, kind) {
  if (!token) return null;
  const { rows } = await q(`select subject from sessions where token_hash = $1 and kind = $2 and expires_at > now()`, [sha(token), kind]);
  return rows[0] ? rows[0].subject : null;
}
const bearer = (req) => { const h = req.get("authorization") || ""; return h.startsWith("Bearer ") ? h.slice(7) : null; };

function studentOut(s) {
  return { id: String(s.id), email: s.email, name: s.name, cls: s.cls, phone: s.phone, strikes: s.strikes, blocked: s.blocked };
}
async function loadStudent(req) {
  const id = await sessionSubject(bearer(req), "student");
  if (!id) return null;
  const { rows } = await q(`select * from students where id = $1`, [id]);
  return rows[0] || null;
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
  if (!id) { fail(res, 401, "Please log in to your shop again."); return null; }
  const { rows } = await q(`select * from vendors where id = $1`, [id]);
  if (!rows[0]) { fail(res, 401, "Shop not found."); return null; }
  return rows[0];
}
/* what students see: everything except the login pincode */
function vendorOut(row) { const d = { ...row.data, id: row.id }; delete d.pincode; return d; }
const orderOut = (row) => ({ ...row.data, id: row.id, status: row.status });

/* ---------- the website itself (one service serves pages + API) ---------- */
const path = require("path");
const ROOT = path.join(__dirname, "..");
const noCache = { setHeaders: (res) => res.set("Cache-Control", "no-cache") }; // always load the latest version
// only the site's own files are public, never server/ or .git
app.use("/css", express.static(path.join(ROOT, "css"), noCache));
app.use("/js", express.static(path.join(ROOT, "js"), noCache));
app.get(["/", "/index.html"], (req, res) => { res.set("Cache-Control", "no-cache"); res.sendFile(path.join(ROOT, "index.html")); });

/* ---------- health ---------- */
app.get("/api/health", (req, res) => res.json({ ok: true, service: "campus-vendors", db: DB.kind }));

/* ---------- student sign-up / sign-in ---------- */
// 1. Email a 6-digit code. `details` (name, class, phone) are sent when creating an account.
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
  const { rows: prev } = await q(`select sent_at from login_codes where email = $1`, [email]);
  if (prev[0] && Date.now() - new Date(prev[0].sent_at).getTime() < 60000) return fail(res, 429, "Please wait a minute before asking for another code.");
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await q(`insert into login_codes (email, code_hash, details, attempts, sent_at, expires_at)
           values ($1, $2, $3, 0, now(), now() + interval '${CODE_TTL_MIN} minutes')
           on conflict (email) do update set code_hash = excluded.code_hash, details = coalesce(excluded.details, login_codes.details),
             attempts = 0, sent_at = now(), expires_at = excluded.expires_at`,
    [email, sha(email + ":" + code), details ? JSON.stringify(details) : null]);
  try { await sendCode(raw, code); } catch (e) { return fail(res, 502, "We couldn't send the email. Please try again in a minute."); }
  res.json({ ok: true, ...(DEV ? { devCode: code } : {}) });
}));

// 2. Check the code: signs in an existing student, or creates the account from the saved details.
app.post("/api/auth/verify", wrap(async (req, res) => {
  const email = canonicalGmail(str(req.body.email, 120));
  const code = str(req.body.code, 10).replace(/\D/g, "");
  const { rows } = await q(`select * from login_codes where email = $1`, [email]);
  const c = rows[0];
  if (!c || new Date(c.expires_at) < new Date()) return fail(res, 400, "That code has expired. Please ask for a new one.");
  if (c.attempts >= 5) return fail(res, 429, "Too many wrong tries. Please ask for a new code.");
  if (c.code_hash !== sha(email + ":" + code)) {
    await q(`update login_codes set attempts = attempts + 1 where email = $1`, [email]);
    return fail(res, 400, "That code is wrong. Check the latest email and try again.");
  }
  await q(`delete from login_codes where email = $1`, [email]);
  if (await isBlocked(email)) return fail(res, 403, "This Gmail account has been permanently blocked.", { blocked: true });
  let { rows: found } = await q(`select * from students where email = $1`, [email]);
  let s = found[0];
  const d = c.details || (req.body.details ? { name: str(req.body.details.name, 40), cls: str(req.body.details.cls, 30), phone: cleanPhone(req.body.details.phone) } : null);
  if (!s) {
    if (!d || d.name.length < 2 || !d.cls || !PHONE.test(d.phone)) {
      // verified, but we don't know who they are yet: hand back a short-lived token to finish the profile
      const pending = await newSession("pending", email);
      return res.json({ needsProfile: true, pendingToken: pending, email });
    }
    ({ rows: found } = await q(`insert into students (email, name, cls, phone) values ($1, $2, $3, $4) returning *`, [email, d.name, d.cls, d.phone]));
    s = found[0];
  } else if (d) {
    ({ rows: found } = await q(`update students set name = $2, cls = $3, phone = $4 where id = $1 returning *`, [s.id, d.name, d.cls, d.phone]));
    s = found[0];
  }
  res.json({ token: await newSession("student", s.id), student: studentOut(s) });
}));

// 2b. Finish a verified account that had no details yet.
app.post("/api/auth/finish", wrap(async (req, res) => {
  const email = await sessionSubject(req.body.pendingToken, "pending");
  if (!email) return fail(res, 401, "Please start again and ask for a new code.");
  const name = str(req.body.name, 40).replace(/\s+/g, " "), cls = str(req.body.cls, 30), phone = cleanPhone(req.body.phone);
  if (name.length < 2 || !cls || !PHONE.test(phone)) return fail(res, 400, "Please fill in your name, class and a valid 10-digit mobile number.");
  if (await isBlocked(email)) return fail(res, 403, "This Gmail account has been permanently blocked.", { blocked: true });
  const { rows } = await q(`insert into students (email, name, cls, phone) values ($1, $2, $3, $4)
                            on conflict (email) do update set name = excluded.name, cls = excluded.cls, phone = excluded.phone returning *`, [email, name, cls, phone]);
  await q(`delete from sessions where token_hash = $1`, [sha(req.body.pendingToken)]);
  res.json({ token: await newSession("student", rows[0].id), student: studentOut(rows[0]) });
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
  const { rows } = await q(`select * from students where email = $1`, [email]);
  const s = rows[0];
  if (!s || s.phone !== cleanPhone(req.body.phone)) {
    recent.push(Date.now()); signinTries.set(email, recent);
    return fail(res, 401, "That Gmail and phone number don't match an account. New here? Create an account instead.");
  }
  signinTries.delete(email);
  res.json({ token: await newSession("student", s.id), student: studentOut(s) });
}));

app.post("/api/auth/logout", wrap(async (req, res) => {
  const t = bearer(req); if (t) await q(`delete from sessions where token_hash = $1`, [sha(t)]);
  res.json({ ok: true });
}));

/* ---------- the signed-in student ---------- */
app.get("/api/me", wrap(async (req, res) => {
  const s = await loadStudent(req);
  if (!s) return fail(res, 401, "Not signed in.");
  if (s.blocked) return fail(res, 403, "This Gmail account has been permanently blocked.", { blocked: true });
  const { rows: ns } = await q(`select order_id, token, shop, at from no_shows where student_id = $1 order by at desc`, [s.id]);
  res.json({ student: studentOut(s), noShows: ns });
}));
app.put("/api/me", wrap(async (req, res) => {
  const s = await needStudent(req, res); if (!s) return;
  const cls = str(req.body.cls, 30) || s.cls, phone = cleanPhone(req.body.phone || s.phone);
  if (!PHONE.test(phone)) return fail(res, 400, "Enter a valid 10-digit mobile number.");
  const { rows } = await q(`update students set cls = $2, phone = $3 where id = $1 returning *`, [s.id, cls, phone]);
  res.json({ student: studentOut(rows[0]) });
}));

/* ---------- one call for the website's live refresh ---------- */
app.get("/api/sync", wrap(async (req, res) => {
  const out = {};
  const { rows: vs } = await q(`select * from vendors order by created_at, id`);
  out.vendors = vs.map(vendorOut);
  const s = await loadStudent(req);
  if (s && s.blocked) out.blocked = true;
  else if (s) {
    out.me = studentOut(s);
    out.noShows = (await q(`select order_id, token, shop, at from no_shows where student_id = $1 order by at desc`, [s.id])).rows;
    out.myOrders = (await q(`select * from orders where student_id = $1 order by created_at desc limit 100`, [s.id])).rows.map(orderOut);
    out.myFeedback = (await q(`select * from feedback where student_id = $1 order by created_at desc`, [s.id])).rows.map((r) => ({ ...r.data, id: r.id, status: r.status }));
  }
  const vid = await sessionSubject(req.get("x-vendor-token"), "vendor");
  if (vid) {
    out.vendorId = vid;
    out.vendorOrders = (await q(`select * from orders where vendor_id = $1 order by created_at desc limit 200`, [vid])).rows.map(orderOut);
    out.vendorFeedback = (await q(`select * from feedback where vendor_id = $1 order by created_at desc`, [vid])).rows.map((r) => ({ ...r.data, id: r.id, status: r.status }));
  }
  res.json(out);
}));

/* ---------- orders (students) ---------- */
app.post("/api/orders", wrap(async (req, res) => {
  const s = await needStudent(req, res); if (!s) return;
  const b = req.body;
  const { rows: vr } = await q(`select * from vendors where id = $1`, [str(b.vendorId, 60)]);
  const v = vr[0] && vr[0].data;
  if (!v) return fail(res, 404, "Shop not found.");
  if (v.status === "closed") return fail(res, 409, `${v.name} is closed right now.`);
  let items, total, print = null;
  if (b.type === "print") {
    if (!v.print) return fail(res, 400, "This shop doesn't take print jobs.");
    const p = b.print || {};
    const pages = Math.min(999, Math.max(1, Number(p.pages) || 1)), copies = Math.min(50, Math.max(1, Number(p.copies) || 1));
    const color = p.color === "color" ? "color" : "bw", sides = p.sides === "double" ? "double" : "single", binding = p.binding === "spiral" ? "spiral" : "none";
    const rate = color === "color" ? v.print.color : v.print.bw;
    const printing = pages * copies * rate;
    total = Math.round(printing - (sides === "double" ? printing * (v.print.doubleSidedDiscount || 0) : 0) + (binding === "spiral" ? v.print.binding * copies : 0));
    items = [{ name: `${pages} pg × ${copies} · ${color === "color" ? "Colour" : "B/W"} · ${sides === "double" ? "Double" : "Single"}-sided${binding === "spiral" ? " · Spiral" : ""}`, price: total, qty: 1 }];
    const dataUrl = typeof b.file === "string" && b.file.startsWith("data:") ? b.file : null;
    if (dataUrl && dataUrl.length > 14 * 1024 * 1024) return fail(res, 413, "File is larger than 10 MB.");
    print = { fileName: str(p.fileName, 120) || "file", size: Number(p.size) || 0, pages, copies, color, sides, binding, hasFile: !!dataUrl };
    b._file = dataUrl;
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
  const { rows: seq } = await q(`select nextval('order_token_seq') as n`);
  const id = "o" + Date.now() + crypto.randomInt(1000, 9999);
  const token = (v.name.replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase() || "T") + "-" + seq[0].n;
  const data = {
    id, token, type: b.type === "print" ? "print" : "food", vendorId: v.id, items, total,
    pickup: /^(ASAP|\d{2}:\d{2})$/.test(b.pickup) ? b.pickup : "ASAP", note: str(b.note, 100),
    student: { id: String(s.id), name: s.name, cls: s.cls, phone: s.phone, email: s.email },
    createdAt: Date.now(), ...(print ? { print } : {}),
  };
  await q(`insert into orders (id, vendor_id, student_id, status, data) values ($1, $2, $3, 'placed', $4)`, [id, v.id, s.id, JSON.stringify(data)]);
  if (b._file) await q(`insert into print_files (order_id, data_url) values ($1, $2)`, [id, b._file]);
  res.json({ order: { ...data, status: "placed" } });
}));

app.post("/api/orders/:id/rate", wrap(async (req, res) => {
  const s = await needStudent(req, res); if (!s) return;
  const { rows } = await q(`select * from orders where id = $1 and student_id = $2`, [req.params.id, s.id]);
  const o = rows[0];
  if (!o || o.status !== "collected" || o.data.rating) return fail(res, 400, "You can rate an order once, after collecting it.");
  const stars = Math.min(5, Math.max(1, Number(req.body.stars) || 0)), comment = str(req.body.comment, 100);
  await q(`update orders set data = data || $2::jsonb where id = $1`, [o.id, JSON.stringify({ rating: { stars, comment } })]);
  const { rows: vr } = await q(`select data from vendors where id = $1`, [o.vendor_id]);
  if (vr[0]) {
    const ratings = (vr[0].data.ratings || []).concat({ stars, comment, at: Date.now() }).slice(-200);
    await q(`update vendors set data = data || $2::jsonb where id = $1`, [o.vendor_id, JSON.stringify({ ratings })]);
  }
  res.json({ ok: true });
}));

/* ---------- feedback & complaints ---------- */
app.post("/api/feedback", wrap(async (req, res) => {
  const s = await needStudent(req, res); if (!s) return;
  const message = str(req.body.message, 600);
  if (message.length < 5) return fail(res, 400, "Please write a little more.");
  const type = ["feedback", "complaint", "suggestion"].includes(req.body.type) ? req.body.type : "feedback";
  const vendorId = str(req.body.vendorId, 60) || null;
  let order = null;
  if (req.body.orderId) order = (await q(`select id, data from orders where id = $1 and student_id = $2`, [req.body.orderId, s.id])).rows[0];
  const { rows: seq } = await q(`select nextval('feedback_ref_seq') as n`);
  const id = "f" + Date.now() + crypto.randomInt(100, 999);
  const data = { id, ref: "FB-" + seq[0].n, type, vendorId, orderId: order ? order.id : null, token: order ? order.data.token : null, message,
    studentId: String(s.id), name: s.name, cls: s.cls, contact: `${s.phone} · ${s.email}`, at: Date.now() };
  await q(`insert into feedback (id, vendor_id, student_id, status, data) values ($1, $2, $3, 'open', $4)`, [id, vendorId, s.id, JSON.stringify(data)]);
  res.json({ feedback: { ...data, status: "open" } });
}));

/* ---------- vendors ---------- */
app.post("/api/vendor/login", wrap(async (req, res) => {
  const { rows } = await q(`select * from vendors where name_key = $1`, [DB.nameKey(req.body.shop)]);
  const v = rows[0];
  const pincode = str(req.body.pincode, 6), phone = cleanPhone(req.body.phone);
  if (!v) return fail(res, 404, "No shop with that name. Check the spelling, or open a new shop.");
  if (!/^\d{6}$/.test(pincode)) return fail(res, 400, "Pincode must be 6 digits.");
  if (!/^\d{10}$/.test(phone)) return fail(res, 400, "Enter the shop's 10-digit phone number.");
  if (pincode !== v.pincode || (v.phone && v.phone !== phone)) return fail(res, 401, "Shop name, pincode and phone number don't match.");
  let claimed = false;
  if (!v.phone) { // first login to a shop listed without a number: that number becomes the shop's
    const data = { ...v.data, phone, whatsapp: v.data.whatsapp || "91" + phone };
    await q(`update vendors set phone = $2, data = $3, updated_at = now() where id = $1`, [v.id, phone, JSON.stringify(data)]);
    claimed = true;
  }
  res.json({ token: await newSession("vendor", v.id), vendorId: v.id, claimed });
}));

app.post("/api/vendors", wrap(async (req, res) => {
  const b = req.body;
  const name = str(b.name, 40);
  if (name.length < 2) return fail(res, 400, "Please enter the shop name.");
  const { rows: same } = await q(`select 1 from vendors where name_key = $1`, [DB.nameKey(name)]);
  if (same.length) return fail(res, 409, "A shop with this name is already listed.");
  const phone = cleanPhone(b.phone), pincode = str(b.pincode, 6);
  if (!/^\d{10}$/.test(phone)) return fail(res, 400, "Enter a valid 10-digit phone number.");
  if (!/^\d{6}$/.test(pincode)) return fail(res, 400, "Pincode must be 6 digits.");
  const hours = (Array.isArray(b.hours) ? b.hours : []).slice(0, 3).filter((h) => Array.isArray(h) && /^\d{2}:\d{2}$/.test(h[0]) && /^\d{2}:\d{2}$/.test(h[1]));
  if (!hours.length) return fail(res, 400, "Please add your opening hours.");
  let id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "shop";
  for (let n = 2; (await q(`select 1 from vendors where id = $1`, [id])).rows.length || id === "new"; n++) id = id.replace(/-\d+$/, "") + "-" + n;
  const p = b.print;
  const data = {
    id, name, category: str(b.category, 24) || "Shops", emoji: str(b.emoji, 4) || "🏪", location: str(b.location, 40),
    distance: Math.max(0, Math.min(5000, Number(b.distance) || 0)), phone, whatsapp: "91" + (cleanPhone(b.whatsapp) || phone),
    hours, pincode, status: b.status === "open" ? "open" : "closed", queue: 0, avgServe: 2, note: "", menu: [], ratings: [],
    custom: true, createdAt: Date.now(), updatedAt: Date.now(),
    ...(p ? { print: { bw: Number(p.bw) || 0, color: Number(p.color) || 0, doubleSidedDiscount: 0.2, binding: Number(p.binding) || 0 } } : {}),
  };
  await q(`insert into vendors (id, data, name_key, pincode, phone) values ($1, $2, $3, $4, $5)`, [id, JSON.stringify(data), DB.nameKey(name), pincode, phone]);
  res.json({ token: await newSession("vendor", id), vendor: vendorOut({ id, data }) });
}));

// the shop updates itself: status, queue, announcement, menu, prices, stock
app.put("/api/vendor/me", wrap(async (req, res) => {
  const v = await needVendor(req, res); if (!v) return;
  const b = req.body, patch = {};
  if (["open", "busy", "closed"].includes(b.status)) patch.status = b.status;
  if (b.queue !== undefined) patch.queue = Math.max(0, Math.min(200, Number(b.queue) || 0));
  if (b.note !== undefined) patch.note = str(b.note, 80);
  if (Array.isArray(b.menu)) patch.menu = b.menu.slice(0, 200).map((m, i) => ({
    id: str(m.id, 40) || "x" + Date.now() + i, name: str(m.name, 40), price: Math.max(0, Number(m.price) || 0),
    inStock: m.inStock !== false, cat: str(m.cat, 20) || "Menu",
  })).filter((m) => m.name);
  patch.updatedAt = Date.now();
  const { rows } = await q(`update vendors set data = data || $2::jsonb, updated_at = now() where id = $1 returning *`, [v.id, JSON.stringify(patch)]);
  res.json({ vendor: vendorOut(rows[0]) });
}));

const NEXT = { placed: ["accepted", "rejected"], accepted: ["ready"], ready: ["collected", "no_show"] };
app.put("/api/vendor/orders/:id", wrap(async (req, res) => {
  const v = await needVendor(req, res); if (!v) return;
  const { rows } = await q(`select * from orders where id = $1 and vendor_id = $2`, [req.params.id, v.id]);
  const o = rows[0];
  if (!o) return fail(res, 404, "Order not found.");
  const status = String(req.body.status || "");
  if (!(NEXT[o.status] || []).includes(status)) return fail(res, 409, `Can't change this order from "${o.status}" to "${status}".`);
  await q(`update orders set status = $2, updated_at = now(), data = data || $3::jsonb where id = $1`, [o.id, status, JSON.stringify({ updatedAt: Date.now() })]);
  let strike = null;
  if (status === "no_show") {
    // 1st uncollected order: warning. 2nd: permanent block of the Gmail.
    await q(`insert into no_shows (order_id, student_id, token, shop) values ($1, $2, $3, $4) on conflict do nothing`, [o.id, o.student_id, o.data.token, v.data.name]);
    const { rows: sr } = await q(`update students set strikes = (select count(*) from no_shows where student_id = $1),
                                    blocked = (select count(*) from no_shows where student_id = $1) >= 2
                                  where id = $1 returning *`, [o.student_id]);
    const s = sr[0];
    if (s.blocked) {
      // the student's session stays so their next refresh can show "Account blocked";
      // every student action already refuses blocked accounts
      await q(`insert into blocked_emails (email, reason) values ($1, 'Did not collect orders twice') on conflict do nothing`, [s.email]);
    }
    strike = { strikes: s.strikes, blocked: s.blocked, name: s.name };
  }
  res.json({ ok: true, strike });
}));

app.get("/api/vendor/files/:orderId", wrap(async (req, res) => {
  const v = await needVendor(req, res); if (!v) return;
  const { rows } = await q(`select f.data_url from print_files f join orders o on o.id = f.order_id where f.order_id = $1 and o.vendor_id = $2`, [req.params.orderId, v.id]);
  if (!rows[0]) return fail(res, 404, "File not available.");
  res.json({ dataUrl: rows[0].data_url });
}));

app.put("/api/vendor/feedback/:id", wrap(async (req, res) => {
  const v = await needVendor(req, res); if (!v) return;
  const status = ["seen", "resolved"].includes(req.body.status) ? req.body.status : null;
  if (!status) return fail(res, 400, "Unknown status.");
  const reply = req.body.reply ? { reply: str(req.body.reply, 200) } : {};
  await q(`update feedback set status = $3, data = data || $4::jsonb where id = $1 and vendor_id = $2 and status <> 'resolved'`, [req.params.id, v.id, status, JSON.stringify(reply)]);
  res.json({ ok: true });
}));

app.post("/api/vendor/logout", wrap(async (req, res) => {
  const t = req.get("x-vendor-token"); if (t) await q(`delete from sessions where token_hash = $1`, [sha(t)]);
  res.json({ ok: true });
}));

/* ---------- start ---------- */
DB.connect().then(() => {
  app.listen(PORT, () => console.log(`Campus Vendors API on :${PORT} (${DB.kind}); allowed origins: ${ORIGINS.join(", ")}`));
}).catch((e) => { console.error("Database setup failed:", e); process.exit(1); });

module.exports = { app, canonicalGmail };
