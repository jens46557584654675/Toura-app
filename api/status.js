import { db } from '../lib/db.js';
import { getSession } from '../lib/auth.js';
import { jobStatus } from '../lib/hf.js';
import { archiveVideo } from '../lib/blob.js';

export default async function handler(req, res){
  const s = getSession(req);
  if(!s) return res.status(401).json({ error: 'Not signed in' });
  const id = String(req.query?.id || '');
  if(!id) return res.status(400).json({ error: 'Missing id' });

  const job = await db.get(`job:${id}`);
  if(!job) return res.status(404).json({ error: 'Unknown job' });
  if(job.email !== s.email) return res.status(403).json({ error: 'Not your job' });
  if(job.done) return res.json({ status: 'completed', project: job.project });

  try{
    const st = await jobStatus(id);
    if(st.status === 'completed'){
      const video = await archiveVideo(st.video?.url);
      const project = {
        id,
        name: job.name,
        meta: `0:${String(job.duration).padStart(2, '0')} · Ready`,
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
    if(st.status === 'failed' || st.status === 'nsfw'){
      await db.set(`job:${id}`, { ...job, done: true, failed: true });
      return res.json({ status: 'failed', error: st.status === 'nsfw' ? 'The photo was rejected by moderation.' : 'The render failed. Credits were refunded — please try again.' });
    }
    res.json({ status: st.status }); // queued | in_progress
  }catch(err){
    res.status(502).json({ error: 'Status check failed: ' + err.message });
  }
}
