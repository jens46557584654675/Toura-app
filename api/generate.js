import { db } from '../lib/db.js';
import { getSession } from '../lib/auth.js';
import { hfConfigured, submitVideo } from '../lib/hf.js';
import { hostImage } from '../lib/blob.js';

const ALLOWED_DURATIONS = [3, 5, 10];
const ALLOWED_ASPECTS = ['16:9', '9:16'];
const ALLOWED_QUALITY = ['720p', '1080p'];

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const s = getSession(req);
  if(!s) return res.status(401).json({ error: 'Not signed in' });
  if(!hfConfigured()) return res.status(503).json({ error: 'Video rendering is not configured yet. The Toura team needs to add its rendering keys.' });

  const { name, prompt, duration, aspect, quality, image } = req.body || {};
  if(!image) return res.status(400).json({ error: 'No start photo provided.' });
  const p = String(prompt || '').trim().slice(0, 2000) || 'Slow cinematic walkthrough, warm natural light, gimbal-smooth camera.';
  const dur = ALLOWED_DURATIONS.includes(Number(duration)) ? Number(duration) : 5;
  const ar  = ALLOWED_ASPECTS.includes(aspect) ? aspect : '16:9';
  const q   = ALLOWED_QUALITY.includes(quality) ? quality : '720p';

  try{
    const imageUrl = await hostImage(image);
    const job = await submitVideo({
      image_url: imageUrl,
      prompt: p.replace(/@image\d+/g, '').replace(/\s+/g, ' ').trim(),
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
      poster: imageUrl.startsWith('data:') ? null : imageUrl,
      created: Date.now(),
      done: false,
    });
    res.json({ id });
  }catch(err){
    res.status(502).json({ error: 'Could not start the render: ' + err.message });
  }
}
