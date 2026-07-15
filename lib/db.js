// Database — supports three modes, picked automatically:
// 1. Upstash REST  (KV_REST_API_URL + KV_REST_API_TOKEN)
// 2. Redis via URL (KV_REDIS_URL or REDIS_URL — e.g. Vercel Redis)
// 3. In-memory fallback for local development (data lost on restart)
const restUrl   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const restToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redisUrl  = process.env.KV_REDIS_URL      || process.env.REDIS_URL;

const mem = (globalThis.__touraMem ??= new Map());
const memDb = {
  async get(k){ return mem.has(k) ? mem.get(k) : null; },
  async set(k, v){ mem.set(k, v); return 'OK'; },
  async del(k){ mem.delete(k); return 1; },
};

let upstash = null;
async function getUpstash(){
  if(!upstash){
    const { Redis } = await import('@upstash/redis');
    upstash = new Redis({ url: restUrl, token: restToken });
  }
  return upstash;
}

async function getRedis(){
  // Reuse one connection across invocations (globalThis survives warm starts)
  if(!globalThis.__touraRedis){
    const { createClient } = await import('redis');
    const client = createClient({ url: redisUrl });
    client.on('error', (e)=>console.error('redis error', e.message));
    await client.connect();
    globalThis.__touraRedis = client;
  }
  return globalThis.__touraRedis;
}

export const persistent = !!((restUrl && restToken) || redisUrl);

export const db =
  restUrl && restToken ? {
    async get(k){ return (await getUpstash()).get(k); },
    async set(k, v){ return (await getUpstash()).set(k, v); },
    async del(k){ return (await getUpstash()).del(k); },
  } :
  redisUrl ? {
    async get(k){ const v = await (await getRedis()).get(k); return v == null ? null : JSON.parse(v); },
    async set(k, v){ return (await getRedis()).set(k, JSON.stringify(v)); },
    async del(k){ return (await getRedis()).del(k); },
  } :
  memDb;
