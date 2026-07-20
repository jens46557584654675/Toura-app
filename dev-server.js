// Local development server — zero dependencies, mirrors how Vercel serves this
// project. Run: npm run dev  → http://localhost:3000
// Note: without KV/Blob env vars, data lives in memory (lost on restart).
import http from 'http';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ROUTES = {
  '/api/auth/signup':  './api/auth/signup.js',
  '/api/auth/signin':  './api/auth/signin.js',
  '/api/auth/signout': './api/auth/signout.js',
  '/api/auth/me':      './api/auth/me.js',
  '/api/projects':     './api/projects.js',
  '/api/generate':     './api/generate.js',
  '/api/status':       './api/status.js',
  '/api/project':      './api/project.js',
  '/api/music':        './api/music.js',
  '/api/branding':     './api/branding.js',
};
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

function wrap(res){
  res.status = (c)=>{ res.statusCode = c; return res; };
  res.json = (o)=>{ res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(o)); };
  return res;
}
function readBody(req){
  return new Promise((resolve, reject)=>{
    let data = '';
    let size = 0;
    req.on('data', c=>{
      size += c.length;
      if(size > 8*1024*1024){ reject(new Error('Body too large')); req.destroy(); return; }
      data += c;
    });
    req.on('end', ()=>{ try{ resolve(data ? JSON.parse(data) : {}); }catch{ resolve({}); } });
    req.on('error', reject);
  });
}

http.createServer(async (req, res)=>{
  wrap(res);
  const u = new URL(req.url, 'http://localhost');
  req.query = Object.fromEntries(u.searchParams);
  const mod = ROUTES[u.pathname];
  if(mod){
    try{
      if(req.method !== 'GET' && req.method !== 'HEAD') req.body = await readBody(req);
      const handler = (await import(mod)).default;
      await handler(req, res);
    }catch(err){
      console.error(err);
      if(!res.writableEnded) res.status(500).json({ error: 'Internal error: '+err.message });
    }
    return;
  }
  // static files from public/
  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  try{
    const file = await readFile(path.join(ROOT, 'public', path.normalize(p).replace(/^([.][.][/\\])+/, '')));
    res.setHeader('Content-Type', MIME[path.extname(p)] || 'application/octet-stream');
    res.end(file);
  }catch{
    res.status(404).end('Not found');
  }
}).listen(process.env.PORT || 3000, ()=>console.log(`toura dev server → http://localhost:${process.env.PORT || 3000}`));
