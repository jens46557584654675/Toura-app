// fal.ai — Seedance 2.0. The ONLY place that touches the central API key.
// Users never see this; they just use Toura.
const FAL_BASE  = process.env.FAL_BASE  || 'https://queue.fal.run';
const FAL_MODEL = process.env.FAL_MODEL || 'bytedance/seedance-2.0/fast/reference-to-video';

export function falConfigured(){
  return !!process.env.FAL_KEY;
}
const headers = () => ({
  Authorization: `Key ${process.env.FAL_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

export async function submitVideo({ prompt, image_urls, duration, aspect_ratio, resolution }){
  const r = await fetch(`${FAL_BASE}/${FAL_MODEL}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      prompt,
      image_urls,
      duration: String(duration),
      aspect_ratio,
      resolution,
      generate_audio: true,
    }),
  });
  if(!r.ok) throw new Error(`fal submit failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
  return r.json(); // { request_id, ... }
}

export async function jobStatus(id){
  const r = await fetch(`${FAL_BASE}/${FAL_MODEL}/requests/${encodeURIComponent(id)}/status`, { headers: headers() });
  if(!r.ok) throw new Error(`fal status failed (${r.status})`);
  return r.json(); // { status: IN_QUEUE | IN_PROGRESS | COMPLETED }
}

export async function jobResult(id){
  const r = await fetch(`${FAL_BASE}/${FAL_MODEL}/requests/${encodeURIComponent(id)}`, { headers: headers() });
  if(!r.ok) throw new Error(`fal result failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
  return r.json(); // { video: { url }, seed }
}
