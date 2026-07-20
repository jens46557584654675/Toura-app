// Per-user kantoor branding: logo + a short outro clip per orientation.
// Stored in Redis as branding:{email}; the files themselves live on Vercel Blob.
import { db } from './db.js';

// Old records may predate a field, so always read through the normaliser.
export function normalizeBranding(b){
  return {
    logo: b?.logo || null,
    videos: {
      landscape: b?.videos?.landscape || null,
      portrait: b?.videos?.portrait || null,
    },
  };
}

export async function getBranding(email){
  return normalizeBranding(await db.get(`branding:${email}`));
}

export async function saveBranding(email, branding){
  await db.set(`branding:${email}`, branding);
}

// A 9:16 project needs the portrait clip; everything else uses landscape.
// Concatenating the wrong orientation would letterbox or stretch the outro.
export function variantForAspect(aspect){
  return String(aspect || '') === '9:16' ? 'portrait' : 'landscape';
}

// The outro URL for this project, or null when branding is off or the matching
// orientation was never uploaded.
export async function outroFor(email, project){
  if(!project.branding?.outro) return null;
  const b = await getBranding(email);
  return b.videos[variantForAspect(project.aspect)]?.url || null;
}
