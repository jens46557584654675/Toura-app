import { db } from '../../lib/db.js';
import { verifyPassword, setSession } from '../../lib/auth.js';

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, password } = req.body || {};
  const e = String(email || '').trim().toLowerCase();
  const acc = await db.get(`user:${e}`);
  if(!acc || !verifyPassword(String(password || ''), acc.hash)){
    return res.status(401).json({ error: 'Wrong email or password.' });
  }
  setSession(res, { email: e, name: acc.name });
  res.json({ user: { email: e, name: acc.name, photo: acc.photo || null } });
}
