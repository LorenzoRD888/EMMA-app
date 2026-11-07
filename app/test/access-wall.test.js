import test from 'node:test';
import assert from 'node:assert/strict';
import {leadFromText} from '../src/intel/preview.js';
import {parsePost} from '../src/intel/social.js';
const company={name:'Geek+',aliases:['Geekplus','Geek +']};
test('LinkedIn access prompts do not become article previews',()=>{
 const wall='Welcome back By clicking Continue to join or sign in, you agree to LinkedIn’s User Agreement, Privacy Policy, and Cookie Policy.';
 assert.equal(leadFromText(wall), '');
 const post=parsePost({url:'https://www.linkedin.com/posts/geekplus_warehouse',title:'Geekplus: warehouse robotics',summary:wall},company);
 assert.ok(post);assert.equal(post.summary,'Geekplus: warehouse robotics');
 assert.equal(parsePost({url:'https://www.linkedin.com/posts/greek-national-tourism_campaign',title:'Greek National Tourism Organisation',summary:'Greek economy and tourism'},company),null);
});
