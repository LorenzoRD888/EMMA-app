// Scroll gives the loose paper a short impulse. No mouse-hover animation.
const motion = matchMedia('(prefers-reduced-motion: no-preference)');
const sheets = new Map();
let frame = 0, previousTime = 0, lastScroll = window.scrollY;
function clearSheet(card) {
 for (const name of ['--breeze-x','--breeze-y','--breeze-z']) card.style.removeProperty(name);
 card.classList.remove('paper-in-breeze'); sheets.delete(card);
}
function reset() {
 cancelAnimationFrame(frame); frame = 0; previousTime = 0;
 for (const card of sheets.keys()) clearSheet(card);
 lastScroll = window.scrollY;
}
function animate(time) {
 frame = 0;
 if (!motion.matches) { reset(); return; }
 const dt = previousTime ? Math.min((time - previousTime) / 16.667, 2) : 1;
 previousTime = time;
 for (const [card, s] of sheets) {
  if (!card.isConnected || card.classList.contains('paper-dismissing')) { clearSheet(card); continue; }
  for (let i = 0; i < 3; i++) {
   s.velocity[i] = (s.velocity[i] + (s.force[i] - s.angle[i]) * .085 * dt) * Math.pow(.74, dt);
   s.angle[i] += s.velocity[i] * dt;
   s.force[i] *= Math.pow(.87, dt);
  }
  ['--breeze-x','--breeze-y','--breeze-z'].forEach((name,i)=>card.style.setProperty(name,s.angle[i].toFixed(3)+'deg'));
  if (![...s.angle,...s.velocity,...s.force].some(n=>Math.abs(n)>.008)) clearSheet(card);
 }
 if (sheets.size) frame = requestAnimationFrame(animate); else previousTime = 0;
}
window.addEventListener('scroll', () => {
 const delta = window.scrollY - lastScroll; lastScroll = window.scrollY;
 if (!motion.matches || !delta) return;
 const impulse = Math.max(-1, Math.min(1, delta / 65));
 document.querySelectorAll('.daily-paper-stories .daily-story[data-paper-tone]').forEach((card,index)=>{
  if (card.classList.contains('paper-dismissing')) return;
  const rect = card.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) return;
  let s = sheets.get(card);
  if (!s) { s={angle:[0,0,0],velocity:[0,0,0],force:[0,0,0]}; sheets.set(card,s);card.classList.add('paper-in-breeze'); }
  const side = index % 2 ? 1 : -1;
  s.force=[impulse*2.6,impulse*side*.45,impulse*side*.2];
 });
 if (sheets.size && !frame) frame=requestAnimationFrame(animate);
}, {passive:true});
window.addEventListener('blur',reset);
motion.addEventListener('change',reset);

// Called only after the deletion was saved successfully; the original holds its place.
export async function detachDailyPaper(card) {
 if (!card?.matches('.daily-story')) return null;
 clearSheet(card);
 const index=[...card.parentElement.children].indexOf(card);
 const nextKey=card.nextElementSibling?.dataset.readingKey;
 if (!motion.matches || !card.animate) return {index,nextKey};
 const rect=card.getBoundingClientRect();
 const stage=document.createElement('div');stage.className='daily-paper-stories paper-fall-stage';stage.setAttribute('aria-hidden','true');
 const copy=card.cloneNode(true);copy.classList.add('paper-dismissing');copy.inert=true;
 Object.assign(copy.style,{position:'absolute',top:rect.top+'px',left:rect.left+'px',width:rect.width+'px',height:rect.height+'px',margin:'0',boxSizing:'border-box'});
 stage.append(copy);document.body.append(stage);card.style.opacity='0';
 const base=getComputedStyle(card).transform;
 const transform=base==='none'?'':base;
 try {
  await copy.animate([
   {transform:transform+' translateY(0) rotate(0deg)',opacity:1,offset:0},
   {transform:transform+' translateY(5px) rotate(-1deg)',opacity:1,offset:.2},
   {transform:transform+' translate(7px, 48px) rotate(2deg)',opacity:.95,offset:.45},
   {transform:transform+` translate(22px, ${Math.max(350,window.innerHeight-rect.top+100)}px) rotate(9deg)`,opacity:0,offset:1}
  ],{duration:760,easing:'cubic-bezier(.32,0,.67,.35)',fill:'forwards'}).finished;
 } catch { /* A cancelled visual effect must never block a saved deletion. */ }
 finally { stage.remove(); }
 return {index,nextKey};
}
// Pack each clipping into the shortest column; CSS multi-column balancing leaves holes.
let paperObserver=null, layoutFrame=0, placePapers=null;
export function layoutDailyPapers() {
 paperObserver?.disconnect();cancelAnimationFrame(layoutFrame);
 const board=document.querySelector('.daily-paper-stories:not(.paper-fall-stage)');
 if (!board) return;
 let lastWidth=0;
 function place() {
  const cards=[...board.children].filter(c=>c.matches('.daily-story'));
  if (!board.isConnected) return;
  const columns=window.innerWidth<=700?1:window.innerWidth<=1000?2:3;
  const padding=9,gap=30,space=34;
  const width=(board.clientWidth-padding*2-gap*(columns-1))/columns;
  if (width<=0) return;
  const sameColumns=lastWidth===width;lastWidth=width;
  const heights=Array(columns).fill(30);
  for (const card of cards) card.style.width=width+'px';
  for (const card of cards) {
   const previous=Number(card.dataset.paperColumn);
   const column=sameColumns&&card.dataset.paperColumn!==undefined&&previous<columns?previous:heights.indexOf(Math.min(...heights));
   card.dataset.paperColumn=column;
   card.style.left=(padding+column*(width+gap))+'px';card.style.top=heights[column]+'px';
   heights[column]+=card.offsetHeight+space;
  }
  board.style.height=(Math.max(...heights)-space+12)+'px';
 }
 placePapers=place;place();
 paperObserver=new ResizeObserver(()=>{cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(place);});
 paperObserver.observe(board);for (const card of board.children) paperObserver.observe(card);
}

// Keep the existing DOM and viewport. Move surviving cards from their old positions.
export async function closeDailyGap(card) {
 if (!card?.isConnected) return;
 const board=card.parentElement, scrollX=window.scrollX, scrollY=window.scrollY;
 const others=[...board.children].filter(c=>c!==card&&c.matches('.daily-story'));
 const before=new Map(others.map(c=>[c,{left:c.offsetLeft,top:c.offsetTop}]));
 const focusWasInside=card.contains(document.activeElement);
 const column=card.dataset.paperColumn;
 const next=others.find(c=>c.dataset.paperColumn===column&&c.offsetTop>card.offsetTop)||others.find(c=>c.dataset.paperColumn===column)||others[0];
 paperObserver?.unobserve(card);
 // Reserve enough height to avoid the browser clamping the viewport near the end.
 board.style.minHeight=board.offsetHeight+'px';
 card.remove();placePapers?.();
 const animations=[];
 if (motion.matches) for (const c of others) {
  const old=before.get(c),dx=old.left-c.offsetLeft,dy=old.top-c.offsetTop;
  if ((dx||dy)&&c.animate) animations.push(c.animate([{translate:`${dx}px ${dy}px`},{translate:'0px 0px'}],{duration:560,easing:'cubic-bezier(.22,.7,.25,1)'}).finished.catch(()=>{}));
 }
 if (focusWasInside) next?.querySelector('button,a')?.focus({preventScroll:true});
 if (window.scrollY!==scrollY) window.scrollTo({left:scrollX,top:scrollY,behavior:'instant'});
 await Promise.all(animations);
 // The document may shrink, but never beyond the user's current reading position.
 const reserved=Math.max(0,window.scrollY+window.innerHeight-(board.getBoundingClientRect().top+window.scrollY));
 board.style.minHeight=Math.min(board.offsetHeight,reserved)+'px';
}
