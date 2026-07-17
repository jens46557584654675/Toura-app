import crypto from 'crypto';
import { getSession } from '../lib/auth.js';
import { falConfigured, falSubmit, clipPrompt, clampDuration, renderCost, RENDER_BUDGET, MODELS } from '../lib/fal.js';
import { hostImage } from '../lib/blob.js';
import { loadProjects, saveProjects } from '../lib/projects.js';

const ALLOWED_ASPECTS = ['auto','16:9','9:16','1:1','4:3','3:4','21:9'];
const ALLOWED_QUALITY = ['480p','720p','1080p'];

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
  const dur = clampDuration(duration);
  const ar  = ALLOWED_ASPECTS.includes(aspect) ? aspect : 'auto';
  const q   = ALLOWED_QUALITY.includes(quality) ? quality : '1080p';
  // Working clips always render at 480p; finalizing a clip re-renders it at 720p.
  const renderRes = '480p';
  const hasMusic = !!(music && music.url);

  try{
    const clips = [];
    for(const seg of segments){
      const hosted = [];
      for(const img of seg.images) hosted.push(await hostImage(img));
      const segStyle = String(seg.prompt ?? stylePrompt ?? '').slice(0, 2000);
      const segDur = seg.duration != null ? clampDuration(seg.duration) : dur;
      const prompt = clipPrompt(segStyle, hosted.length);
      const job = await falSubmit(MODELS.video, {
        prompt,
        image_urls: hosted,
        duration: segDur,
        aspect_ratio: ar,
        resolution: renderRes,
        // Clips are always silent — music is added on the final video.
        generate_audio: false,
      });
      clips.push({
        cid: crypto.randomUUID(),
        falId: job.falId, statusUrl: job.statusUrl, resultUrl: job.resultUrl,
        prompt,
        stylePrompt: segStyle,
        duration: segDur,
        res: renderRes,
        images: hosted,
        poster: hosted[0].startsWith('data:') ? null : hosted[0],
        status: 'queued',
        video: null,
        locked: false,
      });
    }
    const project = {
      renders: clips.length,
      spend: clips.reduce((t, c) => t + renderCost(c.duration, c.res), 0),
      id: crypto.randomUUID(),
      email: s.email,
      name: String(name || '').trim().slice(0, 120) || 'Untitled walkthrough',
      duration: dur, aspect: ar, quality: q,
      music: hasMusic ? { name: String(music.name || 'Track').slice(0, 80), url: String(music.url) } : null,
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
