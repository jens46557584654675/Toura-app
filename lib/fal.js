// fal.ai — the ONLY place that touches the central API key.
// Users never see this; they just use Toura.
const FAL_BASE = process.env.FAL_BASE || 'https://queue.fal.run';

export const MODELS = {
  video: process.env.FAL_MODEL || 'bytedance/seedance-2.0/fast/reference-to-video',
  merge: 'fal-ai/ffmpeg-api/merge-videos',
  audio: 'fal-ai/ffmpeg-api/merge-audio-video',
  music: 'fal-ai/lyria2',
  upscale: 'fal-ai/topaz/upscale/video',
};

export function falConfigured(){
  return !!process.env.FAL_KEY;
}
const headers = () => ({
  Authorization: `Key ${process.env.FAL_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

// Submits a job and returns { falId, statusUrl, resultUrl }.
// IMPORTANT: fal's queue lives at the BASE app id (e.g. bytedance/seedance-2.0),
// NOT the full endpoint path — so we always keep the URLs fal returns.
export async function falSubmit(model, input){
  const r = await fetch(`${FAL_BASE}/${model}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(input),
  });
  if(!r.ok) throw new Error(`fal submit failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  if(!data.request_id) throw new Error('No request id returned');
  return {
    falId: data.request_id,
    statusUrl: data.status_url || `${FAL_BASE}/${baseApp(model)}/requests/${data.request_id}/status`,
    resultUrl: data.response_url || `${FAL_BASE}/${baseApp(model)}/requests/${data.request_id}`,
  };
}

function baseApp(model){ return model.split('/').slice(0, 2).join('/'); }

// Fallback URL derivation for jobs stored before statusUrl was saved.
export function jobUrls(model, job){
  return {
    status: job.statusUrl || `${FAL_BASE}/${baseApp(model)}/requests/${job.falId}/status`,
    result: job.resultUrl || `${FAL_BASE}/${baseApp(model)}/requests/${job.falId}`,
  };
}

export async function falGet(url){
  const r = await fetch(url, { headers: headers() });
  if(!r.ok) throw new Error(`fal request failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

// Builds the per-clip prompt in three layers:
// 1. the route (photo order), 2. the user's optional clip description,
// 3. the Toura base prompt — always appended, never shown to users.
const TOURA_BASE_PROMPT =
  'You are filming one continuous cinematic shot for a real-estate marketing video, seen from the perspective of a potential buyer calmly walking through the home. The camera moves at a slow, natural walking pace and follows realistic walking routes only — across open floor, through doorways and hallways. Never fly over or through furniture, kitchen islands, counters, walls or any other objects, and never take physically impossible paths, unless the clip description explicitly asks for it. Give every room a calm, generous overview before moving on — let each space breathe. Move from photo to photo strictly in the given order, with no cuts and no transitions. Use ONLY the rooms, furniture, materials and architecture visible in the source photos — never invent, add, remove or alter anything; stay true to the real proportions, colors and lighting of the home. Steady gimbal-smooth camera at eye level, straight verticals, warm true-to-life color grading. The result must look beautiful, calm and premium — ready for professional property marketing. No people, no on-screen text, no logos, no warping, no flickering, no hallucinated details. Deliver the clip completely silent: no music, no voice-over, no ambient audio.';

// Internal render-cost accounting (never shown to users).
const RATES = { '480p': 0.14, '720p': 0.28 }; // € per rendered second
export function renderCost(duration, res){
  const secs = parseInt(duration, 10) || 8;
  return secs * (RATES[res] || RATES['720p']);
}
export const RENDER_BUDGET = parseFloat(process.env.TOURA_BUDGET_EUR || '45');

export function clipPrompt(style, imageCount){
  const refs = Array.from({ length: imageCount }, (_, i) => `@Image${i + 1}`);
  const route = imageCount === 1
    ? `Cinematic real estate video: a single continuous shot inside ${refs[0]}.`
    : `Cinematic real estate video: start at ${refs[0]} and move smoothly through ${refs.slice(1).join(', then ')}, in this exact order.`;
  const userPart = String(style || '').trim().replace(/@image(\d+)/gi, '@Image$1');
  return [route, userPart, TOURA_BASE_PROMPT].filter(Boolean).join(' ');
}

// Clamp a requested clip length (2-15 in the UI) to what Seedance supports (4-15).
export function clampDuration(v){
  const n = Math.round(Number(v));
  if(!Number.isFinite(n)) return '10';
  return String(Math.min(15, Math.max(4, n)));
}
