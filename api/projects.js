import { getSession } from '../lib/auth.js';
import { loadProjects, publicProject } from '../lib/projects.js';

export default async function handler(req, res){
  const s = getSession(req);
  if(!s) return res.status(401).json({ error: 'Not signed in' });
  const projects = (await loadProjects(s.email)).map(publicProject);
  res.json({ projects });
}
