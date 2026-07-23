// Fake Resend email API for local testing — records what would be sent.
import http from 'http';

const mails = [];

http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if(req.url === '/_mails') return send(200, { mails });
  if(req.method === 'POST' && req.url === '/emails'){
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { let p = {}; try{ p = JSON.parse(body || '{}'); }catch{} mails.push(p); send(200, { id: `test-${mails.length}` }); });
    return;
  }
  send(404, { error: 'not found' });
}).listen(9997, () => console.log('mail stub → http://localhost:9997'));
