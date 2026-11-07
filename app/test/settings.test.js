import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createSettingsStore,localBase} from '../src/settings.js';
test('settings persist, redact secrets and update runtime; local client sends selected model',async()=>{
const dir=await mkdtemp(path.join(tmpdir(),'emma-test-'));const previous=process.env.TAVILY_API_KEY;let server;
try{const store=await createSettingsStore(path.join(dir,'settings.json'));const snapshot=await store.save({TAVILY_API_KEY:'test-secret',provider:'local',localModel:'test-model'});assert.equal(snapshot.configured.TAVILY_API_KEY,true);assert.ok(!JSON.stringify(snapshot).includes('test-secret'));assert.equal(store.ready(),true);assert.equal((await stat(path.join(dir,'settings.json'))).mode&0o777,0o600);
const reloaded=await createSettingsStore(path.join(dir,'settings.json'));assert.equal(reloaded.snapshot().localModel,'test-model');
server=http.createServer(async(req,res)=>{assert.equal(req.url,'/v1/chat/completions');let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);assert.equal(body.model,'test-model');assert.equal(body.messages[0].role,'system');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));await store.save({localUrl:`http://127.0.0.1:${server.address().port}/v1`});const response=await store.client().messages.create({system:'Return JSON',messages:[{role:'user',content:'test'}],max_tokens:20});assert.equal(response.content[0].text,'{"ok":true}');await store.save({TAVILY_API_KEY:''});assert.equal(store.ready(),false);assert.equal(JSON.parse(await readFile(path.join(dir,'settings.json'),'utf8')).TAVILY_API_KEY,'');
await assert.rejects(store.save({localUrl:'https://example.com/v1'}));assert.throws(()=>localBase('http://localhost@evil.com/v1'));
}finally{if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});if(previous===undefined)delete process.env.TAVILY_API_KEY;else process.env.TAVILY_API_KEY=previous;}
});
