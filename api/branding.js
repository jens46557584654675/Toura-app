// Kantoor branding: upload / preview / remove the logo and the outro clips.
import { getSession } from '../lib/auth.js';
import { getBranding, saveBranding } from '../lib/branding.js';
import { hostLogo, hostBrandingVideo } from '../lib/blob.js';

export default async function handler(req, res){
  const s = getSession(req);
  if(!s) return res.status(401).json({ error: 'Not signed in' });

  if(req.method === 'GET'){
    return res.json({ branding: await getBranding(s.email) });
  }
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const branding = await getBranding(s.email);
  const { action } = req.body || {};
  const variant = () => (req.body.variant === 'portrait' ? 'portrait' : 'landscape');

  try{
    if(action === 'logo'){
      branding.logo = {
        url: await hostLogo(req.body.data),
        name: String(req.body.name || 'Logo').slice(0, 80),
      };

    } else if(action === 'video'){
      branding.videos[variant()] = {
        url: await hostBrandingVideo(req.body.data),
        name: String(req.body.name || 'Branding video').slice(0, 80),
      };

    } else if(action === 'removeLogo'){
      branding.logo = null;

    } else if(action === 'removeVideo'){
      branding.videos[variant()] = null;

    } else {
      return res.status(400).json({ error: 'Unknown action' });
    }
  }catch(err){
    return res.status(400).json({ error: err.message || 'Upload failed' });
  }

  await saveBranding(s.email, branding);
  res.json({ branding });
}
