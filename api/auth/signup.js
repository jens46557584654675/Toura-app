import { db } from '../../lib/db.js';
import { hashPassword, setSession } from '../../lib/auth.js';

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { name, email, password } = req.body || {};
  const e = String(email || '').trim().toLowerCase();
  const n = String(name || '').trim();
  if(!n) return res.status(400).json({ error: 'Please enter your name.' });
  if(!/.+@.+\..+/.test(e)) return res.status(400).json({ error: 'Please enter a valid email.' });
  if(String(password || '').length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  if(await db.get(`user:${e}`)) return res.status(409).json({ error: 'An account with this email already exists.' });
  await db.set(`user:${e}`, { name: n, hash: hashPassword(String(password)), created: Date.now() });
  setSession(res, { email: e, name: n });
  res.json({ user: { email: e, name: n } });
}
