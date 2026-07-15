// File hosting — Vercel Blob. Photos are hosted so Higgsfield can fetch them;
// finished videos are copied to Blob so they never expire.
import crypto from 'crypto';

const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export async function hostImage(dataUrl){
  const m = String(dataUrl || '').match(/^data:(image\/[\w+.-]+);base64,(.+)$/s);
  if(!m) throw new Error('Invalid image');
  const buf = Buffer.from(m[2], 'base64');
  if(buf.length > 6 * 1024 * 1024) throw new Error('Image too large');
  if(!hasBlob()) return dataUrl; // local dev fallback
  const { put } = await import('@vercel/blob');
  const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
  const r = await put(`photos/${crypto.randomUUID()}.${ext}`, buf, { access: 'public', contentType: m[1] });
  return r.url;
}

export async function archiveVideo(url){
  if(!hasBlob()) return url;
  try{
    const res = await fetch(url);
    if(!res.ok) return url;
    const buf = Buffer.from(await res.arrayBuffer());
    const { put } = await import('@vercel/blob');
    const r = await put(`videos/${crypto.randomUUID()}.mp4`, buf, { access: 'public', contentType: 'video/mp4' });
    return r.url;
  }catch{
    return url; // keep the original URL if archiving fails
  }
}
