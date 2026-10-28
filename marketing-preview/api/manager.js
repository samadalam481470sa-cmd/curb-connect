import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
const digest = '1f81c0b2827b2c9c3e2fc8d5061ec807ce4eae0fe9c4706349186b63036a947c';
const secret = Buffer.from(digest,'hex');
const sha = (s) => createHash('sha256').update(s).digest();
const cookie = 'fieldpro_manager';
const signed = (exp) => exp + '.' + createHmac('sha256',secret).update(String(exp)).digest('hex');
function authorized(req) {
 const c=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(x=>x.startsWith(cookie+'='));
 if(!c)return false;
 const token=decodeURIComponent(c.slice(cookie.length+1));const p=token.split('.');
 if(p.length!==2 || !/^\d+$/.test(p[0]) || Number(p[0])<Date.now())return false;
 const expected=signed(p[0]).split('.')[1];
 return /^[a-f0-9]{64}$/.test(p[1])&&timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(p[1],'hex'));
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method==='GET')return res.status(200).json({authenticated:authorized(req)});
 if(req.method==='DELETE'){res.setHeader('Set-Cookie',cookie+'=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');return res.status(200).json({authenticated:false});}
 if(req.method!=='POST'){res.setHeader('Allow','GET, POST, DELETE');return res.status(405).json({error:'Method not allowed'});}
 const key=(typeof req.body==='object'&&req.body!==null?req.body.key:'')||'';
 if(typeof key!=='string'||key.length>150)return res.status(401).json({error:'Invalid management key'});
 const hash=sha(key);
 if(!timingSafeEqual(hash,secret))return res.status(401).json({error:'Invalid management key'});
 const exp=Date.now()+60*60*1000;
 res.setHeader('Set-Cookie',cookie+'='+signed(exp)+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600');
 return res.status(200).json({authenticated:true});
}