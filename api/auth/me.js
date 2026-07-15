import { getSession } from '../../lib/auth.js';

export default async function handler(req, res){
  const s = getSession(req);
  res.json({ user: s ? { email: s.email, name: s.name } : null });
}
