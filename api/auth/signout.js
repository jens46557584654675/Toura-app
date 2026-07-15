import { clearSession } from '../../lib/auth.js';

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  clearSession(res);
  res.json({ ok: true });
}
