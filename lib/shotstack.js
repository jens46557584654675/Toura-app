// Shotstack — cloud video editing. Used only for the FINAL export when text or
// logo overlays are active (fal can't burn those in). Submit → poll, like fal.
// The central API key lives here; users never see it.
const BASE = process.env.SHOTSTACK_BASE || 'https://api.shotstack.io/edit';
const ENV = process.env.SHOTSTACK_ENV || 'v1'; // 'v1' = production (clean), 'stage' = sandbox (watermarked)

export function shotstackConfigured(){ return !!process.env.SHOTSTACK_API_KEY; }

const headers = () => ({
  'x-api-key': process.env.SHOTSTACK_API_KEY,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

// Submit an edit; returns { renderId, statusUrl }.
export async function shotstackSubmit(timeline, output){
  const r = await fetch(`${BASE}/${ENV}/render`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ timeline, output }),
  });
  if(!r.ok) throw new Error(`shotstack submit failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  const id = data.response?.id || data.id;
  if(!id) throw new Error('Shotstack returned no render id');
  return { renderId: id, statusUrl: `${BASE}/${ENV}/render/${id}` };
}

export async function shotstackGet(url){
  const r = await fetch(url, { headers: headers() });
  if(!r.ok) throw new Error(`shotstack status failed (${r.status})`);
  return r.json();
}

// Map our short position codes to Shotstack anchors + a small padding offset
// (Shotstack offset: x positive → right, y positive → up, as a fraction).
const ANCHOR = { tl: 'topLeft', tc: 'top', tr: 'topRight', bl: 'bottomLeft', bc: 'bottom', br: 'bottomRight' };
function textOffset(pos){
  const top = pos[0] === 't';
  const x = pos[1] === 'l' ? 0.05 : pos[1] === 'r' ? -0.05 : 0;
  return { x, y: top ? -0.06 : 0.06 };
}

function htmlEscape(s){ return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Build the Shotstack {timeline, output} for the whole export.
// clips: [{url, dur, cid}] in play order; intro/outro: {url, dur}|null;
// logoUrl + logoScale (1.0 = default);
// texts: [{text, pos, start, dur, font, scale}] — start/dur are seconds on the
//   whole timeline; font is a URL (custom font) or falsy (default sans);
// musicUrl; aspect '16:9'|'9:16'|'auto'.
export function buildShotstackEdit({ clips, intro, outro, logoUrl, logoScale, texts, musicUrl, aspect }){
  const out = aspect === '9:16' ? { w: 720, h: 1280 } : { w: 1280, h: 720 };
  const videoClips = [];
  let t = 0;
  // Intro plays first. Its real length may be unknown for legacy uploads → 5s.
  const introDur = intro ? (intro.dur || 5) : 0;
  if(intro){ videoClips.push({ asset: { type: 'video', src: intro.url }, start: 0, length: round(introDur) }); t = introDur; }
  for(const c of clips){
    videoClips.push({ asset: { type: 'video', src: c.url }, start: round(t), length: round(c.dur) });
    t += c.dur;
  }
  const clipsEnd = t;
  // The outro's real length is unknown for legacy uploads, so fall back to 'auto'.
  if(outro) videoClips.push({ asset: { type: 'video', src: outro.url }, start: round(t), length: outro.dur ? round(outro.dur) : 'auto' });

  const overlay = [];
  if(logoUrl){
    const scale = 0.13 * (Number(logoScale) || 1);
    // Logo covers ONLY the clips region — not the intro or the outro.
    overlay.push({ asset: { type: 'image', src: logoUrl }, start: round(introDur), length: round(clipsEnd - introDur), position: 'bottomRight', offset: { x: -0.06, y: 0.06 }, scale });
  }
  // Text is rendered as an HTML asset: this is the reliable way to embed a
  // custom (uploaded) font via @font-face and to draw the text with NO box —
  // just a soft drop shadow for legibility. Default font = a websafe sans.
  for(const tx of texts || []){
    if(!tx.text || !(tx.dur > 0)) continue;
    const size = Math.round((out.h / 17) * (Number(tx.scale) || 1));
    const align = tx.pos[1] === 'c' ? 'center' : tx.pos[1] === 'r' ? 'right' : 'left';
    const fam = tx.font ? "'tf'" : 'Arial, Helvetica, sans-serif';
    const face = tx.font ? `@font-face{font-family:'tf';src:url('${tx.font}');}` : '';
    const css = `${face}div{margin:0;color:#ffffff;font-weight:700;font-size:${size}px;line-height:1.2;text-align:${align};font-family:${fam};text-shadow:0 2px 6px rgba(0,0,0,.6),0 0 3px rgba(0,0,0,.5);}`;
    overlay.push({
      asset: { type: 'html', html: `<div>${htmlEscape(tx.text)}</div>`, css, width: Math.round(out.w * 0.86), height: Math.round(out.h * 0.4) },
      start: round(tx.start || 0),
      length: round(tx.dur),
      position: ANCHOR[tx.pos] || 'bottomLeft',
      offset: textOffset(tx.pos),
    });
  }

  const tracks = [];
  if(overlay.length) tracks.push({ clips: overlay }); // higher track renders on top
  tracks.push({ clips: videoClips });

  const timeline = { tracks };
  if(musicUrl) timeline.soundtrack = { src: musicUrl, effect: 'fadeOut' };

  const output = { format: 'mp4', resolution: 'hd', aspectRatio: aspect === '9:16' ? '9:16' : '16:9' };
  return { timeline, output };
}

const round = n => Math.round((Number(n) || 0) * 100) / 100;
