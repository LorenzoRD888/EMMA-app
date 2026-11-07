import {localVoiceRoutes} from './local-voice.js';
import { analysisReadiness } from '../public/analysis-readiness.js';
import 'dotenv/config';
import dotenv from 'dotenv';
import express from 'express';
import {createAudit,withAudit,summaryAudit} from './services/research-audit.js';
import { openMarket } from './market-store.js';
import { createMarketService } from './market-service.js';
import { marketRoutes } from './market-routes.js';
import { createSettingsStore } from './settings.js';
import { localAiRoutes } from './local-ai.js';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { COMPETITOR_CATEGORIES, validateCompetitorSchema } from './services/schemas.js';
const root=fileURLToPath(new URL('../',import.meta.url)), VERSION=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version, home=path.basename(path.resolve(root))==='app'?path.resolve(root,'..'):root, data=process.env.EMMA_DATA_DIR||path.join(home,'data');
// Folder layout: EMMA/app (program) and EMMA/data (your data). Older layout: data inside the program folder.
dotenv.config({path:path.join(data,'.env')});
await fs.mkdir(data,{recursive:true});
process.umask(0o077);
const settings=await createSettingsStore(path.join(data,'settings.json'));
const market=openMarket(path.join(data,'market.sqlite'));
const intelligence=createMarketService(market,settings);
export const app=express();
app.disable('x-powered-by');
app.use((req,res,next)=>{if(req.headers.host!==`127.0.0.1:${process.env.PORT||4317}` && req.headers.host!==`localhost:${process.env.PORT||4317}`)return res.sendStatus(403);if(req.headers.origin&&!['http://127.0.0.1:'+ (process.env.PORT||4317),'http://localhost:'+(process.env.PORT||4317)].includes(req.headers.origin))return res.sendStatus(403);next();});
app.use(express.json({limit:'2mb'}));app.get('/analysis.html',(req,res)=>res.redirect('/#archive'));app.use(express.static(path.join(root,'public'),{setHeaders:res=>res.setHeader('Cache-Control','no-store')}));
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const file=id=>{if(!/^[\da-f-]{36}$/.test(id))throw Error('Invalid identifier');return path.join(data,id+'.json');};
app.get('/api/status',(req,res)=>res.json({app:'EMMA',version:VERSION,...analysisReadiness(settings.snapshot()),categories:COMPETITOR_CATEGORIES}));
app.get('/api/settings',(req,res)=>{res.set('Cache-Control','no-store');res.json(settings.snapshot());});
app.post('/api/settings',wrap(async(req,res)=>{if(busy||intelligence.busy())return res.status(409).json({error:'Wait for the analysis to finish before changing settings.'});try{res.json(await settings.save(req.body));}catch(error){const storage=['EACCES','EPERM','ENOENT','EROFS'].includes(error.code);res.status(storage?500:400).json({error:storage?'Couldn’t write the settings. Restart EMMA from its folder and check permissions.':error.message||'Invalid settings.'});}}));
app.post('/api/settings/reveal',(req,res)=>{res.set('Cache-Control','no-store');try{res.json({value:settings.reveal(String(req.body?.key||''))});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/settings/test',wrap(async(req,res)=>{try{await settings.test();res.json({ok:true,message:'AI model connection works.'});}catch{res.status(400).json({error:'AI connection failed. Check the key, or start the local server and check the model name.'});}}));
app.post('/api/settings/test-search',wrap(async(req,res)=>{
 const {searchReady,activeLabel,webSearch}=await import('./search/providers.js');const which=req.body?.provider;if(!searchReady()&&!which)return res.status(400).json({error:'Save a search service key first.'});
 try{const r=await webSearch('polyester film industry news',{maxResults:1,provider:which,noFallback:true});const {SEARCH_PROVIDERS}=await import('./search/providers.js');res.json({ok:true,message:`${SEARCH_PROVIDERS[which]?.label||activeLabel()} risponde correttamente (${r.length?'1 risultato':'no results'} with 1 test search).`});}catch(error){res.status(400).json({error:error.public?error.message:'Search service connection failed. The saved key has not been removed.'});}
}));
app.get('/api/history',wrap(async(req,res)=>{const name=String(req.query.company||'').trim().toLowerCase(),id=String(req.query.companyId||'');const reports=(await Promise.all((await fs.readdir(data)).filter(f=>/^[\da-f-]{36}\.json$/.test(f)).map(async f=>{try{return JSON.parse(await fs.readFile(path.join(data,f),'utf8'));}catch{return null;}}))).filter(Boolean).filter(r=>!name&&!id||(id&&r.companyId===id)||(name&&String(r.companyName).trim().toLowerCase()===name));res.json(reports.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));}));
let busy=false,dossier=null;
// In-depth dossier: runs in the background; the Archive page polls its state.
app.get('/api/analyze',(req,res)=>{res.set('Cache-Control','no-store');res.json(dossier||{status:'idle'});});
app.post('/api/analyze',wrap(async(req,res)=>{
 if(busy)return res.status(409).json({error:'A dossier is already being prepared.'});
 if(!settings.ready())return res.status(400).json({error:analysisReadiness(settings.snapshot()).message});
 const companyName=String(req.body.companyName||'').trim(),url=String(req.body.url||'').trim(),companyId=String(req.body.companyId||'');
 const categories=Array.isArray(req.body.categories)?req.body.categories.filter(k=>k in COMPETITOR_CATEGORIES):Object.keys(COMPETITOR_CATEGORIES);
 if(!companyName||companyName.length>200||!categories.some(k=>k!=='maturity'))return res.status(400).json({error:'Enter a company and select at least one search category.'});
 if(url){const {isSafeExternalUrl}=await import('./services/urlSafety.js');if(!isSafeExternalUrl(url).ok)return res.status(400).json({error:'The company website is not a valid public https address: fix it with Edit.'});}
 busy=true;dossier={status:'running',companyName,companyId,startedAt:new Date().toISOString()};res.status(202).json(dossier);
 (async()=>{try{const {buildCompetitorProfile}=await import('./services/competitor-scraper.js');const audit=createAudit();const competitorSchema=await withAudit(audit,()=>buildCompetitorProfile(companyName,{url:url||null,categories,anthropicClient:settings.client()}));if(!validateCompetitorSchema({hub:'competitor',competitorSchema}).valid)throw Object.assign(Error('The result failed data validation.'),{public:true});const report={id:randomUUID(),companyName,companyId,url,createdAt:new Date().toISOString(),competitorSchema,researchAudit:summaryAudit(audit)};const target=file(report.id);await fs.writeFile(target+'.tmp',JSON.stringify(report,null,2),{mode:0o600});await fs.rename(target+'.tmp',target);dossier={status:'done',companyName,companyId,reportId:report.id,finishedAt:report.createdAt};}
 catch(e){console.error('Dossier failed:',e);dossier={status:'failed',companyName,companyId,error:e.public||e.status?e.message:'The dossier could not be completed. Check the AI and web search settings, then try again.'};}
 finally{busy=false;}})();
}));
app.get('/api/report/:id',wrap(async(req,res)=>{const report=JSON.parse(await fs.readFile(file(req.params.id),'utf8'));const {buildCompetitorReportDocx}=await import('./services/competitorReport.js');const buffer=await buildCompetitorReportDocx(report.competitorSchema,report);res.set('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');res.set('Content-Disposition','attachment; filename="emma-report.docx"');res.send(buffer);}));
app.use('/api/voice',localVoiceRoutes(data));
app.use('/api/setup',localAiRoutes(settings,market,{db:market.db,dataDir:data}));
app.use('/api/market',marketRoutes(market,intelligence,settings));
app.post('/api/shutdown',(req,res)=>{if(busy||intelligence.busy())return res.status(409).json({error:'Wait for the update to finish before quitting EMMA.'});res.json({ok:true});setTimeout(()=>{try{market.close();}catch{}process.exit(0);},300);});
app.use((err,req,res,next)=>{console.error(err.message);res.status(err.status||(err.code==='ENOENT'?404:500)).json({error:err.public?err.message:err.code==='ENOENT'?'Report not found.':'Operation failed. Check the setup and try again.'});});
if(process.env.EMMA_TEST!=='1')app.listen(Number(process.env.PORT||4317),'127.0.0.1',()=>console.log('EMMA is available at http://127.0.0.1:'+(process.env.PORT||4317)));

if(process.env.EMMA_TEST!=='1'){ const timer=setInterval(()=>intelligence.tick().catch(()=>{}),60000);timer.unref();intelligence.tick().catch(()=>{}); setTimeout(()=>intelligence.backfillAll().catch(()=>{}),5000).unref(); }
