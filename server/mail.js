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
      console.error("BREVO_API_KEY is not set: can't email sign-in codes. Add it under campus-vendors-api → Environment.");
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

module.exports = { sendCode };
