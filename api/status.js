import { getSession } from '../lib/auth.js';
import { falGet, falSubmit, jobUrls, MODELS } from '../lib/fal.js';
import { archiveVideo } from '../lib/blob.js';
import { getProject, saveProjects } from '../lib/projects.js';

// Final-video pipeline: merge clips → (music) → (1080p upscale) → done.
async function nextMergePhase(project, currentUrl, justFinished){
  if(justFinished === 'video' && project.music?.url){
    const job = await falSubmit(MODELS.audio, { video_url: currentUrl, audio_url: project.music.url });
    return { phase: 'audio', ...job };
  }
  if(justFinished !== 'upscale' && project.quality === '1080p'){
    const job = await falSubmit(MODELS.upscale, { video_url: currentUrl, upscale_factor: 1.5 });
    return { phase: 'upscale', ...job };
  }
  return null; // done
}

export default async function handler(req, res){
  const s = getSession(req);
  if(!s) return res.status(401).json({ error: 'Not signed in' });
  const id = String(req.query?.id || '');
  if(!id) return res.status(400).json({ error: 'Missing id' });

  const { list, idx, project } = await getProject(s.email, id);
  if(!project) return res.status(404).json({ error: 'Unknown project' });

  let changed = false;
  try{
    // 1. Poll pending clips
    for(const clip of project.clips){
      if(clip.status !== 'queued' && clip.status !== 'in_progress') continue;
      const urls = jobUrls(MODELS.video, clip);
      const st = await falGet(urls.status);
      if(st.status === 'COMPLETED'){
        try{
          const out = await falGet(urls.result);
          clip.video = await archiveVideo(out.video?.url);
          clip.status = 'done';
        }catch{
          clip.status = 'failed';
        }
        changed = true;
      } else {
        const next = st.status === 'IN_PROGRESS' ? 'in_progress' : 'queued';
        if(next !== clip.status){ clip.status = next; changed = true; }
      }
    }
    // 2. Poll pending merge pipeline
    const mp = project.mergedPending;
    if(mp){
      const model = mp.phase === 'audio' ? MODELS.audio : mp.phase === 'upscale' ? MODELS.upscale : MODELS.merge;
      const urls = jobUrls(model, mp);
      const st = await falGet(urls.status);
      if(st.status === 'COMPLETED'){
        const out = await falGet(urls.result);
        const url = out.video?.url;
        const next = await nextMergePhase(project, url, mp.phase);
        if(next){
          project.mergedPending = next;
        } else {
          project.merged = await archiveVideo(url);
          project.mergedPending = null;
        }
        changed = true;
      }
    }
  }catch(err){
    // transient fal error — return current state, client keeps polling
  }
  if(changed){ list[idx] = project; await saveProjects(s.email, list); }

  const { email, ...pub } = project;
  res.json({ project: pub });
}
