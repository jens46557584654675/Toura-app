// Transactional email via Resend. No SDK — plain REST.
const BASE = process.env.RESEND_BASE || 'https://api.resend.com';

export function mailConfigured(){ return !!process.env.RESEND_API_KEY; }

export async function sendMail({ to, subject, html }){
  const r = await fetch(`${BASE}/emails`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM || 'Toura <onboarding@resend.dev>', to, subject, html }),
  });
  if(!r.ok) throw new Error(`Email send failed (${r.status})`);
  return r.json().catch(() => ({}));
}

// Minimal Toura-styled reset email (ultra-plain, white + black pill button).
export function resetEmailHtml(link){
  return `<div style="font-family:Inter,Arial,sans-serif;background:#f4f4f4;padding:32px">
    <div style="max-width:460px;margin:0 auto;background:#fff;border-radius:16px;padding:32px">
      <div style="font-weight:800;font-size:20px;letter-spacing:-.02em;margin-bottom:18px">toura</div>
      <p style="font-size:15px;color:#111;line-height:1.5;margin:0 0 20px">
        We received a request to reset your Toura password. Click the button below to choose a new one. This link expires in 30 minutes.</p>
      <a href="${link}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:999px">Reset password</a>
      <p style="font-size:13px;color:#8a8a8a;line-height:1.5;margin:22px 0 0">
        If you didn't request this, you can safely ignore this email.</p>
    </div>
  </div>`;
}
