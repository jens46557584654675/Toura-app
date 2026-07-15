// Auth — scrypt password hashing + HMAC-signed session cookie. No external deps.
import crypto from 'crypto';

const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const COOKIE = 'toura_session';
const MAX_AGE = 30 * 24 * 60 * 60; // 30 days

export function hashPassword(pw){
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
export function verifyPassword(pw, stored){
  const [salt, hash] = String(stored || '').split(':');
  if(!salt || !hash) return false;
  const check = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), check);
}

function sign(body){
  return crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}
export function signToken(payload){
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + MAX_AGE * 1000 })).toString('base64url');
  return `${body}.${sign(body)}`;
}
export function verifyToken(t){
  if(!t) return null;
  const [body, sig] = String(t).split('.');
  if(!body || !sig) return null;
  const good = sign(body);
  const a = Buffer.from(sig), b = Buffer.from(good);
  if(a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try{
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if(!p.exp || p.exp < Date.now()) return null;
    return p;
  }catch{ return null; }
}

export function getSession(req){
  const m = (req.headers.cookie || '').match(new RegExp(`${COOKIE}=([^;]+)`));
  return verifyToken(m?.[1]);
}
export function setSession(res, payload){
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${signToken(payload)}; HttpOnly; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`);
}
export function clearSession(res){
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}
