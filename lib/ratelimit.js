// Redis-backed rate limiting for the auth endpoints. Counters auto-expire via
// the db TTL, so old windows clean themselves up.
import { db } from './db.js';

const WINDOW = 15 * 60; // seconds
export const IP_LIMIT = Number(process.env.AUTH_IP_LIMIT || 20);   // auth requests per IP / 15 min
export const FAIL_LIMIT = Number(process.env.AUTH_FAIL_LIMIT || 5); // failed sign-ins per email / 15 min

export function clientIp(req){
  const xff = req.headers['x-forwarded-for'];
  if(xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// Increment a windowed counter; returns true while at/under the limit.
async function bump(key, limit){
  const now = Date.now();
  const rec = await db.get(key);
  let n, exp;
  if(rec && rec.exp > now){ n = rec.n + 1; exp = rec.exp; } else { n = 1; exp = now + WINDOW * 1000; }
  await db.set(key, { n, exp }, WINDOW);
  return n <= limit;
}

// Every auth request counts against the caller's IP.
export function ipGate(req){ return bump(`rl:ip:${clientIp(req)}`, IP_LIMIT); }

// Failed-sign-in counter per email (read, then hit only on an actual failure).
export async function failCount(email){
  const r = await db.get(`rl:fail:${email}`);
  return (r && r.exp > Date.now()) ? r.n : 0;
}
export function failHit(email){ return bump(`rl:fail:${email}`, FAIL_LIMIT); }
export function failReset(email){ return db.del(`rl:fail:${email}`); }

// Password-reset requests per email (separate, gentle limit).
export function resetGate(email){ return bump(`rl:reset:${email}`, FAIL_LIMIT); }
