import crypto from 'crypto';
import { db } from '../../lib/db.js';
import { ipGate, resetGate } from '../../lib/ratelimit.js';
import { mailConfigured, sendMail, resetEmailHtml } from '../../lib/mail.js';

const TTL = 30 * 60; // reset token lives 30 minutes

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if(!(await ipGate(req))) return res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });

  const e = String((req.body || {}).email || '').trim().toLowerCase();
  if(!/.+@.+\..+/.test(e)) return res.status(400).json({ error: 'Please enter a valid email.' });

  if(!mailConfigured()){
    return res.json({ unavailable: true, message: 'Password reset is temporarily unavailable — please contact Toura and we\'ll help you back in.' });
  }
  if(!(await resetGate(e))){
    return res.status(429).json({ error: 'Too many reset requests. Please try again in 15 minutes.' });
  }

  // Generic response either way — never reveal whether the account exists.
  const generic = { message: 'If an account exists for that email, a reset link is on its way.' };
  const acc = await db.get(`user:${e}`);
  if(!acc) return res.json(generic);

  const token = crypto.randomBytes(32).toString('hex');
  await db.set(`reset:${token}`, { email: e, exp: Date.now() + TTL * 1000 }, TTL);

  const host = req.headers.host || '';
  const proto = /^(localhost|127\.0\.0\.1)/.test(host) ? 'http' : (req.headers['x-forwarded-proto'] || 'https');
  const link = `${proto}://${host}/?reset=${token}`;
  try{
    await sendMail({ to: e, subject: 'Reset your Toura password', html: resetEmailHtml(link) });
  }catch{
    // Don't leak send failures back to the caller; the generic message stands.
  }
  res.json(generic);
}
