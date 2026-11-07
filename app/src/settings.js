import { analysisReadiness } from '../public/analysis-readiness.js';
import { promises as fs } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { SEARCH_PROVIDERS, activeProvider } from './search/providers.js';

export const secretKeys=['ANTHROPIC_API_KEY','OPENAI_COMPAT_API_KEY','TAVILY_API_KEY','EXA_API_KEY','JINA_API_KEY','YOU_API_KEY','BRAVE_API_KEY','SERPAPI_API_KEY','COMPANIES_HOUSE_API_KEY','PATENTSVIEW_API_KEY','EPO_OPS_CLIENT_ID','EPO_OPS_CLIENT_SECRET','SAFE_BROWSING_API_KEY'];
export const AI_PROVIDERS=['none','anthropic','compat','local'];
const fail=m=>Object.assign(new Error(m),{status:400,public:true});

export function localBase(value){const u=new URL(value);if(u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw Error('Use a local address http://localhost:port/v1.');return u.href.replace(/\/$/,'');}
// Servizi compatibili con OpenAI (DeepSeek, OpenAI, Mistral…): https obbligatorio, nessuna credenziale nell'indirizzo.
export function compatBase(value){let u;try{u=new URL(value);}catch{throw Error('Invalid AI service address.');}if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('Use an https://…/v1 address for the AI service.');return u.href.replace(/\/$/,'');}

export async function createSettingsStore(filename){
 let settings={provider:'anthropic',localUrl:'http://127.0.0.1:11434/v1',localModel:'',compatUrl:'https://api.deepseek.com/v1',compatModel:'deepseek-chat',searchProvider:'',searchFallback:true};
 try{settings={...settings,...JSON.parse(await fs.readFile(filename,'utf8'))};}catch(e){if(e.code!=='ENOENT')throw e;}
 function apply(){for(const k of secretKeys)if(k in settings)process.env[k]=settings[k];process.env.EMMA_SEARCH_PROVIDER=settings.searchProvider||'';process.env.EMMA_SEARCH_FALLBACK=settings.searchFallback===false?'0':'1';}apply();
 function aiReady(){const p=settings.provider;if(p==='local')return !!settings.localModel;if(p==='compat')return !!(settings.compatModel&&process.env.OPENAI_COMPAT_API_KEY);if(p==='anthropic')return !!process.env.ANTHROPIC_API_KEY;return false;}
 function snapshot(){const active=activeProvider();return {...Object.fromEntries(['provider','localUrl','localModel','compatUrl','compatModel','searchProvider'].map(k=>[k,settings[k]])),searchFallback:settings.searchFallback!==false,activeSearch:active,activeSearchLabel:SEARCH_PROVIDERS[active]?.label||null,searchReady:!!active,aiReady:aiReady(),savedAt:settings.savedAt||null,keyInfo:Object.fromEntries(secretKeys.map(k=>[k,{saved:!!process.env[k],source:settings[k]?'file locale':process.env[k]?'ambiente':null,savedAt:settings.keySavedAt?.[k]||null}])),configured:Object.fromEntries(secretKeys.map(k=>[k,!!process.env[k]]))};}
 function ready(){return analysisReadiness(snapshot()).ready;}
 let writeQueue=Promise.resolve();
 function save(body){const operation=writeQueue.then(async()=>{const next={...settings};
  if(body.provider!==undefined){if(!AI_PROVIDERS.includes(body.provider))throw Error('Invalid AI mode.');next.provider=body.provider;}
  if(body.localUrl!==undefined&&String(body.localUrl).trim())next.localUrl=localBase(String(body.localUrl).trim());
  if(body.localModel!==undefined){if(typeof body.localModel!=='string'||body.localModel.length>200)throw Error('Invalid model name.');next.localModel=body.localModel.trim();}
  if(body.compatUrl!==undefined&&String(body.compatUrl).trim())next.compatUrl=compatBase(String(body.compatUrl).trim());
  if(body.compatModel!==undefined){if(typeof body.compatModel!=='string'||body.compatModel.length>200)throw Error('Invalid model name.');next.compatModel=body.compatModel.trim();}
  if(body.searchProvider!==undefined){if(body.searchProvider&&!SEARCH_PROVIDERS[body.searchProvider])throw Error('Invalid search service.');next.searchProvider=body.searchProvider||'';}
  if(body.searchFallback!==undefined)next.searchFallback=body.searchFallback===true;
  for(const k of secretKeys)if(body[k]!==undefined){if(typeof body[k]!=='string'||body[k].length>2000||/[\r\n]/.test(body[k]))throw Error('Invalid key.');next[k]=body[k].trim();next.keySavedAt={...next.keySavedAt,[k]:new Date().toISOString()};}
  next.savedAt=new Date().toISOString();await fs.writeFile(filename+'.tmp',JSON.stringify(next,null,2),{mode:0o600});await fs.chmod(filename+'.tmp',0o600);await fs.rename(filename+'.tmp',filename);settings=next;apply();return snapshot();});writeQueue=operation.catch(()=>{});return operation;}
 function chatClient(base,headers,model,timeout){let queue=Promise.resolve();
  async function request({system,messages,max_tokens}){const response=await fetch(base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({model,messages:[...(system?[{role:'system',content:system}]:[]),...messages],max_tokens,stream:false,temperature:0}),redirect:'error',signal:AbortSignal.timeout(timeout)});if(response.status===401||response.status===403)throw Error('Invalid AI service key.');if(!response.ok)throw Error('The model returned an error ('+response.status+').');const result=await response.json();if(!result.choices?.[0]?.message?.content)throw Error('Empty model response.');return {content:[{type:'text',text:result.choices[0].message.content}],usage:result.usage||{}};}
  // Le analisi complete lanciano molte richieste: le serializziamo per non saturare il servizio o il Mac.
  return {messages:{create:params=>{const operation=queue.then(()=>request(params));queue=operation.catch(()=>{});return operation;}}};}
 function client(){
  if(settings.provider==='none')throw fail('No AI active: choose one in Settings.');
  if(settings.provider==='anthropic')return new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY||'not-configured',timeout:90000,maxRetries:1});
  if(settings.provider==='compat')return chatClient(compatBase(settings.compatUrl),{Authorization:`Bearer ${process.env.OPENAI_COMPAT_API_KEY||''}`},settings.compatModel,120000);
  return chatClient(localBase(settings.localUrl),{},settings.localModel,180000);
 }
 async function test(){const response=await client().messages.create({model:'claude-haiku-4-5-20251001',messages:[{role:'user',content:'Reply with OK.'}],max_tokens:32});return !!response.content?.[0]?.text;}
 // Shows a saved key only when you ask for it (button in Settings); never sent with the other settings.
 function reveal(k){if(!secretKeys.includes(k))throw Error('Unknown key.');return settings[k]||process.env[k]||'';}
 return {snapshot,ready,save,client,test,aiReady,reveal};
}
