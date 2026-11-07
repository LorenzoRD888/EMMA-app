import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
export function createAudit(){return {startedAt:new Date().toISOString(),entries:[]};}
export function withAudit(audit,fn){return context.run(audit,fn);}
export function summaryAudit(audit){const searches=audit.entries.filter(e=>e.kind==='search');const results=searches.flatMap(e=>e.results||[]);return {...audit,finishedAt:new Date().toISOString(),queries:searches.length,uniqueResults:new Set(results.map(r=>r.url)).size,pagesRead:audit.entries.filter(e=>e.kind==='page'&&e.status==='ok').length,domains:[...new Set(results.map(r=>{try{return new URL(r.url).hostname;}catch{return '';}}).filter(Boolean))]};}
export async function auditedFetch(input,options={}){const audit=context.getStore();if(!audit)return globalThis.fetch(input,options);const u=new URL(input);const isSearch=u.hostname==='api.tavily.com'||u.hostname==='api.search.brave.com';let body={};if(isSearch)try{body=JSON.parse(options.body||'{}');}catch{}
 const entry={kind:isSearch?'search':'api',engine:u.hostname,endpoint:u.origin+u.pathname,query:isSearch?(body.query||u.searchParams.get('q')||''):undefined,status:'running',results:[]};audit.entries.push(entry);
 try{const r=await globalThis.fetch(input,options);entry.httpStatus=r.status;entry.status=r.ok?'ok':'error';if(isSearch&&r.ok){try{const data=await r.clone().json();entry.results=(data.results||data.web?.results||[]).map(x=>({url:x.url,title:x.title})).filter(x=>x.url);}catch{entry.status='invalid_response';}}return r;}catch(error){entry.status='error';entry.error='Source not reachable or timed out.';throw error;}}
export async function auditPage(url,fn){const audit=context.getStore();if(!audit)return fn();const entry={kind:'page',url,status:'running'};audit.entries.push(entry);try{const r=await fn();entry.httpStatus=r.status;entry.status=r.ok?'ok':'error';return r;}catch(error){entry.status='error';entry.error='Page not downloaded.';throw error;}}

// Searches made through the configured web search service (any provider), logged with the service actually used.
export function recordSearch(entry){const audit=context.getStore();if(audit)audit.entries.push({kind:'search',status:'ok',results:[],...entry});}
