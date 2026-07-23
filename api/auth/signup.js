import { db } from '../../lib/db.js';
import { hashPassword, setSession, passwordProblem } from '../../lib/auth.js';
import { ipGate } from '../../lib/ratelimit.js';

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if(!(await ipGate(req))) return res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });

  const { name, email, password } = req.body || {};
  const e = String(email || '').trim().toLowerCase();
  const n = String(name || '').trim().slice(0, 120);
  if(!n) return res.status(400).json({ error: 'Please enter your name.' });
  if(!/.+@.+\..+/.test(e) || e.length > 200) return res.status(400).json({ error: 'Please enter a valid email.' });
  const pwErr = passwordProblem(password);
  if(pwErr) return res.status(400).json({ error: pwErr });

  if(await db.get(`user:${e}`)) return res.status(409).json({ error: 'An account with this email already exists.' });
  await db.set(`user:${e}`, { name: n, hash: hashPassword(String(password)), created: Date.now() });
  setSession(res, { email: e, name: n });
  res.json({ user: { email: e, name: n } });
}
