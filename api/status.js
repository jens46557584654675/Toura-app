import { getSession } from '../lib/auth.js';
import { falGet, falSubmit, jobUrls, MODELS } from '../lib/fal.js';
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
    // 1. Poll pending clips (480p working versions AND 720p finalized versions)
    for(const clip of project.clips){
      const jobs = [];
      if(clip.status === 'queued' || clip.status === 'in_progress') jobs.push(clip);
      if(clip.final && (clip.final.status === 'queued' || clip.final.status === 'in_progress')) jobs.push(clip.final);
      for(const job of jobs){
        const urls = jobUrls(MODELS.video, job);
        const st = await falGet(urls.status);
        if(st.status === 'COMPLETED'){
          try{
            const out = await falGet(urls.result);
            job.video = await archiveVideo(out.video?.url);
            job.status = 'done';
          }catch{
            job.status = 'failed';
          }
          changed = true;
        } else {
          const next = st.status === 'IN_PROGRESS' ? 'in_progress' : 'queued';
          if(next !== job.status){ job.status = next; changed = true; }
        }
      }
    }
    // 2. Poll pending merge job → concept / final / export(audio)
    const mp = project.mergedPending;
    if(mp){
      const model = mp.phase === 'audio' ? MODELS.audio : MODELS.merge;
      const urls = jobUrls(model, mp);
      const st = await falGet(urls.status);
      if(st.status === 'COMPLETED'){
        const out = await falGet(urls.result);
        const url = await archiveVideo(out.video?.url);
        project.mergedPending = null;
        if(mp.phase === 'audio') project.export = url;
        else if(mp.phase === 'final') project.final = url;
        else if(mp.phase === 'outro'){
          // The outro is concatenated first; the soundtrack has to span the
          // result, so it is mixed in as a second job rather than the same one.
          if(project.music){
            const job = await falSubmit(MODELS.audio, { video_url: url, audio_url: project.music.url });
            project.mergedPending = { phase: 'audio', ...job };
            project.export = null;
          } else {
            project.export = url;
          }
        }
        else project.concept = url;
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
