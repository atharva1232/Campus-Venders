/* Student accounts: email OTP on each sign-in, with optional Google OAuth.
   Three cancellations / confirmed no-shows suspend ordering; earlier warnings add a checkout fee. */
(function () {
  const CFG = window.CVD_CONFIG || {};
  const TOKEN_KEY = "cvd_student_token";
  const PENDING_KEY = "cvd_pending_signup";
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());
  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const api = (...a) => window.Store.api(...a);

  const GMAIL = /^[a-z0-9](?:[a-z0-9.+_-]*[a-z0-9])?@(gmail|googlemail)\.com$/i;

  const Auth = {
    enabled: typeof CFG.API_URL === "string", // "" = the API is on this same address
    me: null,            // { id, email, name, cls, phone, strikes } of the signed-in student
    needsProfile: false, // code accepted, but name / class / phone still needed
    pendingToken: null,
    pendingEmail: null,
    blocked: false,      // this browser just hit a blocked account
    noShows: [],         // the student's uncollected orders
    fromLink: false,     // (codes only now; kept so older page code keeps working)
    linkError: null,

    onChange(fn) { listeners.add(fn); },
    isGmail(e) { return GMAIL.test(String(e || "").trim()); },
    token() { return get(TOKEN_KEY); },

    rememberSignup(details) { set(PENDING_KEY, JSON.stringify({ ...details, at: Date.now() })); },
    pendingSignup(email) {
      try {
        const p = JSON.parse(get(PENDING_KEY) || "null");
        if (p && p.email === String(email || "").toLowerCase() && Date.now() - p.at < 864e5) return p;
      } catch (e) {}
      return null;
    },
    forgetSignup() { set(PENDING_KEY, null); },

    async init() {
      const url = new URL(location.href);
      const googleToken = url.searchParams.get("google_token");
      const pending = url.searchParams.get("google_pending");
      const email = url.searchParams.get("google_email");
      const error = url.searchParams.get("google_error");
      if (googleToken) { set(TOKEN_KEY, googleToken); this.fromLink = true; }
      if (pending) { set(TOKEN_KEY, null); this.me = null; this.pendingToken = pending; this.pendingEmail = email || ""; this.needsProfile = true; this.fromLink = true; }
      if (error) this.linkError = error === "gmail" ? "Google sign-in requires a verified Gmail account." : error === "blocked" ? "This account is suspended from ordering after three warnings." : error === "ip_block" ? "This account was suspended because its sign-in IP matches a recently suspended account." : error === "unconfigured" ? "Google sign-in hasn’t been configured on this deployment yet." : "Google sign-in could not be completed. Please try again.";
      if (googleToken || pending || error) history.replaceState(null, "", location.pathname + location.hash);
      if (this.token()) await this.refresh();
    },

    /* re-read the signed-in student (and warnings) from the server */
    async refresh() {
      if (!this.token()) { this.me = null; return null; }
      const d = await api("GET", "/api/me");
      if (d.blocked) return this.block();
      if (d.error) { if (d.status === 401) { set(TOKEN_KEY, null); this.me = null; } return null; }
      this.me = d.student; this.noShows = d.noShows || []; this.blocked = false;
      return this.me;
    },
    /* called with every /api/sync result */
    applySync(d) {
      if (d.blocked) { this.block(); return; }
      if (d.me) { this.me = d.me; this.noShows = d.noShows || []; }
      else if (this.me && this.token()) { this.me = null; set(TOKEN_KEY, null); emit(); } // session ended on the server
    },
    block() {
      const wasIn = !!this.me;
      this.me = null; this.needsProfile = false; this.blocked = true;
      set(TOKEN_KEY, null);
      if (wasIn) emit(); // only a student blocked mid-session needs the page swapped out
      return null;
    },
    signedIn(d) {
      set(TOKEN_KEY, d.token);
      this.me = d.student; this.needsProfile = false; this.pendingToken = null; this.blocked = false;
    },

    /* step 1: email a code. `details` = { name, cls, phone } when creating an account */
    async sendCode(email, details) {
      if (!this.isGmail(email)) return { error: "Please use a Gmail address (ending in @gmail.com)." };
      const d = await api("POST", "/api/auth/send-code", { email: email.trim().toLowerCase(), details: details || undefined });
      if (d.blocked) { this.blocked = true; return { error: d.error, blocked: true }; }
      if (d.error) return { error: d.error };
      return { ok: true, devCode: d.devCode };
    },
    /* step 2: check the code */
    async verify(email, code, details) {
      const d = await api("POST", "/api/auth/verify", { email: email.trim().toLowerCase(), code, details: details || undefined });
      if (d.blocked) { this.blocked = true; return { error: d.error, blocked: true }; }
      if (d.error) return { error: d.error };
      if (d.needsProfile) { this.needsProfile = true; this.pendingToken = d.pendingToken; this.pendingEmail = d.email; return { ok: true, needsProfile: true }; }
      this.signedIn(d);
      await this.refresh();
      return { ok: true, needsProfile: false };
    },
    /* name / class / phone: finishes a new account, or updates the signed-in one */
    async saveProfile(name, cls, phone) {
      const d = this.needsProfile && this.pendingToken
        ? await api("POST", "/api/auth/finish", { pendingToken: this.pendingToken, name, cls, phone })
        : await api("PUT", "/api/me", { cls, phone });
      if (d.blocked) { this.block(); return { error: d.error, blocked: true }; }
      if (d.error) return { error: d.error };
      if (d.token) this.signedIn(d); else this.me = d.student;
      await this.refresh();
      return { ok: true };
    },
    async setPhoneAsPassword() {},
    async logout() {
      if (this.token()) await api("POST", "/api/auth/logout");
      set(TOKEN_KEY, null);
      this.me = null; this.needsProfile = false; this.pendingToken = null;
      this.fromLink = false; this.linkError = null;
    },
  };

  window.Auth = Auth;
})();
