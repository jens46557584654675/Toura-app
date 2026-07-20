// File hosting — Vercel Blob. Photos/audio are hosted so fal can fetch them;
// finished videos are copied to Blob so they never expire.
import crypto from 'crypto';

const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

async function putBlob(path, buf, contentType){
  const { put } = await import('@vercel/blob');
  const r = await put(path, buf, { access: 'public', contentType });
  return r.url;
}

export async function hostImage(dataUrl){
  const s = String(dataUrl || '');
  if(/^https?:\/\//.test(s)) return s; // already hosted
  const m = s.match(/^data:(image\/[\w+.-]+);base64,(.+)$/s);
  if(!m) throw new Error('Invalid image');
  const buf = Buffer.from(m[2], 'base64');
  if(buf.length > 6 * 1024 * 1024) throw new Error('Image too large');
  if(!hasBlob()) return dataUrl; // local dev fallback
  const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
  return putBlob(`photos/${crypto.randomUUID()}.${ext}`, buf, m[1]);
}

// Uploads arrive as base64 data URLs in the request body, which inflates them by
// ~33%. Vercel caps a serverless request body at 4.5 MB, so a "4 MB" file would
// arrive as ~5.3 MB and be rejected before our code ever runs. 3 MB is the
// largest round number that still fits after inflation.
export const MAX_UPLOAD_MB = 3;
const MAX_UPLOAD = MAX_UPLOAD_MB * 1024 * 1024;

export async function hostAudio(dataUrl){
  const m = String(dataUrl || '').match(/^data:(audio\/[\w+.-]+|video\/mp4);base64,(.+)$/s);
  if(!m) throw new Error('Invalid audio file — use MP3 or WAV');
  const buf = Buffer.from(m[2], 'base64');
  if(buf.length > MAX_UPLOAD) throw new Error(`Audio too large (max ${MAX_UPLOAD_MB} MB) — try MP3 at 128-192 kbps`);
  if(!hasBlob()) return dataUrl; // local dev fallback
  const ext = m[1].includes('wav') ? 'wav' : 'mp3';
  return putBlob(`music/${crypto.randomUUID()}.${ext}`, buf, m[1]);
}

// Kantoor logo — PNG with transparency recommended so it sits cleanly on video.
export async function hostLogo(dataUrl){
  const m = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|jpg|webp|svg\+xml));base64,(.+)$/s);
  if(!m) throw new Error('Invalid logo — use PNG, JPG, WEBP or SVG');
  const buf = Buffer.from(m[2], 'base64');
  if(buf.length > 2 * 1024 * 1024) throw new Error('Logo too large (max 2 MB)');
  if(!hasBlob()) return dataUrl; // local dev fallback
  const ext = m[1].includes('svg') ? 'svg' : m[1].split('/')[1].replace('jpeg', 'jpg');
  return putBlob(`branding/${crypto.randomUUID()}.${ext}`, buf, m[1]);
}

// Short branding clip used as an outro; must be mp4 so ffmpeg can concat it.
export async function hostBrandingVideo(dataUrl){
  const m = String(dataUrl || '').match(/^data:(video\/mp4);base64,(.+)$/s);
  if(!m) throw new Error('Invalid video — use MP4');
  const buf = Buffer.from(m[2], 'base64');
  if(buf.length > MAX_UPLOAD) throw new Error(`Video too large (max ${MAX_UPLOAD_MB} MB) — keep the clip short`);
  if(!hasBlob()) return dataUrl; // local dev fallback
  return putBlob(`branding/${crypto.randomUUID()}.mp4`, buf, 'video/mp4');
}

export async function archiveAudio(url){
  if(!hasBlob() || !url) return url;
  try{
    const res = await fetch(url);
    if(!res.ok) return url;
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = url.includes('.mp3') ? 'mp3' : 'wav';
    return await putBlob(`music/${crypto.randomUUID()}.${ext}`, buf, ext === 'mp3' ? 'audio/mpeg' : 'audio/wav');
  }catch{
    return url;
  }
}

export async function archiveVideo(url){
  if(!hasBlob() || !url) return url;
  try{
    const res = await fetch(url);
    if(!res.ok) return url;
    const buf = Buffer.from(await res.arrayBuffer());
    return await putBlob(`videos/${crypto.randomUUID()}.mp4`, buf, 'video/mp4');
  }catch{
    return url; // keep the original URL if archiving fails
  }
}
