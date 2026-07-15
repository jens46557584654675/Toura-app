// Fake Higgsfield server for local testing (no credits used).
// Run with: node test/hf-stub.js  → then start dev server with HF_BASE=http://localhost:9999
import http from 'http';
import crypto from 'crypto';

const jobs = new Map();

http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(obj)); };
  if(req.method === 'POST' && !req.url.includes('/requests/')){
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const id = crypto.randomUUID();
      jobs.set(id, { created: Date.now() });
      send(200, { status:'queued', request_id:id, status_url:`http://localhost:9999/requests/${id}/status` });
    });
    return;
  }
  const m = req.url.match(/\/requests\/([\w-]+)\/status/);
  if(m){
    const job = jobs.get(m[1]);
    if(!job) return send(404, { error:'unknown job' });
    const age = Date.now() - job.created;
    if(age < 4000)  return send(200, { status:'queued', request_id:m[1] });
    if(age < 10000) return send(200, { status:'in_progress', request_id:m[1] });
    return send(200, { status:'completed', request_id:m[1], video:{ url:'https://example.com/fake-walkthrough.mp4' } });
  }
  send(404, { error:'not found' });
}).listen(9999, () => console.log('Higgsfield stub → http://localhost:9999'));
