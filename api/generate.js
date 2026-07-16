import crypto from 'crypto';
import { getSession } from '../lib/auth.js';
import { falConfigured, falSubmit, clipPrompt, MODELS } from '../lib/fal.js';
import { hostImage } from '../lib/blob.js';
import { loadProjects, saveProjects } from '../lib/projects.js';

const ALLOWED_DURATIONS = ['auto','4','5','6','7','8','9','10','11','12','13','14','15'];
const ALLOWED_ASPECTS = ['auto','16:9','9:16','1:1','4:3','3:4','21:9'];
const ALLOWED_RES = ['480p','720p'];

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const s = getSession(req);
  if(!s) return res.status(401).json({ error: 'Not signed in' });
  if(!falConfigured()) return res.status(503).json({ error: 'Video rendering is not configured yet.' });

  const { name, segments, stylePrompt, music, duration, aspect, quality } = req.body || {};
  if(!Array.isArray(segments) || segments.length < 1) return res.status(400).json({ error: 'No photos provided.' });
  if(segments.length > 6) return res.status(400).json({ error: 'Up to 6 clips per walkthrough.' });
  for(const seg of segments){
    if(!Array.isArray(seg.images) || seg.images.length < 1) return res.status(400).json({ error: 'Every clip needs at least one photo.' });
    if(seg.images.length > 9) return res.status(400).json({ error: 'Up to 9 photos per clip.' });
  }
  const dur = ALLOWED_DURATIONS.includes(String(duration)) ? String(duration) : 'auto';
  const ar  = ALLOWED_ASPECTS.includes(aspect) ? aspect : '16:9';
  const q   = ALLOWED_RES.includes(quality) ? quality : '720p';

  try{
    const clips = [];
    for(const seg of segments){
      const hosted = [];
      for(const img of seg.images) hosted.push(await hostImage(img));
      const prompt = clipPrompt(stylePrompt, hosted.length);
      const falId = await falSubmit(MODELS.video, {
        prompt,
        image_urls: hosted,
        duration: dur,
        aspect_ratio: ar,
        resolution: q,
        generate_audio: true,
      });
      clips.push({
        cid: crypto.randomUUID(),
        falId,
        prompt,
        stylePrompt: String(stylePrompt || '').slice(0, 2000),
        images: hosted,
        poster: hosted[0].startsWith('data:') ? null : hosted[0],
        status: 'queued',
        video: null,
        locked: false,
      });
    }
    const project = {
      id: crypto.randomUUID(),
      email: s.email,
      name: String(name || '').trim().slice(0, 120) || 'Untitled walkthrough',
      duration: dur, aspect: ar, quality: q,
      music: music && music.url ? { name: String(music.name || 'Track').slice(0, 80), url: String(music.url) } : null,
      merged: null,
      mergedPending: null,
      clips,
      created: Date.now(),
    };
    const list = await loadProjects(s.email);
    list.unshift(project);
    await saveProjects(s.email, list);
    res.json({ id: project.id });
  }catch(err){
    res.status(502).json({ error: 'Could not start the render: ' + err.message });
  }
}
