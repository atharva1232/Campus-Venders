/* Sends the sign-in code through Brevo's transactional email API.
   Without BREVO_API_KEY (local development) the code is printed to the console instead. */
const SENDER_EMAIL = process.env.SENDER_EMAIL || process.env.BREVO_SENDER_EMAIL || "atharvap3212@gmail.com";
const SENDER_NAME = process.env.SENDER_NAME || "Campus Vendors";

async function sendCode(to, code, target = "website") {
  const subject = `Your Campus Vendors code: ${code}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:460px;margin:auto;padding:24px;border:1px solid #e2dacb;border-radius:14px">
    <h2 style="margin:0 0 8px;color:#16302a">Campus Vendors</h2>
    <p style="color:#3f5650">Enter this code in the Campus Vendors ${target} to sign in:</p>
    <p style="font-size:34px;font-weight:bold;letter-spacing:8px;margin:18px 0;color:#e2672b">${code}</p>
    <p style="color:#6d7f79;font-size:13px">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p>
  </div>`;
  const text = `Your Campus Vendors code is ${code}. It expires in 10 minutes.`;

  if (!process.env.BREVO_API_KEY) {
    if (process.env.RENDER || process.env.NODE_ENV === "production") {
      console.error("BREVO_API_KEY is not set: can't email sign-in codes. Add it under your Render service → Environment.");
      throw new Error("email_not_configured");
    }
    console.log(`[dev] No BREVO_API_KEY set. Code for ${to}: ${code}`);
    return { dev: true };
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });
  if (!res.ok) {
    console.error("Brevo send failed:", res.status);
    throw new Error("email_failed");
  }
  return { ok: true };
}

async function sendEmail(to, subject, text, html) {
  if (!process.env.BREVO_API_KEY) {
    if (process.env.RENDER || process.env.NODE_ENV === "production") throw new Error("email_not_configured");
    console.log(`[dev] Email to ${to}: ${subject}\n${text}`); return { dev: true };
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", { method:"POST", signal:AbortSignal.timeout(10_000), headers:{"api-key":process.env.BREVO_API_KEY,"content-type":"application/json"}, body:JSON.stringify({sender:{name:SENDER_NAME,email:SENDER_EMAIL},to:[{email:to}],subject,textContent:text,htmlContent:html}) });
  if (!res.ok) throw new Error("email_failed"); return {ok:true};
}
function safe(s) { return String(s||"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
async function sendMerchantApplication(to, a, approve, reject) {
  return sendEmail(to, `Shop approval needed: ${a.name}`, `New shop: ${a.name}\nOwner: ${a.ownerEmail}\nPhone: ${a.phone}\nApprove: ${approve}\nReject: ${reject}`, `<h2>New shop application</h2><p><b>${safe(a.name)}</b> · ${safe(a.category)} · ${safe(a.location)}</p><p>${safe(a.ownerEmail)} · ${safe(a.phone)}</p><p><a href="${safe(approve)}">Approve shop</a> · <a href="${safe(reject)}">Reject application</a></p><small>One-time links expire in 7 days.</small>`);
}
async function sendBanNotice(to, name, reason) { return sendEmail(to,"Campus Vendors: ordering account banned",`Hi ${name||"there"}, your account is banned from ordering now. Reason: ${reason}`,`<h2>Ordering account banned</h2><p>Hi ${safe(name||"there")}, your account has been banned from ordering now.</p><p><b>Reason:</b> ${safe(reason)}</p>`); }
async function sendMerchantDecision(to,name,approved) { return sendEmail(to,`${name}: application ${approved?"approved":"not approved"}`,`${name}, your shop application was ${approved?"approved":"not approved"}.`,`<h2>${safe(name)}</h2><p>Your shop application was ${approved?"approved":"not approved"}.</p>`); }
module.exports = { sendCode, sendEmail, sendMerchantApplication, sendBanNotice, sendMerchantDecision };
