import {canonical,clean,fail} from './market-store.js';
import {extractPreview,linkedinDate,findPublishedDate,isAccessWall} from './intel/preview.js';
import {pageHtml} from './research-plan.js';

export function matchesMediaCompany(item,company){
 const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const text=' '+norm(`${item.title||''} ${item.summary||''}`)+' ';
 return [company.name,...(company.aliases||[])].filter(Boolean).some(n=>{const name=norm(n);let start=-1;while((start=text.indexOf(name,start+1))!==-1)if(!/[\p{L}\p{N}]/u.test(text[start-1]||' ')&&!/[\p{L}\p{N}]/u.test(text[start+name.length]||' '))return true;return false;});
}

export function mediaTasks(company,{maxResults=10}={}) {
 const quote=v=>'"'+String(v).replaceAll('"','').trim()+'"';
 const names=[...new Set([company.name,...(company.aliases||[])].filter(Boolean))].slice(0,3);
 const name=names.length>1?'('+names.map(quote).join(' OR ')+')':quote(names[0]);
 const task=(suffix,label,extra={})=>({query:`${name} ${suffix}`.trim(),label,engine:'web',topic:'general',recent:false,maxResults,media:true,...extra});
 const tasks=[
  task('interview OR interviewed OR podcast OR television','Media · interviews and podcasts'),
  task('news OR report OR investigation OR analysis','Media · newspapers and trade press'),
  task('interview OR video OR report','Media · Bloomberg',{domain:'bloomberg.com'}),
  task('(site:bbc.com OR site:bbc.co.uk)','Media · BBC'),
  task('(site:foxnews.com OR site:foxbusiness.com)','Media · Fox News and Fox Business'),
  task('(site:reuters.com OR site:apnews.com)','Media · Reuters and AP'),
  task('(site:cnbc.com OR site:cnn.com OR site:ft.com)','Media · business and television press'),
  task('interview OR video OR presentation OR conference','Media · YouTube videos',{domain:'youtube.com'}),
  task('BBC News','Media · BBC videos',{domain:'youtube.com'}),
  task('CNN','Media · CNN videos',{domain:'youtube.com'}),
  task('(site:x.com OR site:twitter.com) (interview OR news OR announcement)','Media · public X posts'),
  task('interview OR television OR media','Media · public LinkedIn posts',{domain:'linkedin.com'}),
 ];
 for(const p of (company.mediaPeople||[]).slice(0,4)){
  const person=typeof p==='string'?p:p.name;if(!person||person.trim().split(/\s+/).length<2)continue;
  tasks.push(task(`${quote(person)} (interview OR podcast OR news OR video OR site:x.com OR site:linkedin.com)`,'Media · associated person · '+person));
 }
 return tasks;
}

export function publicMediaType(raw){
 try{const u=new URL(raw),h=u.hostname.replace(/^www\./,'').toLowerCase();
  if((h==='x.com'||h==='twitter.com'||h.endsWith('.twitter.com')||h.endsWith('.x.com'))&&/^\/[^/]+\/status\/\d+/.test(u.pathname))return 'X post';
  if((h==='youtube.com'||h.endsWith('.youtube.com'))&&(u.pathname==='/watch'&&u.searchParams.has('v')||/^\/(shorts|live)\/[^/]+/.test(u.pathname))||h==='youtu.be'&&u.pathname.length>1)return 'Video';
  if((h==='linkedin.com'||h.endsWith('.linkedin.com'))&&/^\/(posts|pulse|feed\/update)\//.test(u.pathname))return 'LinkedIn post';
 }catch{}return '';
}

export async function collectMedia({store,intel,company,tasks,search,fetchPage,maxPages=10,cancelled=()=>false,onProgress=()=>{}}){
 const audit=[],found=new Map(),queue=[...tasks],followed=new Set();let completed=0;
 for(const task of queue){if(cancelled())break;
  const entry={kind:'search',company:company.name,query:task.query,label:task.label,scope:task.domain||'Public media and web',recent:false,status:'running',results:[]};audit.push(entry);
  try{const rows=await search(task.query,{...task,excludeDomains:company.website?[new URL(company.website).hostname]:[]});
   for(const row of rows){let url;try{url=canonical(row.url);}catch{continue;}
    if(company.website&&new URL(url).hostname.replace(/^www\./,'')===new URL(company.website).hostname.replace(/^www\./,''))continue;
    const named=matchesMediaCompany(row,company);let verdict=intel.judge(row,company,named);
    if(!named&&task.relatedArticle&&publicMediaType(url)==='Video'){
     const words=t=>String(t||'').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[];
     const expected=[...new Set(words(task.relatedTitle))],actual=new Set(words(row.title));
     const same=expected.length>=4&&expected.filter(w=>actual.has(w)).length/expected.length>=0.8;
     if(same&&(`${row.title} ${row.summary}`).toLowerCase().includes(task.publisher.toLowerCase()))verdict={verdict:'review',reason:'Video matches the title of a company-related '+task.publisher+' report; verify publisher and content'};
    }

    entry.results.push({url,title:clean(row.title,500),verdict:verdict.verdict,reason:verdict.reason,accepted:verdict.verdict==='accept'});
    if(verdict.verdict==='reject'||verdict.verdict==='profile')continue;
    // Follow the report title: a video may never mention the company in its headline.
    const host=new URL(url).hostname.replace(/^www\./,'');
    const publisher=/(^|\.)bbc\.(com|co\.uk)$/.test(host)?'BBC':/(^|\.)cnn\.com$/.test(host)?'CNN':/(^|\.)bloomberg\.com$/.test(host)?'Bloomberg':/(^|\.)fox(news|business)\.com$/.test(host)?'Fox':null;
    if(named&&publisher&&!publicMediaType(url)&&!task.relatedArticle&&followed.size<3&&!followed.has(row.title)){
     followed.add(row.title);queue.push({query:'"'+clean(row.title,250).replaceAll('"','')+'" '+publisher,domain:'youtube.com',label:'Media · video of '+publisher+' report',engine:'web',topic:'general',recent:false,maxResults:5,media:true,relatedArticle:url,relatedTitle:row.title,publisher});
    }
    const previous=found.get(url);
    if(!previous||previous.review&&verdict.verdict==='accept')found.set(url,{...row,url,summary:isAccessWall(row.summary)?'':row.summary,review:verdict.verdict==='review',reviewReason:verdict.reason,foundVia:{media:true,label:task.label,query:task.query,engine:row.provider||'web',reason:verdict.reason,contentType:publicMediaType(url)||'Media article',coverage:'Search excerpt',...(task.relatedArticle?{relatedArticle:task.relatedArticle}:{})}});
   }entry.status='ok';
  }catch(e){entry.status='error';entry.error=e.public?e.message:'Media source unavailable.';}
  completed++;onProgress({completed,total:queue.length,found:found.size,label:task.label});
 }
 let pages=0;
 for(const item of found.values()){if(cancelled())break;
  const dateFromUrl=findPublishedDate('',item.url);item.publishedAt=item.publishedAt||dateFromUrl?.date||linkedinDate(item.url);if(dateFromUrl)item.dateHow=dateFromUrl.how;
  const type=publicMediaType(item.url);if(type==='X post'||type==='LinkedIn post')item.category='social';
  const existing=store.db.prepare('SELECT deletedAt FROM news WHERE url=?').get(item.url);
  if(existing?.deletedAt)continue;
  if(!type&&!existing&&pages<maxPages){pages++;const entry={kind:'page',url:item.url,status:'running'};audit.push(entry);
   try{const response=await fetchPage(item.url,{maxBytes:3*1024*1024,signal:AbortSignal.timeout(12000)});entry.httpStatus=response.status;
    if(!response.ok)throw Error();
    if(!/html|text/i.test(response.headers.get('content-type')||''))throw Error();
    const p=extractPreview(await pageHtml(response),item.url,[company.name,...(company.aliases||[])]);
    if(p.text.length>=80&&!isAccessWall(p.text.slice(0,1000))){item.summary=p.text.slice(0,6000);item.lead=p.lead;item.image=p.image;item.publishedAt=p.published||item.publishedAt;item.dateHow=p.publishedHow;item.foundVia.coverage='Page read';}
    const j=intel.judge(item,company,matchesMediaCompany(item,company));item.review=j.verdict!=='accept';item.reviewReason=j.reason;entry.status='ok';
   }catch{entry.status='unavailable';entry.error='Original page unavailable; search excerpt retained.';}
  }
  if(!item.publishedAt)item.dateNote='Publication date not found; original source retained';
 }
 const items=[...found.values()];const result=store.ingest(items,company.id);
 return {...result,review:items.filter(i=>i.review).length,found:items.length,audit,queries:completed,errors:audit.filter(a=>a.kind==='search'&&a.status==='error').map(a=>a.error)};
}
