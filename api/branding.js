// Kantoor branding: logo + named intro/outro clips (each with landscape/portrait).
import crypto from 'crypto';
import { getSession } from '../lib/auth.js';
import { getBranding, saveBranding, findItem } from '../lib/branding.js';
import { hostLogo, hostBrandingVideo } from '../lib/blob.js';

export default async function handler(req, res){
  const s = getSession(req);
  if(!s) return res.status(401).json({ error: 'Not signed in' });

  if(req.method === 'GET'){
    return res.json({ branding: await getBranding(s.email) });
  }
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const branding = await getBranding(s.email);
  const { action } = req.body || {};
  const kind = () => (req.body.kind === 'intro' ? 'intro' : 'outro');
  const listOf = k => (k === 'intro' ? branding.intros : branding.outros);
  const variant = () => (req.body.variant === 'portrait' ? 'portrait' : 'landscape');

  try{
    if(action === 'logo'){
      branding.logo = { url: await hostLogo(req.body.data), name: String(req.body.name || 'Logo').slice(0, 80) };

    } else if(action === 'removeLogo'){
      branding.logo = null;

    } else if(action === 'additem'){
      const k = kind();
      const item = { id: crypto.randomUUID(), name: String(req.body.name || (k === 'intro' ? 'Intro' : 'Outro')).slice(0, 80), videos: { landscape: null, portrait: null } };
      listOf(k).push(item);

    } else if(action === 'rename'){
      const it = findItem(listOf(kind()), req.body.id);
      if(!it) return res.status(404).json({ error: 'Not found' });
      it.name = String(req.body.name || it.name).slice(0, 80);

    } else if(action === 'removeitem'){
      const list = listOf(kind());
      const i = list.findIndex(x => x.id === req.body.id);
      if(i >= 0) list.splice(i, 1);

    } else if(action === 'uploadvariant'){
      const it = findItem(listOf(kind()), req.body.id);
      if(!it) return res.status(404).json({ error: 'Not found' });
      const dur = Number(req.body.dur);
      it.videos[variant()] = { url: await hostBrandingVideo(req.body.data), dur: dur > 0 ? dur : null };

    } else if(action === 'removevariant'){
      const it = findItem(listOf(kind()), req.body.id);
      if(it) it.videos[variant()] = null;

    } else {
      return res.status(400).json({ error: 'Unknown action' });
    }
  }catch(err){
    return res.status(400).json({ error: err.message || 'Upload failed' });
  }

  await saveBranding(s.email, branding);
  res.json({ branding });
}
