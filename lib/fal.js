// fal.ai — the ONLY place that touches the central API key.
// Users never see this; they just use Toura.
const FAL_BASE = process.env.FAL_BASE || 'https://queue.fal.run';

export const MODELS = {
  video: process.env.FAL_MODEL || 'bytedance/seedance-2.0/fast/reference-to-video',
  merge: 'fal-ai/ffmpeg-api/merge-videos',
  audio: 'fal-ai/ffmpeg-api/merge-audio-video',
};

export function falConfigured(){
  return !!process.env.FAL_KEY;
}
const headers = () => ({
  Authorization: `Key ${process.env.FAL_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

export async function falSubmit(model, input){
  const r = await fetch(`${FAL_BASE}/${model}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(input),
  });
  if(!r.ok) throw new Error(`fal submit failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
  const data = await r.json(); // { request_id }
  if(!data.request_id) throw new Error('No request id returned');
  return data.request_id;
}

export async function falStatus(model, id){
  const r = await fetch(`${FAL_BASE}/${model}/requests/${encodeURIComponent(id)}/status`, { headers: headers() });
  if(!r.ok) throw new Error(`fal status failed (${r.status})`);
  return r.json(); // { status: IN_QUEUE | IN_PROGRESS | COMPLETED }
}

export async function falResult(model, id){
  const r = await fetch(`${FAL_BASE}/${model}/requests/${encodeURIComponent(id)}`, { headers: headers() });
  if(!r.ok) throw new Error(`fal result failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
  return r.json(); // { video: { url }, ... }
}

// Builds the per-clip prompt from the route (photo order) and the style prompt.
export function clipPrompt(style, imageCount){
  const refs = Array.from({ length: imageCount }, (_, i) => `@Image${i + 1}`);
  const route = imageCount === 1
    ? `a single continuous shot inside ${refs[0]}`
    : `one continuous single-shot walkthrough that starts at ${refs[0]} and moves smoothly through ${refs.slice(1).join(', then ')}, in this exact order`;
  const s = String(style || '').trim().replace(/@image(\d+)/gi, '@Image$1');
  return `Cinematic real estate video: ${route}. ${s || 'Calm, gimbal-smooth camera, warm natural light, eye-level, luxurious pacing.'} Use only the rooms, furniture and architecture visible in the source photos — no hallucinated objects, no people, no text overlays.`;
}
