// Fake Shotstack edit API for local testing (no credits used).
// Mirrors the real submit → poll flow: POST /{env}/render, GET /{env}/render/{id}.
import http from 'http';
import crypto from 'crypto';

const jobs = new Map();   // id → { created }
const calls = [];         // every submitted edit, so tests can assert what we sent

http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if(req.url === '/_calls') return send(200, { calls });
  if(!req.headers['x-api-key']) return send(401, { success: false, message: 'missing key' });

  const statusMatch = req.url.match(/\/render\/([\w-]+)$/);

  if(req.method === 'POST' && req.url.endsWith('/render')){
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let parsed = {};
      try{ parsed = JSON.parse(body || '{}'); }catch{}
      if(!parsed.timeline || !Array.isArray(parsed.timeline.tracks)) return send(400, { success: false, message: 'timeline.tracks required' });
      const id = crypto.randomUUID();
      jobs.set(id, { created: Date.now() });
      calls.push({ timeline: parsed.timeline, output: parsed.output });
      send(201, { success: true, message: 'Created', response: { id, message: 'Render Successfully Queued' } });
    });
    return;
  }
  if(req.method === 'GET' && statusMatch){
    const job = jobs.get(statusMatch[1]);
    if(!job) return send(404, { success: false, message: 'not found' });
    const age = Date.now() - job.created;
    const status = age < 1000 ? 'queued' : age < 2500 ? 'rendering' : 'done';
    const response = { status };
    if(status === 'done') response.url = `https://example.com/shotstack-${statusMatch[1].slice(0, 8)}.mp4`;
    return send(200, { success: true, response });
  }
  send(404, { success: false, message: 'not found' });
}).listen(9998, () => console.log('shotstack stub → http://localhost:9998'));
