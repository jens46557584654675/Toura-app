// Account settings — currently just the profile photo. The photo lives on the
// user record (user:{email}); it is resized client-side to ~256px before upload.
import { getSession, verifyPassword, hashPassword, passwordProblem } from '../lib/auth.js';
import { db } from '../lib/db.js';
import { hostImage } from '../lib/blob.js';

export default async function handler(req, res){
  const s = getSession(req);
  if(!s) return res.status(401).json({ error: 'Not signed in' });
  const key = `user:${s.email}`;
  const acc = await db.get(key);
  if(!acc) return res.status(404).json({ error: 'Account not found' });

  if(req.method === 'GET'){
    return res.json({ photo: acc.photo || null });
  }
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body || {};
  try{
    if(action === 'photo'){
      // hostImage caps size and returns the data URL unchanged in local dev.
      acc.photo = await hostImage(req.body.data);
    } else if(action === 'removePhoto'){
      acc.photo = null;
    } else if(action === 'password'){
      // Change password — the current password is a required check.
      if(!verifyPassword(String(req.body.current || ''), acc.hash)){
        return res.status(400).json({ error: 'Your current password is incorrect.' });
      }
      const pwErr = passwordProblem(req.body.newPassword);
      if(pwErr) return res.status(400).json({ error: pwErr });
      acc.hash = hashPassword(String(req.body.newPassword));
      await db.set(key, acc);
      return res.json({ ok: true });
    } else {
      return res.status(400).json({ error: 'Unknown action' });
    }
  }catch(err){
    return res.status(400).json({ error: err.message || 'Upload failed' });
  }

  await db.set(key, acc);
  res.json({ photo: acc.photo || null });
}
