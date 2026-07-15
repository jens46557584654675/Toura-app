import { db } from '../lib/db.js';
import { getSession } from '../lib/auth.js';

export default async function handler(req, res){
  const s = getSession(req);
  if(!s) return res.status(401).json({ error: 'Not signed in' });
  const projects = (await db.get(`projects:${s.email}`)) || [];
  res.json({ projects });
}
