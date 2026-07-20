import crypto from 'crypto';
import { db } from '../lib/db.js';
import { getSession } from '../lib/auth.js';
import { hostAudio, archiveAudio } from '../lib/blob.js';
import { falConfigured, falSubmit, falGet, jobUrls, MODELS } from '../lib/fal.js';

// The account in ADMIN_EMAIL curates the "Toura picks" library for all users.
const isAdmin = email => email && email === String(process.env.ADMIN_EMAIL || '').toLowerCase();

export default async function handler(req, res){
  const s = getSession(req);
  if(!s) return res.status(401).json({ error: 'Not signed in' });

  if(req.method === 'GET'){
    // Finalize a pending AI-music job, if any
    let genPending = false;
    const gen = await db.get(`musicgen:${s.email}`);
    if(gen){
      try{
        const urls = jobUrls(MODELS.music, gen);
        const st = await falGet(urls.status);
        if(st.status === 'COMPLETED'){
          const out = await falGet(urls.result);
          const url = await archiveAudio(out.audio?.url);
          const track = { id: crypto.randomUUID(), name: gen.name, url, by: isAdmin(s.email) ? 'toura' : 'me' };
          const key = isAdmin(s.email) ? 'music:catalog' : `music:${s.email}`;
          const listG = (await db.get(key)) || [];
          listG.unshift(track);
          await db.set(key, listG.slice(0, 100));
          await db.del(`musicgen:${s.email}`);
        } else {
          genPending = true;
        }
      }catch{
        genPending = true; // transient — keep pending
      }
    }
    const catalog = (await db.get('music:catalog')) || [];
    const mine = (await db.get(`music:${s.email}`)) || [];
    const favs = (await db.get(`musicfav:${s.email}`)) || [];
    return res.json({ catalog, mine, favs, admin: isAdmin(s.email), genPending });
  }
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body || {};
  try{
    if(action === 'upload'){
      const url = await hostAudio(req.body.data);
      // The browser reads the duration off the file before uploading; there is
      // no audio decoder here.
      const dur = Number(req.body.dur);
      const track = {
        id: crypto.randomUUID(),
        name: String(req.body.name || 'Track').trim().slice(0, 80),
        url,
        dur: Number.isFinite(dur) && dur > 0 ? Math.round(dur) : null,
        by: isAdmin(s.email) ? 'toura' : 'me',
      };
      const key = isAdmin(s.email) ? 'music:catalog' : `music:${s.email}`;
      const list = (await db.get(key)) || [];
      list.unshift(track);
      await db.set(key, list.slice(0, 100));
      return res.json({ track });
    }
    if(action === 'generate'){
      if(!falConfigured()) return res.status(503).json({ error: 'Rendering not configured.' });
      if(await db.get(`musicgen:${s.email}`)) return res.status(409).json({ error: 'A track is already generating — give it a moment.' });
      const desc = String(req.body.prompt || '').trim().slice(0, 500);
      if(!desc) return res.status(400).json({ error: 'Describe the music first.' });
      const job = await falSubmit(MODELS.music, {
        prompt: `${desc}. Instrumental background music for a real estate walkthrough video: calm, warm, unobtrusive, high-quality production, clean mix.`,
        negative_prompt: 'vocals, harsh, distorted, low quality, abrupt changes',
      });
      await db.set(`musicgen:${s.email}`, { ...job, name: String(req.body.name || desc).slice(0, 80) });
      return res.json({ genPending: true });
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
