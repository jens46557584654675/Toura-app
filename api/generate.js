import { db } from '../lib/db.js';
import { getSession } from '../lib/auth.js';
import { falConfigured, submitVideo } from '../lib/fal.js';
import { hostImage } from '../lib/blob.js';

const ALLOWED_DURATIONS = ['auto','4','5','6','7','8','9','10','11','12','13','14','15'];
const ALLOWED_ASPECTS = ['auto','16:9','9:16','1:1','4:3','3:4','21:9'];
const ALLOWED_RES = ['480p','720p'];

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const s = getSession(req);
  if(!s) return res.status(401).json({ error: 'Not signed in' });
  if(!falConfigured()) return res.status(503).json({ error: 'Video rendering is not configured yet. The Toura team needs to add its rendering key.' });

  const { name, prompt, duration, aspect, quality, images } = req.body || {};
  if(!Array.isArray(images) || images.length < 1) return res.status(400).json({ error: 'No photos provided.' });
  if(images.length > 9) return res.status(400).json({ error: 'Up to 9 photos per video.' });

  // Seedance expects @Image1 (capital I); the Toura editor writes @image1.
  const p = String(prompt || '').trim().slice(0, 2000).replace(/@image(\d+)/gi, '@Image$1')
    || 'Slow cinematic walkthrough through @Image1, warm natural light, gimbal-smooth camera.';
  const dur = ALLOWED_DURATIONS.includes(String(duration)) ? String(duration) : 'auto';
  const ar  = ALLOWED_ASPECTS.includes(aspect) ? aspect : '16:9';
  const q   = ALLOWED_RES.includes(quality) ? quality : '720p';

  try{
    const hosted = [];
    for(const img of images) hosted.push(await hostImage(img));
    const job = await submitVideo({
      prompt: p,
      image_urls: hosted,
      duration: dur,
      aspect_ratio: ar,
      resolution: q,
    });
    const id = job.request_id;
    if(!id) throw new Error('No request id returned');
    await db.set(`job:${id}`, {
      email: s.email,
      name: String(name || '').trim().slice(0, 120) || 'Untitled walkthrough',
      duration: dur, aspect: ar, quality: q,
      poster: hosted[0].startsWith('data:') ? null : hosted[0],
      created: Date.now(),
      done: false,
    });
    res.json({ id });
  }catch(err){
    res.status(502).json({ error: 'Could not start the render: ' + err.message });
  }
}
