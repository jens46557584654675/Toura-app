import crypto from 'crypto';
import { db } from '../lib/db.js';
import { getSession } from '../lib/auth.js';
import { hostAudio } from '../lib/blob.js';

// The account in ADMIN_EMAIL curates the "Toura picks" library for all users.
const isAdmin = email => email && email === String(process.env.ADMIN_EMAIL || '').toLowerCase();

export default async function handler(req, res){
  const s = getSession(req);
  if(!s) return res.status(401).json({ error: 'Not signed in' });

  if(req.method === 'GET'){
    const catalog = (await db.get('music:catalog')) || [];
    const mine = (await db.get(`music:${s.email}`)) || [];
    const favs = (await db.get(`musicfav:${s.email}`)) || [];
    return res.json({ catalog, mine, favs, admin: isAdmin(s.email) });
  }
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body || {};
  try{
    if(action === 'upload'){
      const url = await hostAudio(req.body.data);
      const track = {
        id: crypto.randomUUID(),
        name: String(req.body.name || 'Track').trim().slice(0, 80),
        url,
        by: isAdmin(s.email) ? 'toura' : 'me',
      };
      const key = isAdmin(s.email) ? 'music:catalog' : `music:${s.email}`;
      const list = (await db.get(key)) || [];
      list.unshift(track);
      await db.set(key, list.slice(0, 100));
      return res.json({ track });
    }
    if(action === 'fav'){
      const favs = (await db.get(`musicfav:${s.email}`)) || [];
      const id = String(req.body.id || '');
      const next = req.body.on ? [...new Set([...favs, id])] : favs.filter(f => f !== id);
      await db.set(`musicfav:${s.email}`, next);
      return res.json({ favs: next });
    }
    if(action === 'remove'){
      const id = String(req.body.id || '');
      const key = `music:${s.email}`;
      const mine = ((await db.get(key)) || []).filter(t => t.id !== id);
      await db.set(key, mine);
      if(isAdmin(s.email)){
        const cat = ((await db.get('music:catalog')) || []).filter(t => t.id !== id);
        await db.set('music:catalog', cat);
      }
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'Unknown action' });
  }catch(err){
    res.status(502).json({ error: err.message });
  }
}
