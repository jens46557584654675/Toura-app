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

export async function hostAudio(dataUrl){
  const m = String(dataUrl || '').match(/^data:(audio\/[\w+.-]+|video\/mp4);base64,(.+)$/s);
  if(!m) throw new Error('Invalid audio file — use MP3 or WAV');
  const buf = Buffer.from(m[2], 'base64');
  if(buf.length > 4 * 1024 * 1024) throw new Error('Audio too large (max 4 MB)');
  if(!hasBlob()) return dataUrl; // local dev fallback
  const ext = m[1].includes('wav') ? 'wav' : 'mp3';
  return putBlob(`music/${crypto.randomUUID()}.${ext}`, buf, m[1]);
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
