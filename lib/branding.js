// Per-user kantoor branding: a logo + named INTRO and OUTRO clips. Each intro/
// outro is { id, name, videos:{landscape, portrait} }; a variant is {url, dur}.
// Stored in Redis as branding:{email}; the files live on Vercel Blob.
import crypto from 'crypto';
import { db } from './db.js';

function normVariant(v){
  if(!v || !v.url) return null;
  const dur = Number(v.dur);
  return { url: String(v.url), dur: dur > 0 ? dur : null };
}
function normItem(it){
  return {
    id: String(it?.id || crypto.randomUUID()),
    name: String(it?.name || 'Clip').slice(0, 80),
    videos: { landscape: normVariant(it?.videos?.landscape), portrait: normVariant(it?.videos?.portrait) },
  };
}

// Always read through this — it also migrates the OLD single-video model
// (branding.videos:{landscape,portrait}) into the first outro named "Outro".
function normFont(f){
  return { id: String(f?.id || crypto.randomUUID()), name: String(f?.name || 'Font').slice(0, 60), url: String(f?.url || '') };
}
export function normalizeBranding(b){
  const intros = Array.isArray(b?.intros) ? b.intros.map(normItem) : [];
  let outros = Array.isArray(b?.outros) ? b.outros.map(normItem) : [];
  if(!Array.isArray(b?.outros) && (b?.videos?.landscape || b?.videos?.portrait)){
    outros = [ normItem({ id: 'outro', name: 'Outro', videos: b.videos }) ];
  }
  const fonts = Array.isArray(b?.fonts) ? b.fonts.map(normFont).filter(f => f.url) : [];
  return { logo: b?.logo || null, intros, outros, fonts };
}

export async function getBranding(email){
  return normalizeBranding(await db.get(`branding:${email}`));
}
export async function saveBranding(email, branding){
  await db.set(`branding:${email}`, branding);
}

// A 9:16 project needs the portrait clip; everything else uses landscape.
export function variantForAspect(aspect){
  return String(aspect || '') === '9:16' ? 'portrait' : 'landscape';
}

export function findItem(list, id){ return (list || []).find(x => x.id === id) || null; }

function pickVariant(item, aspect){
  if(!item) return null;
  const v = item.videos[variantForAspect(aspect)];
  return v && v.url ? v : null;
}

// Resolve a project's chosen intro/outro to {url, dur} for its aspect, plus the
// logo. Back-compat: a project that had the old branding.outro flag on but no
// outroId yet maps to the first outro so its exports keep the outro.
export async function introOutroFor(email, project){
  const b = await getBranding(email);
  const introId = project.introId ?? null;
  let outroId = project.outroId;
  if(outroId === undefined) outroId = (project.branding?.outro && b.outros[0]) ? b.outros[0].id : null;
  return {
    intro: pickVariant(findItem(b.intros, introId), project.aspect),
    outro: pickVariant(findItem(b.outros, outroId), project.aspect),
    logo: b.logo,
    fonts: b.fonts,
  };
}
