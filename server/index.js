/* Campus Vendors: website + API. Students use email OTP. New shops require admin approval.
   Three student cancellations/confirmed no-shows suspend ordering; warnings 1 and 2 add
   a configurable percentage to the next successful pickup order. */
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const cors = require("cors");
const DB = require("./db");
const { sendCode, sendMerchantApplication } = require("./mail");

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

const studentOut = (s) => ({ id: s._id, email: s.email, name: s.name, cls: s.cls, phone: s.phone, strikes: s.strikes || 0, blocked: !!s.blocked, warningFeePercent: Number(s.warningFeePercent) || 0, feePending: !!s.feePending, feeOrderId: s.feeOrderId || null });
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
function vendorOut(v) { const d = { ...v.data, id: v._id }; delete d.pincode; delete d.ownerEmail; delete d.nameKey; return d; }
const orderOut = (o) => ({ ...o.data, id: o._id, status: o.status });
const feedbackOut = (f) => ({ ...f.data, id: f._id, status: f.status });
const noShowsOf = async (studentId) => (await C.noShows.find({ studentId }).sort({ at: -1 }).toArray())
  .map((n) => ({ order_id: n._id, token: n.token, shop: n.shop, at: n.at, reason: n.reason || "not_collected" }));
async function warningFeeFor(student) {
  if (!student.feePending || student.feeOrderId || student.strikes < 1 || student.strikes >= 3) return 0;
  if (student.warningFeePercent !== undefined && student.warningFeePercent !== null) return Math.max(0, Math.min(50, Number(student.warningFeePercent) || 0));
  const settings = await C.adminSettings.findOne({ _id: "order-warnings" });
  return Number(student.strikes === 1 ? settings?.warning1Percent ?? 5 : settings?.warning2Percent ?? 10) || 0;
}
async function recordStudentLogin(req, student, method) {
  const ip = String(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 80);
  await C.loginEvents.insertOne({
    email: student.email, studentId: student._id, ip, method,
    userAgent: str(req.get("user-agent"), 200), createdAt: new Date(), expiresAt: days(90),
  });
}

/* ---------- the website (only its own files are public) ---------- */
const ROOT = path.join(__dirname, "..");
const noCache = { setHeaders: (res) => res.set("Cache-Control", "no-cache") }; // always load the latest version
app.use("/css", express.static(path.join(ROOT, "css"), noCache));
app.use("/js", express.static(path.join(ROOT, "js"), noCache));
app.get(["/", "/index.html"], (req, res) => { res.set("Cache-Control", "no-cache"); res.sendFile(path.join(ROOT, "index.html")); });
app.get("/api/health", (req, res) => res.json({ ok: true, service: "campus-vendors", db: DB.kind, email: process.env.BREVO_API_KEY ? "brevo" : "not set" }));

/* ---------- admin access and shop approvals ---------- */
const ADMIN_EMAIL = canonicalGmail(process.env.ADMIN_EMAIL || "");
const adminConfigured = (res) => {
  if (!GMAIL.test(ADMIN_EMAIL)) { fail(res, 503, "Set ADMIN_EMAIL to the admin's Gmail address on the server."); return false; }
  return true;
};
async function needAdmin(req, res) {
  if (!adminConfigured(res)) return null;
  const email = await sessionSubject(bearer(req), "admin");
  if (email !== ADMIN_EMAIL) { fail(res, 401, "Admin sign-in required."); return null; }
  return email;
}
app.post("/api/admin/send-code", wrap(async (req, res) => {
  if (!adminConfigured(res)) return;
  if (canonicalGmail(str(req.body.email, 120)) !== ADMIN_EMAIL) return fail(res, 403, "Use the configured admin Gmail address.");
  const prev = await C.adminCodes.findOne({ _id: ADMIN_EMAIL });
  if (prev && Date.now() - prev.sentAt.getTime() < 60000) return fail(res, 429, "Please wait a minute before requesting another code.");
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await C.adminCodes.updateOne({ _id: ADMIN_EMAIL }, { $set: { codeHash: sha(ADMIN_EMAIL + ":" + code), attempts: 0, sentAt: new Date(), expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60000) } }, { upsert: true });
  try { await sendCode(ADMIN_EMAIL, code); } catch (e) { return fail(res, 502, "We couldn't email the admin code. Check email service settings."); }
  res.json({ ok: true, ...(DEV ? { devCode: code } : {}) });
}));
app.post("/api/admin/verify", wrap(async (req, res) => {
  if (!adminConfigured(res)) return;
  const c = await C.adminCodes.findOne({ _id: ADMIN_EMAIL });
  const code = str(req.body.code, 10).replace(/\D/g, "");
  if (!c || c.expiresAt < new Date()) return fail(res, 400, "That code expired. Request a new one.");
  if (c.attempts >= 5) return fail(res, 429, "Too many wrong tries. Request a new code.");
  if (c.codeHash !== sha(ADMIN_EMAIL + ":" + code)) { await C.adminCodes.updateOne({ _id: ADMIN_EMAIL }, { $inc: { attempts: 1 } }); return fail(res, 400, "That code is incorrect."); }
  await C.adminCodes.deleteOne({ _id: ADMIN_EMAIL });
  res.json({ token: await newSession("admin", ADMIN_EMAIL), email: ADMIN_EMAIL });
}));
app.get("/api/admin/applications", wrap(async (req, res) => {
  if (!await needAdmin(req, res)) return;
  const applications = await C.vendorApplications.find({ status: "pending" }).sort({ createdAt: 1 }).toArray();
  res.json({ applications: applications.map((a) => ({ ...a.data, vendorId: a.data.id, id: a._id, submittedAt: a.createdAt })) });
}));
app.patch("/api/admin/applications/:id", wrap(async (req, res) => {
  if (!await needAdmin(req, res)) return;
  const action = req.body.action === "approve" ? "approved" : req.body.action === "reject" ? "rejected" : null;
  if (!action) return fail(res, 400, "Choose approve or reject.");
  const a = await C.vendorApplications.findOne({ _id: req.params.id, status: "pending" });
  if (!a) return fail(res, 404, "This application is no longer pending.");
  if (action === "approved") {
    const d = a.data;
    try { await C.vendors.insertOne({ _id: d.id, nameKey: DB.nameKey(d.name), pincode: d.pincode, phone: d.phone, ownerEmail: d.ownerEmail, data: d, createdAt: new Date() }); }
    catch (e) { if (e.code === 11000) return fail(res, 409, "A shop with this name is already listed."); throw e; }
  }
  await C.vendorApplications.updateOne({ _id: a._id, status: "pending" }, { $set: { status: action, reviewedAt: new Date(), reviewedBy: ADMIN_EMAIL } });
  res.json({ ok: true, status: action, name: a.data.name });
}));
app.get("/api/admin/settings", wrap(async (req, res) => {
  if (!await needAdmin(req, res)) return;
  let settings = await C.adminSettings.findOne({ _id: "order-warnings" });
  if (!settings) settings = { _id: "order-warnings", warning1Percent: 5, warning2Percent: 10 };
  res.json({ settings: { warning1Percent: settings.warning1Percent, warning2Percent: settings.warning2Percent } });
}));
app.put("/api/admin/settings", wrap(async (req, res) => {
  if (!await needAdmin(req, res)) return;
  const warning1Percent = Math.max(0, Math.min(50, Number(req.body.warning1Percent) || 0));
  const warning2Percent = Math.max(0, Math.min(50, Number(req.body.warning2Percent) || 0));
  await C.adminSettings.updateOne({ _id: "order-warnings" }, { $set: { warning1Percent, warning2Percent, updatedAt: new Date() } }, { upsert: true });
  res.json({ settings: { warning1Percent, warning2Percent } });
}));
app.get("/api/admin/security-events", wrap(async (req, res) => {
  if (!await needAdmin(req, res)) return;
  const events = await C.loginEvents.find({}).sort({ createdAt: -1 }).limit(100).toArray();
  const emailsByIp = new Map();
  events.forEach((e) => emailsByIp.set(e.ip, (emailsByIp.get(e.ip) || new Set()).add(e.email)));
  res.json({ events: events.map((e) => ({ email: e.email, ip: e.ip, method: e.method, userAgent: e.userAgent, at: e.createdAt, sharedAccounts: emailsByIp.get(e.ip)?.size || 1 })) });
}));
app.get("/api/admin/logout", wrap(async (req, res) => {
  const token = bearer(req); if (token) await C.sessions.deleteOne({ _id: sha(token) });
  res.json({ ok: true });
}));

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
  await recordStudentLogin(req, s, "email_otp");
  res.json({ token: await newSession("student", s._id), student: studentOut(s) });
}));

// 2b. Finish a verified account that had no details yet.
app.post("/api/auth/finish", wrap(async (req, res) => {
  const email = await sessionSubject(req.body.pendingToken, "pending") || await sessionSubject(req.body.pendingToken, "pending-google");
  if (!email) return fail(res, 401, "Please start again and ask for a new code.");
  const name = str(req.body.name, 40).replace(/\s+/g, " "), cls = str(req.body.cls, 30), phone = cleanPhone(req.body.phone);
  if (name.length < 2 || !cls || !PHONE.test(phone)) return fail(res, 400, "Please fill in your name, class and a valid 10-digit mobile number.");
  if (await isBlocked(email)) return fail(res, 403, "This Gmail account has been permanently blocked.", { blocked: true });
  await C.students.updateOne({ email },
    { $set: { name, cls, phone }, $setOnInsert: { _id: newId("s"), email, strikes: 0, blocked: false, createdAt: new Date() } },
    { upsert: true });
  const s = await C.students.findOne({ email });
  await C.sessions.deleteOne({ _id: sha(req.body.pendingToken) });
  await recordStudentLogin(req, s, "verified_email");
  res.json({ token: await newSession("student", s._id), student: studentOut(s) });
}));

/* ---------- optional Google OAuth sign-in ---------- */
app.get("/api/auth/google", wrap(async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.redirect("/?google_error=unconfigured#/login");
  const state = crypto.randomBytes(24).toString("hex");
  await C.oauthStates.insertOne({ _id: state, expiresAt: new Date(Date.now() + 10 * 60000) });
  const baseUrl = String(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/auth/google/callback`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile", state, prompt: "select_account" }).toString();
  res.redirect(url.toString());
}));
app.get("/api/auth/google/callback", wrap(async (req, res) => {
  const state = str(req.query.state, 100);
  const stored = state && await C.oauthStates.findOne({ _id: state, expiresAt: { $gt: new Date() } });
  if (!stored || !req.query.code) return res.redirect("/?google_error=expired#/login");
  await C.oauthStates.deleteOne({ _id: state });
  const baseUrl = String(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/auth/google/callback`;
  const exchange = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: String(req.query.code), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: "authorization_code" }) });
  if (!exchange.ok) return res.redirect("/?google_error=failed#/login");
  const tokenData = await exchange.json();
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { authorization: `Bearer ${tokenData.access_token}` } });
  if (!profileRes.ok) return res.redirect("/?google_error=failed#/login");
  const profile = await profileRes.json();
  const email = canonicalGmail(profile.email);
  if (!profile.verified_email || !GMAIL.test(email)) return res.redirect("/?google_error=gmail#/login");
  if (await isBlocked(email)) return res.redirect("/?google_error=blocked#/login");
  let s = await C.students.findOne({ email });
  if (s && s.phone && s.cls) {
    await recordStudentLogin(req, s, "google");
    return res.redirect(`/?google_token=${encodeURIComponent(await newSession("student", s._id))}#/`);
  }
  if (s) await C.students.updateOne({ _id: s._id }, { $set: { name: s.name || str(profile.name, 40) } });
  else await C.students.insertOne({ _id: newId("s"), email, name: str(profile.name, 40) || email.split("@")[0], cls: "", phone: "", strikes: 0, blocked: false, createdAt: new Date() });
  s = await C.students.findOne({ email });
  const pendingToken = await newSession("pending-google", email, 1);
  res.redirect(`/?google_pending=${encodeURIComponent(pendingToken)}&google_email=${encodeURIComponent(email)}#/login`);
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
  const subtotal = total;
  const warningFeePercent = await warningFeeFor(s);
  const warningFee = warningFeePercent ? Math.ceil(subtotal * warningFeePercent / 100) : 0;
  total += warningFee;
  const id = newId("o");
  const token = (v.name.replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase() || "T") + "-" + (await DB.nextSeq("order", 101));
  const data = {
    id, token, type: b.type === "print" ? "print" : "food", vendorId: row._id, items, subtotal, total,
    ...(warningFee ? { warningFee: { percent: warningFeePercent, amount: warningFee, forMerchant: true } } : {}),
    pickup: /^(ASAP|\d{2}:\d{2})$/.test(b.pickup) ? b.pickup : "ASAP", note: str(b.note, 100),
    student: { id: s._id, name: s.name, cls: s.cls, phone: s.phone, email: s.email },
    createdAt: Date.now(), ...(print ? { print } : {}),
  };
  await C.orders.insertOne({ _id: id, vendorId: row._id, studentId: s._id, status: "placed", data, createdAt: new Date() });
  if (warningFee) await C.students.updateOne({ _id: s._id, feePending: true, feeOrderId: null }, { $set: { feeOrderId: id } });
  if (file) await C.printFiles.insertOne({ _id: id, dataUrl: file });
  res.json({ order: { ...data, status: "placed" } });
}));

app.put("/api/orders/:id/cancel", wrap(async (req, res) => {
  const s = await needStudent(req, res); if (!s) return;
  const o = await C.orders.findOne({ _id: req.params.id, studentId: s._id });
  if (!o) return fail(res, 404, "Order not found.");
  if (o.status !== "placed") return fail(res, 409, "Orders can only be cancelled before the shop accepts them.");
  const result = await C.orders.updateOne({ _id: o._id, studentId: s._id, status: "placed" }, { $set: { status: "cancelled", "data.updatedAt": Date.now() } });
  if (!result.modifiedCount) return fail(res, 409, "The shop just accepted this order. It can no longer be cancelled.");
  const strike = (s.strikes || 0) + 1;
  const blocked = strike >= 3;
  const feePercent = strike === 1 || strike === 2 ? await warningFeeFor({ ...s, strikes: strike, feePending: true, feeOrderId: null, warningFeePercent: null }) : 0;
  const shop = await C.vendors.findOne({ _id: o.vendorId });
  await C.noShows.updateOne({ _id: o._id }, { $setOnInsert: { studentId: s._id, token: o.data.token, shop: shop?.data?.name || "Shop", at: new Date(), reason: "cancelled" } }, { upsert: true });
  await C.students.updateOne({ _id: s._id }, { $set: { strikes: strike, blocked, feePending: !blocked, feeOrderId: null, warningFeePercent: feePercent } });
  if (blocked) await C.blockedEmails.updateOne({ _id: s.email }, { $setOnInsert: { reason: "Cancelled orders three times", at: new Date() } }, { upsert: true });
  res.json({ ok: true, strike: { strikes: strike, blocked, feePercent } });
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
  const ownerEmail = canonicalGmail(str(b.ownerEmail, 120));
  if (!GMAIL.test(ownerEmail)) return fail(res, 400, "Enter a valid Gmail address so we can send your application updates.");
  const name = str(b.name, 40);
  if (name.length < 2) return fail(res, 400, "Please enter the shop name.");
  if (await C.vendors.findOne({ nameKey: DB.nameKey(name) }) || await C.vendorApplications.findOne({ "data.nameKey": DB.nameKey(name), status: "pending" })) return fail(res, 409, "A shop with this name is already listed or awaiting review.");
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
    hours, pincode, ownerEmail, status: "closed", queue: 0, avgServe: 2, note: "", menu: [], ratings: [],
    custom: true, createdAt: Date.now(), updatedAt: Date.now(),
    ...(p ? { print: { bw: Number(p.bw) || 0, color: Number(p.color) || 0, doubleSidedDiscount: 0.2, binding: Number(p.binding) || 0 } } : {}),
  };
  const applicationId = newId("va");
  await C.vendorApplications.insertOne({ _id: applicationId, status: "pending", data: { ...data, nameKey: DB.nameKey(name) }, createdAt: new Date() });
  let emailSent = false;
  try {
    if (!GMAIL.test(ADMIN_EMAIL)) throw new Error("admin_email_not_configured");
    const baseUrl = String(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "https://campus-vendors.onrender.com").replace(/\/$/, "");
    await sendMerchantApplication(ADMIN_EMAIL, data, `${baseUrl}/#/admin`);
    emailSent = true;
  } catch (e) { console.error("Admin application email failed:", e.message); }
  res.status(202).json({ ok: true, pending: true, applicationId, emailSent, message: emailSent ? "Application sent to the admin for approval." : "Application saved. Admin email notification could not be sent; check server email settings." });
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
    // A confirmed uncollected pickup is counted with cancellation warnings.
    await C.noShows.updateOne({ _id: o._id }, { $setOnInsert: { studentId: o.studentId, token: o.data.token, shop: v.data.name, at: new Date(), reason: "not_collected" } }, { upsert: true });
    const strikes = await C.noShows.countDocuments({ studentId: o.studentId });
    const blocked = strikes >= 3;
    const student = await C.students.findOne({ _id: o.studentId });
    const warningFeePercent = blocked ? 0 : await warningFeeFor({ ...student, strikes, feePending: true, feeOrderId: null, warningFeePercent: null });
    await C.students.updateOne({ _id: o.studentId }, { $set: { strikes, blocked, feePending: !blocked, feeOrderId: null, warningFeePercent } });
    const s = await C.students.findOne({ _id: o.studentId });
    // the student's session stays so their next refresh can show "Account blocked";
    // every student action already refuses blocked accounts
    if (s.blocked) await C.blockedEmails.updateOne({ _id: s.email }, { $setOnInsert: { reason: "Cancelled or failed to collect orders three times", at: new Date() } }, { upsert: true });
    strike = { strikes: s.strikes, blocked: s.blocked, feePercent: warningFeePercent, name: s.name };
  }
  if (status === "collected" && o.data.warningFee) await C.students.updateOne({ _id: o.studentId, feeOrderId: o._id }, { $set: { feePending: false, feeOrderId: null, warningFeePercent: 0 } });
  if (status === "rejected" && o.data.warningFee) await C.students.updateOne({ _id: o.studentId, feeOrderId: o._id }, { $set: { feePending: true, feeOrderId: null } });
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
