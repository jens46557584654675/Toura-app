// Database — Upstash Redis (via Vercel KV/Upstash integration) with an
// in-memory fallback for local development (data is lost on restart).
const url   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const mem = (globalThis.__touraMem ??= new Map());
const memDb = {
  async get(k){ return mem.has(k) ? mem.get(k) : null; },
  async set(k, v){ mem.set(k, v); return 'OK'; },
  async del(k){ mem.delete(k); return 1; },
};

let real = null;
async function redis(){
  if(!real){
    const { Redis } = await import('@upstash/redis');
    real = new Redis({ url, token });
  }
  return real;
}

export const persistent = !!(url && token);
export const db = !persistent ? memDb : {
  async get(k){ return (await redis()).get(k); },
  async set(k, v){ return (await redis()).set(k, v); },
  async del(k){ return (await redis()).del(k); },
};
