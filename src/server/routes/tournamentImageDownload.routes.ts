import { Router } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import { createTournamentImageDownloadService } from '../services/tournamentImageDownload';

export function createTournamentImageDownloadRouters(service=createTournamentImageDownloadService()){
  const admin=Router(),download=Router();
  admin.post('/',requireAdmin,async(req,res)=>{
    try{res.setHeader('Cache-Control','private, no-store');res.json(await service.create(req.body?.pngBase64,req.body?.filename));}
    catch(error){const message=error instanceof Error?error.message:'';res.status(message.startsWith('INVALID_')?400:503).json({error:message.startsWith('INVALID_')?message:'IMAGE_EXPORT_UNAVAILABLE',message:'Rasmni saqlashga tayyorlab bo‘lmadi. Qayta urinib ko‘ring.'});}
  });
  download.get('/:token.png',async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Access-Control-Allow-Origin','https://web.telegram.org');
    try{const file=await service.get(req.params.token);if(!file){res.status(404).json({error:'IMAGE_EXPORT_EXPIRED'});return;}
      res.setHeader('Content-Type','image/png');res.setHeader('Content-Disposition',`attachment; filename="${file.filename}"`);
      res.setHeader('X-Content-Type-Options','nosniff');res.send(file.png);
    }catch{res.status(503).json({error:'IMAGE_EXPORT_UNAVAILABLE'});}
  });
  return {admin,download};
}
const routers=createTournamentImageDownloadRouters();
export const adminImageExportsRouter=routers.admin;
export const imageExportDownloadRouter=routers.download;
