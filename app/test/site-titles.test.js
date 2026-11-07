import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {openMarket} from '../src/market-store.js';
import {createIntel} from '../src/intel/intel.js';
import {readPage} from '../src/intel/site-watch.js';
test('existing sitemap pages without titles are enriched on subsequent scans, including baseline pages',async()=>{
 const store=openMarket(':memory:');const c=store.saveCompany({name:'Example',website:'https://example.com'});
 const url='https://example.com/resources/news/lpp';
 store.db.prepare(`INSERT INTO site_pages(id,companyId,url,title,summary,kind,via,firstSeen,baseline) VALUES('old',?,?,?,'','news','sitemap',?,1)`).run(c.id,url,url,new Date().toISOString());
 store.db.prepare("UPDATE site_pages SET id=? WHERE id='old'").run(createHash('sha256').update(c.id+url).digest('hex').slice(0,32));
 const fetchFn=async target=>new Response(target===url?'<html><head><meta property="article:published_time" content="2026-10-12"><meta name="description" content="A warehouse automation announcement."></head><article><h1>Warehouse automation partnership</h1><p>Example has announced a new warehouse automation partnership.</p></article></html>':target.endsWith('/robots.txt')?'Sitemap: https://example.com/sitemap.xml':target.endsWith('/sitemap.xml')?`<urlset><url><loc>${url}</loc></url></urlset>`:'<html></html>',{headers:{'Content-Type':target.endsWith('.xml')?'application/xml':'text/html'}});
 const intel=createIntel(store,{fetchFn});await intel.scanOfficialSite(c);
 const row=store.db.prepare("SELECT * FROM site_pages LIMIT 1").get();assert.equal(row.title,'Warehouse automation partnership');assert.equal(row.publishedAt,'2026-10-12T00:00:00.000Z');assert.ok(intel.dossier(c.id).publishing.news[0].summary);store.close();
});
test('structured publication dates are retained by page reader',async()=>{
 const page=await readPage('https://example.com/news/item',async()=>new Response('<html><head><title>Real title</title><script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-10"}</script></head><body><article>Example article</article></body></html>',{headers:{'content-type':'text/html'}}));assert.equal(page.title,'Real title');assert.equal(page.publishedAt,'2026-10-10T00:00:00.000Z');
});
