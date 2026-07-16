import { getSession } from '../lib/auth.js';
import { falStatus, falResult, falSubmit, MODELS } from '../lib/fal.js';
import { archiveVideo } from '../lib/blob.js';
import { getProject, saveProjects } from '../lib/projects.js';

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
      const st = await falStatus(MODELS.video, clip.falId);
      if(st.status === 'COMPLETED'){
        try{
          const out = await falResult(MODELS.video, clip.falId);
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
    // 2. Poll pending merge
    const mp = project.mergedPending;
    if(mp){
      const model = mp.phase === 'audio' ? MODELS.audio : MODELS.merge;
      const st = await falStatus(model, mp.falId);
      if(st.status === 'COMPLETED'){
        const out = await falResult(model, mp.falId);
        const url = out.video?.url;
        if(mp.phase === 'video' && project.music?.url){
          // Video merged — now lay the music underneath
          const falId = await falSubmit(MODELS.audio, { video_url: url, audio_url: project.music.url });
          project.mergedPending = { phase: 'audio', falId };
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
