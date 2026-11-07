import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisReadiness} from '../public/analysis-readiness.js';

test('dossier explains the missing AI when web search is configured',()=>{
 const s=analysisReadiness({provider:'anthropic',configured:{TAVILY_API_KEY:true}});
 assert.equal(s.ready,false);assert.equal(s.missing.length,1);
 assert.match(s.message,/Anthropic/);assert.match(s.message,/local/);
});
test('dossier accepts either cloud or local AI and always requires web search',()=>{
 assert.equal(analysisReadiness({provider:'anthropic',configured:{TAVILY_API_KEY:true,ANTHROPIC_API_KEY:true}}).ready,true);
 assert.equal(analysisReadiness({provider:'local',localModel:'test-model',configured:{TAVILY_API_KEY:true}}).ready,true);
 assert.equal(analysisReadiness({provider:'local',localModel:' ',configured:{TAVILY_API_KEY:true}}).ready,false);
 assert.match(analysisReadiness({provider:'local',localModel:'test-model',configured:{}}).message,/web search/);
 assert.equal(analysisReadiness({provider:'none',searchReady:true,aiReady:false}).ready,false);
 assert.equal(analysisReadiness({provider:'compat',searchReady:true,aiReady:true}).ready,true);
});
