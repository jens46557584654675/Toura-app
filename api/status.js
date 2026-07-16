import { db } from '../lib/db.js';
import { getSession } from '../lib/auth.js';
import { jobStatus, jobResult } from '../lib/fal.js';
import { archiveVideo } from '../lib/blob.js';

export default async function handler(req, res){
  const s = getSession(req);
  if(!s) return res.status(401).json({ error: 'Not signed in' });
  const id = String(req.query?.id || '');
  if(!id) return res.status(400).json({ error: 'Missing id' });

  const job = await db.get(`job:${id}`);
  if(!job) return res.status(404).json({ error: 'Unknown job' });
  if(job.email !== s.email) return res.status(403).json({ error: 'Not your job' });
  if(job.done) return job.failed
    ? res.json({ status: 'failed', error: job.error || 'The render failed.' })
    : res.json({ status: 'completed', project: job.project });

  try{
    const st = await jobStatus(id);
    if(st.status === 'COMPLETED'){
      let out;
      try{
        out = await jobResult(id);
      }catch(err){
        await db.set(`job:${id}`, { ...job, done: true, failed: true, error: 'The render failed — please try again.' });
        return res.json({ status: 'failed', error: 'The render failed — please try again.' });
      }
      const video = await archiveVideo(out.video?.url);
      const project = {
        id,
        name: job.name,
        meta: (job.duration === 'auto' ? 'Ready' : `0:${String(job.duration).padStart(2, '0')} · Ready`),
        video,
        poster: job.poster,
        aspect: job.aspect,
        ready: true,
        created: job.created,
      };
      const list = (await db.get(`projects:${s.email}`)) || [];
      list.unshift(project);
      await db.set(`projects:${s.email}`, list.slice(0, 200));
      await db.set(`job:${id}`, { ...job, done: true, project });
      return res.json({ status: 'completed', project });
    }
    res.json({ status: st.status === 'IN_PROGRESS' ? 'in_progress' : 'queued' });
  }catch(err){
    res.status(502).json({ error: 'Status check failed: ' + err.message });
  }
}
