import { getSession } from '../../lib/auth.js';
import { db } from '../../lib/db.js';

export default async function handler(req, res){
  const s = getSession(req);
  if(!s) return res.json({ user: null });
  // Photo lives on the user record, not in the session cookie.
  const acc = await db.get(`user:${s.email}`);
  res.json({ user: { email: s.email, name: s.name, photo: acc?.photo || null } });
}
