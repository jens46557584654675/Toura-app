import { getSession } from '../lib/auth.js';
import { PLANS, isPlan, getSubscription, saveSubscription } from '../lib/billing.js';

export default async function handler(req, res){
  const s = getSession(req);
  if(!s) return res.status(401).json({ error: 'Not signed in' });

  if(req.method === 'GET'){
    return res.json({ plans: PLANS, subscription: await getSubscription(s.email) });
  }
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, plan } = req.body || {};
  if(action !== 'choose') return res.status(400).json({ error: 'Unknown action' });
  if(!isPlan(plan)) return res.status(400).json({ error: 'Unknown plan' });

  // TODO(payments): this is where the Stripe/Mollie checkout session gets
  // created. Redirect the user to the hosted checkout, and only mark the
  // subscription active from the provider's webhook — never from this handler,
  // because the client can call it directly. Until then the choice is recorded
  // as 'pending' so nothing reads it as a paid subscription.
  const sub = { plan, status: 'pending', since: Date.now() };
  await saveSubscription(s.email, sub);
  res.json({ subscription: sub });
}
