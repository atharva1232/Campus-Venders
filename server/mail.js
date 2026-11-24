/* Sends the sign-in code through Brevo's transactional email API.
   Without BREVO_API_KEY (local development) the code is printed to the console instead. */
const SENDER_EMAIL = process.env.SENDER_EMAIL || process.env.BREVO_SENDER_EMAIL || "atharvap3212@gmail.com";
const SENDER_NAME = process.env.SENDER_NAME || "Campus Vendors";

async function sendCode(to, code) {
  const subject = `Your Campus Vendors code: ${code}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:460px;margin:auto;padding:24px;border:1px solid #e2dacb;border-radius:14px">
    <h2 style="margin:0 0 8px;color:#16302a">Campus Vendors</h2>
    <p style="color:#3f5650">Enter this code on the website to sign in:</p>
    <p style="font-size:34px;font-weight:bold;letter-spacing:8px;margin:18px 0;color:#e2672b">${code}</p>
    <p style="color:#6d7f79;font-size:13px">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p>
  </div>`;
  const text = `Your Campus Vendors code is ${code}. It expires in 10 minutes.`;

  if (!process.env.BREVO_API_KEY) {
    if (process.env.RENDER) {
      console.error("BREVO_API_KEY is not set: can't email sign-in codes. Add it under your Render service → Environment.");
      throw new Error("email_not_configured");
    }
    console.log(`[dev] No BREVO_API_KEY set. Code for ${to}: ${code}`);
    return { dev: true };
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
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
    const body = await res.text();
    console.error("Brevo send failed:", res.status, body);
    throw new Error("email_failed");
  }
  return { ok: true };
}

async function sendEmail(to, subject, text, html) {
  if (!process.env.BREVO_API_KEY) {
    if (process.env.RENDER) throw new Error("email_not_configured");
    console.log(`[dev] Email to ${to}: ${subject}\n${text}`);
    return { dev: true };
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: SENDER_NAME, email: SENDER_EMAIL }, to: [{ email: to }], subject, htmlContent: html, textContent: text,
    }),
  });
  if (!res.ok) {
    console.error("Brevo send failed:", res.status, await res.text());
    throw new Error("email_failed");
  }
  return { ok: true };
}

async function sendMerchantApplication(to, application, approveUrl, rejectUrl) {
  const subject = `Shop approval needed: ${application.name}`;
  const text = `A new shop has applied to Campus Vendors.\n\nShop: ${application.name}\nCategory: ${application.category}\nLocation: ${application.location}\nContact: ${application.phone} · ${application.ownerEmail}\n\nApprove: ${approveUrl}\nReject: ${rejectUrl}\n\nThese one-time links expire in 7 days.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #e2dacb;border-radius:14px;color:#16302a"><p style="color:#e2672b;font-size:12px;letter-spacing:2px">CAMPUS VENDORS · SHOP REQUEST</p><h2>New shop application</h2><p><b>${escapeHtml(application.name)}</b> · ${escapeHtml(application.category)}</p><p>${escapeHtml(application.location)} · ${escapeHtml(application.phone)} · ${escapeHtml(application.ownerEmail)}</p><p><a href="${escapeHtml(approveUrl)}" style="display:inline-block;padding:12px 18px;background:#1d8a4e;color:white;text-decoration:none;border-radius:9px">Approve shop</a> <a href="${escapeHtml(rejectUrl)}" style="display:inline-block;padding:12px 18px;background:#b8432f;color:white;text-decoration:none;border-radius:9px">Reject</a></p><p style="color:#6d7f79;font-size:13px">Each link works once and expires in 7 days.</p></div>`;
  return sendEmail(to, subject, text, html);
}

async function sendMerchantDecision(to, name, decision) {
  const approved = decision === "approved";
  const subject = `${name}: shop application ${approved ? "approved" : "not approved"}`;
  const text = `${name}, your Campus Vendors shop application was ${approved ? "approved" : "not approved"}.${approved ? " You can now sign in to the vendor dashboard and add your menu." : " Please contact the Campus Vendors team if you need more information."}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:24px;border:1px solid #e2dacb;border-radius:14px;color:#16302a"><h2>${escapeHtml(name)} · ${approved ? "Approved" : "Application update"}</h2><p>${approved ? "Your shop is now listed on Campus Vendors. Sign in to the vendor dashboard to finish setup." : "Your shop application was not approved."}</p></div>`;
  return sendEmail(to, subject, text, html);
}

async function sendAccountBanNotice(to, name, reason) {
  const subject = "Campus Vendors: ordering account banned";
  const text = `Hi ${name || "there"}, your Campus Vendors account has been banned from ordering now. Reason: ${reason}. You can still browse the directory.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #e2dacb;border-radius:14px;color:#16302a"><h2>Ordering account banned</h2><p>Hi ${escapeHtml(name || "there")}, your account has been banned from placing orders now.</p><p><b>Reason:</b> ${escapeHtml(reason)}</p><p>You can still browse shops and menus. If this is a mistake, reply to this email.</p></div>`;
  return sendEmail(to, subject, text, html);
}

async function sendSecurityAlert(to, student, ip, relatedEmail, reason) {
  const subject = `Account suspended: ${student.email}`;
  const text = `Campus Vendors suspended ${student.email} from ordering.\nReason: ${reason}\nSign-in IP: ${ip}\nRelated suspended account: ${relatedEmail}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #e2dacb;border-radius:14px;color:#16302a"><h2>Ordering account suspended</h2><p><b>Account:</b> ${escapeHtml(student.email)}</p><p><b>Reason:</b> ${escapeHtml(reason)}</p><p><b>Sign-in IP:</b> ${escapeHtml(ip)}</p><p><b>Related suspended account:</b> ${escapeHtml(relatedEmail)}</p></div>`;
  return sendEmail(to, subject, text, html);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>\"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

module.exports = { sendCode, sendMerchantApplication, sendMerchantDecision, sendAccountBanNotice, sendSecurityAlert };
