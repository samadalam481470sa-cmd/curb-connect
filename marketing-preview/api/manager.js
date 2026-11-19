import {createHash,timingSafeEqual} from 'node:crypto';
const expected=Buffer.from('1f81c0b2827b2c9c3e2fc8d5061ec807ce4eae0fe9c4706349186b63036a947c','hex');
export default function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
 const key=req.body&&typeof req.body.key==='string'?req.body.key:'';
 if(key.length>100||key.length<20)return res.status(401).json({error:'Invalid manager key'});
 const given=createHash('sha256').update(key).digest();
 if(!timingSafeEqual(given,expected))return res.status(401).json({error:'Invalid manager key'});
 return res.status(200).json({authenticated:true,notice:'Manager preview unlocked. No privileged actions are enabled.'});
}