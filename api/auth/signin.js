import { db } from '../../lib/db.js';
import { verifyPassword, setSession } from '../../lib/auth.js';
import { ipGate, failCount, failHit, failReset, FAIL_LIMIT } from '../../lib/ratelimit.js';

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if(!(await ipGate(req))) return res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });

  const { email, password } = req.body || {};
  const e = String(email || '').trim().toLowerCase();

  if(await failCount(e) >= FAIL_LIMIT){
    return res.status(429).json({ error: 'Too many failed sign-ins. Please try again in 15 minutes or reset your password.' });
  }

  const acc = await db.get(`user:${e}`);
  if(!acc || !verifyPassword(String(password || ''), acc.hash)){
    await failHit(e);
    return res.status(401).json({ error: 'Wrong email or password.' });
  }
  await failReset(e);
  setSession(res, { email: e, name: acc.name });
  res.json({ user: { email: e, name: acc.name, photo: acc.photo || null } });
}
