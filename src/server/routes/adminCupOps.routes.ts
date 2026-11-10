import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import {canUseDangerZone} from '../../lib/adminPermissions';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';
import {
  adminApproveFixtureResultFirestore,
  reopenFixtureFirestore,
} from '../firebase/firestoreStore';
import {
  getDomesticCupBracketHealth,
  reconcileDomesticCupBracketSafe,
  reconcileDomesticCupSourceFixture,
  setDomesticCupRoundStateSafe,
  advanceDomesticCupRoundSafe,
} from '../tournament/domesticCupRoundOps';
import { DOMESTIC_CUPS, advanceDomesticCupWinnerSafe } from '../tournament/domesticCupService';
import {getSeasonOneSupercupPreview,createSeasonOneSupercup,controlSeasonOneSupercupRound} from '../tournament/seasonOneSupercupService';
import {getSeasonOneEuropeanOverview,replaceSeasonOneEuropeanRoster,finalizeSeasonOneEuropeanManualRoster,publishSeasonOneEuropeanDraw,createSeasonOneEuropeanKnockout,openSeasonOneEuropeanRound,archiveUnplayedLegacyEuropeanDraw} from '../tournament/seasonOneEuropeanOperations';
import { refreshChangedFixtureReadModel, invalidateFixtureReadModels } from '../readModel/readModelStore';

export const adminCupOpsRouter = Router();
adminCupOpsRouter.use(requireAdmin);

// First-season UCL and UEL: no conference league, no second-season takeover.
adminCupOpsRouter.get('/season-one/european/:competitionId/overview',async(req:Request,res:Response)=>{
 if(!canUseDangerZone(req.user)){res.status(403).json({error:'Global administrator required.'});return;}
 try{
  res.setHeader('Cache-Control','no-store');
  res.json(await getSeasonOneEuropeanOverview(req.params.competitionId));
 }catch(err:any){res.status(400).json({error:err.message});}
});
// Global-admin-only, one-time recovery: only completely unplayed legacy fixtures.
adminCupOpsRouter.post('/season-one/european/:competitionId/archive-unplayed-legacy',async(req:Request,res:Response)=>{
 if(!canUseDangerZone(req.user)){res.status(403).json({error:'Global administrator required.'});return;}
 if(req.body?.confirmation!==true||typeof req.body?.previewToken!=='string'){
  res.status(400).json({error:'Explicit confirmation and previewToken are required.'});return;
 }
 try{
  res.setHeader('Cache-Control','no-store');
  res.json(await archiveUnplayedLegacyEuropeanDraw(req.params.competitionId,{
   confirmation:true,previewToken:req.body.previewToken,adminUserId:req.user!.id
  }));
 }catch(err:any){res.status(409).json({error:err.message});}
});
adminCupOpsRouter.post('/season-one/european/:competitionId/roster',async(req:Request,res:Response)=>{
 if(!canUseDangerZone(req.user)){res.status(403).json({error:'Global administrator required.'});return;}
 if(req.body?.confirmation!==true||typeof req.body?.previewToken!=='string'||!Array.isArray(req.body?.clubIds)){
  res.status(400).json({error:'confirmation, previewToken and clubIds required.'});return;
 }
 try{
  res.setHeader('Cache-Control','no-store');
  res.json(await replaceSeasonOneEuropeanRoster(req.params.competitionId,{
   confirmation:true,previewToken:req.body.previewToken,clubIds:req.body.clubIds,adminUserId:req.user!.id
  }));
 }catch(err:any){res.status(409).json({error:err.message});}
});
adminCupOpsRouter.post('/season-one/european/:competitionId/manual-finalize',async(req:Request,res:Response)=>{
 if(!canUseDangerZone(req.user)){res.status(403).json({error:'Global administrator required.'});return;}
 if(req.body?.confirmation!==true||typeof req.body?.previewToken!=='string'){
  res.status(400).json({error:'Explicit confirmation and previewToken are required.'});return;
 }
 try{
  res.setHeader('Cache-Control','no-store');
  res.json(await finalizeSeasonOneEuropeanManualRoster(req.params.competitionId,{
   confirmation:true,previewToken:req.body.previewToken,adminUserId:req.user!.id
  }));
 }catch(err:any){res.status(409).json({error:err.message});}
});
adminCupOpsRouter.post('/season-one/european/:competitionId/draw',async(req:Request,res:Response)=>{
 if(!canUseDangerZone(req.user)){res.status(403).json({error:'Global administrator required.'});return;}
 if(req.body?.confirmation!==true||typeof req.body?.previewToken!=='string'){
  res.status(400).json({error:'Explicit confirmation and previewToken are required.'});return;
 }
 try{
  res.setHeader('Cache-Control','no-store');
  res.json(await publishSeasonOneEuropeanDraw(req.params.competitionId,{
    confirmation:true,previewToken:req.body.previewToken
  }));
 }catch(err:any){res.status(409).json({error:err.message});}
});
adminCupOpsRouter.post('/season-one/european/:competitionId/knockout',async(req:Request,res:Response)=>{
 if(!canUseDangerZone(req.user)){res.status(403).json({error:'Global administrator required.'});return;}
 if(req.body?.confirmation!==true||typeof req.body?.previewToken!=='string'){
  res.status(400).json({error:'Explicit confirmation and previewToken required.'});return;
 }
 try{
  res.setHeader('Cache-Control','no-store');
  res.json(await createSeasonOneEuropeanKnockout(req.params.competitionId,{
    confirmation:true,previewToken:req.body.previewToken
  }));
 }catch(err:any){res.status(409).json({error:err.message});}
});
adminCupOpsRouter.post('/season-one/european/:competitionId/next-round',async(req:Request,res:Response)=>{
 if(!canUseDangerZone(req.user)){res.status(403).json({error:'Global administrator required.'});return;}
 const {nextMatchday,expectedUpdatedAt,durationHours}=req.body||{};
 if(!Number.isSafeInteger(nextMatchday)||!Number.isFinite(durationHours)||
    durationHours<=0||durationHours>720||
    !(expectedUpdatedAt===null||typeof expectedUpdatedAt==='string')){
  res.status(400).json({error:'Valid nextMatchday, expectedUpdatedAt and durationHours required.'});return;
 }
 try{
  res.setHeader('Cache-Control','no-store');
  res.json(await openSeasonOneEuropeanRound(req.params.competitionId,{
   nextMatchday,expectedUpdatedAt,durationHours,adminUserId:req.user!.id
  }));
 }catch(err:any){res.status(409).json({error:err.message});}
});

// First-season Super Cups: verified source preview -> explicit confirmed creation.
// Admin authorization is enforced by the router-level requireAdmin middleware.
adminCupOpsRouter.post('/supercups/:supercupId/round',async(req:Request,res:Response)=>{
 if(!canUseDangerZone(req.user)){res.status(403).json({error:'Global administrator required.'});return;}
 const {action,expectedUpdatedAt,durationHours}=req.body||{};
 if(!['OPEN','NEXT','LOCK'].includes(action)||!Number.isFinite(durationHours)||
   durationHours<=0||durationHours>720||
   !(expectedUpdatedAt===null||typeof expectedUpdatedAt==='string')){
  res.status(400).json({error:'Action OPEN|NEXT|LOCK, expectedUpdatedAt and valid durationHours required.'});
  return;
 }
 try{
  res.setHeader('Cache-Control','no-store');
  res.json(await controlSeasonOneSupercupRound(req.params.supercupId,{
   action,expectedUpdatedAt,durationHours,adminUserId:req.user!.id
  }));
 }catch(err:any){res.status(409).json({error:err.message,code:'SUPERCUP_ROUND_NOT_READY'});}
});

adminCupOpsRouter.get('/supercups/:supercupId/preview',async(req:Request,res:Response)=>{
 if(!canUseDangerZone(req.user)){res.status(403).json({error:'Global administrator required.'});return;}
 try{
  const preview=await getSeasonOneSupercupPreview(req.params.supercupId);
  res.setHeader('Cache-Control','no-store');
  res.json(preview);
 }catch(err:any){
  res.status(400).json({error:err.message,code:'SUPERCUP_PREVIEW_FAILED'});
 }
});
adminCupOpsRouter.post('/supercups/:supercupId/create',async(req:Request,res:Response)=>{
 if(!canUseDangerZone(req.user)){res.status(403).json({error:'Global administrator required.'});return;}
 if(req.body?.confirmation!==true||typeof req.body?.previewToken!=='string'||!Array.isArray(req.body?.selectedClubIds)){
  res.status(400).json({error:'Explicit confirmation and previewToken are required.'});
  return;
 }
 try{
  const result=await createSeasonOneSupercup(req.params.supercupId,{
   previewToken:req.body.previewToken,selectedClubIds:req.body.selectedClubIds,confirmed:true,
   adminUserId:req.user!.id,adminUsername:req.user?.username||'admin'
  });
  res.setHeader('Cache-Control','no-store');
  res.json(result);
 }catch(err:any){
  res.status(409).json({error:err.message,code:'SUPERCUP_NOT_READY'});
 }
});

adminCupOpsRouter.get('/cups/:cupId/health', async (req: Request, res: Response) => {
  try {
    const health = await getDomesticCupBracketHealth(req.params.cupId);
    res.json(health);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminCupOpsRouter.post('/cups/:cupId/reconcile', async (req: Request, res: Response) => {
  try {
    const result = await reconcileDomesticCupBracketSafe(req.params.cupId, {
      adminUserId: req.user!.id,
      adminUsername: req.user?.username || 'admin',
      reason: req.body?.reason || 'admin-bracket-health-reconcile',
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminCupOpsRouter.post('/cups/:cupId/round', async (req: Request, res: Response) => {
  const roundNumber = Number(req.body?.roundNumber);
  const action = req.body?.action;
  if (!Number.isInteger(roundNumber) || !['OPEN', 'LOCK'].includes(action)) {
    res.status(400).json({ error: 'roundNumber and action OPEN|LOCK are required.' });
    return;
  }
  try {
    const result = await setDomesticCupRoundStateSafe(req.params.cupId, roundNumber, action, {
      adminUserId: req.user!.id,
      adminUsername: req.user?.username || 'admin',
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminCupOpsRouter.post('/cups/:cupId/round/advance', async (req: Request, res: Response) => {
  try {
    const result = await advanceDomesticCupRoundSafe(req.params.cupId, {
      adminUserId: req.user!.id,
      adminUsername: req.user?.username || 'admin',
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Shadow the generic admin approve endpoint so domestic cup confirmations auto-progress.
adminCupOpsRouter.post('/results/:fixtureId/approve', async (req: Request, res: Response, next) => {
  const { homeScore, awayScore, notes } = req.body || {};
  if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
    next();
    return;
  }
  try {
    const result = await adminApproveFixtureResultFirestore(req.user!.id, req.params.fixtureId, homeScore, awayScore, notes);
    const fixture = (result as any)?.fixture;
    const competitionId = fixture?.competitionId || '';
    if (competitionId && DOMESTIC_CUPS[competitionId] && fixture?.status === 'CONFIRMED') {
      await advanceDomesticCupWinnerSafe(req.params.fixtureId, {
        adminUserId: req.user!.id,
        adminUsername: req.user?.username || 'admin',
      }).catch(async () => {
        await reconcileDomesticCupSourceFixture(req.params.fixtureId, {
          actorUserId: req.user!.id,
          actorUsername: req.user?.username || 'admin',
          reason: 'admin-result-approved',
        });
      });
    }
    await refreshChangedFixtureReadModel(req.params.fixtureId)
      .catch(() => invalidateFixtureReadModels(competitionId, fixture?.seasonId || 'season-2026-27'))
      .catch(() => {});
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/results/${req.params.fixtureId}/approve`);
  }
});

// Shadow reopen/reject so a previously advanced cup winner is removed from its source-bound slot.
adminCupOpsRouter.post('/fixtures/:id/reopen', async (req: Request, res: Response) => {
  const fixtureId = req.params.id;
  try {
    const result = await reopenFixtureFirestore(req.user!.id, fixtureId, req.body?.notes);
    await reconcileDomesticCupSourceFixture(fixtureId, {
      actorUserId: req.user!.id,
      actorUsername: req.user?.username || 'admin',
      reason: 'fixture-reopened',
    }).catch(() => {});
    res.json({ success: true, message: 'Fixture has been reopened for submissions.', result });
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/fixtures/${fixtureId}/reopen`);
  }
});

adminCupOpsRouter.post('/results/:fixtureId/reject', async (req: Request, res: Response) => {
  const fixtureId = req.params.fixtureId;
  try {
    const result = await reopenFixtureFirestore(
      req.user!.id,
      fixtureId,
      req.body?.notes || 'Rejected by tournament administrator'
    );
    await reconcileDomesticCupSourceFixture(fixtureId, {
      actorUserId: req.user!.id,
      actorUsername: req.user?.username || 'admin',
      reason: 'admin-result-rejected',
    }).catch(() => {});
    res.json({ success: true, message: 'Pending result rejected and match reopened for re-submission.', result });
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/results/${fixtureId}/reject`);
  }
});
