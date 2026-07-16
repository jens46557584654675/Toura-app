import { getSession } from '../lib/auth.js';
import { falConfigured, falSubmit, clipPrompt, MODELS } from '../lib/fal.js';
import { getProject, saveProjects } from '../lib/projects.js';

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const s = getSession(req);
  if(!s) return res.status(401).json({ error: 'Not signed in' });
  const { id, action } = req.body || {};
  const { list, idx, project } = await getProject(s.email, String(id || ''));
  if(!project) return res.status(404).json({ error: 'Unknown project' });

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
      clip.stylePrompt = style;
      clip.prompt = clipPrompt(style, clip.images.length);
      const job = await falSubmit(MODELS.video, {
        prompt: clip.prompt,
        image_urls: clip.images,
        duration: project.duration,
        aspect_ratio: project.aspect,
        resolution: project.quality,
        generate_audio: true,
      });
      clip.falId = job.falId;
      clip.statusUrl = job.statusUrl;
      clip.resultUrl = job.resultUrl;
      clip.status = 'queued';
      clip.video = null;
      project.merged = null;

    } else if(action === 'music'){
      const m = req.body.music;
      project.music = m && m.url ? { name: String(m.name || 'Track').slice(0, 80), url: String(m.url) } : null;
      project.merged = null;

    } else if(action === 'merge'){
      if(!falConfigured()) return res.status(503).json({ error: 'Rendering not configured.' });
      const videos = project.clips.filter(c => c.status === 'done' && c.video).map(c => c.video);
      if(videos.length < 1) return res.status(400).json({ error: 'No finished clips to combine.' });
      if(videos.length === 1 && !project.music){
        project.merged = videos[0];
      } else if(videos.length === 1 && project.music){
        const job = await falSubmit(MODELS.audio, { video_url: videos[0], audio_url: project.music.url });
        project.mergedPending = { phase: 'audio', ...job };
        project.merged = null;
      } else {
        const job = await falSubmit(MODELS.merge, { video_urls: videos });
        project.mergedPending = { phase: 'video', ...job };
        project.merged = null;
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
