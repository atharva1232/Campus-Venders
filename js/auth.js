/* Student accounts: Gmail + emailed verification code (Supabase Auth),
   plus the "not collected" strikes: 1st = warning, 2nd = permanent block. */
(function () {
  const CFG = window.CVD_CONFIG || {};
  // Read this before supabase-js tidies the address bar: a sign-in link from the email lands here as
  // #access_token=…  (worked)  or  #error=…&error_description=…  (expired / already used).
  const landing = new URLSearchParams(String(location.hash || "").replace(/^#\/?/, ""));
  const fromLink = landing.has("access_token");
  const linkError = landing.get("error_description");
  const PENDING_KEY = "cvd_pending_signup"; // details typed before the email was sent (the link may open in a new tab)
  const sb = window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_KEY
    ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY)
    : null;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());

  const GMAIL = /^[a-z0-9](?:[a-z0-9.+_-]*[a-z0-9])?@(gmail|googlemail)\.com$/i;

  const Auth = {
    enabled: !!sb,
    me: null,          // { id, email, name, cls, phone, strikes } of the signed-in student
    needsProfile: false, // signed in, but has not entered name and class yet
    blocked: false,    // this browser just hit a blocked account
    noShows: [],       // the student's uncollected orders
    lastError: null,
    fromLink: false,   // this page load came from clicking the sign-in link in the email
    linkError: linkError ? linkError.replace(/\+/g, " ") : null,

    onChange(fn) { listeners.add(fn); },
    isGmail(e) { return GMAIL.test(String(e || "").trim()); },

    rememberSignup(details) { try { localStorage.setItem(PENDING_KEY, JSON.stringify({ ...details, at: Date.now() })); } catch (e) {} },
    pendingSignup(email) {
      try {
        const p = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
        // only for the same Gmail, and only for a day
        if (p && p.email === String(email || "").toLowerCase() && Date.now() - p.at < 864e5) return p;
      } catch (e) {}
      return null;
    },
    forgetSignup() { try { localStorage.removeItem(PENDING_KEY); } catch (e) {} },

    async init() {
      if (!sb) return;
      try {
        const { data } = await sb.auth.getSession();
        if (data.session) await this.refresh();
        if (data.session && fromLink && !this.blocked) await this.finishLinkSignIn(data.session.user.email);
      } catch (e) { this.lastError = e.message; console.warn("Auth init failed:", e); }
      // other tabs signing out (supabase-js syncs the session through storage)
      sb.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT" && (this.me || this.needsProfile)) { this.me = null; this.needsProfile = false; emit(); }
      });
    },

    /* Re-read the student's row. Signs out and flags `blocked` if the account is blocked. */
    async refresh() {
      if (!sb) return null;
      const { data: u } = await sb.auth.getUser();
      if (!u || !u.user) { this.me = null; this.needsProfile = false; return null; }
      const { data: row, error } = await sb.from("students").select("id,email,name,cls,phone,strikes,blocked").eq("id", u.user.id).maybeSingle();
      if (error) throw error;
      if (!row) {
        const { data: isBlocked } = await sb.rpc("email_blocked", { p_email: u.user.email });
        if (isBlocked) return this.block();
        this.me = null; this.needsProfile = true; this.pendingEmail = u.user.email;
        return null;
      }
      if (row.blocked) return this.block();
      this.me = row; this.needsProfile = false; this.blocked = false;
      const { data: ns } = await sb.from("no_shows").select("order_id,token,shop,at").order("at", { ascending: false });
      this.noShows = ns || [];
      return row;
    },

    async block() {
      const wasIn = !!this.me;
      this.me = null; this.needsProfile = false; this.blocked = true;
      try { await sb.auth.signOut(); } catch (e) {}
      if (wasIn) emit(); // only a student blocked mid-session needs the page swapped out
      return null;
    },

    /* Step 1: email a code. Returns { ok } or { error, blocked }. */
    async sendCode(email) {
      if (!sb) return { error: "Login isn't set up yet (missing Supabase settings in js/config.js)." };
      email = email.trim().toLowerCase();
      if (!this.isGmail(email)) return { error: "Please use a Gmail address (ending in @gmail.com)." };
      const { data: isBlocked, error: bErr } = await sb.rpc("email_blocked", { p_email: email });
      if (bErr) return { error: "Couldn't reach the login server. Check your internet and try again." };
      if (isBlocked) { this.blocked = true; return { error: "This Gmail account has been permanently blocked.", blocked: true }; }
      // if the email holds a link instead of a code, the link brings the student back to this page
      const back = location.origin + location.pathname;
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: back } });
      if (error) {
        const m = /rate|seconds|too many/i.test(error.message) ? "Too many codes requested. Please wait a minute and try again." : error.message;
        return { error: m };
      }
      return { ok: true };
    },

    /* Step 2: check the code. Returns { ok, needsProfile } or { error, blocked }. */
    async verify(email, code) {
      const { error } = await sb.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
      if (error) return { error: /expired|invalid/i.test(error.message) ? "That code is wrong or has expired. Check the latest email or send a new code." : error.message };
      await this.refresh();
      if (this.blocked) return { error: "This Gmail account has been permanently blocked.", blocked: true };
      return { ok: true, needsProfile: this.needsProfile }; // the login page redraws itself
    },

    /* Save name, class and phone (after the code is verified, and from the account page). */
    async saveProfile(name, cls, phone) {
      const { error } = await sb.rpc("save_profile", { p_name: name, p_cls: cls, p_phone: phone });
      if (error) {
        if (/blocked/.test(error.message)) { await this.block(); return { error: "This Gmail account has been permanently blocked.", blocked: true }; }
        if (/duplicate|unique/i.test(error.message)) return { error: "This Gmail inbox already has an account (maybe written with dots or a +tag)." };
        return { error: error.message };
      }
      await this.refresh();
      await this.setPhoneAsPassword(phone);
      return { ok: true };
    },

    /* Signed in by clicking the email link: finish a new account with the details typed earlier,
       and make sure the phone number works for the next sign-in. */
    async finishLinkSignIn(email) {
      this.fromLink = true;
      const p = this.pendingSignup(email);
      if (this.needsProfile && p) await this.saveProfile(p.name, p.cls, p.phone);
      else if (this.me && this.me.phone) await this.setPhoneAsPassword(this.me.phone);
      if (this.me) this.forgetSignup();
    },

    /* The phone number is the account's sign-in secret (Supabase stores it hashed, like a password). */
    async setPhoneAsPassword(phone) {
      const { error } = await sb.auth.updateUser({ password: phone });
      // "should be different from the old password" just means it's already set
      if (error && !/different|same/i.test(error.message)) console.warn("Could not set the sign-in phone:", error.message);
    },

    /* Returning students: Gmail + phone number, no code. Returns { ok } or { error, blocked, noAccount }. */
    async signIn(email, phone) {
      if (!sb) return { error: "Login isn't set up yet (missing Supabase settings in js/config.js)." };
      email = email.trim().toLowerCase();
      if (!this.isGmail(email)) return { error: "Please use a Gmail address (ending in @gmail.com)." };
      const { data: isBlocked, error: bErr } = await sb.rpc("email_blocked", { p_email: email });
      if (bErr) return { error: "Couldn't reach the login server. Check your internet and try again." };
      if (isBlocked) { this.blocked = true; return { error: "This Gmail account has been permanently blocked.", blocked: true }; }
      const { error } = await sb.auth.signInWithPassword({ email, password: phone });
      if (error) {
        if (/invalid|credentials/i.test(error.message)) return { error: "That Gmail and phone number don't match an account. New here? Create an account instead.", noAccount: true };
        if (/confirm/i.test(error.message)) return { error: "This account was never finished. Create the account again to get a new code." };
        if (/rate|too many/i.test(error.message)) return { error: "Too many tries. Please wait a minute and try again." };
        return { error: error.message };
      }
      await this.refresh();
      if (this.blocked) return { error: "This Gmail account has been permanently blocked.", blocked: true };
      return { ok: true, needsProfile: this.needsProfile };
    },

    async logout() {
      this.me = null; this.needsProfile = false;
      if (sb) await sb.auth.signOut();
    },

    /* Called from the vendor dashboard when a ready order is never picked up. */
    async reportNoShow(order, shopName) {
      if (!sb || !order.student || !order.student.id) return { error: "This order has no student account attached." };
      const { data, error } = await sb.rpc("report_no_show", { p_student: order.student.id, p_order: order.id, p_token: order.token, p_shop: shopName });
      return error ? { error: error.message } : data;
    },
  };

  window.Auth = Auth;
})();
