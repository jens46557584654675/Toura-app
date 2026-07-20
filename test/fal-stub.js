// Fake fal.ai queue server for local testing (no credits used).
// Handles Seedance video jobs AND the ffmpeg merge endpoints.
import http from 'http';
import crypto from 'crypto';

const jobs = new Map(); // id → {created, kind}

const calls = []; // every submitted job, so tests can assert what fal was asked to do

http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(obj)); };
  // Introspection for the e2e suite — before the auth check, it is not a fal route.
  if(req.url === '/_calls') return send(200, { calls });
  if(!req.headers.authorization?.startsWith('Key ')) return send(401, { error:'missing key' });

  const statusMatch = req.url.match(/\/requests\/([\w-]+)\/status$/);
  const resultMatch = req.url.match(/\/requests\/([\w-]+)$/);

  if(req.method === 'POST' && !req.url.includes('/requests/')){
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      const isMergeVideos = req.url.includes('merge-videos');
      const isMergeAudio = req.url.includes('merge-audio-video');
      // merge-videos takes minItems:2 upstream — reject a single url like fal does.
      if(isMergeVideos && !(Array.isArray(parsed.video_urls) && parsed.video_urls.length >= 2)) return send(422, { error:'video_urls requires at least 2 items' });
      if(isMergeAudio && !(parsed.video_url && parsed.audio_url)) return send(422, { error:'video_url and audio_url required' });
      if(!isMergeVideos && !isMergeAudio && (!parsed.prompt || !Array.isArray(parsed.image_urls))) return send(422, { error:'prompt and image_urls required' });
      const id = crypto.randomUUID();
      const kind = isMergeVideos ? 'merge' : isMergeAudio ? 'audio' : 'video';
      jobs.set(id, { created: Date.now(), kind });
      calls.push({ kind, url: req.url, input: parsed });
      send(200, { status:'IN_QUEUE', request_id:id });
    });
    return;
  }
  if(statusMatch){
    const job = jobs.get(statusMatch[1]);
    if(!job) return send(404, { error:'unknown job' });
    const age = Date.now() - job.created;
    const t1 = job.kind === 'video' ? 3000 : 1000;
    const t2 = job.kind === 'video' ? 7000 : 2500;
    if(age < t1) return send(200, { status:'IN_QUEUE' });
    if(age < t2) return send(200, { status:'IN_PROGRESS' });
    return send(200, { status:'COMPLETED' });
  }
  if(resultMatch){
    const job = jobs.get(resultMatch[1]);
    if(!job) return send(404, { error:'unknown job' });
    return send(200, { video:{ url:`https://example.com/fake-${job.kind}-${resultMatch[1].slice(0,8)}.mp4` }, seed: 42 });
  }
  send(404, { error:'not found' });
}).listen(9999, () => console.log('fal stub → http://localhost:9999'));
