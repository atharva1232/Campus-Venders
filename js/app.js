/* Campus Vendor Directory — UI and routing (vanilla JS, hash routes). */
(function () {
  const CFG = window.CVD_CONFIG || {};
  const S = window.Store;
  const app = document.getElementById("app");

  /* ---------- helpers ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rupee = (n) => "₹" + (Math.round(n * 100) / 100).toLocaleString("en-IN");
  const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };
  const fmtTime = (t) => { const m = toMin(t); const h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 ? "pm" : "am"; return ((h + 11) % 12 + 1) + (mm ? ":" + String(mm).padStart(2, "0") : "") + " " + ap; };
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const ago = (ts) => {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return "just now";
    const m = Math.round(s / 60); if (m < 60) return m + " min ago";
    const h = Math.round(m / 60); return h < 24 ? h + " hr ago" : Math.round(h / 24) + " d ago";
  };
  const clock = (ts) => new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const waitMin = (v) => (v.status === "closed" ? 0 : Math.round(v.queue * v.avgServe));
  const avgRating = (v) => (v.ratings && v.ratings.length ? v.ratings.reduce((a, r) => a + r.stars, 0) / v.ratings.length : null);
  const STATUS_LABEL = { open: "Open", busy: "Busy", closed: "Closed" };
  const ORDER_LABEL = { placed: "Sent to vendor", accepted: "Being prepared", ready: "Ready for pickup", collected: "Collected", rejected: "Declined", no_show: "Not collected", cancelled: "Cancelled" };

  function hoursInfo(v) {
    const m = nowMin();
    const slots = (v.hours || []).map(([o, c]) => [toMin(o), toMin(c)]);
    const cur = slots.find(([o, c]) => m >= o && m < c);
    if (cur) return { within: true, text: "Closes " + fmtTime(Math.floor(cur[1] / 60) + ":" + (cur[1] % 60)) };
    const next = slots.find(([o]) => o > m);
    if (next) return { within: false, text: "Opens " + fmtTime(Math.floor(next[0] / 60) + ":" + (next[0] % 60)) };
    return { within: false, text: slots.length ? "Opens tomorrow " + fmtTime(v.hours[0][0]) : "Timings not listed" };
  }

  /* Minutes until a closed shop's next opening later today, or null if it does not open again today. */
  function opensIn(v) {
    const m = nowMin();
    const next = (v.hours || []).map(([o]) => toMin(o)).filter((o) => o > m).sort((a, b) => a - b)[0];
    return next === undefined ? null : next - m;
  }
  const inMins = (n) => (n < 60 ? n + " min" : Math.floor(n / 60) + " hr" + (n % 60 ? " " + (n % 60) + " min" : ""));

  window.toast = (m, k) => toast(m, k);
  function toast(msg, kind) {
    const t = document.createElement("div");
    t.className = "toast " + (kind || "");
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2800);
  }


  function ask(msg, okLabel) {
    return new Promise((resolve) => {
      const d = document.createElement("div");
      d.className = "modal";
      d.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true"><p>${esc(msg)}</p><div class="modal-actions"><button class="btn" data-m="0">Cancel</button><button class="btn primary" data-m="1">${esc(okLabel || "OK")}</button></div></div>`;
      document.body.appendChild(d);
      d.querySelector('[data-m="1"]').focus();
      const done = (v) => { d.remove(); resolve(v); };
      d.addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (b) done(b.dataset.m === "1"); else if (e.target === d) done(false); });
      d.addEventListener("keydown", (e) => { if (e.key === "Escape") done(false); });
    });
  }

  const pill = (status) => `<span class="pill pill-${status}"><i></i>${STATUS_LABEL[status]}</span>`;
  const isPrint = (v) => !!v.print;

  function pickupSlots(v) {
    const out = [];
    const start = Math.ceil((nowMin() + 10) / 15) * 15;
    for (let m = start; m < start + 6 * 60 && out.length < 16; m += 15) {
      const within = (v.hours || []).some(([o, c]) => m >= toMin(o) && m < toMin(c));
      if (within && m < 24 * 60) out.push(String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"));
    }
    return out;
  }

  /* ---------- layout ---------- */
  function nav(active) {
    const cartN = S.cartCount();
    const live = S.myOrders().filter((o) => ["placed", "accepted", "ready"].includes(o.status)).length;
    const link = (href, label, key, badge) => `<a href="${href}" class="${active === key ? "active" : ""}">${label}${badge ? `<b class="badge">${badge}</b>` : ""}</a>`;
    return `
      <header class="topbar">
        <a href="#/" class="brand"><span class="brand-mark">CV</span><span>Campus<br>Vendors</span></a>
        <nav class="mainnav">
          ${link("#/", "Directory", "home")}
          ${link("#/print", "Print job", "print")}
          ${link("#/orders", "My orders", "orders", live)}
          ${link("#/dashboard", "For vendors", "dashboard")}
          ${link("#/about", "About", "about")}
        </nav>
        <a href="#/cart" class="cartbtn ${cartN ? "has" : ""}" aria-label="Cart">🛒<span>${cartN || ""}</span></a>
        ${(() => {
          const me = S.student();
          return me
            ? `<a href="#/account" class="acct ${active === "account" ? "active" : ""}" title="Your account"><span class="initials sm">${esc(initials(me.name))}</span><span class="acct-name">${esc(me.name.split(" ")[0])}</span></a>`
            : `<a href="#/login" class="acct login ${active === "account" ? "active" : ""}">Sign in</a>`;
        })()}
      </header>`;
  }

  const initials = (n) => String(n).trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  /* ---------- student OTP sign-in ---------- */
  let afterLogin = null;
  /* Sends the visitor to the login page if no student is signed in. Returns true when it redirected. */
  function needStudent() {
    if (S.student()) return false;
    afterLogin = location.hash || "#/";
    location.hash = "#/login";
    return true;
  }

  function studentBox() {
    const me = S.student();
    return `<div class="who"><span class="initials sm">${esc(initials(me.name))}</span><div class="grow"><b>${esc(me.name)}</b><div class="muted small">${esc(me.cls)} · ${esc(me.phone || "")} · ${esc(me.email)}</div></div><a class="small" href="#/account">Not you?</a></div>`;
  }

  /* Login page
     mode "signin"   – returning student: Gmail + phone number, no code
     mode "create"   – new student: name, class, phone, Gmail → emailed code (once)
     mode "codeonly" – forgot the phone number: Gmail → emailed code
     step "email" (the form) → "code" → (only if details are missing) "profile" */
  const login = { mode: "signin", step: "email", email: "", name: "", cls: "", phone: "", lastSent: 0 };
  const PHONE = /^[6-9]\d{9}$/;
  const cleanPhone = (p) => String(p || "").replace(/\D/g, "").replace(/^(91|0)(?=[6-9]\d{9}$)/, "");
  function goAfterLogin(msg) {
    Auth.forgetSignup();
    toast(msg, "ok");
    login.step = "email"; login.mode = "signin";
    const next = afterLogin || "#/";
    afterLogin = null;
    if (location.hash === next) route(); else location.hash = next;
  }

  function blockedPage() {
    page("account", `
      <div class="login-wrap">
        <div class="card blocked">
          <div class="blocked-icon">⛔</div>
          <h1>Account blocked</h1>
          <p>This Gmail account has been <b>suspended from ordering</b> after three repeated order cancellations or missed pickups.</p>
          <p class="muted small">You can still browse shops, menus, and prices. Contact the Campus Vendors team if you believe this is a mistake.</p>
          <a class="btn" href="#/">Back to the directory</a>
        </div>
      </div>`);
  }

  const gmailField = () => `<label>Gmail address<input name="email" type="email" required autocomplete="email" inputmode="email" value="${esc(login.email)}" placeholder="yourname@gmail.com"></label>`;
  const phoneField = (label) => `<label>${label || "Phone number"}<input name="phone" type="tel" required inputmode="numeric" maxlength="14" autocomplete="tel-national" value="${esc(login.phone)}" placeholder="10-digit mobile number"></label>`;
  const detailFields = () => `
        <label>Full name<input name="name" required maxlength="40" autocomplete="name" value="${esc(login.name)}" placeholder="e.g. Ananya Rao"></label>
        <div class="row2">
          <label>Class<input name="cls" required maxlength="30" value="${esc(login.cls)}" placeholder="e.g. 2nd Year CSE – B"></label>
          ${phoneField()}
        </div>`;
  /* reads and checks name / class / phone from a form into `login`; returns false (after a toast) if something is wrong */
  function readDetails(f) {
    login.name = f.name.value.trim().replace(/\s+/g, " ");
    login.cls = f.cls.value.trim();
    login.phone = cleanPhone(f.phone.value);
    if (login.name.length < 2) { toast("Please enter your full name", "err"); return false; }
    if (!login.cls) { toast("Please enter your class", "err"); return false; }
    if (!PHONE.test(login.phone)) { toast("Enter a valid 10-digit mobile number", "err"); return false; }
    return true;
  }
  function readGmail(f) {
    login.email = f.email.value.trim().toLowerCase();
    if (!Auth.isGmail(login.email)) { toast("Please use a Gmail address (ending in @gmail.com)", "err"); return false; }
    return true;
  }

  function loginPage() {
    if (S.student()) { location.hash = afterLogin || "#/account"; afterLogin = null; return; }
    if (Auth.blocked) return blockedPage();
    if (Auth.needsProfile && login.step !== "code") { login.step = "profile"; login.email = Auth.pendingEmail || login.email; }
    if (!Auth.enabled) return page("account", `<div class="empty big"><h2>Student login isn't set up</h2><p class="muted">Set API_URL in js/config.js.</p></div>`);
    const note = (Auth.linkError && login.step === "email"
        ? `<div class="alert">⚠️ ${esc(Auth.linkError)}</div>` : "")
      + (afterLogin && afterLogin !== "#/" && login.step === "email" ? `<div class="note big">Sign in to continue. You'll go straight back to where you were.</div>` : "");
    const tabs = `<div class="tabs auth-tabs">
        <button type="button" data-mode="signin" class="${login.mode !== "create" ? "on" : ""}">Sign in</button>
        <button type="button" data-mode="create" class="${login.mode === "create" ? "on" : ""}">New student? Create account</button>
      </div>`;
    let body = "";
    if (login.step === "email" && login.mode === "signin") body = `
      <p class="eyebrow">Students</p>
      <h1>Sign in</h1>
      <p class="lead">Enter your Gmail and we’ll send a one-time code every time you sign in.</p>
      ${note}${tabs}
      <form id="lSignin" class="card form">
        ${gmailField()}
        <button class="btn primary block" type="submit">Email me a sign-in code</button>
        <a class="btn block google-btn" href="/api/auth/google">Continue with Google</a>
        <p class="muted small">For account security, sign-in IP and browser details are stored for 90 days. An IP matching a banned account can trigger a ban; shared campus Wi-Fi may cause a mistaken match.</p>
      </form>`;
    if (login.step === "email" && login.mode === "create") body = `
      <p class="eyebrow">Students · step 1 of 2</p>
      <h1>Create your account</h1>
      <p class="lead">Enter your details and Gmail. We’ll email you a code to verify your account. Future sign-ins also use a one-time code.</p>
      ${note}${tabs}
      <form id="lCreate" class="card form">
        ${detailFields()}
        ${gmailField()}
        <button class="btn primary block" type="submit">Send code</button>
        <p class="muted small">Only Gmail addresses (@gmail.com) can be used. Shops see your name, class and phone number on your orders so they can reach you.</p>
      </form>`;
    if (login.step === "email" && login.mode === "codeonly") body = `
      <p class="eyebrow">Students</p>
      <h1>Sign in with a code</h1>
      <p class="lead">Enter your Gmail and we'll email you a one-time code.</p>
      ${note}
      <form id="lCodeOnly" class="card form">
        ${gmailField()}
        <button class="btn primary block" type="submit">Send code</button>
        <div class="row-between small"><button type="button" class="linkbtn" data-mode="signin">← Back to sign in</button></div>
      </form>`;
    if (login.step === "code") body = `
      <p class="eyebrow">Students${login.mode === "create" ? " · step 2 of 2" : ""}</p>
      <h1>Check your Gmail</h1>
      <p class="lead">We've emailed <b>${esc(login.email)}</b>. It may take a minute, and check Spam if you don't see it.</p>
      <div class="note big">📩 Enter the six-digit code from your email. It expires in 10 minutes.</div>
      <form id="lCode" class="card form">
        <label>Code from the email<input name="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" placeholder="6-digit code" class="codein"></label>
        <button class="btn primary block" type="submit">Verify</button>
        <div class="row-between small"><button type="button" class="linkbtn" id="lResend">Send a new email</button><button type="button" class="linkbtn" id="lBack">${login.mode === "create" ? "Change my details" : "Use a different Gmail"}</button></div>
      </form>`;
    if (login.step === "profile") body = `
      <p class="eyebrow">Students</p>
      <h1>Finish your account</h1>
      <p class="lead">Your Gmail <b>${esc(login.email)}</b> is confirmed. Add your details so shops can prepare your orders.</p>
      <form id="lProfile" class="card form">
        ${detailFields()}
        <button class="btn primary block" type="submit">Save and continue</button>
      </form>`;
    page("account", `<div class="login-wrap">${body}<p class="muted small center">Run a shop? <a href="#/dashboard">Vendor login is here</a>.</p></div>`);

    app.querySelectorAll(".login-wrap [data-mode]").forEach((b) => b.onclick = () => {
      // keep whatever was typed when switching between the forms
      const f = b.closest(".login-wrap").querySelector("form");
      if (f && f.email) login.email = f.email.value.trim();
      if (f && f.phone) login.phone = f.phone.value.trim();
      login.mode = b.dataset.mode; login.step = "email"; loginPage();
    });

    const busy = (form, on, label) => { const b = form.querySelector("button[type=submit]"); b.disabled = on; if (label) b.textContent = label; };
    const send = async () => {
      if (Date.now() - login.lastSent < 60000) { toast(`Please wait ${Math.ceil((60000 - (Date.now() - login.lastSent)) / 1000)} s before asking for another code`, "err"); return false; }
      const details = login.mode === "create" ? { name: login.name, cls: login.cls, phone: login.phone } : null;
      const r = await Auth.sendCode(login.email, details);
      if (r.blocked) { blockedPage(); return false; }
      if (r.error) { toast(r.error, "err"); return false; }
      login.lastSent = Date.now();
      if (r.devCode) setTimeout(() => toast("Local test mode: your code is " + r.devCode), 1200); // only when running on this computer
      return true;
    };
    /* save name / class / phone on the account (this also makes the phone the sign-in number), then go on */
    const finish = async (form, label) => {
      const wasNew = Auth.needsProfile;
      const r = await Auth.saveProfile(login.name, login.cls, login.phone);
      if (r.blocked) return blockedPage();
      if (r.error) { toast(r.error, "err"); return busy(form, false, label); }
      goAfterLogin(wasNew ? `Welcome, ${login.name.split(" ")[0]}! Your account is ready.` : `Welcome back, ${login.name.split(" ")[0]}!`);
    };

    const fs = document.getElementById("lSignin");
    if (fs) fs.onsubmit = async (e) => {
      e.preventDefault();
      if (!readGmail(fs)) return;
      busy(fs, true, "Sending…");
      if (await send()) { login.step = "code"; toast("Sign-in code sent. Check your Gmail.", "ok"); loginPage(); }
      else if (document.body.contains(fs)) busy(fs, false, "Email me a sign-in code");
    };
    const fn = document.getElementById("lCreate");
    if (fn) fn.onsubmit = async (e) => {
      e.preventDefault();
      if (!readDetails(fn) || !readGmail(fn)) return;
      busy(fn, true, "Sending…");
      Auth.rememberSignup({ email: login.email, name: login.name, cls: login.cls, phone: login.phone });
      if (await send()) { login.step = "code"; toast("Email sent. Check your Gmail.", "ok"); loginPage(); }
      else if (document.body.contains(fn)) busy(fn, false, "Send code");
    };
    const fo = document.getElementById("lCodeOnly");
    if (fo) fo.onsubmit = async (e) => {
      e.preventDefault();
      if (!readGmail(fo)) return;
      login.name = "";
      busy(fo, true, "Sending…");
      if (await send()) { login.step = "code"; toast("Email sent. Check your Gmail.", "ok"); loginPage(); }
      else if (document.body.contains(fo)) busy(fo, false, "Send code");
    };
    const fc = document.getElementById("lCode");
    if (fc) {
      fc.code.focus();
      fc.onsubmit = async (e) => {
        e.preventDefault();
        busy(fc, true, "Checking…");
        const details = login.mode === "create" && login.name ? { name: login.name, cls: login.cls, phone: login.phone } : null;
        const r = await Auth.verify(login.email, fc.code.value, details);
        if (r.blocked) return blockedPage();
        if (r.error) { toast(r.error, "err"); return busy(fc, false, "Verify"); }
        if (Auth.me) return goAfterLogin(login.mode === "create" ? `Welcome, ${Auth.me.name.split(" ")[0]}! Your account is ready.` : `Welcome back, ${Auth.me.name.split(" ")[0]}!`);
        login.step = "profile"; loginPage(); // code accepted, but we still need name / class / phone
      };
      document.getElementById("lResend").onclick = async () => { if (await send()) toast("New email sent", "ok"); };
      document.getElementById("lBack").onclick = () => { login.step = "email"; loginPage(); };
    }
    const fp = document.getElementById("lProfile");
    if (fp) fp.onsubmit = async (e) => {
      e.preventDefault();
      if (!readDetails(fp)) return;
      busy(fp, true, "Saving…");
      await finish(fp, "Save and continue");
    };
  }

  function accountPage() {
    const me = S.student();
    if (!me) return loginPage();
    const os = S.myOrders();
    const live = os.filter((o) => ["placed", "accepted", "ready"].includes(o.status)).length;
    page("account", `
      <div class="login-wrap">
        <p class="eyebrow">Your account</p>
        <div class="card acct-card">
          <span class="initials lg">${esc(initials(me.name))}</span>
          <div class="grow"><h2>${esc(me.name)}</h2><div class="muted">${esc(me.cls)}</div><div class="muted">📞 ${esc(me.phone || "—")}</div><div class="muted">✉️ ${esc(me.email)}</div></div>
        </div>
        ${me.strikes ? strikeWarning() : `<div class="card small muted">✓ Good standing. Repeated cancellations or missed pickups receive warnings. A third strike suspends ordering.</div>`}
        <form id="sedit" class="card form">
          <h3>Update your details</h3>
          <div class="row2">
            <label>Class<input name="cls" required maxlength="30" value="${esc(me.cls)}"></label>
          <label>Phone number <span class="muted small">(shops can contact you about pickup)</span><input name="phone" type="tel" required inputmode="numeric" maxlength="14" value="${esc(me.phone || "")}"></label>
          </div>
          <button class="btn">Save</button>
        </form>
        <div class="stack">
          <a class="btn" href="#/orders">My orders${live ? ` · ${live} in progress` : ` (${os.length})`}</a>
          <button class="btn" id="slogout">Log out</button>
        </div>
      </div>
    `);
    document.getElementById("sedit").onsubmit = async (e) => {
      e.preventDefault();
      const cls = e.target.cls.value.trim(), phone = cleanPhone(e.target.phone.value);
      if (!cls) return toast("Please enter your class", "err");
      if (!PHONE.test(phone)) return toast("Enter a valid 10-digit mobile number", "err");
      const r = await Auth.saveProfile(me.name, cls, phone);
      if (r.error) return toast(r.error, "err");
      toast("Details updated");
      if (location.hash === "#/account") accountPage(); // don't redraw over a page the student has moved to
    };
    document.getElementById("slogout").onclick = async () => { S.clearCart(); await Auth.logout(); toast("Logged out"); location.hash = "#/"; };
  }

  /* shown to a student with cancellation / missed-pickup warnings */
  function strikeWarning() {
    const n = Auth.noShows[0];
    const fee = Number(Auth.me && Auth.me.warningFeePercent) || 0;
    return `<div class="strike">
      <b>⚠️ Warning ${Auth.me.strikes} of 3: repeated order cancellation</b>
      <p>${n ? `Order <b>${esc(n.token)}</b> at ${esc(n.shop)} was ${n.reason === "cancelled" ? "cancelled" : "not collected"} on ${new Date(n.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}. ` : ""}${fee ? (Auth.me.feeOrderId ? `A ${fee}% fee is attached to order ${esc(Auth.me.feeOrderId)} and due at pickup.` : `Your next order includes a ${fee}% fee on its final amount, paid to the shop.`) : ""} <b>A third warning suspends ordering.</b></p>
    </div>`;
  }

  function footer() {
    const src = S.lastError ? `<span class="warn">Offline: showing the last saved shop list</span>` : "Live";
    return `<footer class="foot">
      <div>Campus Vendor Directory · Design Thinking Lab, RVCE · SDG 9 & SDG 17</div>
      <div class="muted">${src} · <a href="#/poster">QR poster</a></div>
    </footer>`;
  }

  let keepScroll = false;
  function page(active, body) {
    const y = window.scrollY;
    const me = S.student();
    const warn = me && me.strikes >= 1 && active !== "account" ? `<div class="wrap strike-wrap">${strikeWarning()}</div>` : "";
    app.innerHTML = nav(active) + warn + `<main class="wrap">${body}</main>` + footer();
    window.scrollTo(0, keepScroll ? y : 0);
    keepScroll = false;
  }

  /* ---------- HOME / directory ---------- */
  const ui = { q: "", cat: "All", openOnly: false, sort: "wait" };

  function vendorCard(v) {
    const h = hoursInfo(v);
    const w = waitMin(v);
    const r = avgRating(v);
    const top = v.menu.filter((m) => m.inStock).slice(0, 3).map((m) => esc(m.name)).join(" · ");
    return `
      <article class="card vcard status-${v.status}" data-href="#/vendor/${v.id}">
        <div class="vcard-top">
          <div class="avatar">${v.emoji}</div>
          <div class="vcard-title">
            <h3>${esc(v.name)}</h3>
            <div class="muted small">${esc(v.category)} · ${v.distance} m · ${esc(v.location)}</div>
          </div>
          ${pill(v.status)}
        </div>
        <div class="vcard-stats">
          <div><b>${v.status === "closed" ? "—" : "~" + w + " min"}</b><span>wait</span></div>
          <div><b>${v.status === "closed" ? "—" : v.queue}</b><span>in queue</span></div>
          <div><b>${r ? r.toFixed(1) + "★" : "New"}</b><span>${r ? v.ratings.length + " ratings" : "rating"}</span></div>
        </div>
        ${v.note ? `<div class="note">📢 ${esc(v.note)}</div>` : ""}
        <div class="muted small top-items">${top || "Menu not listed yet"}</div>
        <div class="vcard-foot">
          <span class="small ${h.within ? "" : "warn"}">🕒 ${h.text}${v.status === "closed" && opensIn(v) !== null ? ` <b>(in ${inMins(opensIn(v))})</b>` : ""}</span>
          <span class="small muted">Updated ${ago(v.updatedAt)}</span>
        </div>
      </article>`;
  }

  function filteredVendors() {
    const q = ui.q.trim().toLowerCase();
    let list = S.state.vendors.filter((v) => {
      if (ui.cat !== "All" && v.category !== ui.cat) return false;
      if (ui.openOnly && v.status === "closed") return false;
      if (!q) return true;
      return [v.name, v.category, v.location, ...v.menu.map((m) => m.name)].join(" ").toLowerCase().includes(q);
    });
    const rank = { open: 0, busy: 1, closed: 2 };
    list.sort((a, b) => {
      if (ui.sort === "near") return a.distance - b.distance;
      if (ui.sort === "rating") return (avgRating(b) || 0) - (avgRating(a) || 0);
      return rank[a.status] - rank[b.status] || waitMin(a) - waitMin(b);
    });
    return list;
  }

  function renderGrid() {
    const list = filteredVendors();
    const el = document.getElementById("grid");
    if (!el) return;
    const openNow = list.filter((v) => v.status !== "closed");
    const soon = list.filter((v) => v.status === "closed" && opensIn(v) !== null).sort((a, b) => opensIn(a) - opensIn(b));
    const later = list.filter((v) => v.status === "closed" && opensIn(v) === null);
    const group = (title, sub, vs, cls) => vs.length ? `
      <div class="vgroup ${cls}">
        <div class="vgroup-head"><h2>${title}</h2><span class="muted small">${vs.length} shop${vs.length > 1 ? "s" : ""} · ${sub}</span></div>
        <div class="grid">${vs.map(vendorCard).join("")}</div>
      </div>` : "";
    el.innerHTML = list.length
      ? group("Open now", "go right away", openNow, "g-open") +
        group("Opening soon", "later today, soonest first", soon, "g-soon") +
        group("Closed for today", "check back tomorrow", later, "g-closed")
      : `<div class="empty">No shops match. Try another search or turn off “Open now”.</div>`;
    if (list.length && !openNow.length) el.insertAdjacentHTML("afterbegin", `<div class="note big">None of these shops are open right now. The ones opening next are listed first.</div>`);
    document.getElementById("count").textContent = list.length + " of " + S.state.vendors.length + " shops";
  }

  function home() {
    const vs = S.state.vendors;
    const open = vs.filter((v) => v.status === "open").length;
    const busy = vs.filter((v) => v.status === "busy").length;
    const closed = vs.filter((v) => v.status === "closed").length;
    const cats = ["All", ...new Set(vs.map((v) => v.category))];
    page("home", `
      <section class="hero">
        <div>
          <p class="eyebrow">Around ${esc(CFG.CAMPUS_NAME || "campus")} · live status</p>
          <h1>Know before<br>you walk over.</h1>
          <p class="lead">See which tea stalls, print shops, tiffin centres and tailors near campus are open, how long the queue is, and what's on the menu. Pre-order your food or send your print job ahead.</p>
          <div class="hero-cta">
            <a class="btn primary" href="#directory">Find a shop</a>
            <a class="btn" href="#/print">Send a print job</a>
          </div>
        </div>
        <div class="board">
          <div class="board-row"><span class="dot open"></span><b>${open}</b> open</div>
          <div class="board-row"><span class="dot busy"></span><b>${busy}</b> busy</div>
          <div class="board-row"><span class="dot closed"></span><b>${closed}</b> closed</div>
          <div class="board-foot">Status board · ${clock(Date.now())}</div>
        </div>
      </section>

      <section id="directory" class="toolbar">
        <input id="search" type="search" placeholder="Search a shop or item — try “dosa”, “xerox”, “graph book”" value="${esc(ui.q)}" autocomplete="off">
        <div class="chips">${cats.map((c) => `<button class="chip ${ui.cat === c ? "on" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}</div>
        <div class="toolbar-row">
          <label class="switch"><input type="checkbox" id="openOnly" ${ui.openOnly ? "checked" : ""}><span></span> Open now</label>
          <select id="sort" aria-label="Sort">
            <option value="wait" ${ui.sort === "wait" ? "selected" : ""}>Shortest wait</option>
            <option value="near" ${ui.sort === "near" ? "selected" : ""}>Nearest</option>
            <option value="rating" ${ui.sort === "rating" ? "selected" : ""}>Top rated</option>
          </select>
          <span id="count" class="muted small"></span>
        </div>
      </section>
      <section id="grid"></section>
    `);
    renderGrid();
    const search = document.getElementById("search");
    search.addEventListener("input", (e) => { ui.q = e.target.value; renderGrid(); });
    document.getElementById("openOnly").addEventListener("change", (e) => { ui.openOnly = e.target.checked; renderGrid(); });
    document.getElementById("sort").addEventListener("change", (e) => { ui.sort = e.target.value; renderGrid(); });
  }

  /* ---------- VENDOR detail ---------- */
  function vendorPage(id) {
    const v = S.vendor(id);
    if (!v) return notFound();
    const h = hoursInfo(v);
    const cart = S.state.cart;
    const canOrder = v.status !== "closed";
    const groups = {};
    v.menu.forEach((m) => (groups[m.cat || "Menu"] = groups[m.cat || "Menu"] || []).push(m));
    const r = avgRating(v);
    const days = (v.hours || []).map(([o, c]) => `<li>${fmtTime(o)} – ${fmtTime(c)}</li>`).join("");
    const waText = encodeURIComponent(`Hi ${v.name}, I found you on the Campus Vendor Directory.`);
    const reviews = (v.ratings || []).slice(-3).reverse().map((x) => `<li>${"★".repeat(x.stars)}${"☆".repeat(5 - x.stars)} ${x.comment ? "— " + esc(x.comment) : ""}</li>`).join("");

    page("home", `
      <a href="#/" class="back">← All shops</a>
      <section class="vhead status-${v.status}">
        <div class="avatar big">${v.emoji}</div>
        <div class="vhead-main">
          <div class="vhead-line">${pill(v.status)} <span class="muted small">Updated ${ago(v.updatedAt)}</span></div>
          <h1>${esc(v.name)}</h1>
          <p class="muted">${esc(v.category)} · ${esc(v.location)} · ${v.distance} m from campus</p>
        </div>
        <div class="vhead-stats">
          <div><b>${v.status === "closed" ? "—" : "~" + waitMin(v) + " min"}</b><span>expected wait</span></div>
          <div><b>${v.status === "closed" ? "—" : v.queue}</b><span>people in queue</span></div>
          <div><b>${r ? r.toFixed(1) + "★" : "—"}</b><span>${v.ratings.length} ratings</span></div>
        </div>
      </section>
      ${v.note ? `<div class="note big">📢 ${esc(v.note)}</div>` : ""}
      ${!canOrder ? `<div class="alert">This shop is closed right now. ${esc(h.text)}. You can browse the menu, but ordering is paused.</div>` : ""}

      <div class="two-col">
        <section>
          ${isPrint(v) ? `
            <div class="card printcta">
              <div><h3>Skip the counter</h3><p class="muted small">Upload your PDF, choose copies and colour, and pick it up when it's ready. B/W ${rupee(v.print.bw)}/page · Colour ${rupee(v.print.color)}/page</p></div>
              <a class="btn primary" href="#/print/${v.id}">Send print job</a>
            </div>` : ""}
          <h2 class="sec">Menu & prices</h2>
          ${Object.entries(groups).map(([g, items]) => `
            <h4 class="menu-group">${esc(g)}</h4>
            <ul class="menu">
              ${items.map((m) => {
                const q = cart.vendorId === v.id ? cart.items[m.id] || 0 : 0;
                return `<li class="${m.inStock ? "" : "oos"}">
                  <div><div class="mname">${esc(m.name)}</div><div class="muted small">${m.inStock ? rupee(m.price) : "Out of stock"}</div></div>
                  ${m.inStock && canOrder ? (q
                    ? `<div class="stepper"><button data-qty="${m.id}" data-d="-1" aria-label="Remove one">−</button><span>${q}</span><button data-qty="${m.id}" data-d="1" aria-label="Add one">+</button></div>`
                    : `<button class="btn small" data-qty="${m.id}" data-d="1">Add</button>`) : `<span class="muted small">${m.inStock ? "" : "—"}</span>`}
                </li>`;
              }).join("")}
            </ul>`).join("") || `<p class="muted">Menu not listed yet.</p>`}
        </section>
        <aside>
          <div class="card">
            <h3>Timings</h3>
            <ul class="plain">${days || "<li>Not listed</li>"}</ul>
            <p class="small ${h.within ? "" : "warn"}">🕒 ${esc(h.text)}</p>
          </div>
          <div class="card">
            <h3>Contact</h3>
            <div class="stack">
              ${v.phone ? `<a class="btn" href="tel:${esc(v.phone)}">📞 Call ${esc(v.phone)}</a>` : ""}
              ${v.whatsapp ? `<a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/${esc(v.whatsapp)}?text=${waText}">💬 WhatsApp</a>` : ""}
            </div>
          </div>
          ${reviews ? `<div class="card"><h3>Recent feedback</h3><ul class="plain small">${reviews}</ul></div>` : ""}
        </aside>
      </div>
      ${cart.vendorId === v.id && S.cartCount() ? cartBar() : ""}
    `);

    app.querySelectorAll("[data-qty]").forEach((b) => b.addEventListener("click", async () => {
      if (needStudent()) return; // sign in before adding anything to an order
      const itemId = b.dataset.qty, d = Number(b.dataset.d);
      const c = S.state.cart;
      if (c.vendorId && c.vendorId !== v.id && d > 0) {
        const other = S.vendor(c.vendorId);
        if (!(await ask(`Your cart has items from ${other ? other.name : "another shop"}. Start a new cart for ${v.name}?`, "Start new cart"))) return;
      }
      const cur = c.vendorId === v.id ? c.items[itemId] || 0 : 0;
      S.setQty(v.id, itemId, cur + d);
      keepScroll = true;
      vendorPage(v.id);
    }));
  }

  function cartTotals() {
    const c = S.state.cart;
    const v = c.vendorId && S.vendor(c.vendorId);
    if (!v) return null;
    const items = Object.entries(c.items).map(([id, qty]) => {
      const m = v.menu.find((x) => x.id === id);
      return m ? { id, name: m.name, price: m.price, qty } : null;
    }).filter(Boolean);
    return { v, items, total: items.reduce((a, i) => a + i.price * i.qty, 0) };
  }

  function cartBar() {
    const t = cartTotals();
    if (!t) return "";
    return `<div class="cartbar"><span><b>${S.cartCount()} item${S.cartCount() > 1 ? "s" : ""}</b> · ${rupee(t.total)}</span><a class="btn primary" href="#/cart">Review & pre-order →</a></div>`;
  }

  /* ---------- CART / checkout ---------- */
  function cartPage() {
    const t = cartTotals();
    if (!t || !t.items.length) {
      return page("", `<div class="empty big"><h2>Your cart is empty</h2><p class="muted">Pick a shop and add items to pre-order.</p><a class="btn primary" href="#/">Browse shops</a></div>`);
    }
    if (needStudent()) return;
    const { v, items, total } = t;
    const feePercent = Auth.me && Auth.me.feePending && !Auth.me.feeOrderId ? Number(Auth.me.warningFeePercent) || 0 : 0;
    const warningFee = feePercent ? Math.ceil(total * feePercent / 100) : 0;
    const due = total + warningFee;
    const slots = pickupSlots(v);
    page("", `
      <a href="#/vendor/${v.id}" class="back">← Back to ${esc(v.name)}</a>
      <h1>Pre-order</h1>
      <div class="two-col">
        <form id="checkout" class="card form">
          <h3>Ordering as</h3>
          ${studentBox()}
          <label>Pickup time
            <select name="pickup">
              <option value="ASAP">As soon as possible (~${Math.max(5, waitMin(v))} min)</option>
              ${slots.map((s) => `<option value="${s}">${fmtTime(s)}</option>`).join("")}
            </select>
          </label>
          <label>Note for the shop <span class="muted small">(optional)</span><input name="note" maxlength="80" placeholder="Less sugar, extra chutney…"></label>
          <p class="muted small">Pay at the counter when you collect. Show your token number.</p>
          <button class="btn primary block" type="submit">Place pre-order · ${rupee(due)}</button>
        </form>
        <aside class="card">
          <h3>${v.emoji} ${esc(v.name)}</h3>
          <ul class="summary">
            ${items.map((i) => `<li><span>${i.qty} × ${esc(i.name)}</span><span>${rupee(i.price * i.qty)}</span></li>`).join("")}
            ${warningFee ? `<li><span>Cancellation warning fee (${feePercent}%)</span><span>${rupee(warningFee)}</span></li>` : ""}
            <li class="total"><span>Total due at pickup</span><span>${rupee(due)}</span></li>
          </ul>
          ${warningFee ? `<p class="muted small">This fee is based on your order total and goes to the merchant. It will be due when you collect this order.</p>` : ""}
          <button class="linkbtn" id="clearCart">Clear cart</button>
        </aside>
      </div>
    `);
    document.getElementById("clearCart").onclick = () => { S.clearCart(); cartPage(); };
    document.getElementById("checkout").onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      if (!S.student()) return needStudent();
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true; btn.textContent = "Sending to the shop…";
      const o = await S.placeOrder({
        type: "food", vendorId: v.id, items: items.map(({ id, qty }) => ({ id, qty })),
        pickup: f.get("pickup"), note: String(f.get("note") || "").trim(),
      });
      if (o.error) { btn.disabled = false; btn.textContent = `Place pre-order · ${rupee(due)}`; return toast(o.error, "err"); }
      S.clearCart();
      location.hash = "#/order/" + o.id;
    };
  }

  /* ---------- PRINT job ---------- */
  async function countPdfPages(file) {
    try {
      const buf = await file.slice(0, Math.min(file.size, 8 * 1024 * 1024)).arrayBuffer();
      const txt = new TextDecoder("latin1").decode(buf);
      const m = txt.match(/\/Type\s*\/Page(?!s)/g);
      return m ? m.length : 0;
    } catch (e) { return 0; }
  }

  /* A list of shops to choose from. extra(v) adds a line under each shop; disabled(v) greys a shop out. */
  function shopPicker(list, hrefFn, extra, disabled) {
    return `<div class="pickgrid">${list.map((v) => {
      const off = disabled && disabled(v);
      const h = hoursInfo(v);
      return `<a class="card pick status-${v.status} ${off ? "off" : ""}" ${off ? 'aria-disabled="true"' : `href="${hrefFn(v)}"`}>
        <div class="avatar">${v.emoji}</div>
        <div class="grow">
          <div class="pick-top"><b>${esc(v.name)}</b>${pill(v.status)}</div>
          <div class="muted small">${esc(v.location)} · ${v.distance} m · ${v.status === "closed" ? esc(h.text) : "~" + waitMin(v) + " min wait"}</div>
          ${extra ? `<div class="small">${extra(v)}</div>` : ""}
        </div>
        <span class="pick-go">${off ? "" : "→"}</span>
      </a>`;
    }).join("")}</div>`;
  }

  function printPage(preId) {
    if (needStudent()) return;
    const shops = S.state.vendors.filter(isPrint);
    const chosen = S.vendor(preId);
    if (!chosen || !isPrint(chosen)) {
      const rank = { open: 0, busy: 1, closed: 2 };
      const sorted = shops.slice().sort((a, b) => rank[a.status] - rank[b.status] || waitMin(a) - waitMin(b));
      return page("print", `
        <p class="eyebrow">Step 1 of 2</p>
        <h1>Which shop should print it?</h1>
        <p class="lead">Pick a print shop first. Next you'll upload your files and choose copies, colour and binding.</p>
        ${shops.length ? shopPicker(sorted, (v) => "#/print/" + v.id,
          (v) => `B/W ${rupee(v.print.bw)}/page · Colour ${rupee(v.print.color)}/page · Spiral ${rupee(v.print.binding)}${v.status === "closed" ? ` · <span class="warn">closed, can't take jobs now</span>` : ""}`,
          (v) => v.status === "closed")
        : `<div class="empty big"><h2>No print shops listed yet</h2></div>`}
      `);
    }
    if (needStudent()) return;
    const sel = chosen.id;
    page("print", `
      <a href="#/print" class="back">← Choose a different shop</a>
      <p class="eyebrow">Step 2 of 2</p>
      <h1>Upload your files</h1>
      <div class="chosen card">
        <div class="avatar">${chosen.emoji}</div>
        <div class="grow"><b>${esc(chosen.name)}</b><div class="muted small">${esc(chosen.location)} · B/W ${rupee(chosen.print.bw)}/page · Colour ${rupee(chosen.print.color)}/page</div></div>
        ${pill(chosen.status)}
      </div>
      ${chosen.status === "closed" ? `<div class="alert">${esc(chosen.name)} is closed right now (${esc(hoursInfo(chosen).text)}), so it can't take print jobs. <a href="#/print">Pick another shop</a>.</div>` : ""}
      <div class="two-col">
        <form id="printForm" class="card form">
          <input type="hidden" name="vendor" id="pshop" value="${sel}">
          <label class="drop" id="drop">
            <input type="file" name="file" id="pfile" accept="application/pdf,.pdf,.doc,.docx,.ppt,.pptx,image/*" required>
            <span id="dropText"><b>Choose a file</b> or drop it here<br><span class="muted small">PDF works best · up to 10 MB</span></span>
          </label>
          <div class="row3">
            <label>Pages<input name="pages" id="ppages" type="number" min="1" max="999" value="1" required></label>
            <label>Copies<input name="copies" id="pcopies" type="number" min="1" max="50" value="1" required></label>
            <label>Colour
              <select name="color" id="pcolor"><option value="bw">Black & white</option><option value="color">Colour</option></select>
            </label>
          </div>
          <div class="row3">
            <label>Sides
              <select name="sides" id="psides"><option value="single">Single-sided</option><option value="double">Double-sided</option></select>
            </label>
            <label>Binding
              <select name="binding" id="pbind"><option value="none">None</option><option value="spiral">Spiral</option></select>
            </label>
            <label>Pickup
              <select name="pickup" id="ppickup"></select>
            </label>
          </div>
          <div class="fieldlabel">Sending as</div>
          ${studentBox()}
          <label>Instructions <span class="muted small">(optional)</span><input name="note" maxlength="100" placeholder="Print pages 1–5 only, staple top-left…"></label>
          <button class="btn primary block" type="submit" id="psubmit">Send to shop</button>
        </form>
        <aside class="card">
          <h3>Estimate</h3>
          <ul class="summary" id="pest"></ul>
          <p class="muted small">Pay at the counter. The shop confirms the final amount.</p>
        </aside>
      </div>
    `);

    const f = document.getElementById("printForm");
    const shopSel = document.getElementById("pshop");
    const fileIn = document.getElementById("pfile");
    const drop = document.getElementById("drop");

    function refreshPickup() {
      const v = S.vendor(shopSel.value);
      const el = document.getElementById("ppickup");
      el.innerHTML = `<option value="ASAP">ASAP</option>` + (v ? pickupSlots(v).map((s) => `<option value="${s}">${fmtTime(s)}</option>`).join("") : "");
    }
    function estimate() {
      const v = S.vendor(shopSel.value);
      if (!v) return { total: 0 };
      const pages = Math.max(1, Number(f.pages.value) || 1), copies = Math.max(1, Number(f.copies.value) || 1);
      const rate = f.color.value === "color" ? v.print.color : v.print.bw;
      let printing = pages * copies * rate;
      const disc = f.sides.value === "double" ? printing * v.print.doubleSidedDiscount : 0;
      const bind = f.binding.value === "spiral" ? v.print.binding * copies : 0;
      const total = Math.round(printing - disc + bind);
      const feePercent = Auth.me && Auth.me.feePending && !Auth.me.feeOrderId ? Number(Auth.me.warningFeePercent) || 0 : 0;
      const warningFee = feePercent ? Math.ceil(total * feePercent / 100) : 0;
      const due = total + warningFee;
      document.getElementById("pest").innerHTML = `
        <li><span>${pages} pg × ${copies} cop × ${rupee(rate)}</span><span>${rupee(printing)}</span></li>
        ${disc ? `<li><span>Double-sided saving</span><span>−${rupee(disc)}</span></li>` : ""}
        ${bind ? `<li><span>Spiral binding × ${copies}</span><span>${rupee(bind)}</span></li>` : ""}
        ${warningFee ? `<li><span>Cancellation warning fee (${feePercent}%)</span><span>${rupee(warningFee)}</span></li>` : ""}
        <li class="total"><span>Estimated total</span><span>${rupee(due)}</span></li>
      ${warningFee ? `<li class="muted small">Fee is paid to the merchant when you collect the job.</li>` : ""}`;
      return { total, due, warningFee, feePercent, pages, copies, rate };
    }
    async function onFile(file) {
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { toast("File is larger than 10 MB", "err"); fileIn.value = ""; return; }
      document.getElementById("dropText").innerHTML = `<b>📎 ${esc(file.name)}</b><br><span class="muted small">${(file.size / 1024).toFixed(0)} KB</span>`;
      drop.classList.add("has");
      if (/pdf$/i.test(file.name) || file.type === "application/pdf") {
        const n = await countPdfPages(file);
        if (n) { f.pages.value = n; toast(`Detected ${n} page${n > 1 ? "s" : ""}`); }
      }
      estimate();
    }
    fileIn.addEventListener("change", () => onFile(fileIn.files[0]));
    ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      if (e.dataTransfer.files[0]) { const dt = new DataTransfer(); dt.items.add(e.dataTransfer.files[0]); fileIn.files = dt.files; onFile(e.dataTransfer.files[0]); }
    });
    shopSel.addEventListener("change", () => { refreshPickup(); estimate(); });
    f.addEventListener("input", estimate);
    refreshPickup(); estimate();

    f.onsubmit = (e) => {
      e.preventDefault();
      const file = fileIn.files[0];
      const v = S.vendor(shopSel.value);
      if (!v) return toast("Choose a print shop", "err");
      if (v.status === "closed") return toast(v.name + " is closed right now", "err");
      if (!file) return toast("Attach the file to print", "err");
      const me = S.student();
      if (!me) return needStudent();
      const est = estimate();
      document.getElementById("psubmit").disabled = true;
      const reader = new FileReader();
      document.getElementById("psubmit").textContent = "Uploading…";
      reader.onload = async () => {
        const o = await S.placeOrder({
          type: "print", vendorId: v.id, pickup: f.pickup.value, note: f.note.value.trim(),
          print: { fileName: file.name, size: file.size, pages: est.pages, copies: est.copies, color: f.color.value, sides: f.sides.value, binding: f.binding.value },
        }, reader.result);
        if (o.error) { document.getElementById("psubmit").disabled = false; document.getElementById("psubmit").textContent = "Send to shop"; return toast(o.error, "err"); }
        location.hash = "#/order/" + o.id;
      };
      reader.onerror = () => { toast("Could not read the file", "err"); document.getElementById("psubmit").disabled = false; };
      reader.readAsDataURL(file);
    };
  }

  /* ---------- ORDERS ---------- */
  const STEPS = ["placed", "accepted", "ready", "collected"];
  function progress(o) {
    if (o.status === "cancelled") return `<div class="alert">You cancelled this order. Cancellation warning ${S.student() ? S.student().strikes : ""} of 3 recorded. A third warning suspends ordering.</div>`;
    if (o.status === "no_show") return `<div class="alert">The shop marked this order as <b>not collected</b>. This counts as a warning toward the three-strike cancellation and missed-pickup policy.</div>`;
    if (o.status === "rejected") return `<div class="alert">The shop couldn't take this order. Please contact them or try another shop.</div>`;
    const idx = STEPS.indexOf(o.status);
    return `<ol class="steps">${STEPS.map((s, i) => `<li class="${i <= idx ? "done" : ""} ${i === idx ? "cur" : ""}">${ORDER_LABEL[s]}</li>`).join("")}</ol>`;
  }

  function orderPage(id) {
    if (needStudent()) return;
    const o = S.myOrders().find((x) => x.id === id);
    if (!o) return page("orders", `<div class="empty big"><h2>Order not found</h2><p class="muted">This order isn’t on the signed-in account.</p><a class="btn primary" href="#/orders">My orders</a></div>`);
    const v = S.vendor(o.vendorId) || { name: "Shop", emoji: "🏪" };
    page("orders", `
      <a href="#/orders/${o.vendorId}" class="back">← My orders at ${esc(v.name)}</a>
      <section class="token-card status-o-${o.status}">
        <p class="eyebrow">${o.type === "print" ? "Print job" : "Pre-order"} · ${v.emoji} ${esc(v.name)}</p>
        <div class="token">${esc(o.token)}</div>
        <p class="lead">${o.status === "ready" ? "🎉 Ready! Show this token at the counter." : ORDER_LABEL[o.status]}</p>
        <p class="muted small">Pickup: ${o.pickup === "ASAP" ? "As soon as possible" : fmtTime(o.pickup)} · Placed ${clock(o.createdAt)}</p>
      </section>
      ${progress(o)}
      <div class="card">
        <ul class="summary">
          ${o.items.map((i) => `<li><span>${i.qty} × ${esc(i.name)}</span><span>${rupee(i.price * i.qty)}</span></li>`).join("")}
          ${o.warningFee ? `<li><span>Cancellation warning fee (${o.warningFee.percent}%)</span><span>${rupee(o.warningFee.amount)}</span></li>` : ""}
          <li class="total"><span>Pay at counter</span><span>${rupee(o.total)}</span></li>
        </ul>
        ${o.print ? `<p class="small muted">📎 ${esc(o.print.fileName)}</p>` : ""}
        ${o.note ? `<p class="small">Note: ${esc(o.note)}</p>` : ""}
      </div>
      ${o.status === "collected" && !o.rating ? ratingForm(o) : ""}
      ${o.rating ? `<p class="muted">Thanks for your feedback: ${"★".repeat(o.rating.stars)}</p>` : ""}
      ${o.status === "placed" ? `<button class="btn danger-btn" id="cancelOrder">Cancel this order</button>` : ""}
      <p class="muted small center">This page updates by itself when the shop changes your order.</p>
    `);
    const cancel = document.getElementById("cancelOrder");
    if (cancel) cancel.onclick = async () => {
      const strikeNo = (Auth.me.strikes || 0) + 1;
      if (!(await ask(`Cancel ${o.token}? This will be warning ${strikeNo} of 3. A fee may apply to your next order; after a third warning, ordering is suspended.`, "Cancel order"))) return;
      cancel.disabled = true;
      const result = await S.cancelOrder(o.id);
      if (result.error) { cancel.disabled = false; return toast(result.error, "err"); }
      if (result.strike.blocked) toast("Three warnings reached. Ordering is suspended.", "err");
      else toast(`Order cancelled. Warning ${result.strike.strikes} of 3 recorded.`, "ok");
      keepScroll = true; route();
    };
    bindRating(o);
  }

  function ratingForm(o) {
    return `<form class="card form" id="rate"><h3>How was it?</h3>
      <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${n} stars">☆</button>`).join("")}</div>
      <input name="comment" maxlength="100" placeholder="Anything the shop should know? (optional)">
      <button class="btn primary" type="submit">Send feedback</button></form>`;
  }
  function bindRating(o) {
    const form = document.getElementById("rate");
    if (!form) return;
    let stars = 0;
    form.querySelectorAll("[data-star]").forEach((b) => b.addEventListener("click", () => {
      stars = Number(b.dataset.star);
      form.querySelectorAll("[data-star]").forEach((x) => (x.textContent = Number(x.dataset.star) <= stars ? "★" : "☆"));
    }));
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!stars) return toast("Tap a star rating first", "err");
      const r = await S.rate(o.id, stars, form.comment.value.trim());
      if (r.error) return toast(r.error, "err");
      toast("Thanks for the feedback!");
      keepScroll = true;
      orderPage(o.id);
    };
  }

  const LIVE = ["placed", "accepted", "ready"];
  function orderRow(o) {
    return `<a class="card orow" href="#/order/${o.id}">
      <div class="token sm">${esc(o.token)}</div>
      <div class="grow"><b>${o.type === "print" ? "🖨️ Print job" : "🍽️ " + o.items.reduce((a, i) => a + i.qty, 0) + " items"}</b><div class="muted small">${rupee(o.total)} · ${new Date(o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, ${clock(o.createdAt)}${o.print ? " · " + esc(o.print.fileName) : ""}</div></div>
      <span class="ostatus os-${o.status}">${ORDER_LABEL[o.status]}</span>
    </a>`;
  }

  function ordersPage(vendorId) {
    if (needStudent()) return;
    const mine = S.myOrders();
    const v = S.vendor(vendorId);
    if (!v) {
      const byShop = (id) => mine.filter((o) => o.vendorId === id);
      const shops = S.state.vendors.slice().sort((a, b) =>
        byShop(b.id).filter((o) => LIVE.includes(o.status)).length - byShop(a.id).filter((o) => LIVE.includes(o.status)).length ||
        byShop(b.id).length - byShop(a.id).length);
      const live = mine.filter((o) => LIVE.includes(o.status)).length;
      return page("orders", `
        <h1>My orders</h1>
        <p class="lead">Choose a shop to see your orders there${live ? `. You have <b>${live}</b> order${live > 1 ? "s" : ""} in progress` : ""}.</p>
        ${shopPicker(shops, (s) => "#/orders/" + s.id, (s) => {
          const os = byShop(s.id);
          const l = os.filter((o) => LIVE.includes(o.status)).length;
          return os.length ? `<b>${os.length} order${os.length > 1 ? "s" : ""}</b>${l ? ` · <span class="ostatus os-accepted">${l} in progress</span>` : ""}` : `<span class="muted">No orders yet</span>`;
        })}
      `);
    }
    const list = mine.filter((o) => o.vendorId === v.id);
    const newHref = isPrint(v) ? "#/print/" + v.id : "#/vendor/" + v.id;
    page("orders", `
      <a href="#/orders" class="back">← All shops</a>
      <div class="chosen card">
        <div class="avatar">${v.emoji}</div>
        <div class="grow"><b>${esc(v.name)}</b><div class="muted small">${esc(v.location)} · ${esc(hoursInfo(v).text)}</div></div>
        ${pill(v.status)}
      </div>
      <div class="dash-head"><h2>Your orders here</h2><a class="btn primary small" href="${newHref}">${isPrint(v) ? "New print job" : "Order again"}</a></div>
      ${list.length ? `<div class="list">${list.map(orderRow).join("")}</div>`
        : `<div class="empty big"><h2>No orders at ${esc(v.name)} yet</h2><p class="muted">${isPrint(v) ? "Send a print job" : "Pre-order from the menu"} to skip the queue.</p><a class="btn primary" href="${newHref}">${isPrint(v) ? "Send a print job" : "See the menu"}</a></div>`}
    `);
  }

  /* ---------- VENDOR DASHBOARD ---------- */
  // the signed-in shop comes from the server (S.vendorId, set by every sync)
  const vendorSessionId = () => (S.vendorToken() ? S.vendorId : null);

  const DEFAULT_PINCODE = String(CFG.CAMPUS_PINCODE || "560059");
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  function loginAs(id) {
    dashUi.tab = "new";
    location.hash = "#/dashboard/" + id;
  }

  function dashLogin() {
    page("dashboard", `
      <h1>For vendors</h1>
      <p class="lead">Update your status in one tap, mark items out of stock, and see pre-orders and print jobs as they come in. Free, no app to install.</p>
      <div class="two-col even">
        <form id="vlogin" class="card form">
          <h3>Log in to your shop</h3>
          <label>Shop name
            <input name="shop" required maxlength="40" list="shoplist" autocomplete="off" placeholder="Start typing your shop's name">
            <datalist id="shoplist">${S.state.vendors.map((v) => `<option value="${esc(v.name)}">`).join("")}</datalist>
          </label>
          <div class="row2">
            <label>Pincode<input name="pincode" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="e.g. ${esc(DEFAULT_PINCODE)}"></label>
            <label>Phone number<input name="phone" type="tel" required inputmode="numeric" pattern="[0-9]{10}" maxlength="10" placeholder="Shop's 10-digit number"></label>
          </div>
          <button class="btn primary block">Open dashboard</button>
          <p class="muted small">Use the phone number and pincode registered with your approved shop. Tip: open the student directory in another tab to watch updates appear live.</p>
        </form>
        <div class="card newshop">
          <h3>New here? Apply to list your shop</h3>
          <p class="muted">Submit your shop details for review. It will appear in the directory after an admin approves it.</p>
          <ul class="plain small">
            <li>✓ No fees, no app to install</li>
            <li>✓ Set your own timings and prices</li>
            <li>✓ Take pre-orders and print jobs</li>
          </ul>
          <a class="btn primary block" href="#/dashboard/new">Apply to list a shop →</a>
        </div>
      </div>
    `);
    document.getElementById("vlogin").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const pincode = f.pincode.value.replace(/\D/g, "");
      const phone = f.phone.value.replace(/\D/g, "").slice(-10);
      if (!f.shop.value.trim()) return toast("Enter your shop's name", "err");
      if (!/^\d{6}$/.test(pincode)) return toast("Pincode must be 6 digits", "err");
      if (!/^\d{10}$/.test(phone)) return toast("Enter the shop's 10-digit phone number", "err");
      const btn = f.querySelector("button"); btn.disabled = true;
      const r = await S.vendorLogin(f.shop.value.trim(), pincode, phone);
      btn.disabled = false;
      if (r.error) return toast(r.error, "err");
      if (r.claimed) toast("Phone number saved to your shop", "ok");
      loginAs(r.vendorId);
    };
  }

  const EMOJIS = ["🏪", "☕", "🍛", "🥤", "🍔", "🍕", "🥪", "🍰", "🖨️", "📚", "✏️", "🧵", "💇", "📱", "🔧", "🧺"];
  function registerShop() {
    const cats = [...new Set(S.state.vendors.map((v) => v.category))];
    page("dashboard", `
      <a href="#/dashboard" class="back">← Back to vendor login</a>
      <h1>Apply to list your shop</h1>
      <p class="lead">The admin reviews every new shop application by email. Approved shops can finish setting up their menu in the vendor dashboard.</p>
      <form id="newShop" class="card form narrow-wide">
        <h3>About your shop</h3>
        <label>Shop name<input name="name" required maxlength="40" placeholder="e.g. Sri Lakshmi Juice Centre"></label>
        <div class="row2">
          <label>Category
            <input name="category" required maxlength="24" list="catlist" placeholder="e.g. Juice & Chats">
            <datalist id="catlist">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
          </label>
          <label>Icon
            <select name="emoji">${EMOJIS.map((e) => `<option>${e}</option>`).join("")}</select>
          </label>
        </div>
        <div class="row2">
          <label>Where is it?<input name="location" required maxlength="40" placeholder="e.g. Next to Gate 3"></label>
          <label>Distance from campus (m)<input name="distance" type="number" min="0" max="5000" value="200" required></label>
        </div>
        <label>Pincode<input name="pincode" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" value="${esc(DEFAULT_PINCODE)}"></label>

        <h3>Contact</h3>
        <label>Owner Gmail<input name="ownerEmail" type="email" required autocomplete="email" placeholder="owner@gmail.com"></label>
        <div class="row2">
          <label>Phone <span class="muted small">(you'll log in with this)</span><input name="phone" type="tel" required pattern="[0-9]{10}" maxlength="10" placeholder="10-digit number"></label>
          <label>WhatsApp <span class="muted small">(optional)</span><input name="whatsapp" type="tel" pattern="[0-9]{10}" maxlength="10" placeholder="Same as phone if blank"></label>
        </div>

        <h3>Timings</h3>
        <div class="row2">
          <label>Opens at<input name="open1" type="time" value="08:00" required></label>
          <label>Closes at<input name="close1" type="time" value="20:00" required></label>
        </div>
        <label class="switch"><input type="checkbox" id="split"><span></span> Closed for a break in the middle of the day</label>
        <div class="row2" id="slot2" hidden>
          <label>Reopens at<input name="open2" type="time" value="16:00"></label>
          <label>Closes at<input name="close2" type="time" value="21:00"></label>
        </div>

        <h3>Print & xerox</h3>
        <label class="switch"><input type="checkbox" name="isPrint" id="isPrint"><span></span> We take print jobs (students can upload files)</label>
        <div class="row3" id="printRates" hidden>
          <label>B/W per page (₹)<input name="bw" type="number" min="0" step="0.5" value="2"></label>
          <label>Colour per page (₹)<input name="color" type="number" min="0" step="0.5" value="10"></label>
          <label>Spiral binding (₹)<input name="binding" type="number" min="0" value="30"></label>
        </div>

        <button class="btn primary block" type="submit">Send application for approval</button>
      </form>
    `);
    const f = document.getElementById("newShop");
    document.getElementById("split").onchange = (e) => { document.getElementById("slot2").hidden = !e.target.checked; };
    document.getElementById("isPrint").onchange = (e) => { document.getElementById("printRates").hidden = !e.target.checked; };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const name = f.name.value.trim();
      if (S.state.vendors.some((v) => v.name.toLowerCase() === name.toLowerCase())) return toast("A shop with this name is already listed", "err");
      if (!/^\d{6}$/.test(f.pincode.value.trim())) return toast("Pincode must be 6 digits", "err");
      const hours = [[f.open1.value, f.close1.value]];
      if (document.getElementById("split").checked) hours.push([f.open2.value, f.close2.value]);
      if (hours.some(([o, c]) => !o || !c || toMin(o) >= toMin(c))) return toast("Closing time must be after opening time", "err");
      if (hours.length === 2 && toMin(hours[1][0]) < toMin(hours[0][1])) return toast("The second slot must start after the first one ends", "err");
      const wa = f.whatsapp.value.trim() || f.phone.value.trim();
      const m = nowMin();
      const v = await S.addVendor({
        name, ownerEmail: f.ownerEmail.value.trim().toLowerCase(), category: f.category.value.trim(), emoji: f.emoji.value, location: f.location.value.trim(),
        distance: Math.max(0, Number(f.distance.value) || 0), phone: f.phone.value.trim(), whatsapp: "91" + wa,
        hours, pincode: f.pincode.value.trim(),
        status: hours.some(([o, c]) => m >= toMin(o) && m < toMin(c)) ? "open" : "closed",
        ...(f.isPrint.checked ? { print: { bw: Number(f.bw.value) || 0, color: Number(f.color.value) || 0, doubleSidedDiscount: 0.2, binding: Number(f.binding.value) || 0 } } : {}),
      });
      if (v.error) return toast(v.error, "err");
      if (v.pending) {
        page("dashboard", `<div class="login-wrap"><section class="card"><p class="eyebrow">Application received</p><h1>${esc(name)} is awaiting review</h1><p class="lead">${esc(v.message)}</p><p class="muted small">Application reference: <span class="mono">${esc(v.applicationId)}</span></p><p class="muted small">Your shop won’t appear in search until the admin approves it. Keep your owner Gmail available for updates.</p><a class="btn primary" href="#/">Back to directory</a></section></div>`);
        return;
      }
      toast("Application submitted for review", "ok");
    };
  }

  const dashUi = { tab: "new" };
  function dashboard(id) {
    const v = S.vendor(id);
    if (!v || vendorSessionId() !== id) return dashLogin();
    const orders = S.vendorOrders(id);
    const buckets = {
      new: orders.filter((o) => o.status === "placed"),
      accepted: orders.filter((o) => o.status === "accepted"),
      ready: orders.filter((o) => o.status === "ready"),
      done: orders.filter((o) => ["collected", "rejected", "no_show", "cancelled"].includes(o.status)),
    };
    const todaySales = orders.filter((o) => o.status === "collected" && new Date(o.createdAt).toDateString() === new Date().toDateString()).reduce((a, o) => a + o.total, 0);
    const waShare = encodeURIComponent(`${v.emoji} ${v.name} is ${STATUS_LABEL[v.status].toUpperCase()} now${v.status !== "closed" ? ` · ~${waitMin(v)} min wait` : ""}.${v.note ? " " + v.note : ""} See menu & pre-order on Campus Vendors.`);

    page("dashboard", `
      <div class="dash-head">
        <div><p class="eyebrow">Vendor dashboard</p><h1>${v.emoji} ${esc(v.name)}</h1></div>
        <button class="btn" data-act="logout">Log out</button>
      </div>

      <section class="card">
        <h3>Shop status</h3>
        <div class="seg">${["open", "busy", "closed"].map((s) => `<button class="seg-${s} ${v.status === s ? "on" : ""}" data-status="${s}">${STATUS_LABEL[s]}</button>`).join("")}</div>
        <div class="dash-row">
          <div>
            <div class="muted small">People in queue</div>
            <div class="stepper big"><button data-queue="-1" aria-label="Fewer">−</button><span>${v.queue}</span><button data-queue="1" aria-label="More">+</button></div>
          </div>
          <div><div class="muted small">Students see</div><b class="bigtxt">${v.status === "closed" ? "Closed" : "~" + waitMin(v) + " min wait"}</b></div>
          <div><div class="muted small">Collected today</div><b class="bigtxt">${rupee(todaySales)}</b></div>
        </div>
        <label class="small">Announcement for students
          <div class="inline"><input id="vnote" maxlength="80" value="${esc(v.note)}" placeholder="e.g. Fresh samosas at 4 pm"><button class="btn" id="saveNote">Save</button></div>
        </label>
        <a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/?text=${waShare}">💬 Share status on WhatsApp</a>
      </section>

      <section class="card">
        <div class="tabs">
          ${[["new", "New"], ["accepted", "Preparing"], ["ready", "Ready"], ["done", "Done"]].map(([k, l]) => `<button class="${dashUi.tab === k ? "on" : ""}" data-tab="${k}">${l}<b class="badge ${buckets[k].length ? "" : "zero"}">${buckets[k].length}</b></button>`).join("")}
        </div>
        <div class="list">
          ${buckets[dashUi.tab].map((o) => `
            <div class="order">
              <div class="order-top"><span class="token sm">${esc(o.token)}</span><div class="grow"><b>${esc(o.student.name)}</b> <span class="muted small">${esc(o.student.cls || o.student.usn || "")}${o.student.phone ? ` · <a href="tel:${esc(o.student.phone)}">📞 ${esc(o.student.phone)}</a>` : ""}${o.student.email ? ` · <a href="mailto:${esc(o.student.email)}">✉️ ${esc(o.student.email)}</a>` : ""}</span><div class="muted small">${o.type === "print" ? "🖨️ Print job" : "🍽️ Pre-order"} · ${clock(o.createdAt)} · Pickup ${o.pickup === "ASAP" ? "ASAP" : fmtTime(o.pickup)}</div></div><b>${rupee(o.total)}</b></div>
              <ul class="plain small">${o.items.map((i) => `<li>${i.qty} × ${esc(i.name)}</li>`).join("")}${o.warningFee ? `<li>Cancellation warning fee (${o.warningFee.percent}%) · ${rupee(o.warningFee.amount)} goes to the shop</li>` : ""}</ul>
              ${o.print ? `<div class="small">📎 ${esc(o.print.fileName)} ${o.print.hasFile ? `<button class="linkbtn" data-file="${o.id}">Download</button>` : `<span class="muted">(too large to keep in demo storage)</span>`}</div>` : ""}
              ${o.note ? `<div class="small note">“${esc(o.note)}”</div>` : ""}
              <div class="order-actions">
                ${o.status === "placed" ? `<button class="btn primary" data-o="${o.id}" data-s="accepted">Accept</button><button class="btn" data-o="${o.id}" data-s="rejected">Decline</button>` : ""}
                ${o.status === "accepted" ? `<button class="btn primary" data-o="${o.id}" data-s="ready">Mark ready</button>` : ""}
                ${o.status === "ready" ? `<button class="btn primary" data-o="${o.id}" data-s="collected">Collected & paid</button><button class="btn danger-btn" data-noshow="${o.id}">Not collected</button>` : ""}
                ${o.status === "no_show" ? `<span class="ostatus os-no_show">Not collected · reported</span>` : ""}
                ${o.status === "cancelled" ? `<span class="ostatus os-cancelled">Cancelled by student</span>` : ""}
                ${o.rating ? `<span class="small">${"★".repeat(o.rating.stars)} ${esc(o.rating.comment || "")}</span>` : ""}
              </div>
            </div>`).join("") || `<p class="muted center">Nothing here right now.</p>`}
        </div>
      </section>

      ${(() => {
        const fbs = S.vendorFeedback(id);
        const open = fbs.filter((x) => x.status !== "resolved").length;
        return `<section class="card">
          <h3>Feedback & complaints ${open ? `<b class="badge">${open}</b>` : ""}</h3>
          ${fbs.length ? `<div class="list">${fbs.map((x) => `
            <div class="order">
              <div class="pick-top"><b>${FB_TYPES[x.type]}</b><span class="ostatus ${x.status === "resolved" ? "os-ready" : x.status === "seen" ? "os-accepted" : "os-rejected"}">${x.status === "open" ? "New" : FB_STATUS[x.status]}</span></div>
              <div class="muted small">${esc(x.ref)} · ${esc(x.name || "Anonymous")}${x.cls ? " (" + esc(x.cls) + ")" : ""}${x.token ? " · order " + esc(x.token) : ""}${x.contact ? " · " + esc(x.contact) : ""} · ${ago(x.at)}</div>
              <p class="small">${esc(x.message)}</p>
              ${x.reply ? `<div class="note small">Your reply: ${esc(x.reply)}</div>` : ""}
              ${x.status !== "resolved" ? `<div class="inline"><input data-reply-in="${x.id}" maxlength="200" placeholder="Reply to the student (optional)"><button class="btn primary" data-fb="${x.id}">Mark resolved</button></div>` : ""}
            </div>`).join("")}</div>` : `<p class="muted small">No feedback or complaints yet. Students can send them from the About page.</p>`}
        </section>`;
      })()}

      <section class="card">
        <h3>Menu & stock</h3>
        ${v.menu.length ? "" : `<div class="note big">Your menu is empty. Add your items and prices below so students can see them and pre-order.</div>`}
        <ul class="menu edit">
          ${v.menu.map((m) => `<li>
            <div class="grow"><div class="mname">${esc(m.name)}</div><div class="muted small">${esc(m.cat || "")}</div></div>
            <input class="price" type="number" min="0" step="1" value="${m.price}" data-price="${m.id}" aria-label="Price of ${esc(m.name)}">
            <label class="switch"><input type="checkbox" data-stock="${m.id}" ${m.inStock ? "checked" : ""}><span></span> ${m.inStock ? "In stock" : "Out"}</label>
            <button class="linkbtn danger" data-del="${m.id}" aria-label="Remove ${esc(m.name)}">✕</button>
          </li>`).join("")}
        </ul>
        <form id="addItem" class="inline wrapline">
          <input name="name" required maxlength="40" placeholder="New item">
          <input name="price" type="number" min="0" required placeholder="₹" class="price">
          <input name="cat" maxlength="20" placeholder="Category">
          <button class="btn">Add item</button>
        </form>
      </section>
    `);

    const rerender = () => { keepScroll = true; dashboard(id); };
    const cur = () => S.vendor(id) || v; // the latest copy of this shop, not the one the page was drawn with
    app.querySelectorAll("[data-status]").forEach((b) => b.onclick = () => { S.updateVendor(id, { status: b.dataset.status, queue: b.dataset.status === "closed" ? 0 : cur().queue }); toast("Status: " + STATUS_LABEL[b.dataset.status]); rerender(); });
    app.querySelectorAll("[data-queue]").forEach((b) => b.onclick = () => {
      const q = Math.max(0, cur().queue + Number(b.dataset.queue));
      const status = cur().status === "open" && q >= 6 ? "busy" : cur().status;
      S.updateVendor(id, { queue: q, status }); rerender();
    });
    document.getElementById("saveNote").onclick = () => { S.updateVendor(id, { note: document.getElementById("vnote").value.trim() }); toast("Announcement saved"); rerender(); };
    app.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { dashUi.tab = b.dataset.tab; rerender(); });
    app.querySelectorAll("[data-o]").forEach((b) => b.onclick = async () => {
      b.disabled = true;
      const r = await S.setOrderStatus(b.dataset.o, b.dataset.s);
      if (r.error) { b.disabled = false; return toast(r.error, "err"); }
      toast("Order " + ORDER_LABEL[b.dataset.s].toLowerCase()); rerender();
    });
    app.querySelectorAll("[data-noshow]").forEach((b) => b.onclick = async () => {
      const o = S.state.orders.find((x) => x.id === b.dataset.noshow);
      if (!o) return;
      if (!(await ask(`Mark ${o.token} (${o.student.name}) as not collected? This counts toward the student's three-warning cancellation and missed-pickup policy.`, "Not collected"))) return;
      b.disabled = true;
      const r = await S.setOrderStatus(o.id, "no_show"); // the server records the warning / block
      if (r.error) { b.disabled = false; return toast("Couldn't report it: " + r.error, "err"); }
      const k = r.strike || {};
      toast(k.blocked ? `${o.student.name} reached three warnings and is suspended from ordering` : `${o.student.name} has warning ${k.strikes} of 3${k.feePercent ? ` · ${k.feePercent}% next-order fee` : ""}`, k.blocked ? "err" : "ok");
      rerender();
    });
    app.querySelectorAll("[data-file]").forEach((b) => b.onclick = async () => {
      const data = await S.getFile(b.dataset.file);
      const o = S.state.orders.find((x) => x.id === b.dataset.file);
      if (!data) return toast("File not available", "err");
      const a = document.createElement("a"); a.href = data; a.download = o.print.fileName; a.click();
    });
    app.querySelectorAll("[data-stock]").forEach((c) => c.onchange = () => { cur().menu.find((m) => m.id === c.dataset.stock).inStock = c.checked; S.updateVendor(id, {}); rerender(); });
    app.querySelectorAll("[data-price]").forEach((c) => c.onchange = () => { cur().menu.find((m) => m.id === c.dataset.price).price = Math.max(0, Number(c.value) || 0); S.updateVendor(id, {}); toast("Price updated"); });
    app.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => { if (!(await ask("Remove this item from your menu?", "Remove"))) return; cur().menu = cur().menu.filter((m) => m.id !== b.dataset.del); S.updateVendor(id, { menu: cur().menu }); rerender(); });
    app.querySelectorAll("[data-fb]").forEach((b) => b.onclick = () => {
      const r = app.querySelector(`[data-reply-in="${b.dataset.fb}"]`).value.trim();
      S.setFeedbackStatus(b.dataset.fb, "resolved", r || undefined);
      toast("Marked resolved"); rerender();
    });
    const unseen = S.vendorFeedback(id).filter((x) => x.status === "open");
    unseen.forEach((x) => S.setFeedbackStatus(x.id, "seen"));
    document.getElementById("addItem").onsubmit = (e) => {
      e.preventDefault();
      const f = e.target;
      cur().menu.push({ id: "x" + Date.now(), name: f.name.value.trim(), price: Math.max(0, Number(f.price.value) || 0), inStock: true, cat: f.cat.value.trim() || "Menu" });
      S.updateVendor(id, { menu: cur().menu }); toast("Item added"); rerender();
    };
  }

  /* ---------- ABOUT / POSTER ---------- */
  const FB_TYPES = { feedback: "👍 Feedback", complaint: "⚠️ Complaint", suggestion: "💡 Suggestion" };
  const FB_STATUS = { open: "Received", seen: "Seen by shop", resolved: "Resolved" };
  let fbDraft = null;

  function about() {
    const mine = S.myFeedback();
    const me = S.student();
    page("about", `
      <p class="eyebrow">About us · Design Thinking Lab · RVCE</p>
      <h1>We're four RVCE students<br>fixing the break-time queue.</h1>
      <p class="lead">Campus Vendors started as our Design Thinking Lab project. We kept losing break time standing in queues, or walking to a shop only to find it shut. The tea stalls, print shops and tiffin centres around campus had no free way to tell us they were open. So we built one.</p>
      <div class="two-col even">
        <div class="card"><h3>Our mission</h3><p class="muted">Help students save time and help small vendors near campus reach more customers, at zero cost to either. We work towards SDG 9 (industry, innovation and infrastructure) and SDG 17 (partnerships for the goals).</p></div>
        <div class="card"><h3>What we do</h3><p class="muted">Live open / busy status, menus and prices for nearby shops; food pre-orders with pickup tokens; print-job upload; and a free one-tap dashboard for vendors.</p></div>
      </div>
      <h2 class="sec">The team</h2>
      <div class="team">
        ${["Aarush Sequeira", "Atharva Patil", "Akshay B", "Anjney Rohit Shah"].map((n) => `<div class="card member"><span class="initials">${n.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span><b>${esc(n)}</b></div>`).join("")}
      </div>

      <h2 class="sec" id="feedback">Feedback & complaints</h2>
      <p class="lead">Something went wrong with an order, a shop, or this website? Or have an idea to make it better? Tell us. Complaints about a shop also go to that shop's dashboard so they can reply.</p>
      <div class="two-col">
        <form id="fbForm" class="card form">
          <fieldset class="fbtype"><legend>What is it?</legend>
            <div class="seg fbseg">${Object.entries(FB_TYPES).map(([k, l], i) => `<label class="segopt"><input type="radio" name="type" value="${k}" ${i === 0 ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>
          </fieldset>
          <label>About
            <select name="vendorId">
              <option value="">This website / general</option>
              ${S.state.vendors.map((v) => `<option value="${v.id}">${v.emoji} ${esc(v.name)}</option>`).join("")}
            </select>
          </label>
          <label>Order token <span class="muted small">(optional)</span>
            <select name="orderId"><option value="">Not about a specific order</option>
              ${S.myOrders().map((o) => `<option value="${o.id}" data-v="${o.vendorId}">${esc(o.token)} · ${esc((S.vendor(o.vendorId) || {}).name || "Shop")}</option>`).join("")}
            </select>
          </label>
          <label>Your message<textarea name="message" required maxlength="600" placeholder="Tell us what happened, or what you'd like to see…"></textarea></label>
          ${me ? `<div class="fieldlabel">Sending as</div>${studentBox()}` : `<p class="muted small">You'll be asked to log in with your Gmail so the shop or our team can get back to you.</p>`}
          <button class="btn primary block" type="submit">${me ? "Send" : "Log in & send"}</button>
        </form>
        <aside>
          <div class="card">
            <h3>Your submissions</h3>
            ${mine.length ? `<div class="list">${mine.map((f) => {
              const v = S.vendor(f.vendorId);
              return `<div class="fbitem">
                <div class="pick-top"><b>${FB_TYPES[f.type]}</b><span class="ostatus ${f.status === "resolved" ? "os-ready" : f.status === "seen" ? "os-accepted" : ""}">${FB_STATUS[f.status]}</span></div>
                <div class="muted small">${esc(f.ref)} · ${v ? esc(v.name) : "Website"} · ${ago(f.at)}</div>
                <p class="small">${esc(f.message)}</p>
                ${f.reply ? `<div class="note small">Reply from ${v ? esc(v.name) : "the team"}: ${esc(f.reply)}</div>` : ""}
              </div>`;
            }).join("")}</div>` : `<p class="muted small">Nothing yet. Anything you send shows up here with its status.</p>`}
          </div>
          <div class="card"><h3>Other ways to reach us</h3><p class="muted small">Talk to any of us on campus, or rate a shop from your order page after you collect.</p></div>
        </aside>
      </div>

      <h2 class="sec">Why we built it</h2>
      <div class="statgrid">
        <div class="stat"><b>117</b><span>RVCE students surveyed</span></div>
        <div class="stat"><b>75%</b><span>frustrated by break-time queues</span></div>
        <div class="stat"><b>60%</b><span>skipped a shop, unsure if it was open</span></div>
        <div class="stat"><b>76%</b><span>would pre-order to skip the line</span></div>
      </div>
      <h2 class="sec">How might we…</h2>
      <ol class="hmw">
        <li>…show live open / busy status without adding work for vendors? <span class="muted">→ One-tap status board and queue counter</span></li>
        <li>…let students pre-order or pre-send print jobs to skip the queue? <span class="muted">→ Pre-orders with tokens and print-job upload</span></li>
        <li>…keep the tool zero-cost and simple enough for any vendor to run? <span class="muted">→ Static site + Google Sheets, no app, no install</span></li>
      </ol>
      <h2 class="sec">How it works</h2>
      <div class="flow">
        <div><b>1</b><span>Vendor updates status from the dashboard, WhatsApp or the shared Sheet</span></div>
        <div><b>2</b><span>Google Sheets stores status, menu and prices for free</span></div>
        <div><b>3</b><span>This lightweight page renders live cards on any phone</span></div>
        <div><b>4</b><span>Students scan a QR poster or open the link</span></div>
      </div>
    `);
    const f = document.getElementById("fbForm");
    if (fbDraft) { // restore what was typed before logging in
      f.querySelector(`input[value="${fbDraft.type}"]`).checked = true;
      f.vendorId.value = fbDraft.vendorId;
      f.message.value = fbDraft.message;
      document.getElementById("feedback").scrollIntoView();
    }
    f.orderId.onchange = () => { const o = f.orderId.selectedOptions[0]; if (o.dataset.v) f.vendorId.value = o.dataset.v; };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const message = f.message.value.trim();
      if (message.length < 5) return toast("Please write a little more", "err");
      if (!S.student()) {
        fbDraft = { type: f.type.value, vendorId: f.vendorId.value, message };
        afterLogin = "#/about";
        location.hash = "#/login";
        return;
      }
      const order = S.myOrders().find((o) => o.id === f.orderId.value);
      const item = await S.addFeedback({ type: f.type.value, vendorId: f.vendorId.value || null, orderId: order ? order.id : null, message });
      if (item.error) return toast(item.error, "err");
      fbDraft = null;
      toast(`Sent. Your reference is ${item.ref}`, "ok");
      keepScroll = true;
      about();
    };
  }

  function poster() {
    const url = location.href.split("#")[0];
    const qr = "https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=10&data=" + encodeURIComponent(url);
    page("", `
      <section class="poster">
        <p class="eyebrow">Near ${esc(CFG.CAMPUS_NAME || "campus")}?</p>
        <h1>Is it open?<br>How long's the queue?</h1>
        <img src="${qr}" alt="QR code linking to the Campus Vendor Directory" width="240" height="240" onerror="this.replaceWith(Object.assign(document.createElement('p'),{className:'muted',textContent:'QR could not load offline — use the link below.'}))">
        <p class="lead">Scan to see live status, menus & prices — and pre-order.</p>
        <p class="small mono">${esc(url)}</p>
        <button class="btn noprint" onclick="window.print()">🖨️ Print poster</button>
      </section>
    `);
  }

  function notFound() { page("", `<div class="empty big"><h2>Page not found</h2><a class="btn primary" href="#/">Go to directory</a></div>`); }

  /* ---------- router ---------- */
  function route() {
    const h = location.hash.replace(/^#\/?/, "");
    // coming to the login page from anywhere else always starts at step 1 (Gmail)
    if (!/^(login|blocked)/.test(h)) { login.step = "email"; if (login.mode === "codeonly") login.mode = "signin"; Auth.linkError = null; }
    if (h === "directory") { if (!document.getElementById("directory")) home(); document.getElementById("directory").scrollIntoView({ behavior: "smooth" }); return; }
    if (/^(access_token|error|code)=/.test(h)) return home(); // leftovers of an email sign-in link
    const [a, b] = h.split("/");
    switch (a) {
      case "": return home();
      case "vendor": return vendorPage(b);
      case "cart": return cartPage();
      case "print": return printPage(b);
      case "orders": return ordersPage(b);
      case "order": return orderPage(b);
      case "dashboard": return b === "new" ? registerShop() : b ? dashboard(b) : vendorSessionId() && S.vendor(vendorSessionId()) ? (location.hash = "#/dashboard/" + vendorSessionId()) : dashLogin();
      case "about": return about();
      case "login": return loginPage();
      case "blocked": return Auth.blocked ? blockedPage() : loginPage();
      case "account": return accountPage();
      case "poster": return poster();
      default: return notFound();
    }
  }

  /* global clicks */
  document.addEventListener("click", (e) => {
    const card = e.target.closest("[data-href]");
    if (card && !e.target.closest("a,button,input,select")) { location.hash = card.dataset.href; return; }
    const cat = e.target.closest("[data-cat]");
    if (cat) { ui.cat = cat.dataset.cat; document.querySelectorAll("[data-cat]").forEach((c) => c.classList.toggle("on", c === cat)); renderGrid(); return; }
    const act = e.target.closest("[data-act]");
    if (act && act.dataset.act === "logout") { S.vendorLogout().then(() => { location.hash = "#/dashboard"; route(); }); }
  });
  document.addEventListener("keydown", (e) => {
    const card = e.target.closest && e.target.closest("[data-href]");
    if (card && e.key === "Enter") location.hash = card.dataset.href;
  });

  /* live updates from other tabs (student ↔ vendor) */
  function statusSnapshot() { return Object.fromEntries(S.myOrders().map((o) => [o.id, o.status])); }
  let lastMine = {};
  async function liveRefresh() {
    const before = lastMine;
    const changed = await S.sync();
    lastMine = statusSnapshot();
    let strike = false;
    Object.entries(lastMine).forEach(([id, st]) => {
      if (before[id] && before[id] !== st) {
        const o = S.state.orders.find((x) => x.id === id);
        toast(`${o.token}: ${ORDER_LABEL[st]}`, st === "ready" ? "ok" : st === "no_show" ? "err" : "");
        if (st === "ready" && navigator.vibrate) navigator.vibrate(200);
        if (st === "no_show") strike = true;
      }
    });
    // a shop just reported an uncollected order: re-check this student's warning / block status
    if (strike) Auth.refresh().then(() => { keepScroll = true; route(); }).catch(() => {});
    if (!changed) return;
    const active = document.activeElement;
    const typing = active && /INPUT|TEXTAREA|SELECT/.test(active.tagName) && active.type !== "checkbox";
    if (!typing) { keepScroll = true; route(); } else if (document.getElementById("grid")) renderGrid();
  }
  // every 5 s while the page is visible: shop status, new orders, order progress
  let polling = false;
  setInterval(async () => {
    if (document.hidden || polling) return;
    polling = true;
    try { await liveRefresh(); } finally { polling = false; }
  }, 5000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) liveRefresh(); });
  window.addEventListener("hashchange", route);

  /* refresh relative times every minute */
  setInterval(() => { if (document.getElementById("grid")) renderGrid(); }, 60000);

  /* boot: restore the student's Gmail session first, then draw the page */
  S.load();
  let blockShown = false;
  Auth.onChange(() => {
    lastMine = statusSnapshot();
    if (Auth.blocked && !blockShown) { blockShown = true; location.hash = "#/blocked"; return; }
    keepScroll = true; route();
  });
  if (S.state.vendors.length) route(); // last saved shop list, while the server answers
  Promise.all([Auth.init(), S.sync()]).catch(() => {}).finally(() => {
    lastMine = statusSnapshot();
    if (Auth.blocked) { blockShown = true; history.replaceState(null, "", "#/blocked"); }
    else if (Auth.linkError) history.replaceState(null, "", "#/login"); // the login page explains it
    else if (Auth.fromLink && Auth.me) {
      history.replaceState(null, "", "#/");
      setTimeout(() => toast(`Signed in with Google. Welcome, ${Auth.me.name.split(" ")[0]}!`, "ok"), 300);
    } else if (Auth.fromLink && Auth.needsProfile) history.replaceState(null, "", "#/login");
    route();
  });

})();
