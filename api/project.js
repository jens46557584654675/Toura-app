import crypto from 'crypto';
import { getSession } from '../lib/auth.js';
import { falConfigured, falSubmit, clipPrompt, clampDuration, MODELS } from '../lib/fal.js';
import { hostImage } from '../lib/blob.js';
import { getProject, saveProjects } from '../lib/projects.js';

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const s = getSession(req);
  if(!s) return res.status(401).json({ error: 'Not signed in' });
  const { id, action } = req.body || {};
  const { list, idx, project } = await getProject(s.email, String(id || ''));
  if(!project) return res.status(404).json({ error: 'Unknown project' });
  const renderRes = project.quality === '1080p' ? '720p' : project.quality;

  try{
    if(action === 'reorder'){
      const order = req.body.order;
      if(!Array.isArray(order) || order.length !== project.clips.length) return res.status(400).json({ error: 'Bad order' });
      const byId = Object.fromEntries(project.clips.map(c => [c.cid, c]));
      if(order.some(cid => !byId[cid])) return res.status(400).json({ error: 'Bad order' });
      project.clips = order.map(cid => byId[cid]);
      project.merged = null; // order changed → final video is stale

    } else if(action === 'lock'){
      const clip = project.clips.find(c => c.cid === req.body.cid);
      if(!clip) return res.status(404).json({ error: 'Unknown clip' });
      clip.locked = !!req.body.locked;

    } else if(action === 'regenerate'){
      if(!falConfigured()) return res.status(503).json({ error: 'Rendering not configured.' });
      const clip = project.clips.find(c => c.cid === req.body.cid);
      if(!clip) return res.status(404).json({ error: 'Unknown clip' });
      if(clip.locked) return res.status(400).json({ error: 'This clip is locked.' });
      const style = req.body.stylePrompt != null ? String(req.body.stylePrompt).slice(0, 2000) : clip.stylePrompt;
      const pacing = ['slow','normal','fast'].includes(req.body.pacing) ? req.body.pacing : (clip.pacing || 'normal');
      const dur = req.body.duration != null ? clampDuration(req.body.duration) : (clip.duration || project.duration);
      // Optionally replace the clip's photos (route was changed)
      if(Array.isArray(req.body.images) && req.body.images.length){
        if(req.body.images.length > 9) return res.status(400).json({ error: 'Up to 9 photos per clip.' });
        const hosted = [];
        for(const img of req.body.images) hosted.push(await hostImage(img));
        clip.images = hosted;
        clip.poster = hosted[0].startsWith('data:') ? null : hosted[0];
      }
      clip.stylePrompt = style;
      clip.pacing = pacing;
      clip.duration = dur;
      clip.prompt = clipPrompt(style, clip.images.length, pacing);
      const job = await falSubmit(MODELS.video, {
        prompt: clip.prompt,
        image_urls: clip.images,
        duration: dur,
        aspect_ratio: project.aspect,
        resolution: renderRes,
        generate_audio: !project.music,
      });
      clip.falId = job.falId; clip.statusUrl = job.statusUrl; clip.resultUrl = job.resultUrl;
      clip.status = 'queued';
      clip.video = null;
      project.merged = null;

    } else if(action === 'addclip'){
      if(!falConfigured()) return res.status(503).json({ error: 'Rendering not configured.' });
      const images = req.body.images;
      if(!Array.isArray(images) || images.length < 1) return res.status(400).json({ error: 'No photos provided.' });
      if(images.length > 9) return res.status(400).json({ error: 'Up to 9 photos per clip.' });
      if(project.clips.length >= 8) return res.status(400).json({ error: 'Max 8 clips per walkthrough.' });
      const hosted = [];
      for(const img of images) hosted.push(await hostImage(img));
      const style = req.body.stylePrompt != null ? String(req.body.stylePrompt).slice(0, 2000) : (project.clips[0]?.stylePrompt || '');
      const pacing = ['slow','normal','fast'].includes(req.body.pacing) ? req.body.pacing : 'normal';
      const dur = req.body.duration != null ? clampDuration(req.body.duration) : project.duration;
      const prompt = clipPrompt(style, hosted.length, pacing);
      const job = await falSubmit(MODELS.video, {
        prompt,
        image_urls: hosted,
        duration: dur,
        aspect_ratio: project.aspect,
        resolution: renderRes,
        generate_audio: !project.music,
      });
      project.clips.push({
        cid: crypto.randomUUID(),
        falId: job.falId, statusUrl: job.statusUrl, resultUrl: job.resultUrl,
        prompt, stylePrompt: style, pacing, duration: dur,
        images: hosted,
        poster: hosted[0].startsWith('data:') ? null : hosted[0],
        status: 'queued', video: null, locked: false,
      });
      project.merged = null;

    } else if(action === 'removeclip'){
      const i = project.clips.findIndex(c => c.cid === req.body.cid);
      if(i < 0) return res.status(404).json({ error: 'Unknown clip' });
      project.clips.splice(i, 1);
      project.merged = null;
      if(!project.clips.length){
        list.splice(idx, 1);
        await saveProjects(s.email, list);
        return res.json({ ok: true, deleted: true });
      }

    } else if(action === 'music'){
      const m = req.body.music;
      project.music = m && m.url ? { name: String(m.name || 'Track').slice(0, 80), url: String(m.url) } : null;
      project.merged = null;

    } else if(action === 'merge'){
      if(!falConfigured()) return res.status(503).json({ error: 'Rendering not configured.' });
      const videos = project.clips.filter(c => c.status === 'done' && c.video).map(c => c.video);
      if(videos.length < 1) return res.status(400).json({ error: 'No finished clips to combine.' });
      project.merged = null;
      if(videos.length > 1){
        const job = await falSubmit(MODELS.merge, { video_urls: videos });
        project.mergedPending = { phase: 'video', ...job };
      } else if(project.music){
        const job = await falSubmit(MODELS.audio, { video_url: videos[0], audio_url: project.music.url });
        project.mergedPending = { phase: 'audio', ...job };
      } else if(project.quality === '1080p'){
        const job = await falSubmit(MODELS.upscale, { video_url: videos[0], upscale_factor: 1.5 });
        project.mergedPending = { phase: 'upscale', ...job };
      } else {
        project.merged = videos[0];
      }

    } else if(action === 'delete'){
      list.splice(idx, 1);
      await saveProjects(s.email, list);
      return res.json({ ok: true });

    } else if(action === 'rename'){
      project.name = String(req.body.name || '').trim().slice(0, 120) || project.name;

    } else {
      return res.status(400).json({ error: 'Unknown action' });
    }

    list[idx] = project;
    await saveProjects(s.email, list);
    const { email, ...pub } = project;
    res.json({ project: pub });
  }catch(err){
    res.status(502).json({ error: err.message });
  }
}
