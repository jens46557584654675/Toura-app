import crypto from 'crypto';
import { getSession } from '../lib/auth.js';
import { falConfigured, falSubmit, clipPrompt, clampDuration, renderCost, RENDER_BUDGET, MODELS } from '../lib/fal.js';
import { hostImage } from '../lib/blob.js';
import { introOutroFor } from '../lib/branding.js';
import { shotstackConfigured, shotstackSubmit, buildShotstackEdit } from '../lib/shotstack.js';
import { getProject, saveProjects } from '../lib/projects.js';

const isAdmin = email => email && email === String(process.env.ADMIN_EMAIL || '').toLowerCase();
// A clip changed → its merges are stale
const clearVideo = (p) => { p.concept = null; p.final = null; p.export = null; };

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const s = getSession(req);
  if(!s) return res.status(401).json({ error: 'Not signed in' });
  const { id, action } = req.body || {};
  const { list, idx, project } = await getProject(s.email, String(id || ''));
  if(!project) return res.status(404).json({ error: 'Unknown project' });
  const renderRes = '480p'; // working clips always render at 480p
  // Internal cost budget per project (euros, never shown to users)
  const checkBudget = (cost) => {
    if(isAdmin(s.email)) return null;
    if(((project.spend || 0) + cost) > RENDER_BUDGET) return 'This project has reached its render limit. Contact Toura to extend it.';
    return null;
  };
  const addSpend = (cost) => {
    project.spend = (project.spend || 0) + cost;
    project.renders = (project.renders || 0) + 1;
  };
  const clipVideo = c => (c.final?.status === 'done' && c.final.video) ? c.final.video : c.video;

  try{
    if(action === 'reorder'){
      const order = req.body.order;
      if(!Array.isArray(order) || order.length !== project.clips.length) return res.status(400).json({ error: 'Bad order' });
      const byId = Object.fromEntries(project.clips.map(c => [c.cid, c]));
      if(order.some(cid => !byId[cid])) return res.status(400).json({ error: 'Bad order' });
      const before = project.clips.map(c => c.cid).join(',');
      project.clips = order.map(cid => byId[cid]);
      if(before !== order.join(',')) clearVideo(project);

    } else if(action === 'regenerate'){
      if(!falConfigured()) return res.status(503).json({ error: 'Rendering not configured.' });
      const clip = project.clips.find(c => c.cid === req.body.cid);
      if(!clip) return res.status(404).json({ error: 'Unknown clip' });
      const style = req.body.stylePrompt != null ? String(req.body.stylePrompt).slice(0, 2000) : clip.stylePrompt;
      const dur = req.body.duration != null ? clampDuration(req.body.duration) : (clip.duration || project.duration);
      const cost = renderCost(dur, renderRes);
      const budgetErr = checkBudget(cost);
      if(budgetErr) return res.status(402).json({ error: budgetErr });
      if(Array.isArray(req.body.images) && req.body.images.length){
        if(req.body.images.length > 9) return res.status(400).json({ error: 'Up to 9 photos per clip.' });
        const hosted = [];
        for(const img of req.body.images) hosted.push(await hostImage(img));
        clip.images = hosted;
        clip.poster = hosted[0].startsWith('data:') ? null : hosted[0];
      }
      clip.stylePrompt = style;
      clip.duration = dur;
      clip.prompt = clipPrompt(style, clip.images.length);
      const job = await falSubmit(MODELS.video, {
        prompt: clip.prompt,
        image_urls: clip.images,
        duration: dur,
        aspect_ratio: project.aspect,
        resolution: renderRes,
        generate_audio: false,
      });
      clip.falId = job.falId; clip.statusUrl = job.statusUrl; clip.resultUrl = job.resultUrl;
      clip.res = renderRes;
      clip.status = 'queued';
      clip.video = null;
      clip.final = null; // clip changed → old finalized version is stale
      clearVideo(project);
      addSpend(cost);

    } else if(action === 'finalize'){
      if(!falConfigured()) return res.status(503).json({ error: 'Rendering not configured.' });
      const clip = project.clips.find(c => c.cid === req.body.cid);
      if(!clip) return res.status(404).json({ error: 'Unknown clip' });
      if(clip.status !== 'done' || !clip.video) return res.status(400).json({ error: 'Render the clip first.' });
      if(clip.final && (clip.final.status === 'queued' || clip.final.status === 'in_progress')) return res.status(400).json({ error: 'Already finalizing.' });
      if(clip.final && clip.final.status === 'done' && !req.body.force){
        // Already finalized and unchanged — nothing to render, nothing to pay.
        const { email, ...pubSame } = project;
        return res.json({ project: pubSame });
      }
      const cost = renderCost(clip.duration, '720p');
      const budgetErr = checkBudget(cost);
      if(budgetErr) return res.status(402).json({ error: budgetErr });
      const job = await falSubmit(MODELS.video, {
        prompt: clip.prompt,
        image_urls: clip.images,
        duration: clip.duration,
        aspect_ratio: project.aspect,
        resolution: '720p',
        generate_audio: false,
      });
      clip.final = { ...job, status: 'queued', video: null, res: '720p' };
      project.final = null; project.export = null;
      addSpend(cost);

    } else if(action === 'addclip'){
      if(!falConfigured()) return res.status(503).json({ error: 'Rendering not configured.' });
      const images = req.body.images;
      if(!Array.isArray(images) || images.length < 1) return res.status(400).json({ error: 'No photos provided.' });
      if(images.length > 9) return res.status(400).json({ error: 'Up to 9 photos per clip.' });
      if(project.clips.length >= 12) return res.status(400).json({ error: 'Max 12 clips per walkthrough.' });
      const hosted = [];
      for(const img of images) hosted.push(await hostImage(img));
      const style = req.body.stylePrompt != null ? String(req.body.stylePrompt).slice(0, 2000) : '';
      const dur = req.body.duration != null ? clampDuration(req.body.duration) : project.duration;
      const cost = renderCost(dur, renderRes);
      const budgetErr = checkBudget(cost);
      if(budgetErr) return res.status(402).json({ error: budgetErr });
      const prompt = clipPrompt(style, hosted.length);
      const job = await falSubmit(MODELS.video, {
        prompt,
        image_urls: hosted,
        duration: dur,
        aspect_ratio: project.aspect,
        resolution: renderRes,
        generate_audio: false,
      });
      project.clips.push({
        cid: crypto.randomUUID(),
        falId: job.falId, statusUrl: job.statusUrl, resultUrl: job.resultUrl,
        prompt, stylePrompt: style, duration: dur, res: renderRes,
        images: hosted,
        poster: hosted[0].startsWith('data:') ? null : hosted[0],
        status: 'queued', video: null, final: null, locked: false,
      });
      clearVideo(project);
      addSpend(cost);

    } else if(action === 'removeclip'){
      const i = project.clips.findIndex(c => c.cid === req.body.cid);
      if(i < 0) return res.status(404).json({ error: 'Unknown clip' });
      project.clips.splice(i, 1);
      clearVideo(project);
      if(!project.clips.length){
        list.splice(idx, 1);
        await saveProjects(s.email, list);
        return res.json({ ok: true, deleted: true });
      }

    } else if(action === 'music'){
      const m = req.body.music;
      project.music = m && m.url ? { name: String(m.name || 'Track').slice(0, 80), url: String(m.url) } : null;
      project.export = null; // soundtrack changed → export is stale

    } else if(action === 'edit'){
      // Video-editor choices: texts + logo (burned in on export via Shotstack),
      // plus introId/outroId and music which are stored on the project itself.
      const e = req.body.edit || {};
      const POS = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];
      const texts = Array.isArray(e.texts) ? e.texts.slice(0, 10).map(t => ({
        text: String(t.text || '').slice(0, 120),
        pos: POS.includes(t.pos) ? t.pos : 'bl',
        clips: Array.isArray(t.clips) ? t.clips.filter(c => typeof c === 'string').slice(0, 50) : [],
      })).filter(t => t.text) : [];
      const music = e.music && e.music.url ? { name: String(e.music.name || 'Track').slice(0, 80), url: String(e.music.url) } : null;
      const logoScale = Math.min(2, Math.max(0.5, Number(e.logoScale) || 1));
      project.edit = { texts, logo: !!e.logo, logoScale, music };
      if('introId' in e) project.introId = e.introId ? String(e.introId) : null;
      if('outroId' in e) project.outroId = e.outroId ? String(e.outroId) : null;
      project.music = music;
      project.export = null; // edits changed → export is stale

    } else if(action === 'merge'){
      // kind 'concept' = merge the 480p working clips (cheap check)
      // kind 'final'   = merge the finalized 720p clips
      if(!falConfigured()) return res.status(503).json({ error: 'Rendering not configured.' });
      const kind = req.body.kind === 'final' ? 'final' : 'concept';
      if(project.mergedPending) return res.status(400).json({ error: 'A video is already building.' });
      let videos;
      if(kind === 'concept'){
        videos = project.clips.filter(c => c.status === 'done' && c.video).map(c => c.video);
      } else {
        const missing = project.clips.filter(c => !(c.final?.status === 'done' && c.final.video));
        if(missing.length) return res.status(400).json({ error: `${missing.length} clip(s) are not finalized in 720p yet.` });
        videos = project.clips.map(c => c.final.video);
      }
      if(videos.length < 1) return res.status(400).json({ error: 'No finished clips to combine.' });
      if(videos.length === 1){
        project[kind] = videos[0];
        project.export = null;
      } else {
        const job = await falSubmit(MODELS.merge, { video_urls: videos });
        project.mergedPending = { phase: kind, ...job };
        project[kind] = null;
        project.export = null;
      }

    } else if(action === 'branding'){
      // Toggles only — the actual outro/logo files live per user, not per project.
      project.branding = project.branding || { outro: false, logo: false };
      if(req.body.outro != null) project.branding.outro = !!req.body.outro;
      if(req.body.logo != null) project.branding.logo = !!req.body.logo;
      project.export = null; // branding changed → export is stale

    } else if(action === 'export'){
      // Builds the downloadable video. Per clip it takes the 720p final when that
      // exists, else the 480p working version. Two routes, chosen automatically:
      //  - Shotstack when text/logo overlays are active — it burns them in.
      //  - fal (merge + music) otherwise — cheaper, no overlays. Never a new render.
      if(project.mergedPending) return res.status(400).json({ error: 'A video is already building.' });
      const videos = project.clips.filter(c => clipVideo(c)).map(clipVideo);
      if(!videos.length) return res.status(400).json({ error: 'Render your clips first.' });
      if(videos.length !== project.clips.length) return res.status(400).json({ error: 'Some clips are still rendering.' });

      const { intro, outro, logo } = await introOutroFor(s.email, project);
      const wantLogo = !!(project.edit?.logo && logo?.url);
      const texts = (project.edit?.texts || []).filter(t => t.text && t.clips?.length);
      const overlaysActive = wantLogo || texts.length > 0;

      if(overlaysActive && shotstackConfigured()){
        // Real overlays → Shotstack renders the whole timeline (intro + clips +
        // outro + logo + text + music) in one job.
        const clipItems = project.clips.map(c => ({ url: clipVideo(c), dur: Number(c.duration) || 8, cid: c.cid }));
        const edit = buildShotstackEdit({
          clips: clipItems,
          intro: intro || null,
          outro: outro || null,
          logoUrl: wantLogo ? logo.url : null,
          logoScale: project.edit?.logoScale || 1,
          texts,
          musicUrl: project.music?.url || null,
          aspect: project.aspect,
        });
        const job = await shotstackSubmit(edit.timeline, edit.output);
        project.mergedPending = { phase: 'shotstack', ...job };
        project.export = null;
      } else {
        // fal fallback (cheaper, no overlays): concat intro + clips + outro, then music.
        const parts = [...(intro ? [intro.url] : []), ...videos, ...(outro ? [outro.url] : [])];
        if(parts.length > 1){
          if(!falConfigured()) return res.status(503).json({ error: 'Rendering not configured.' });
          // index 0 = the first listing clip decides the output shape; without this
          // the merge takes min width AND min height across inputs, which can
          // produce an aspect ratio matching neither clip.
          const job = await falSubmit(MODELS.merge, {
            video_urls: parts,
            resolution_aspect_ratio_video_index: 0,
          });
          project.mergedPending = { phase: 'export', ...job };
          project.export = null;
        } else if(!project.music){
          project.export = parts[0];
        } else {
          if(!falConfigured()) return res.status(503).json({ error: 'Rendering not configured.' });
          const job = await falSubmit(MODELS.audio, { video_url: parts[0], audio_url: project.music.url });
          project.mergedPending = { phase: 'audio', ...job };
          project.export = null;
        }
      }

    } else if(action === 'delete'){
      list.splice(idx, 1);
      await saveProjects(s.email, list);
      return res.json({ ok: true });

    } else if(action === 'rename'){
      project.name = String(req.body.name || '').trim().slice(0, 120) || project.name;

    } else if(action === 'lock'){
      const clip = project.clips.find(c => c.cid === req.body.cid);
      if(!clip) return res.status(404).json({ error: 'Unknown clip' });
      clip.locked = !!req.body.locked;

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
