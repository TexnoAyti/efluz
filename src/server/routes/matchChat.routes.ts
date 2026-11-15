import {Router} from 'express';
import {z} from 'zod';
import {requireAuth} from '../middleware/authMiddleware';
import {listMatchChatReports,MatchChatError,readMatchChat,readMatchChatAvatar,reportMatchChat,resolveMatchChatReport,sendMatchChatMessage,pinMatchChatMessage,setMatchChatAdminBlock,setMatchChatBlock} from '../services/matchChatService';
import type {MatchChatKind} from '../../types/matchChat';

export const matchChatRouter=Router();
const target=z.object({kind:z.enum(['fixture','uzeflife']),matchId:z.string().min(1).max(180)});
const fail=(res:any,e:any)=>res.status(e instanceof MatchChatError?e.statusCode:503).json({ok:false,error:e instanceof MatchChatError?e.message:'Chat vaqtincha ishlamayapti. Qayta urinib ko‘ring.',code:e?.code});
matchChatRouter.use(requireAuth);
matchChatRouter.get('/reports',async(req,res)=>{try{res.json({ok:true,reports:await listMatchChatReports(req.user!)});}catch(e){fail(res,e);}});
matchChatRouter.post('/reports/:roomId/:reportId/resolve',async(req,res)=>{try{await resolveMatchChatReport(req.user!,req.params.roomId,req.params.reportId);res.json({ok:true});}catch(e){fail(res,e);}});
matchChatRouter.post('/reports/:roomId/block',async(req,res)=>{try{const body=z.object({blocked:z.boolean()}).parse(req.body);await setMatchChatAdminBlock(req.user!,req.params.roomId,body.blocked);res.json({ok:true});}catch(e){fail(res,e);}});
matchChatRouter.get('/:kind/:matchId/avatar/:side',async(req,res)=>{
  try{
    const p=target.extend({side:z.enum(['me','opponent'])}).parse(req.params);
    const result=await readMatchChatAvatar(p.kind as MatchChatKind,p.matchId,req.user!,p.side);
    if(!result){res.status(404).setHeader('Cache-Control','private, max-age=30').end();return;}
    res.setHeader('Content-Type',result.contentType);
    res.setHeader('Cache-Control','private, max-age=300');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.status(200).end(result.bytes);
  }catch(e){fail(res,e);}
});
matchChatRouter.get('/:kind/:matchId',async(req,res)=>{try{const p=target.parse(req.params);res.json({ok:true,chat:await readMatchChat(p.kind as MatchChatKind,p.matchId,req.user!)});}catch(e){fail(res,e);}});
matchChatRouter.post('/:kind/:matchId/messages',async(req,res)=>{try{const p=target.parse(req.params);res.json({ok:true,chat:await sendMatchChatMessage(p.kind as MatchChatKind,p.matchId,req.user!,req.body?.text,req.body?.replyToId)});}catch(e){fail(res,e);}});
matchChatRouter.post('/:kind/:matchId/pin',async(req,res)=>{try{const p=target.parse(req.params);res.json({ok:true,chat:await pinMatchChatMessage(p.kind as MatchChatKind,p.matchId,req.user!,req.body?.messageId||null)});}catch(e){fail(res,e);}});
matchChatRouter.post('/:kind/:matchId/block',async(req,res)=>{try{const p=target.parse(req.params),body=z.object({blocked:z.boolean()}).parse(req.body);res.json({ok:true,chat:await setMatchChatBlock(p.kind as MatchChatKind,p.matchId,req.user!,body.blocked)});}catch(e){fail(res,e);}});
matchChatRouter.post('/:kind/:matchId/report',async(req,res)=>{try{const p=target.parse(req.params);res.json({ok:true,chat:await reportMatchChat(p.kind as MatchChatKind,p.matchId,req.user!,req.body?.reason)});}catch(e){fail(res,e);}});
