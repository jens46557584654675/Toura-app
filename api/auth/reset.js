import { db } from '../../lib/db.js';
import { hashPassword, setSession, passwordProblem } from '../../lib/auth.js';
import { ipGate, failReset } from '../../lib/ratelimit.js';

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if(!(await ipGate(req))) return res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });

  const { token, password } = req.body || {};
  const t = String(token || '');
  const rec = t ? await db.get(`reset:${t}`) : null;
  if(!rec || rec.exp < Date.now()){
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
  }
  const pwErr = passwordProblem(password);
  if(pwErr) return res.status(400).json({ error: pwErr });

  const acc = await db.get(`user:${rec.email}`);
  if(!acc){
    await db.del(`reset:${t}`);
    return res.status(400).json({ error: 'This reset link is no longer valid.' });
  }
  acc.hash = hashPassword(String(password));
  await db.set(`user:${rec.email}`, acc);
  await db.del(`reset:${t}`);        // single use
  await failReset(rec.email);         // clear any lockout
  setSession(res, { email: rec.email, name: acc.name });
  res.json({ user: { email: rec.email, name: acc.name, photo: acc.photo || null } });
}
