// Higgsfield Cloud API — the ONLY place that touches the central API key.
// Users never see this; they just use Toura.
const HF_BASE  = process.env.HF_BASE  || 'https://platform.higgsfield.ai';
const HF_MODEL = process.env.HF_MODEL || 'higgsfield-ai/dop/standard';

export function hfConfigured(){
  return !!(process.env.HIGGSFIELD_API_KEY && process.env.HIGGSFIELD_API_SECRET);
}
function authHeader(){
  return `Key ${process.env.HIGGSFIELD_API_KEY}:${process.env.HIGGSFIELD_API_SECRET}`;
}

export async function submitVideo({ image_url, prompt, duration, aspect_ratio, resolution }){
  const r = await fetch(`${HF_BASE}/${HF_MODEL}`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ image_url, prompt, duration, aspect_ratio, resolution }),
  });
  if(!r.ok) throw new Error(`Higgsfield submit failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
  return r.json(); // { request_id, status_url, ... }
}

export async function jobStatus(id){
  const r = await fetch(`${HF_BASE}/requests/${encodeURIComponent(id)}/status`, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  if(!r.ok) throw new Error(`Higgsfield status failed (${r.status})`);
  return r.json(); // { status, video: { url }, ... }
}
