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

// Builds the per-clip prompt from the route (photo order) and the style prompt.
export function clipPrompt(style, imageCount){
  const refs = Array.from({ length: imageCount }, (_, i) => `@Image${i + 1}`);
  const route = imageCount === 1
    ? `a single continuous shot inside ${refs[0]}`
    : `one continuous single-shot walkthrough that starts at ${refs[0]} and moves smoothly through ${refs.slice(1).join(', then ')}, in this exact order`;
  const s = String(style || '').trim().replace(/@image(\d+)/gi, '@Image$1');
  return `Cinematic real estate video: ${route}. ${s || 'Calm, gimbal-smooth camera, warm natural light, eye-level, luxurious pacing.'} Use only the rooms, furniture and architecture visible in the source photos — no hallucinated objects, no people, no text overlays.`;
}
