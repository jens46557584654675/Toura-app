// Shared project helpers.
import { db } from './db.js';

export async function loadProjects(email){
  return (await db.get(`projects:${email}`)) || [];
}
export async function saveProjects(email, list){
  await db.set(`projects:${email}`, list.slice(0, 100));
}
export async function getProject(email, id){
  const list = await loadProjects(email);
  const idx = list.findIndex(p => p.id === id);
  return { list, idx, project: idx >= 0 ? list[idx] : null };
}

// Strip heavy/internal fields for the dashboard list.
export function publicProject(p){
  return {
    id: p.id, name: p.name, created: p.created, aspect: p.aspect,
    ready: p.clips.every(c => c.status === 'done' || c.status === 'failed'),
    clipCount: p.clips.length,
    poster: p.clips[0]?.poster || null,
    merged: p.merged || null,
  };
}
