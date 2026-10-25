import {Router,type RequestHandler} from 'express';
import {beginAndroidLogin,androidLoginStatus,completeAndroidLogin,logoutAndroid} from '../services/androidAuth';
export const androidAuthRouter=Router();
const run=(handler:(req:any,res:any)=>Promise<any>):RequestHandler=>async(req,res)=>{res.setHeader('Cache-Control','private, no-store');res.setHeader('Pragma','no-cache');try{res.json(await handler(req,res));}catch(e:any){res.status(e.statusCode||503).json({success:false,error:e.statusCode?e.message:'Kirishni hozir yakunlab bo‘lmadi. Qayta urinib ko‘ring.'});}};
androidAuthRouter.post('/start',run(beginAndroidLogin));
androidAuthRouter.get('/status',run(androidLoginStatus));
androidAuthRouter.post('/complete',run(completeAndroidLogin));
androidAuthRouter.post('/logout',run(logoutAndroid));
