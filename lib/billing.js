// Subscriptions. No payment provider yet — choosing a plan only records the
// choice so the rest of the app can already read it.
// Kept in its own Redis key rather than on user:{email}, so billing writes can
// never clobber the password hash stored there.
import { db } from './db.js';

// The ONLY place in the app where prices exist. Never surface them elsewhere.
export const PLANS = [
  { id: 'starter', name: 'Starter', price: 49,  videos: 1,  blurb: 'One property video per month.' },
  { id: 'office',  name: 'Office',  price: 199, videos: 5,  blurb: 'Five property videos per month.' },
  { id: 'pro',     name: 'Pro',     price: 449, videos: 15, blurb: 'Fifteen property videos per month, plus team access.' },
];

export const isPlan = id => PLANS.some(p => p.id === id);

export function normalizeSubscription(s){
  return {
    plan: isPlan(s?.plan) ? s.plan : null,
    status: s?.status || 'trial',
    since: s?.since || null,
  };
}

export async function getSubscription(email){
  return normalizeSubscription(await db.get(`billing:${email}`));
}

export async function saveSubscription(email, sub){
  await db.set(`billing:${email}`, sub);
}
