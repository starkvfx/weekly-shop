
(function(){
const STEPS=["Week","Meals","Top-ups","Cupboard","Household & drinks","List"];
const AISLES=["Fresh & Chilled","Bakery","Food Cupboard","Frozen","Drinks","Household","Other"];
const TICK='<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
let sheet=null, autoOpened=false;
let baseMaster=null, userRecipes=[], userItems=[], inv={}, catalogue=null, lookups=[];
let invUI=null; /* {tab, draft:{key:level|null}, recipe:{...}, item:{...}, q:""} */
let commonRecipes=null, readyMeals=null, recKind="scratch", rf={serves:"any",methods:[],q:""};
/* ---------- ready meals ---------- */
const METHOD_LABEL={oven:"Oven",micro:"Microwave",hob:"Hob"};
function loadReady(){ if(readyMeals||!db) return; readyMeals=[]; db.doc("catalog/ready").get().then(s=>{readyMeals=s.exists?(s.data().items||[]):[];render();renderInv();},()=>{}); }
function rmId(r){return "rm-"+r.id;}
function rmMethods(r){return ["oven","micro","hob"].filter(k=>r[k]);}
function rmCookLine(r){ const parts=rmMethods(r).map(k=>`${METHOD_LABEL[k]}${r[k]>1?` ${r[k]} min`:""}`); return (parts.length?parts.join(" · "):"See pack")+(r.frozen?" (from frozen)":" (from chilled)"); }
function rmFilter(list,f){
  const qt=(f.q||"").toLowerCase().match(/[a-z0-9]+/g)||[];
  return list.filter(r=>{ if(f.serves==="1"&&r.serves!==1) return false; if(f.serves==="2"&&!(r.serves>=2)) return false;
    if(f.methods.length&&!f.methods.some(k=>r[k])) return false;
    if(qt.length){ const nt=(r.name+" "+(r.cuisine||"")).toLowerCase().match(/[a-z0-9]+/g)||[]; if(!qt.every(t=>nt.some(x=>x.startsWith(t)))) return false; }
    return true; });
}
function rmAsMeal(r,qty){ return {id:rmId(r),name:r.name,ready:true,readyId:r.id,dinners:1,protein:"other",region:r.cuisine||"",serves:r.serves||null,frozen:r.frozen||0,oven:r.oven||0,micro:r.micro||0,hob:r.hob||0,
  buy:[Object.assign({product:(r.name+" "+r.size).trim(),aisle:r.frozen?"Frozen":"Fresh & Chilled",qty:qty||1,price:r.price},r.offer?{offer:"On offer"}:{})],check:[],steps:[`Cook from the pack: ${rmCookLine(r)}.`],desc:`${r.size}${r.serves?` · serves ${r.serves}`:""}`}; }
function rmInWeek(r){ return inWeek(rmId(r)); }
function rmQty(r){ const m=run&&(run.extraMeals||[]).find(x=>x.id===rmId(r)); return m?m.buy[0].qty:(r.serves===1?2:1); }
function rmToggleWeek(r){ if(!run) return; const id=rmId(r);
  if(rmInWeek(r)) change(x=>{x.meals=x.meals.filter(i=>i!==id);x.extraMeals=(x.extraMeals||[]).filter(m=>m.id!==id);});
  else change(x=>{x.meals=[...x.meals,id]; x.extraMeals=[...(x.extraMeals||[]).filter(m=>m.id!==id),rmAsMeal(r,r.serves===1?2:1)];}); }
function rmSetQty(r,d){ const id=rmId(r); change(x=>{ x.extraMeals=(x.extraMeals||[]).map(m=>m.id===id?Object.assign({},m,{buy:[Object.assign({},m.buy[0],{qty:Math.max(1,Math.min(6,m.buy[0].qty+d))})]}):m); }); }
async function rmToggleFav(r){ const id=rmId(r); try{ if(isFav(id)) await db.collection("recipes").doc(id).delete(); else await db.collection("recipes").doc(id).set(Object.assign(recipeBody(rmAsMeal(r,1)),{ready:true,readyId:r.id,serves:r.serves||null,frozen:r.frozen||0,oven:r.oven||0,micro:r.micro||0,hob:r.hob||0})); }catch(e){ saveMsg="Couldn't update favourites"; renderBar(); } }
function rmFilters(scope){
  return `<div class="rmfilters">
    <div class="inline"><span class="muted">Serves</span><div class="chips">${[["any","Any"],["1","For one"],["2","For two"]].map(([k,l])=>`<button type="button" class="chip sm txt" data-rmserves="${k}" data-scope="${scope}" aria-pressed="${rf.serves===k}">${l}</button>`).join("")}</div></div>
    <div class="inline"><span class="muted">Cook by</span><div class="chips">${["oven","micro","hob"].map(k=>`<button type="button" class="chip sm txt" data-rmmethod="${k}" data-scope="${scope}" aria-pressed="${rf.methods.includes(k)}">${METHOD_LABEL[k]}</button>`).join("")}</div></div>
    <input type="text" id="rmQ${scope}" value="${esc(rf.q)}" placeholder="Search ready meals, e.g. lasagne, curry, fish" autocomplete="off"></div>`;
}
function rmCard(r){
  const wk=rmInWeek(r), fav=isFav(rmId(r));
  return `<div class="rmcard"><div class="rmtop"><span class="rname">${esc(r.name)}</span><button type="button" class="star" data-rmfav="${esc(r.id)}" aria-pressed="${fav}" aria-label="${fav?"Remove from":"Save to"} favourites">${fav?"★":"☆"}</button></div>
    <span class="meta"><span class="tag mono">${money(r.price)}</span>${r.offer?'<span class="tag on">offer</span>':""}<span class="tag">${esc(r.size)}</span>${r.serves?`<span class="tag dinners">for ${r.serves===1?"one":r.serves===2?"two":r.serves}</span>`:""}${r.cuisine?`<span class="tag">${esc(r.cuisine)}</span>`:""}</span>
    <span class="cookline">${esc(rmCookLine(r))}</span>
    ${run?`<div class="inline">${wk?`<button type="button" class="btn primary sm" data-rmweek="${esc(r.id)}">On this week ✓</button>${qtyCtl(rmQty(r),`data-rmqty="${esc(r.id)}"`,true)}`:`<button type="button" class="btn sm" data-rmweek="${esc(r.id)}">Add to this week</button>`}</div>`:""}</div>`;
}
function refreshRm(){ if(invUI) renderInv(); if(view==="recipes") render(); }
function rmList(limit){
  if(!readyMeals||!readyMeals.length) return `<div class="empty">${readyMeals?"No ready meals loaded yet.":"Loading ready meals…"}</div>`;
  const list=rmFilter(readyMeals,rf).sort((a,b)=>(isFav(rmId(b))-isFav(rmId(a)))||(rmInWeek(b)-rmInWeek(a))||a.price-b.price);
  return `<p class="hint">${list.length} of ${readyMeals.length} ready meals${readyMeals.checkedAt?"":""}. Favourites first, then cheapest.</p>${list.length?`<div class="rgrid">${list.slice(0,limit||400).map(rmCard).join("")}</div>`:`<div class="empty">Nothing matches those filters.</div>`}`;
}
let library={}, view="plan", recTab="week", recRegion="Thai", rv=null, sampleFn=null, finding=null;
const REGIONS=["Chinese","Indian","Thai","Malaysian","Japanese","Eastern Europe","French","Spanish","Italian","United Kingdom","Wildcard"];
function regionSlug(r){return r.toLowerCase().replace(/[^a-z]+/g,"-");}
function libraryRecipes(regions){ return (regions||REGIONS).flatMap(r=>(library[r]||[])); }
function findRecipe(id){ return (master&&master.meals.find(m=>m.id===id))||(run&&(run.extraMeals||[]).find(m=>m.id===id))||libraryRecipes().find(m=>m.id===id)||null; }
function rebuildMaster(){
  if(!baseMaster){master=null;return;}
  const m=Object.assign({},baseMaster);
  const over={}; userRecipes.forEach(r=>{over[r.id]=r;});
  m.meals=[...baseMaster.meals.map(b=>over[b.id]?Object.assign({},b,over[b.id],{edited:true}):b),...userRecipes.filter(r=>!baseMaster.meals.some(b=>b.id===r.id)).map(r=>Object.assign({},r,{user:true}))];
  ["topups","household","drinks"].forEach(k=>{m[k]=[...(baseMaster[k]||[]),...userItems.filter(i=>i.kind===k).map(i=>Object.assign({},i,{user:true}))];});
  master=m;
}
let db=null, master=null, runs=[], run=null, step=0, dirty=false, inflight=false, saveT=null, saveMsg="", readOnly=false, suggestSeed=0;

const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clone=o=>JSON.parse(JSON.stringify(o));
const money=n=>"£"+n.toFixed(2);
const DAY=86400000;
function parseD(s){const [y,m,d]=s.split("-").map(Number);return new Date(Date.UTC(y,m-1,d));}
function fmtD(s,opts){if(!s)return "";return parseD(s).toLocaleDateString("en-GB",Object.assign({weekday:"short",day:"numeric",month:"short",timeZone:"UTC"},opts||{}));}
function isoD(dt){return dt.toISOString().slice(0,10);}
function daysBetween(a,b){return Math.round((parseD(b)-parseD(a))/DAY);}
function nextMonday(from){const d=from?parseD(from):new Date(Date.UTC(new Date().getFullYear(),new Date().getMonth(),new Date().getDate()));let x=new Date(d.getTime()+DAY);while(x.getUTCDay()!==1)x=new Date(x.getTime()+DAY);return isoD(x);}

function defaultBreakfast(){return {zoe:["oats"],owen:["cereal"],cereal:"cornflakes",cerealCustom:"",cerealQty:1,weekend:false,weekendPicks:[],weekendCustom:[]};}
function bf(){ if(!run.breakfast) run.breakfast=defaultBreakfast(); const d=defaultBreakfast(); for(const k in d) if(run.breakfast[k]==null) run.breakfast[k]=d[k]; return run.breakfast; }
function bfData(){ return master.breakfasts||{zoe:[],owen:[],cereals:[],weekend:[]}; }
function pantryFor(){ const out={}; if(!master.breakfasts) return out; const b=bf(); (b.zoe||[]).forEach(id=>{const o=bfData().zoe.find(x=>x.id===id); if(o) o.pantry.forEach(p=>{out[p]="for Zoe's "+(id==="oats"?"oats":"pancakes");});}); return out; }
function blankRun(delivery,prevBreakfast){return {delivery,dinners:5,notes:"",breakfast:prevBreakfast?Object.assign(clone(prevBreakfast),{weekend:false,weekendPicks:[],weekendCustom:[]}):defaultBreakfast(),meals:[],staples:{},topups:{},drinks:{},household:{},cupboard:[],extras:[],edits:{},status:"planning",report:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};}

/* ---------- derived data ---------- */
function otherRuns(cur){cur=cur||run;return runs.filter(r=>cur&&r.id!==cur.id&&(r.status==="ready"||r.status==="filled"));}
/* Last time an item was bought, or checked and declined ("we've got some"), before this run's delivery. */
function lastBought(item,kind,cur){
  cur=cur||run; let best=item.lastBought||null;
  for(const r of otherRuns(cur)){ if(r.delivery>(cur?cur.delivery:"9999")) continue;
    const bought=r[kind]&&r[kind][item.id]>0, declined=r.declined&&(r.declined[kind]||[]).includes(item.id);
    if((bought||declined)&&(!best||r.delivery>best)) best=r.delivery; }
  /* A stock level someone entered by hand wins until the item is next bought. */
  const ov=inv[kind+":"+item.id];
  if(ov&&item.everyDays){ const setD=ov.setAt.slice(0,10); if(!best||setD>=best){ const shift=Math.round((1-ov.level)*item.everyDays); return isoD(new Date(parseD(setD).getTime()-shift*DAY)); } }
  return best;
}
function overrideFor(item,kind){ const ov=inv[kind+":"+item.id]; if(!ov) return null; let best=item.lastBought||null;
  for(const r of runs.filter(r=>r.status==="ready"||r.status==="filled")){ if(r[kind]&&r[kind][item.id]>0&&(!best||r.delivery>best)) best=r.delivery; }
  return (!best||ov.setAt.slice(0,10)>=best)?ov:null; }
function dueInfo(item,kind,cur){
  cur=cur||run; const lb=lastBought(item,kind,cur); if(!lb||!item.everyDays||!cur) return {lb,due:false};
  const age=daysBetween(lb,cur.delivery); return {lb,age,due:age>=item.everyDays};
}
function recentMeals(cur){
  cur=cur||run; const out={}; if(!cur) return out;
  for(const r of otherRuns(cur)){ const gap=daysBetween(r.delivery,cur.delivery); if(gap>0&&gap<=14) (r.meals||[]).forEach(m=>{out[m]=r.delivery;}); }
  return out;
}
/* ---------- automatic fill ---------- */
const AUTO_KINDS=["topups","household","drinks"];
function applyAuto(r,opts){
  r.auto=r.auto||{}; r.declined=r.declined||{};
  AUTO_KINDS.forEach(kind=>{ r[kind]=r[kind]||{}; r.auto[kind]=r.auto[kind]||[];
    master[kind].forEach(i=>{
      if(i.autoAdd===false||(r.declined[kind]||[]).includes(i.id)||r[kind][i.id]>0) return;
      if(dueInfo(i,kind,r).due){ r[kind][i.id]=i.qty||1; if(!r.auto[kind].includes(i.id)) r.auto[kind].push(i.id); }
    });
  });
  if(opts&&opts.meals) r.meals=pickMeals(r);
}
/* "New meals" weeks pick from the recipe library instead of favourites, and carry those recipes on the run. */
/* One recipe = one meal. "New meals" weeks pick from the recipe library and carry those recipes on the run. */
function mealPool(r){ const src=r.mealSource&&r.mealSource.type==="new"?libraryRecipes(r.mealSource.regions):null; return src&&src.length?{list:src,isNew:true}:{list:master.meals,isNew:false}; }
function pickMeals(r){ const n=r.dinners; const keep=(r.extraMeals||[]).filter(m=>m.ready&&(r.meals||[]).includes(m.id)); r.meals=keep.map(m=>m.id).slice(0,n); r.extraMeals=keep.filter(m=>r.meals.includes(m.id)); topUpMeals(r,n); return r.meals; }
/* Grow or shrink the week to n meals, keeping what's already chosen. */
function topUpMeals(r,n){
  r.meals=r.meals||[]; r.extraMeals=r.extraMeals||[];
  if(r.meals.length>n){ r.meals=r.meals.slice(0,n); r.extraMeals=r.extraMeals.filter(m=>r.meals.includes(m.id)); return; }
  const need=n-r.meals.length; if(need<=0) return;
  const {list,isNew}=mealPool(r);
  const ids=pickFrom(r,list,isNew?{}:recentMeals(r),need,r.meals);
  ids.forEach(id=>{ r.meals.push(id); if(isNew&&!isFav(id)){ const m=list.find(x=>x.id===id); if(m&&!r.extraMeals.some(x=>x.id===id)) r.extraMeals.push(clone(m)); } });
}
function pickFrom(r,all,recent,count,exclude){
  exclude=exclude||[]; all=all.filter(m=>!m.ready&&!exclude.includes(m.id));
  let pool=all.filter(m=>!recent[m.id]); if(pool.length<count) pool=all;
  const have={}; exclude.forEach(id=>{const m=mealById(id)||findRecipe(id); if(m) have[m.protein]=1;});
  let best=[],bestScore=-Infinity;
  for(let a=0;a<300;a++){
    const sh=[...pool].sort(()=>Math.random()-.5); const pick=[]; const prot=Object.assign({},have);
    for(const m of sh){ if(pick.length>=count) break; if(prot[m.protein]&&Math.random()<.8&&sh.length>count*2) continue; pick.push(m); prot[m.protein]=1; }
    for(const m of sh){ if(pick.length>=count) break; if(!pick.includes(m)) pick.push(m); }
    const score=Object.keys(prot).length*6+pick.filter(m=>m.frequent).length*3+Math.random()*4;
    if(score>bestScore){bestScore=score;best=pick;}
  }
  return best.map(m=>m.id);
}
function autoAdded(){ const out=[]; if(!run.auto) return out; AUTO_KINDS.forEach(kind=>(run.auto[kind]||[]).forEach(id=>{const i=master[kind].find(x=>x.id===id); if(i&&run[kind][id]>0) out.push({kind,i});})); return out; }
function decline(kind,id){ change(r=>{ r[kind][id]=0; r.declined=r.declined||{}; r.declined[kind]=[...new Set([...(r.declined[kind]||[]),id])]; if(r.auto&&r.auto[kind]) r.auto[kind]=r.auto[kind].filter(x=>x!==id); }); }
/* ---------- modes ---------- */
const MODES={auto:{name:"Full auto",desc:"Tell it how many meals. They're picked for you (or pick them yourself) and top-ups are added when they're due.",steps:[5]},
  manual:{name:"Manual",desc:"Go through every stage yourself.",steps:[0,1,2,3,4,5]}};
let showAll=false, pickOpen=false, priceReq=null;
function modeOf(){const m=run&&run.mode;return m==="meals"?"auto":(m&&MODES[m])?m:"manual";}
function priceInfo(product){return (master&&master.prices&&master.prices[product])||null;}
function visibleSteps(){return showAll?[0,1,2,3,4,5]:MODES[modeOf()].steps;}
function mealById(id){return (run&&(run.extraMeals||[]).find(m=>m.id===id&&m.ready))||master.meals.find(m=>m.id===id)||(run&&(run.extraMeals||[]).find(m=>m.id===id));}
function plannedDinners(){return (run.meals||[]).length;}

function buildList(){
  const map=new Map();
  const add=(product,aisle,qty,price,src)=>{ if(qty<=0) return; const k=product; const pi=priceInfo(product); if(pi&&pi.price!=null) price=pi.price;
    const e=map.get(k)||{key:k,product,aisle:aisle||"Other",qty:0,price:price,offer:pi&&pi.offer||null,note:pi&&pi.note||null,srcs:[]}; e.qty+=qty; if(e.price==null&&price!=null)e.price=price; if(src&&!e.srcs.includes(src))e.srcs.push(src); map.set(k,e); };
  master.staples.forEach(i=>{const q=(run.staples[i.id]!=null)?run.staples[i.id]:i.qty; add(i.product,i.aisle,q,i.price,"Weekly");});
  ["topups","drinks","household"].forEach(kind=>master[kind].forEach(i=>{const q=run[kind][i.id]||0; add(i.product,i.aisle,q,i.price,kind==="topups"?"Top-up":kind==="drinks"?"Drinks":"Household");}));
  if(master.breakfasts){ const b=bf(), B=bfData();
    (b.zoe||[]).forEach(id=>{const o=B.zoe.find(x=>x.id===id); if(o) o.buy.forEach(i=>add(i.product,i.aisle,i.qty,i.price,"Zoe's breakfast"));});
    (b.owen||[]).forEach(id=>{const o=B.owen.find(x=>x.id===id); if(!o) return;
      if(id==="cereal"){ const q=b.cerealQty||0; if(b.cereal==="custom"){ if(b.cerealCustom.trim()) add(b.cerealCustom.trim(),"Food Cupboard",q,null,"Owen's breakfast"); } else { const c=B.cereals.find(x=>x.id===b.cereal); if(c) add(c.product,"Food Cupboard",q,c.price,"Owen's breakfast"); } }
      else o.buy.forEach(i=>add(i.product,i.aisle,i.qty,i.price,"Owen's breakfast"));});
    if(b.weekend){ (b.weekendPicks||[]).forEach(id=>{const o=B.weekend.find(x=>x.id===id); if(o) o.buy.forEach(i=>add(i.product,i.aisle,i.qty,i.price,"Weekend breakfast"));});
      (b.weekendCustom||[]).forEach(x=>add(x.text,"Other",x.qty||1,null,"Weekend breakfast")); }
  }
  (run.meals||[]).forEach(id=>{const m=mealById(id); if(!m)return; m.buy.forEach(b=>add(b.product,b.aisle,b.qty,b.price,m.name));});
  (run.cupboard||[]).forEach(c=>add(c,"Food Cupboard",1,null,"Cupboard"));
  (run.extras||[]).forEach(x=>add(x.text,"Other",x.qty||1,null,"Extra"));
  const items=[...map.values()];
  items.forEach(e=>{e.base=e.qty; if(run.edits&&run.edits[e.key]!=null) e.qty=run.edits[e.key];});
  return items;
}
function totals(items){let sum=0,unpriced=0,count=0;items.forEach(e=>{if(e.qty<=0)return;count+=e.qty;if(e.price!=null)sum+=e.price*e.qty;else unpriced++;});return {sum,unpriced,count};}

/* ---------- persistence ---------- */
function change(mut,opts){
  if(!run||readOnly) return;
  mut(run); run.updatedAt=new Date().toISOString(); dirty=true; saveMsg="Saving…";
  if(!opts||opts.render!==false) render(); else renderBar();
  clearTimeout(saveT); saveT=setTimeout(flush,700);
}
/* The PC agent writes report, agent, filledAt (and status "filled") on a week. The phones never
   change those, so always carry the newest copy forward instead of overwriting it with an older one. */
function keepAgentFields(local,remote){
  if(!remote) return;
  ["report","agent","filledAt"].forEach(k=>{ if(remote[k]!==undefined) local[k]=clone(remote[k]); });
  if(remote.status==="filled"&&local.status==="ready"&&remote.filledAt&&Date.parse(remote.filledAt)>=Date.parse(local.readyAt||0)) local.status="filled";
}
async function flush(){
  if(inflight||!dirty||!db||!run) return;
  inflight=true; dirty=false;
  keepAgentFields(run,runs.find(r=>r.id===run.id));
  const body=clone(run); const id=body.id; delete body.id;
  try{ await db.doc("runs/"+id).set(body); saveMsg="Saved"; }
  catch(e){
    if(e&&e.code==="invalid_argument"){ readOnly=true; saveMsg="You can view this list but not change it."; }
    else if(e&&e.code==="unavailable"){ dirty=true; saveMsg="Connection dropped, retrying…"; setTimeout(flush,1500+Math.random()*1000); }
    else { saveMsg="Couldn't save: "+((e&&e.message)||"unknown error"); }
  }
  inflight=false; renderBar();
  if(dirty) { clearTimeout(saveT); saveT=setTimeout(flush,300); }
}
function selectRun(id){ const r=runs.find(x=>x.id===id); if(!r) return; run=clone(r); render(); }
async function newRun(mode,dinners,mealSource){
  if(!db||!master) return;
  const latest=runs.reduce((a,r)=>(!a||r.delivery>a)?r.delivery:a,null);
  let delivery=nextMonday(latest&&latest>isoD(new Date())?latest:null);
  while(runs.some(r=>r.delivery===delivery)) delivery=isoD(new Date(parseD(delivery).getTime()+7*DAY));
  const prev=[...runs].sort((a,b)=>b.delivery.localeCompare(a.delivery)).find(r=>r.breakfast);
  const body=blankRun(delivery,prev&&prev.breakfast); const ref=db.collection("runs").doc();
  body.mode=mode||"manual"; if(dinners) body.dinners=dinners; body.auto={}; body.declined={}; body.mealSource=mealSource||{type:"fav"}; body.extraMeals=[];
  run=Object.assign({id:ref.id},body);
  if(body.mode!=="manual"){ applyAuto(run,{meals:body.mode==="auto"}); Object.assign(body,clone(run)); delete body.id; }
  showAll=false; step=MODES[body.mode].steps[0]; dirty=false; render(); window.scrollTo({top:0});
  try{ await ref.set(body); saveMsg="Saved"; }catch(e){ if(e&&e.code==="invalid_argument"){readOnly=true;saveMsg="You can view this list but not change it.";} else saveMsg="Couldn't create the week: "+((e&&e.message)||""); }
  renderBar();
}

/* ---------- rendering ---------- */
function renderSteps(){
  if(!run){$("steps").innerHTML="";return;}
  const vis=visibleSteps(); if(!vis.includes(step)) step=vis[vis.length-1];
  const m=modeOf();
  let h=`<button class="step mode" type="button" id="modeBtn" aria-label="Change planning mode">${esc(MODES[m].name)} ▾</button>`;
  h+=vis.map((i,k)=>`<button class="step" type="button" data-step="${i}" ${i===step?'aria-current="step"':''}>${vis.length>1?`<span class="n">${k+1}</span>`:""}${esc(STEPS[i])}</button>`).join("");
  if(m!=="manual") h+=`<button class="step more" type="button" id="toggleAll">${showAll?"Fewer stages":"All stages"}</button>`;
  $("steps").innerHTML=h;
}
function renderRunPick(){
  const sel=$("runPick");
  if(!runs.length&&!run){sel.innerHTML='<option>No weeks yet</option>';sel.disabled=true;return;}
  const list=[...runs]; if(run&&!list.some(r=>r.id===run.id)) list.push(run);
  list.sort((a,b)=>b.delivery.localeCompare(a.delivery));
  sel.disabled=false;
  sel.innerHTML=list.map(r=>`<option value="${esc(r.id)}" ${run&&r.id===run.id?"selected":""}>${esc(fmtD(r.delivery))}${r.status==="ready"?" · ready":r.status==="filled"?" · filled":""}</option>`).join("");
}
function renderBanner(){
  const b=$("banner"); if(!run){b.innerHTML="";return;}
  let h='<div class="banner trial" style="margin-top:12px"><span>When you mark a week ready, the PC agent adds it to your booked Waitrose order. You confirm the order in the Waitrose app.</span></div>';
  if(readOnly) h+='<div class="banner warn" style="margin-top:8px"><span>You can view this list but not change it. Ask Owen to invite your email address.</span></div>';
  b.innerHTML=h;
}
function rowCheck(on,attrs){return `<button class="check" role="checkbox" aria-checked="${on}" type="button" ${attrs}>${on?TICK:""}</button>`;}
function qtyCtl(q,attrs,on){return `<div class="qty ${on?"":"off"}"><button type="button" aria-label="Less" ${attrs} data-d="-1">−</button><span>${q}</span><button type="button" aria-label="More" ${attrs} data-d="1">+</button></div>`;}

function paneWeek(){
  const cut=run.delivery?fmtD(isoD(new Date(parseD(run.delivery).getTime()-DAY))):"";
  return `<section class="pane">
    <div class="group"><h2>This week</h2><p class="lead">Set the delivery you've booked and how many meals you're cooking at home. Each meal is one recipe.</p></div>
    <div class="field"><label for="delivery">Delivery date</label>
      <input type="date" id="delivery" value="${esc(run.delivery)}">
      <span class="cutoff">Amend by 11pm ${esc(cut)}</span></div>
    <div class="group"><h3>Meals at home</h3>
      <div class="chips">${[1,2,3,4,5,6,7].map(n=>`<button type="button" class="chip" data-dinners="${n}" aria-pressed="${run.dinners===n}">${n}</button>`).join("")}</div></div>
    ${paneBreakfastChoices()}
    <div class="field"><label for="notes">Guests, nights out, anything different</label>
      <textarea id="notes" placeholder="e.g. friends over Saturday, out Thursday">${esc(run.notes)}</textarea></div>
  </section>`;
}
function optCard(attr,id,on,name,desc){return `<button type="button" class="meal opt" ${attr}="${esc(id)}" aria-pressed="${on}"><span class="name">${esc(name)}</span>${desc?`<span class="t2 muted">${esc(desc)}</span>`:""}</button>`;}
function paneBreakfastChoices(){
  if(!master.breakfasts) return "";
  const b=bf(), B=bfData();
  const cerealOn=(b.owen||[]).includes("cereal");
  let h=`<div class="group"><h3>Zoe's breakfast</h3><div class="opts">${B.zoe.map(o=>optCard("data-zoe",o.id,b.zoe.includes(o.id),o.name,o.desc)).join("")}</div></div>`;
  h+=`<div class="group"><h3>Owen's breakfast</h3><div class="opts">${B.owen.map(o=>optCard("data-owen",o.id,b.owen.includes(o.id),o.name,o.id==="cereal"?"":o.desc)).join("")}</div>`;
  if(cerealOn){
    h+=`<div class="subopts"><div class="chips">${B.cereals.map(c=>`<button type="button" class="chip txt" data-cereal="${esc(c.id)}" aria-pressed="${b.cereal===c.id}">${esc(c.name)}</button>`).join("")}<button type="button" class="chip txt" data-cereal="custom" aria-pressed="${b.cereal==="custom"}">Something else</button></div>
      ${b.cereal==="custom"?`<input type="text" id="cerealCustom" placeholder="Which cereal?" value="${esc(b.cerealCustom)}">`:""}
      <div class="inline"><span class="muted">Boxes this week</span>${qtyCtl(b.cerealQty,'data-cerealqty="1"',b.cerealQty>0)}</div></div>`;
  }
  h+=`</div>`;
  h+=`<div class="group"><h3>Any weekend breakfast?</h3><div class="chips"><button type="button" class="chip txt" data-weekend="0" aria-pressed="${!b.weekend}">No</button><button type="button" class="chip txt" data-weekend="1" aria-pressed="${!!b.weekend}">Yes</button></div>`;
  if(b.weekend){
    h+=`<div class="opts">${B.weekend.map(o=>optCard("data-wk",o.id,b.weekendPicks.includes(o.id),o.name,o.desc)).join("")}</div>`;
    if(b.weekendCustom.length) h+=`<div class="rows">${b.weekendCustom.map((x,i)=>`<div class="row"><span></span><div class="txt"><div class="t1">${esc(x.text)}${x.qty>1?" ×"+x.qty:""}</div></div><button type="button" class="btn ghost" data-wkdel="${i}" aria-label="Remove ${esc(x.text)}">Remove</button></div>`).join("")}</div>`;
    h+=`<div class="addrow"><input type="text" id="wkAdd" placeholder="Add something, e.g. black pudding, hash browns x2"><button class="btn" type="button" id="wkAddBtn">Add</button></div>`;
  }
  h+=`</div>`;
  return h;
}
function paneMeals(){
  const planned=plannedDinners(), target=run.dinners, recent=recentMeals();
  const cls=planned===target?"full":planned>target?"over":"";
  const meals=[...master.meals].sort((a,b)=>(b.frequent-a.frequent)||a.name.localeCompare(b.name));
  return `<section class="pane">
    <div class="group"><h2>Meals</h2><p class="lead">Tap to choose. Meals cooked in the last fortnight are marked.</p></div>
    <div class="top"><div class="tally ${cls}"><span class="big mono">${planned}/${target}</span><span class="muted">meals planned${planned>target?" (over)":""}</span></div>
      <button class="btn" type="button" id="suggest">${run.meals.length?"Suggest another week":"Suggest a week"}</button></div>
    <div class="meals">${meals.map(m=>{const on=run.meals.includes(m.id);return `<button type="button" class="meal" data-meal="${esc(m.id)}" aria-pressed="${on}">
      <span class="name">${esc(m.name)}</span>
      <span class="meta"><span class="tag dinners">serves ${m.dinners===2?4:2}</span><span class="tag">${esc(m.protein)}</span>${m.frequent?'<span class="tag on">frequent</span>':""}${recent[m.id]?`<span class="tag recent">had ${esc(fmtD(recent[m.id],{weekday:undefined}))}</span>`:""}</span>
    </button>`;}).join("")}</div>
  </section>`;
}
function itemRows(kind,list,defaultOn){
  return `<div class="rows">${list.map(i=>{
    const q=kind==="staples"?((run.staples[i.id]!=null)?run.staples[i.id]:i.qty):(run[kind][i.id]||0);
    const on=q>0; const d=kind==="staples"?{}:dueInfo(i,kind);
    const tags=[]; const pf=kind==="topups"?pantryFor()[i.id]:null; if(pf) tags.push(`<span class="tag on">${esc(pf)}</span>`); if(d.due) tags.push('<span class="tag due">due</span>'); if(d.lb) tags.push(`<span class="tag">last ${esc(fmtD(d.lb,{weekday:undefined}))}</span>`);
    return `<div class="row">${rowCheck(on,`data-toggle="${kind}" data-id="${esc(i.id)}"`)}
      <div class="txt"><div class="t1">${esc(i.name)}</div><div class="t2">${esc(i.product)}${i.price!=null?" · "+money(i.price):""}</div>${tags.length?`<div class="tags">${tags.join("")}</div>`:""}</div>
      ${qtyCtl(q,`data-qty="${kind}" data-id="${esc(i.id)}"`,on)}</div>`;}).join("")}</div>`;
}
function paneBreakfast(){
  const dueCount=master.topups.filter(i=>dueInfo(i,"topups").due).length;
  return `<section class="pane">
    <div class="group"><h2>Top-ups</h2><p class="lead">Breakfast fresh items come from your choices on the first page. ${Object.keys(pantryFor()).length?"Check the oat jar: its ingredients are marked below. ":""}${dueCount?`${dueCount} top-up${dueCount>1?"s look":" looks"} due.`:"Nothing looks due."}</p></div>
    <div class="group"><h3>Every week</h3>${itemRows("staples",master.staples)}</div>
    <div class="group"><h3>Every few weeks</h3>${itemRows("topups",master.topups)}</div>
  </section>`;
}
function paneCupboard(){
  const need={}; run.meals.forEach(id=>{const m=mealById(id); if(m) m.check.forEach(c=>{(need[c]=need[c]||[]).push(m.name);});});
  const keys=Object.keys(need).sort();
  const extraCup=(run.cupboard||[]).filter(c=>!need[c]);
  return `<section class="pane">
    <div class="group"><h2>Cupboard check</h2><p class="lead">${keys.length?"These are what this week's meals use from the cupboard. Tick anything running low and it goes on the list.":"Choose meals first and their cupboard items appear here."}</p></div>
    ${keys.length?`<div class="rows">${keys.map(c=>{const on=run.cupboard.includes(c);return `<div class="row">${rowCheck(on,`data-cup="${esc(c)}"`)}<div class="txt"><div class="t1">${esc(c)}</div><div class="t2">${esc(need[c].join(", "))}</div></div><span></span></div>`;}).join("")}</div>`:""}
    ${extraCup.length?`<div class="group"><h3>Also added</h3><div class="rows">${extraCup.map(c=>`<div class="row">${rowCheck(true,`data-cup="${esc(c)}"`)}<div class="txt"><div class="t1">${esc(c)}</div></div><span></span></div>`).join("")}</div></div>`:""}
    <div class="field"><label for="cupAdd">Something else from the cupboard</label>
      <div class="addrow"><input type="text" id="cupAdd" placeholder="e.g. olive oil, cumin seed"><button class="btn" type="button" id="cupAddBtn">Add</button></div></div>
  </section>`;
}
function paneHouse(){
  const dueH=master.household.filter(i=>dueInfo(i,"household").due).length;
  return `<section class="pane">
    <div class="group"><h2>Household and drinks</h2><p class="lead">${dueH?`${dueH} household item${dueH>1?"s are":" is"} probably running low, judging by when you last bought ${dueH>1?"them":"it"}.`:"Nothing household looks due."}</p></div>
    <div class="group"><h3>Household</h3>${itemRows("household",master.household)}</div>
    <div class="group"><h3>Drinks and treats</h3>${itemRows("drinks",master.drinks)}</div>
  </section>`;
}
function paneList(){
  const items=buildList(); const t=totals(items); const min=master.minimumOrder||40;
  const byAisle={}; items.forEach(e=>{(byAisle[e.aisle]=byAisle[e.aisle]||[]).push(e);});
  const changedSinceReady=run.status==="ready"&&run.readyAt&&run.updatedAt>run.readyAt;
  let h=`<section class="pane">
    <div class="group"><h2>The list</h2><p class="lead">${modeOf()==="manual"?"Check quantities, add extras, then mark it ready.":"Built for you. Change anything below, then mark it ready."}</p></div>`;
  if(modeOf()!=="manual") h+=weekSummary();
  if(run.report) h+=`<div class="banner ready"><div><h3 style="margin-bottom:4px">Agent report</h3><div class="report">${esc(run.report)}</div></div></div>`;
  if(run.status==="ready") h+=`<div class="banner ready"><span>${changedSinceReady?"Changed since you marked it ready.":"Ready. The PC agent will add it to your booked order."}</span></div>`;
  if(t.sum>0&&t.sum<min) h+=`<div class="banner warn"><span>About ${money(t.sum)} of priced items, under the ${money(min)} minimum order.</span></div>`;
  h+=`<div class="receipt"><div class="head"><span>Delivery ${esc(fmtD(run.delivery))}</span><span>${t.count} items</span></div>`;
  AISLES.forEach(a=>{const list=byAisle[a]; if(!list) return; list.sort((x,y)=>x.product.localeCompare(y.product));
    h+=`<div class="aisle">${esc(a)}</div>`+list.map(e=>`<div class="line ${e.qty<=0?"removed":""}"><span class="p">${esc(e.product)}<span class="src">${esc(e.srcs.join(" · "))}</span></span>
      ${qtyCtl(e.qty,`data-edit="${esc(e.key)}" data-base="${e.base}"`,e.qty>0)}
      <span class="amt">${e.price!=null&&e.qty>0?money(e.price*e.qty):e.qty>0?"–":""}${e.offer&&e.qty>0?`<span class="offer">${esc(e.offer)}</span>`:""}${e.note&&e.qty>0?`<span class="offer warnnote" title="${esc(e.note)}">Not found on Waitrose</span>`:""}</span></div>`).join("");});
  const pc=master.pricesCheckedAt;
  const reqPending=!!(priceReq&&priceReq.requestedAt&&(!pc||Date.parse(priceReq.requestedAt)>Date.parse(pc)));
  h+=`<div class="totals"><div class="grand"><span>Estimate</span><span>${money(t.sum)}</span></div>${t.unpriced?`<div class="muted"><span>${t.unpriced} item${t.unpriced>1?"s":""} without a price yet</span><span></span></div>`:""}</div>
    <div class="pricecheck"><span>${pc?`Waitrose prices checked ${esc(fmtD(pc.slice(0,10)))}`:"Prices from your past orders"}${reqPending?" · new check requested":""}</span><button class="link" type="button" id="priceCheck" ${reqPending?"disabled":""}>${reqPending?"Requested":"Check latest prices"}</button></div></div>
    <div class="field"><label for="extraAdd">Add an extra</label>
      <div class="addrow"><input type="text" id="extraAdd" placeholder="e.g. birthday candles, lemons x2"><button class="btn" type="button" id="extraAddBtn">Add</button></div></div>
    <div class="chips">
      <button class="btn primary" type="button" id="ready">${run.status==="ready"?(changedSinceReady?"Mark ready again":"Ready ✓"):"Mark ready"}</button>
      ${run.status==="ready"?'<button class="btn" type="button" id="unready">Back to planning</button>':""}
      <button class="btn" type="button" id="copy">Copy list</button>
    </div>
  </section>`;
  return h;
}
function breakfastLine(){
  if(!master.breakfasts) return ""; const b=bf(), B=bfData();
  const nm=(list,ids)=>ids.map(id=>{const o=list.find(x=>x.id===id);return o?o.name:id;});
  const owen=(b.owen||[]).map(id=>id==="cereal"?(b.cereal==="custom"?(b.cerealCustom||"cereal"):((B.cereals.find(c=>c.id===b.cereal)||{}).name||"cereal")):"Boiled eggs");
  const parts=[`Zoe: ${nm(B.zoe,b.zoe||[]).join(", ")||"nothing"}`,`Owen: ${owen.join(", ")||"nothing"}`];
  if(b.weekend) parts.push("Weekend: "+([...nm(B.weekend,b.weekendPicks||[]),...(b.weekendCustom||[]).map(x=>x.text)].join(", ")||"to decide"));
  return parts.join(" · ");
}
function weekSummary(){
  const m=modeOf(), planned=plannedDinners(), auto=autoAdded();
  const need={}; run.meals.forEach(id=>{const ml=mealById(id); if(ml) ml.check.forEach(c=>{need[c]=1;});});
  const cup=Object.keys(need).sort();
  let h=`<div class="summary">
    <div class="srow"><h3>Meals at home</h3><div class="chips">${[1,2,3,4,5,6,7].map(n=>`<button type="button" class="chip sm" data-dinners="${n}" aria-pressed="${run.dinners===n}">${n}</button>`).join("")}</div></div>
    <div class="srow"><div class="shead"><h3>Meals · ${planned}/${run.dinners}</h3><button class="link" type="button" id="suggest">Shuffle</button></div>
      ${run.mealSource&&run.mealSource.type==="new"?`<p class="hint">New recipes from ${esc(run.mealSource.regions.join(", "))}, for this week only. Tap one to see it or save it.</p>`:""}
      <div class="mealline">${run.meals.length?run.meals.map(id=>{const ml=mealById(id);return ml?`<button type="button" class="pill" data-openrec="${esc(ml.id)}">${esc(ml.name)}</button>`:"";}).join(""):'<span class="muted">No meals chosen yet.</span>'}</div>
      <button class="link left" type="button" id="pickToggle" aria-expanded="${pickOpen}">${pickOpen?"Done picking":"Pick meals myself"}</button>
      ${pickOpen?(()=>{const recent=recentMeals();return `<p class="hint">Tap to add or remove. ${planned===run.dinners?"All meals picked.":planned<run.dinners?`${run.dinners-planned} more meal${run.dinners-planned>1?"s":""} to pick.`:`${planned-run.dinners} over.`}</p><div class="mealline">${[...master.meals].sort((a,b)=>a.name.localeCompare(b.name)).map(ml=>`<button type="button" class="pill toggle" data-meal="${esc(ml.id)}" aria-pressed="${run.meals.includes(ml.id)}">${esc(ml.name)}${recent[ml.id]?' <span class="recentdot" title="Had recently">·recent</span>':""}</button>`).join("")}</div>`;})():""}</div>
    <div class="srow"><div class="shead"><h3>Breakfast</h3><button class="link" type="button" id="editBreakfast">Change</button></div><p>${esc(breakfastLine())}</p></div>`;
  h+=`<div class="srow"><h3>Added because they're due</h3>${auto.length?`<div class="mealline">${auto.map(a=>`<button type="button" class="pill x" data-decline="${a.kind}:${esc(a.i.id)}" aria-label="Remove ${esc(a.i.name)}, we have some">${esc(a.i.name)} <span aria-hidden="true">×</span></button>`).join("")}</div><p class="hint">Tap one you don't need. It won't come back until it's due again.</p>`:'<p class="muted">Nothing due this week.</p>'}</div>`;
  if(cup.length) h+=`<div class="srow"><h3>Running low on any of these?</h3><div class="mealline">${cup.map(c=>`<button type="button" class="pill toggle" data-cup="${esc(c)}" aria-pressed="${run.cupboard.includes(c)}">${esc(c)}</button>`).join("")}</div></div>`;
  return h+`</div>`;
}
function renderSheet(){
  const s=$("sheet"); if(!sheet){s.hidden=true;return;}
  s.hidden=false;
  s.innerHTML=`<div class="sheet-card" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <div class="shead"><h2 id="sheetTitle">${sheet.forNew?"Plan a new week":"Change how you plan"}</h2><div class="sheetlinks"><button class="link quiet" type="button" id="openInv">Inventory update</button>${(sheet.forNew&&!run)?"":'<button class="link" type="button" id="sheetClose">Close</button>'}</div></div>
    <div class="modes">${Object.entries(MODES).map(([k,v])=>`<button type="button" class="meal mode-card" data-pickmode="${k}" aria-pressed="${sheet.mode===k}"><span class="name">${esc(v.name)}</span><span class="t2 muted">${esc(v.desc)}</span></button>`).join("")}</div>
    ${sheet.mode!=="manual"?`<div class="group"><h3>Meals at home this week</h3><div class="chips">${[1,2,3,4,5,6,7].map(n=>`<button type="button" class="chip" data-sheetdin="${n}" aria-pressed="${sheet.dinners===n}">${n}</button>`).join("")}</div></div>
      <div class="group"><h3>Which meals?</h3><div class="chips"><button type="button" class="chip txt" data-sheetsrc="fav" aria-pressed="${sheet.src==="fav"}">Existing favourites</button><button type="button" class="chip txt" data-sheetsrc="new" aria-pressed="${sheet.src==="new"}">New meals</button></div>
      ${sheet.src==="new"?`<p class="hint">Pick one or more regions. New recipes are tried for this week only; save any you like to favourites from the Recipes tab.</p><div class="chips">${REGIONS.map(r=>`<button type="button" class="chip sm txt" data-sheetreg="${esc(r)}" aria-pressed="${sheet.regions.includes(r)}">${esc(r)}</button>`).join("")}</div>`:""}</div>`:""}
    <button class="btn primary big" type="button" id="sheetGo" ${sheet.mode==="auto"&&sheet.src==="new"&&!sheet.regions.length?"disabled":""}>${sheet.forNew?(sheet.mode==="auto"?"Build my list":"Start"):"Switch"}</button>
  </div>`;
}
function openSheet(forNew){
  const last=[...runs].sort((a,b)=>b.delivery.localeCompare(a.delivery))[0];
  const lastMode=last&&MODES[last.mode]?last.mode:"auto";
  const ms=(!forNew&&run&&run.mealSource)||null;
  sheet={forNew,mode:forNew?lastMode:modeOf(),dinners:forNew?((last&&last.dinners)||5):(run?run.dinners:5),src:ms&&ms.type==="new"?"new":"fav",regions:ms&&ms.regions?[...ms.regions]:[]};
  renderSheet(); const first=document.querySelector('#sheet [aria-pressed="true"]'); if(first) first.focus();
}
function closeSheet(){sheet=null;renderSheet();}
async function sheetGo(){
  const s=sheet; closeSheet();
  const src=s.mode==="auto"&&s.src==="new"?{type:"new",regions:s.regions}:{type:"fav"};
  if(s.forNew){ await newRun(s.mode,s.mode==="manual"?null:s.dinners,src); return; }
  const was=modeOf();
  change(r=>{ r.mode=s.mode; if(s.mode!=="manual"){ const dinChanged=r.dinners!==s.dinners; const srcChanged=JSON.stringify(r.mealSource||{type:"fav"})!==JSON.stringify(src); r.dinners=s.dinners; r.mealSource=src; applyAuto(r,{meals:s.mode==="auto"&&(srcChanged||!r.meals.length||was!=="auto")}); if(s.mode==="auto"&&dinChanged&&!srcChanged&&r.meals.length) topUpMeals(r,s.dinners); } });
  showAll=false; step=MODES[s.mode].steps[0]; render(); window.scrollTo({top:0});
}
function renderBar(){
  if(!run||!master){$("sum").textContent=db===null?"":"Connecting…";return;}
  const items=buildList(), t=totals(items);
  $("sum").innerHTML=`<b>${plannedDinners()}/${run.dinners}</b> meals · <b>${t.count}</b> items · <b>${money(t.sum)}</b>${saveMsg?` <span class="saved">· ${esc(saveMsg)}</span>`:""}`;
  const vis=visibleSteps(), k=vis.indexOf(step);
  $("back").hidden=$("next").hidden=vis.length<2;
  $("back").disabled=k<=0; $("next").textContent=k>=vis.length-1?"Done":"Next"; $("next").disabled=k>=vis.length-1;
}
function render(){
  document.querySelectorAll("[data-view]").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.view===view)));
  const main=$("main");
  if(view==="recipes"){ $("steps").hidden=true; document.querySelector(".bar").hidden=true; $("banner").innerHTML=""; renderRunPick(); main.innerHTML=master?paneRecipes():'<section class="pane"><div class="empty">Loading your recipes…</div></section>'; renderRec(); return; }
  $("steps").hidden=false; document.querySelector(".bar").hidden=false;
  renderSteps(); renderRunPick(); renderBanner();
  if(db===null){ main.innerHTML='<section class="pane"><div class="empty">Sign in to load your shared lists.</div></section>'; $("sum").textContent=""; return; }
  if(!master){ main.innerHTML='<section class="pane"><div class="empty">Loading your lists…<br>If this stays empty, the master list hasn\'t been loaded yet; run seed-data.sql from the setup guide.</div></section>'; renderBar(); return; }
  if(!run){ main.innerHTML='<section class="pane"><div class="empty">No week planned yet. Tap <b>New week</b> to start.</div></section>'; renderBar(); return; }
  main.innerHTML=[paneWeek,paneMeals,paneBreakfast,paneCupboard,paneHouse,paneList][step]();
  renderBar();
}

/* ---------- recipes ---------- */
function onThisWeek(product){ if(!run) return false; return buildList().some(e=>e.product===product&&e.qty>0); }
function isFav(id){ return !!(master&&master.meals.some(m=>m.id===id)); }
function inWeek(id){ return !!(run&&(run.meals||[]).includes(id)); }
function recCard(m){
  const steps=(m.steps||[]).length;
  return `<button type="button" class="rcard" data-openrec="${esc(m.id)}">
    <span class="rname">${esc(m.name)}</span>${m.desc?`<span class="rdesc">${esc(m.desc)}</span>`:""}
    <span class="meta">${m.region?`<span class="tag">${esc(m.region)}</span>`:""}<span class="tag dinners">serves ${m.dinners===2?4:2}</span>${m.time?`<span class="tag">${m.time} min</span>`:""}${steps?"":'<span class="tag due">no method yet</span>'}${inWeek(m.id)?'<span class="tag on">this week</span>':""}</span></button>`;
}
function kindSwitch(scope){ return `<div class="kindsw" role="tablist" aria-label="Recipe type">${[["scratch","Cook from scratch"],["ready","Ready meals"]].map(([k,l])=>`<button type="button" role="tab" data-reckind="${k}" data-scope="${scope}" aria-selected="${recKind===k}">${l}</button>`).join("")}</div>`; }
function paneRecipes(){
  if(recKind==="ready"){
    loadReady();
    const wk=run?(run.meals||[]).map(mealById).filter(m=>m&&m.ready):[];
    return `<section class="pane">${kindSwitch("main")}
      <div class="group"><h2>Ready meals</h2><p class="lead">Waitrose ready meals with today's prices. Add one to the week and it goes on the list; star the ones you like.</p></div>
      ${wk.length?`<div class="group"><h3>On this week</h3><div class="mealline">${wk.map(m=>`<button type="button" class="pill" data-openrec="${esc(m.id)}">${esc(m.name)}${m.buy[0].qty>1?` <span class="mono">×${m.buy[0].qty}</span>`:""}</button>`).join("")}</div></div>`:""}
      ${rmFilters("main")}<div id="rmListmain">${rmList()}</div></section>`;
  }
  const tabs=[["week","This week"],["fav","Favourites"],["discover","Discover"]];
  let h=`<section class="pane">${kindSwitch("main")}<div class="tabs" role="tablist">${tabs.map(([k,l])=>`<button type="button" role="tab" class="tab" data-rectab="${k}" aria-selected="${recTab===k}">${l}</button>`).join("")}</div>`;
  if(recTab==="week"){
    const ms=run?(run.meals||[]).map(mealById).filter(Boolean):[];
    h+=`<div class="group"><h2>${run?`Cooking this week`:"No week planned"}</h2><p class="lead">${run?`Delivery ${esc(fmtD(run.delivery))}. Open a recipe to cook from it; ingredients on this week's list are ticked.`:"Plan a week first."}</p></div>`;
    h+=ms.length?`<div class="rgrid">${ms.map(recCard).join("")}</div>`:`<div class="empty">No meals chosen for this week yet.</div>`;
  } else if(recTab==="fav"){
    const ms=[...master.meals].filter(m=>!m.ready).sort((a,b)=>a.name.localeCompare(b.name));
    const noMethod=ms.filter(m=>!(m.steps||[]).length).length;
    h+=`<div class="group"><div class="shead"><h2>Favourites</h2><button class="btn" type="button" id="recNew">New recipe</button></div><p class="lead">${ms.length} saved meals.${noMethod?` ${noMethod} still need a method; open one to write it${sampleFn?" or have Claude draft it":""}.`:""}</p></div><div class="rgrid">${ms.map(recCard).join("")}</div>`;
  } else {
    const list=library[recRegion]||[];
    h+=`<div class="group"><h2>Discover</h2><p class="lead">Recipes built from real Waitrose products. Try one for a week or save it to your favourites.</p>
      <div class="chips">${REGIONS.map(r=>`<button type="button" class="chip sm txt" data-region="${esc(r)}" aria-pressed="${recRegion===r}">${esc(r)}${library[r]?` <span class="mono muted">${library[r].length}</span>`:""}</button>`).join("")}</div></div>`;
    h+=list.length?`<div class="rgrid">${list.map(recCard).join("")}</div>`:`<div class="empty">No ${esc(recRegion)} recipes yet.</div>`;
    const busy=!!(finding&&finding.ctl&&finding.region===recRegion);
    h+=`<div class="findmore">${busy?`<span class="muted">${esc(finding.status)}</span><button class="btn" type="button" id="findStop">Stop</button>`:`<button class="btn" type="button" id="findMore" ${sampleFn?"":"disabled"}>Find 4 more ${esc(recRegion)} recipes</button>${finding&&finding.msg&&finding.region===recRegion?`<span class="muted">${esc(finding.msg)}</span>`:""}${sampleFn?"":'<span class="hint">Finding new recipes with Claude is switched off in this version.</span>'}`}</div>`;
  }
  return h+`</section>`;
}
function blankDraft(){return {name:"",dinners:1,protein:"chicken",region:"",time:30,desc:"",buy:[],check:[],steps:[]};}
function openRec(id){ rv={id,mode:"view",done:{},q:"",msg:""}; renderRec(); }
function editRec(){ const m=rv.id?findRecipe(rv.id):null; rv.mode="edit"; rv.q=""; rv.draft=m?clone({name:m.name,dinners:m.dinners,protein:m.protein||"other",region:m.region||"",time:m.time||30,desc:m.desc||"",buy:m.buy||[],check:m.check||[],steps:m.steps||[]}):blankDraft(); loadCatalogue(); renderRec(); }
function recView(m){
  const fav=isFav(m.id), wk=inWeek(m.id);
  const ings=(m.buy||[]).map(b=>{const on=onThisWeek(b.product);return `<li class="${on?"have":""}"><span class="tick" aria-label="${on?"On this week's list":"Not on this week's list"}">${on?TICK:""}</span><span class="iname">${esc(b.product)}${b.pending?' <span class="tag due">to find</span>':""}</span><span class="iqty mono">${b.qty>1?"×"+b.qty:""}</span></li>`;}).join("");
  const steps=(m.steps||[]);
  return `<div class="shead"><h2 id="recTitle">${esc(m.name)}</h2><button class="link" type="button" id="recClose">Close</button></div>
    <div class="meta">${m.region?`<span class="tag">${esc(m.region)}</span>`:""}<span class="tag dinners">serves ${m.dinners===2?4:2}</span>${m.time?`<span class="tag">${m.time} min</span>`:""}${m.protein?`<span class="tag">${esc(m.protein)}</span>`:""}${fav?'<span class="tag on">favourite</span>':'<span class="tag">not saved</span>'}</div>
    ${m.desc?`<p class="lead">${esc(m.desc)}</p>`:""}
    ${rv.msg?`<div class="banner ready"><span>${esc(rv.msg)}</span></div>`:""}
    <div class="chips">
      ${fav||m.ready?"":'<button class="btn primary" type="button" id="recSaveFav">Save to favourites</button>'}
      ${run?(wk?'<button class="btn" type="button" id="recWeekOff">Remove from this week</button>':`<button class="btn ${fav?"primary":""}" type="button" id="recWeekOn">${fav?"Add to this week":"Try this week"}</button>`):""}
      ${m.ready?"":'<button class="btn ghost" type="button" id="recEdit">Edit</button>'}
    </div>
    <div class="group"><h3>Ingredients to buy</h3>${ings?`<ul class="ings">${ings}</ul>`:'<p class="hint">None listed yet.</p>'}</div>
    ${(m.check||[]).length?`<div class="group"><h3>From the cupboard</h3><p class="cupline">${esc(m.check.join(" · "))}</p></div>`:""}
    <div class="group"><h3>Method</h3>${steps.length?`<ol class="steps-list">${steps.map((s,i)=>`<li><button type="button" class="stepbtn ${rv.done[i]?"done":""}" data-stepdone="${i}">${esc(s)}</button></li>`).join("")}</ol><p class="hint">Tap a step to tick it off while you cook.</p>`:`<p class="hint">No method yet.</p><div class="chips">${sampleFn?`<button class="btn" type="button" id="recDraft" ${rv.busy?"disabled":""}>${rv.busy?esc(rv.busy):"Have Claude write the method"}</button>`:""}<button class="btn ghost" type="button" id="recEdit2">Write it myself</button></div>`}</div>`;
}
function recEditor(){
  const d=rv.draft;
  return `<div class="shead"><h2 id="recTitle">${rv.id?"Edit recipe":"New recipe"}</h2><button class="link" type="button" id="recCancel">Cancel</button></div>
    ${rv.msg?`<div class="banner ready"><span>${esc(rv.msg)}</span></div>`:""}
    <div class="field"><label for="edName">Name</label><input type="text" id="edName" value="${esc(d.name)}"></div>
    <div class="field"><label for="edDesc">Short description</label><input type="text" id="edDesc" value="${esc(d.desc)}" placeholder="One line on what it is"></div>
    <div class="inline"><span class="muted">Serves</span><div class="chips">${[1,2].map(n=>`<button type="button" class="chip sm txt" data-eddin="${n}" aria-pressed="${d.dinners===n}">${n*2}</button>`).join("")}</div>
      <label class="muted" for="edTime">Minutes</label><input type="number" id="edTime" min="5" max="400" step="5" value="${d.time||""}" class="num"></div>
    <div class="inline"><span class="muted">Main</span><div class="chips">${PROTEINS.map(p=>`<button type="button" class="chip sm txt" data-edprot="${p}" aria-pressed="${d.protein===p}">${p}</button>`).join("")}</div></div>
    <div class="field"><label for="edRegion">Region</label><select id="edRegion"><option value="">None</option>${REGIONS.map(r=>`<option ${d.region===r?"selected":""}>${esc(r)}</option>`).join("")}</select></div>
    <div class="group"><h3>Ingredients to buy</h3>
      ${d.buy.length?`<div class="rows">${d.buy.map((b,i)=>`<div class="row"><span></span><div class="txt"><div class="t1">${esc(b.product)}</div><div class="t2">${b.pending?"The PC agent will find this on Waitrose":b.price!=null?money(b.price):""}</div></div><div class="inline">${qtyCtl(b.qty,`data-edqty="${i}"`,true)}<button type="button" class="link sm" data-eddel="${i}">remove</button></div></div>`).join("")}</div>`:""}
      <input type="text" id="edQ" value="${esc(rv.q)}" placeholder="Add from Waitrose, e.g. chorizo" autocomplete="off"><div id="edRes">${catResults("edit",rv.q)}</div></div>
    <div class="group"><h3>From the cupboard</h3><div class="addrow"><input type="text" id="edChk" placeholder="e.g. smoked paprika"><button class="btn" type="button" id="edChkAdd">Add</button></div>
      ${d.check.length?`<div class="mealline">${d.check.map((c,i)=>`<button type="button" class="pill x" data-edchk="${i}">${esc(c)} <span aria-hidden="true">×</span></button>`).join("")}</div>`:""}</div>
    <div class="group"><div class="shead"><h3>Method</h3>${sampleFn?`<button class="link sm" type="button" id="edDraft" ${rv.busy?"disabled":""}>${rv.busy?esc(rv.busy):(d.steps.length?"Rewrite with Claude":"Draft with Claude")}</button>`:""}</div>
      <ol class="stepedit">${d.steps.map((s,i)=>`<li><textarea id="step-${i}" rows="2" aria-label="Step ${i+1}">${esc(s)}</textarea><div class="stepctl"><button type="button" class="link sm" data-stepup="${i}" ${i===0?"disabled":""} aria-label="Move step ${i+1} up">↑</button><button type="button" class="link sm" data-stepdown="${i}" ${i===d.steps.length-1?"disabled":""} aria-label="Move step ${i+1} down">↓</button><button type="button" class="link sm" data-stepdel="${i}" aria-label="Delete step ${i+1}">✕</button></div></li>`).join("")}</ol>
      <button class="btn ghost" type="button" id="stepAdd">Add a step</button></div>
    <div class="invfoot"><button class="btn primary big" type="button" id="edSave" ${d.name.trim()?"":"disabled"}>Save to favourites</button></div>`;
}
function renderRec(){
  const el=$("rec"); if(!el) return;
  if(!rv||!master){el.hidden=true;el.innerHTML="";return;}
  const m=rv.id?(findRecipe(rv.id)||rv.local||null):null;
  if(rv.mode==="view"&&!m){rv=null;el.hidden=true;return;}
  const focusId=document.activeElement&&document.activeElement.id, sel=document.activeElement&&document.activeElement.selectionStart;
  el.hidden=false;
  el.innerHTML=`<div class="sheet-card inv-card rec-card" role="dialog" aria-modal="true" aria-labelledby="recTitle">${rv.mode==="edit"?recEditor():recView(m)}</div>`;
  if(focusId){const f=document.getElementById(focusId); if(f){f.focus(); try{if(sel!=null)f.setSelectionRange(sel,sel);}catch(_){}}}
}
function recipeBody(m){ const o={name:m.name,dinners:m.dinners,protein:m.protein||"other",frequent:!!m.frequent,buy:(m.buy||[]).map(b=>{const x={product:b.product,aisle:b.aisle||"Other",qty:b.qty||1};if(b.price!=null)x.price=b.price;if(b.pending)x.pending=true;if(b.offer)x.offer=b.offer;return x;}),check:m.check||[],steps:m.steps||[],updatedAt:new Date().toISOString()};
  if(m.region)o.region=m.region; if(m.time)o.time=m.time; if(m.desc)o.desc=m.desc; return o; }
async function saveFav(id,m){
  try{ await db.collection("recipes").doc(id).set(recipeBody(m)); return true; }
  catch(e){ rv.msg=e&&e.code==="invalid_argument"?"You can't save recipes on this share level.":"Couldn't save. Try again."; renderRec(); return false; }
}
async function getSample(){ try{ sampleFn=window.claude&&window.claude.use?await window.claude.use("sample"):null; }catch(_){ sampleFn=null; } render(); }
function sampleErr(e){ const c=e&&e.code; return c==="not_granted"?"Claude wasn't allowed for this page.":c==="rate_limited"?"Too many requests just now. Try again in a minute.":c==="cancelled"?"Stopped.":c==="invalid_json"?"Claude's answer didn't come back in the right shape. Try again.":"Couldn't reach Claude. Try again."; }
async function draftMethod(m){
  const prompt=`Write a clear home-cooking method for this dish.
Dish: ${m.name}${m.region?` (${m.region})`:""}
Makes ${m.dinners===2?"4 portions (two dinners for two people)":"2 portions"}.
Ingredients bought for it: ${(m.buy||[]).map(b=>b.product+(b.qty>1?" x"+b.qty:"")).join("; ")||"none listed"}
Cupboard ingredients: ${(m.check||[]).join("; ")||"none listed"}
Use those ingredients, give amounts inside the steps, oven temperatures in Celsius, and keep it to 4 to 7 steps of one or two sentences each, in British English.
Reply with only JSON: {"time": <total minutes as a number>, "steps": ["step one", "step two"]}`;
  const out=await sampleFn.json(prompt,{cache:false});
  if(!out||!Array.isArray(out.steps)||!out.steps.length) throw {code:"invalid_json"};
  return {steps:out.steps.map(s=>String(s).replace(/^\s*\d+[.)]\s*/,"")).slice(0,12),time:Number(out.time)||m.time||null};
}
/* One recipe writer for "Find more" and "Build with Claude": Claude searches the product catalogue as it writes. */
async function generateRecipes(task,count,ctl,onStatus){
  await loadCatalogue();
  let searches=0;
  const tools=[{name:"searchProducts",description:"Search the household's Waitrose product catalogue. Pass several ingredient searches at once. Returns, for each query, up to 4 real products as {product, price}. Use the exact product string in the recipe.",
    inputSchema:{type:"object",properties:{queries:{type:"array",items:{type:"string"},description:"Short ingredient searches, e.g. 'chicken thigh', 'coconut milk', 'lemongrass'"}},required:["queries"]},
    execute:(input)=>{ const qs=Array.isArray(input.queries)?input.queries.slice(0,40).map(String):[]; searches+=qs.length; onStatus(`Matching ingredients to Waitrose products (${searches} searched)…`);
      const out={}; qs.forEach(q=>{out[q]=searchCat(q).slice(0,4).map(c=>({product:productLabel(c),price:c.price}));}); return out; }}];
  const prompt=`${task}
For each fresh or speciality ingredient that has to be bought, first call searchProducts with all the searches you need in one call, then use the exact "product" string it returns. If nothing suitable comes back, write a short plain name for it instead. Pantry basics (oils, dried spices, rice, pasta, flour, stock, soy sauce, garlic, salt, sugar) go in "check" as plain words.
"dinners" is 2 when the recipe makes 4 portions (two dinners for two people), otherwise 1.
Reply with only a JSON array of ${count} object${count>1?"s":""}:
[{"name": "...", "desc": "one short line", "dinners": 1 or 2, "protein": "chicken|beef|pork|lamb|fish|veg|other", "time": minutes, "buy": [{"product": "exact product string", "qty": 1}], "check": ["..."], "steps": ["4 to 7 clear steps with amounts, Celsius, British English"]}]`;
  onStatus("Claude is thinking…");
  const arr=await sampleFn.json(prompt,{tools,signal:ctl.signal});
  const list=Array.isArray(arr)?arr:(arr&&arr.name?[arr]:null);
  if(!list) throw {code:"invalid_json"};
  const recs=list.filter(x=>x&&x.name&&Array.isArray(x.buy)&&Array.isArray(x.steps)).slice(0,6).map(x=>{
    const buy=x.buy.map(b=>{ const label=String((b&&b.product)||b||"").trim(); const c=catalogue.find(c=>productLabel(c).toLowerCase()===label.toLowerCase()); const o={product:c?productLabel(c):label,aisle:c?c.aisle:"Other",qty:Math.max(1,Math.min(6,Number(b&&b.qty)||1))}; if(c&&c.price!=null)o.price=c.price; if(!c)o.pending=true; return o; }).filter(b=>b.product);
    return {name:String(x.name),dinners:Number(x.dinners)===2?2:1,protein:PROTEINS.includes(x.protein)?x.protein:"other",time:Number(x.time)||null,desc:String(x.desc||""),buy,check:Array.isArray(x.check)?x.check.map(String):[],steps:x.steps.map(s=>String(s).replace(/^\s*\d+[.)]\s*/,"")),source:"claude"};
  });
  if(!recs.length) throw {code:"invalid_json"};
  return recs;
}
async function findMore(region){
  const ctl=new AbortController(); finding={region,status:"Thinking…",ctl,msg:""}; render();
  const existing=(library[region]||[]).map(r=>r.name).concat(master.meals.map(m=>m.name));
  const task=`Suggest 4 ${region==="Wildcard"?"varied dishes from any cuisine not usually found in a British weekly shop":region+" dishes"} that a confident home cook in London can make from a Waitrose delivery.
Do not repeat any of these: ${existing.join("; ")}.
Mix the main ingredient (chicken, beef, pork, lamb, fish, veg) and include at least one that makes 4 portions.`;
  try{
    const recs=(await generateRecipes(task,4,ctl,st=>{finding.status=st;render();})).map(r=>Object.assign({id:"lib-"+slugify(r.name),region},r));
    const all=[...(library[region]||[]),...recs];
    await db.doc("discover/"+regionSlug(region)).set({region,recipes:all,updatedAt:new Date().toISOString()});
    library[region]=all; finding={region,msg:`Added ${recs.length} new ${region} recipes.`};
  }catch(e){ finding={region,msg:sampleErr(e)}; }
  render();
}
async function buildRecipe(name,region,protein,dinners){
  const ctl=new AbortController(); invUI.build={name,status:"Claude is thinking…",ctl}; renderInv();
  const task=`Write a home-cooking recipe for "${name}"${region?` (${region} cooking)`:""} for a household in London shopping at Waitrose.${dinners?` It should make ${dinners===2?"4 portions (two dinners for two)":"2 portions"}.`:""}${protein?` The main ingredient is ${protein}.`:""}`;
  try{
    const [r]=await generateRecipes(task,1,ctl,st=>{ if(invUI&&invUI.build){invUI.build.status=st;const box=$("recFindRes");if(box)box.innerHTML=recFindResults();} });
    if(!invUI) return;
    invUI.build=null; renderInv();
    rv={id:null,mode:"edit",done:{},q:"",msg:"Built by Claude from real Waitrose products. Check it over, then save.",draft:Object.assign(blankDraft(),r,{region:region||r.region||""})}; renderRec();
  }catch(e){ if(invUI){ invUI.build=null; invUI.msg=sampleErr(e); renderInv(); } }
}
function recClick(t){
  const m=rv.id?(findRecipe(rv.id)||rv.local||null):null;
  if(t.id==="recClose"){rv=null;renderRec();return;}
  if(t.dataset.stepdone){const i=+t.dataset.stepdone;rv.done[i]=!rv.done[i];renderRec();return;}
  if(t.id==="recEdit"||t.id==="recEdit2"){editRec();return;}
  if(t.id==="recSaveFav"&&m){ saveFav(m.id,m).then(ok=>{ if(ok){ rv.msg="Saved to your favourites."; if(run&&run.extraMeals&&run.extraMeals.some(x=>x.id===m.id)) change(r=>{r.extraMeals=r.extraMeals.filter(x=>x.id!==m.id);}); renderRec(); } }); return; }
  if(t.id==="recWeekOn"&&m){ change(r=>{ if(!r.meals.includes(m.id)) r.meals=[...r.meals,m.id]; if(!isFav(m.id)){ r.extraMeals=[...(r.extraMeals||[]).filter(x=>x.id!==m.id),clone(m)]; } }); rv.msg=`Added to the week of ${fmtD(run.delivery)}. Its ingredients are on the list.`; renderRec(); return; }
  if(t.id==="recWeekOff"&&m){ change(r=>{ r.meals=r.meals.filter(x=>x!==m.id); r.extraMeals=(r.extraMeals||[]).filter(x=>x.id!==m.id); }); rv.msg="Removed from this week."; renderRec(); return; }
  if(t.id==="recDraft"&&m){ rv.busy="Claude is writing the method…"; renderRec(); draftMethod(m).then(res=>{ rv.busy=null; editRec(); rv.draft.steps=res.steps; if(res.time) rv.draft.time=res.time; rv.msg="Here's a draft method. Check it, then save."; renderRec(); },e=>{ rv.busy=null; rv.msg=sampleErr(e); renderRec(); }); return; }
  /* editor */
  const d=rv.draft; if(!d) return;
  if(t.id==="recCancel"){ if(rv.id){rv.mode="view";rv.draft=null;} else rv=null; renderRec(); return; }
  if(t.dataset.eddin){d.dinners=+t.dataset.eddin;renderRec();return;}
  if(t.dataset.edprot){d.protein=t.dataset.edprot;renderRec();return;}
  if(t.dataset.edqty){const b=d.buy[+t.dataset.edqty];b.qty=Math.max(1,Math.min(10,b.qty+(+t.dataset.d)));renderRec();return;}
  if(t.dataset.eddel){d.buy.splice(+t.dataset.eddel,1);renderRec();return;}
  if(t.dataset.pick&&t.dataset.target==="edit"){const p=pickFromCatalogue(t.dataset.pick); if(p){d.buy.push(p);} rv.q="";renderRec();const q=$("edQ");if(q)q.focus();return;}
  if(t.dataset.ask==="edit"){const text=rv.q.trim(); if(text){d.buy.push({product:text,qty:1,pending:true,aisle:"Other"}); requestLookup(text,"recipe: "+(d.name||"recipe"));} rv.q="";renderRec();return;}
  if(t.id==="edChkAdd"){const v=$("edChk").value.trim(); if(v)d.check.push(v); renderRec(); const f=$("edChk"); if(f)f.focus(); return;}
  if(t.dataset.edchk){d.check.splice(+t.dataset.edchk,1);renderRec();return;}
  if(t.dataset.stepup){const i=+t.dataset.stepup;[d.steps[i-1],d.steps[i]]=[d.steps[i],d.steps[i-1]];renderRec();return;}
  if(t.dataset.stepdown){const i=+t.dataset.stepdown;[d.steps[i+1],d.steps[i]]=[d.steps[i],d.steps[i+1]];renderRec();return;}
  if(t.dataset.stepdel){d.steps.splice(+t.dataset.stepdel,1);renderRec();return;}
  if(t.id==="stepAdd"){d.steps.push("");renderRec();const f=$("step-"+(d.steps.length-1));if(f)f.focus();return;}
  if(t.id==="edDraft"){ rv.busy="Claude is writing…"; renderRec(); draftMethod(Object.assign({},d)).then(res=>{rv.busy=null; d.steps=res.steps; if(res.time)d.time=res.time; rv.msg="Draft method added. Check it, then save."; renderRec();},e=>{rv.busy=null; rv.msg=sampleErr(e); renderRec();}); return; }
  if(t.id==="edSave"){ d.steps=d.steps.map(s=>s.trim()).filter(Boolean); const id=rv.id||("fav-"+slugify(d.name));
    const base=m?Object.assign({},m,d):d; saveFav(id,base).then(ok=>{ if(!ok) return;
      if(run&&run.extraMeals&&run.extraMeals.some(x=>x.id===id)) change(r=>{r.extraMeals=r.extraMeals.filter(x=>x.id!==id);});
      rv={id,mode:"view",done:{},q:"",msg:"Saved to your favourites.",local:Object.assign({id},recipeBody(base))}; renderRec(); }); return; }
}

/* ---------- inventory update ---------- */
const LEVELS=[[0,"Out"],[0.25,"Low"],[0.5,"Half"],[0.75,"Most"],[1,"Full"],[2,"+ Spare"]];
const AISLE_CODES={F:"Fresh & Chilled",C:"Food Cupboard",Z:"Frozen",B:"Bakery",D:"Drinks",H:"Household"};
const PROTEINS=["chicken","beef","pork","lamb","fish","veg","other"];
const FREQS=[1,2,3,4,6,8,12];
function todayISO(){return isoD(new Date(Date.UTC(new Date().getFullYear(),new Date().getMonth(),new Date().getDate())));}
function snap(l){ if(l==null) return null; if(l>=1.5) return 2; return LEVELS.slice(0,5).reduce((a,b)=>Math.abs(b[0]-l)<Math.abs(a-l)?b[0]:a,0); }
function estLevel(item,kind){ const cur={id:"__inv",delivery:todayISO()}; const lb=lastBought(item,kind,cur); if(!lb||!item.everyDays) return null;
  const ov=overrideFor(item,kind); if(ov){ const age=daysBetween(ov.setAt.slice(0,10),todayISO()); return snap(Math.max(0,ov.level-age/item.everyDays)); }
  return snap(Math.max(0,1-daysBetween(lb,todayISO())/item.everyDays)); }
function slugify(s){return (s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,40)||"item")+"-"+Math.random().toString(36).slice(2,6);}
function blankRecipe(){return {name:"",dinners:1,protein:"chicken",buy:[],check:[]};}
function blankItem(){return {kind:"topups",everyWeeks:4,pick:null};}
function openInv(){ invUI={tab:"stock",draft:{},recipe:blankRecipe(),item:blankItem(),q:"",msg:""}; renderInv(); loadCatalogue(); }
function closeInv(){ invUI=null; renderInv(); }
let catLoading=null;
function loadCatalogue(){ if(catalogue||!db) return Promise.resolve(); if(!catLoading) catLoading=loadCatalogue0(); return catLoading; }
async function loadCatalogue0(){
  try{ const cs=await db.doc("catalog/common").get(); commonRecipes=cs.exists?(cs.data().items||[]):[]; }catch(_){ commonRecipes=[]; }
  try{ const qs=await db.collection("catalogue").get(); const out=[];
    qs.docs.forEach(d=>(d.data().items||[]).forEach(r=>out.push({id:r[0],name:r[1],size:r[2],price:r[3],offer:r[4]?1:0,aisle:AISLE_CODES[r[5]]||"Other"})));
    const aisleOf={}; if(baseMaster){ const L=[...["staples","topups","drinks","household"].map(k=>baseMaster[k]||[]),...baseMaster.meals.map(m=>m.buy)]; L.forEach(list=>list.forEach(d=>{if(d.product)aisleOf[d.product]=d.aisle;})); }
    if(baseMaster&&baseMaster.prices) Object.entries(baseMaster.prices).forEach(([p,v])=>{ if(v.price!=null&&!out.some(o=>(o.name+" "+o.size).trim()===p)) out.push({id:"m:"+p,name:p,size:"",price:v.price,offer:v.offer?1:0,aisle:aisleOf[p]||"Other",known:true}); });
    catalogue=out; }catch(e){ catalogue=[]; }
  renderInv(); renderRec();
}
function searchCat(q){
  if(!catalogue) return []; const qt=(q.toLowerCase().match(/[a-z0-9%]+/g)||[]); if(!qt.length) return [];
  const hits=catalogue.filter(c=>{const nt=(c.name+" "+c.size).toLowerCase().match(/[a-z0-9%]+/g)||[];return qt.every(t=>nt.some(n=>n.startsWith(t)));});
  return hits.sort((a,b)=>(b.known?1:0)-(a.known?1:0)||a.name.length-b.name.length).slice(0,8);
}
function productLabel(c){return (c.name+(c.size?" "+c.size:"")).trim();}
async function requestLookup(text,forWhat){
  const items=[...lookups,{text,for:forWhat,requestedAt:new Date().toISOString()}];
  try{ await db.doc("requests/lookups").set({items}); }catch(e){ invUI.msg="Couldn't send the request."; }
}
function levelCtl(key,cur,est){
  return `<div class="levels" role="radiogroup">${LEVELS.map(([v,l])=>`<button type="button" class="lvl" role="radio" data-lvl="${key}" data-v="${v}" aria-checked="${cur===v}" ${est===v&&cur!==v?'data-est="1"':""}>${l}</button>`).join("")}</div>`;
}
function invStock(){
  const kinds=[["topups","Top-ups"],["household","Household"],["drinks","Drinks and treats"]];
  const changed=Object.keys(invUI.draft).length;
  let h=`<p class="lead">Set how much is really in the house. What you enter replaces our estimate until the item is next bought. Highlighted levels are the current estimate.</p>`;
  kinds.forEach(([kind,label])=>{
    h+=`<div class="group"><h3>${label}</h3><div class="rows">`+master[kind].filter(i=>i.everyDays).map(i=>{
      const key=kind+":"+i.id, est=estLevel(i,kind), ov=overrideFor(i,kind);
      const cur=(key in invUI.draft)?(invUI.draft[key]==null?est:invUI.draft[key]):est;
      const lb=lastBought(i,kind,{id:"__inv",delivery:todayISO()});
      const status=(key in invUI.draft)?(invUI.draft[key]==null?"Back to estimate on save":"Changed, not saved yet"):ov?`You set ${LEVELS.find(x=>x[0]===ov.level)?.[1]||ov.level} on ${fmtD(ov.setAt.slice(0,10),{weekday:undefined})}`:(est==null?"No purchase history yet":`Estimate · last bought ${fmtD(lb,{weekday:undefined})}, lasts about ${Math.round(i.everyDays/7)} weeks`);
      return `<div class="row invrow"><div class="txt"><div class="t1">${esc(i.name)}${i.user?' <span class="tag">added</span>':""}</div><div class="t2">${esc(status)}${ov&&!(key in invUI.draft)?` · <button class="link sm" type="button" data-clearov="${key}">use estimate</button>`:""}</div>${levelCtl(key,cur,est)}</div></div>`;}).join("")+`</div></div>`;
  });
  h+=`<div class="invfoot"><button class="btn primary big" type="button" id="invSave" ${changed?"":"disabled"}>${changed?`Save ${changed} change${changed>1?"s":""}`:"No changes yet"}</button></div>`;
  return h;
}
function catResults(target,qq){
  const q=(qq!=null?qq:(invUI?invUI.q:"")).trim(); if(q.length<2) return `<p class="hint">Type at least two letters, e.g. "chorizo" or "coconut milk".</p>`;
  if(!catalogue) return `<p class="hint">Loading Waitrose products…</p>`;
  const hits=searchCat(q);
  return `<div class="results">${hits.map(c=>`<button type="button" class="result" data-pick="${esc(c.id)}" data-target="${target}"><span class="rn">${esc(productLabel(c))}</span><span class="rp mono">${c.price!=null?money(c.price):""}${c.offer?' <span class="offer inl">offer</span>':""}</span></button>`).join("")}
    <button type="button" class="result ask" data-ask="${target}"><span class="rn">${hits.length?"None of these? ":""}Add “${esc(q)}” and have the PC agent find it on Waitrose</span></button></div>`;
}
function recSearch(q){
  const qt=(q.toLowerCase().match(/[a-z0-9]+/g)||[]); if(!qt.length) return {fav:[],lib:[],common:[]};
  const hit=n=>{const nt=n.toLowerCase().match(/[a-z0-9]+/g)||[];return qt.every(t=>nt.some(x=>x.startsWith(t)));};
  const fav=master.meals.filter(m=>hit(m.name));
  const libAll=libraryRecipes().filter(m=>!isFav(m.id)&&hit(m.name));
  const known=new Set([...master.meals,...libraryRecipes()].map(m=>m.name.toLowerCase()));
  const common=(commonRecipes||[]).filter(c=>!known.has(c[0].toLowerCase())&&(hit(c[0])||hit(c[1])));
  return {fav:fav.slice(0,6),lib:libAll.slice(0,6),common:common.slice(0,10)};
}
function recFindResults(){
  const q=(invUI.rq||"").trim();
  if(invUI.build) return `<div class="banner ready"><div><b>Building ${esc(invUI.build.name)}</b><div class="hint">${esc(invUI.build.status)}</div></div><button class="btn" type="button" id="buildStop">Stop</button></div>`;
  if(q.length<2) return `<p class="hint">Start typing a dish, e.g. "lasagne", "katsu" or "Thai". You'll see your saved recipes, the recipe library and around 260 common dishes to start from.</p>`;
  const r=recSearch(q);
  const sec=(title,rows)=>rows.length?`<div class="rgroup"><h3>${title}</h3><div class="results">${rows.join("")}</div></div>`:"";
  let h=sec("Your recipes",r.fav.map(m=>`<button type="button" class="result" data-openrec="${esc(m.id)}"><span class="rn">${esc(m.name)}</span><span class="rp muted">${(m.steps||[]).length?"open":"open · no method yet"}</span></button>`));
  h+=sec("Recipe library",r.lib.map(m=>`<button type="button" class="result" data-openrec="${esc(m.id)}"><span class="rn">${esc(m.name)} <span class="muted">· ${esc(m.region||"")}</span></span><span class="rp muted">${(m.buy||[]).length} ingredients</span></button>`));
  h+=sec("Common dishes",r.common.map(c=>`<button type="button" class="result" data-buildrec="${esc(c[0])}" data-buildreg="${esc(c[1])}" data-buildprot="${esc(c[2])}" data-builddin="${c[3]}"><span class="rn">${esc(c[0])} <span class="muted">· ${esc(c[1])}</span></span><span class="rp ${sampleFn?"accent":"muted"}">${sampleFn?"build with Claude":"start it"}</span></button>`));
  if(!r.fav.length&&!r.lib.length&&!r.common.length) h+=`<p class="hint">Nothing matching “${esc(q)}” yet.</p>`;
  h+=`<div class="results">${sampleFn?`<button type="button" class="result ask" data-buildrec="${esc(q)}" data-buildreg="" data-buildprot="" data-builddin="0"><span class="rn">Create “${esc(q)}” with Claude</span></button>`:""}<button type="button" class="result" id="recBlank"><span class="rn">Start “${esc(q)}” from scratch</span></button></div>`;
  return h;
}
function invRecipes(){
  if(recKind==="ready"){ loadReady(); return `${kindSwitch("inv")}<div class="group"><h3>Find a ready meal</h3>${rmFilters("inv")}<div id="rmListinv">${rmList(60)}</div></div>`; }
  const mine=master.meals.filter(m=>(m.user||m.edited)&&!m.ready);
  return `${kindSwitch("inv")}<div class="group"><h3>Find or create a recipe</h3>
    <input type="text" id="recFind" value="${esc(invUI.rq||"")}" placeholder="Search dishes, e.g. lasagne" autocomplete="off">
    <div id="recFindRes">${recFindResults()}</div></div>
    <div class="group"><h3>Recipes you've added or edited</h3>${mine.length?`<div class="rows">${mine.map(m=>`<div class="row"><span></span><div class="txt"><button type="button" class="link left" data-openrec="${esc(m.id)}">${esc(m.name)}</button><div class="t2">serves ${m.dinners===2?4:2} · ${(m.buy||[]).length} ingredients${m.edited?" · edited original":""}</div></div>${m.user?`<button type="button" class="link sm" data-recremove="${esc(m.id)}">delete</button>`:""}</div>`).join("")}</div>`:'<p class="hint">None yet.</p>'}</div>`;
}
function invItems(){
  const it=invUI.item;
  let h=`<div class="group"><h3>Track a new item</h3><p class="lead">For things you top up now and then. Full auto adds it when it's due.</p>
    <div class="field"><label for="catQ">Find it on Waitrose</label><input type="text" id="catQ" value="${esc(invUI.q)}" placeholder="Search, e.g. olive oil" autocomplete="off"><div id="catRes">${it.pick?"":catResults("item")}</div></div>
    ${it.pick?`<div class="rows"><div class="row"><span></span><div class="txt"><div class="t1">${esc(it.pick.product)}</div><div class="t2">${it.pick.pending?"The PC agent will find this on Waitrose":it.pick.price!=null?money(it.pick.price):""}</div></div><button type="button" class="link sm" id="itemUnpick">change</button></div></div>`:""}
    <div class="inline"><span class="muted">Type</span><div class="chips">${[["topups","Top-up"],["household","Household"],["drinks","Drinks"]].map(([k,l])=>`<button type="button" class="chip sm txt" data-itemkind="${k}" aria-pressed="${it.kind===k}">${l}</button>`).join("")}</div></div>
    <div class="inline"><span class="muted">Lasts about</span><div class="chips">${FREQS.map(w=>`<button type="button" class="chip sm" data-itemfreq="${w}" aria-pressed="${it.everyWeeks===w}">${w}w</button>`).join("")}</div></div>
    <button class="btn primary big" type="button" id="itemSave" ${it.pick?"":"disabled"}>Start tracking</button></div>`;
  const mine=userItems;
  h+=`<div class="group"><h3>Items you've added</h3>${mine.length?`<div class="rows">${mine.map(i=>`<div class="row"><span></span><div class="txt"><div class="t1">${esc(i.name)}</div><div class="t2">${esc(i.product)} · every ${Math.round(i.everyDays/7)} weeks</div></div><button type="button" class="link sm" data-itemremove="${esc(i.id)}">delete</button></div>`).join("")}</div>`:'<p class="hint">None yet.</p>'}</div>`;
  return h;
}
function renderInv(){
  const el=$("inv"); if(!el) return;
  if(!invUI||!master){el.hidden=true;el.innerHTML="";return;}
  el.hidden=false;
  const focusId=document.activeElement&&document.activeElement.id, selStart=document.activeElement&&document.activeElement.selectionStart;
  const pending=lookups.length;
  el.innerHTML=`<div class="sheet-card inv-card" role="dialog" aria-modal="true" aria-labelledby="invTitle">
    <div class="shead"><h2 id="invTitle">Inventory update</h2><button class="link" type="button" id="invClose">Done</button></div>
    <div class="tabs" role="tablist">${[["stock","Stock levels"],["recipes","Recipes"],["items","Items"]].map(([k,l])=>`<button type="button" role="tab" class="tab" data-invtab="${k}" aria-selected="${invUI.tab===k}">${l}</button>`).join("")}</div>
    ${invUI.msg?`<div class="banner ready"><span>${esc(invUI.msg)}</span></div>`:""}
    ${pending&&invUI.tab!=="stock"?`<p class="hint">${pending} product${pending>1?"s":""} waiting for the PC agent to find on Waitrose.</p>`:""}
    ${invUI.tab==="stock"?invStock():invUI.tab==="recipes"?invRecipes():invItems()}
  </div>`;
  if(focusId){const f=document.getElementById(focusId); if(f){f.focus(); try{if(selStart!=null)f.setSelectionRange(selStart,selStart);}catch(_){}}}
}
function refreshAuto(r){
  if(!r.auto) return; AUTO_KINDS.forEach(kind=>{ (r.auto[kind]||[]).slice().forEach(id=>{ const i=master[kind].find(x=>x.id===id); if(i&&!dueInfo(i,kind,r).due){ r[kind][id]=0; r.auto[kind]=r.auto[kind].filter(x=>x!==id); } }); });
  applyAuto(r);
}
async function saveStock(){
  const next=clone(inv); const now=new Date().toISOString();
  Object.entries(invUI.draft).forEach(([k,v])=>{ if(v==null) delete next[k]; else next[k]={level:v,setAt:now}; });
  try{ await db.doc("inventory/levels").set(next); inv=next; const n=Object.keys(invUI.draft).length; invUI.draft={}; invUI.msg=`Saved ${n} stock level${n>1?"s":""}.`;
    if(run&&modeOf()==="auto"&&run.status!=="filled") change(r=>refreshAuto(r)); }
  catch(e){ invUI.msg=e&&e.code==="invalid_argument"?"You can view stock levels but not change them.":"Couldn't save. Try again."; }
  renderInv();
}
function pickFromCatalogue(id){ const c=catalogue.find(x=>x.id===id); if(!c) return null; return {product:productLabel(c),price:c.price,aisle:c.aisle,qty:1,offer:c.offer?"On offer":null,waitroseId:c.known?null:c.id}; }
async function saveRecipe(){
  const r=invUI.recipe; const id=slugify(r.name);
  const body={name:r.name.trim(),dinners:r.dinners,protein:r.protein,frequent:false,buy:r.buy.map(b=>{const o={product:b.product,aisle:b.aisle||"Other",qty:b.qty};if(b.price!=null)o.price=b.price;if(b.pending)o.pending=true;if(b.waitroseId)o.waitroseId=b.waitroseId;return o;}),check:r.check,addedAt:new Date().toISOString()};
  try{ await db.collection("recipes").doc(id).set(body); invUI.recipe=blankRecipe(); invUI.q=""; invUI.msg=`Added “${body.name}” to your meals.`; }
  catch(e){ invUI.msg=e&&e.code==="invalid_argument"?"You can't add recipes on this share level.":"Couldn't save the recipe."; }
  renderInv();
}
async function saveItem(){
  const it=invUI.item, p=it.pick; const id=slugify(p.product);
  const short=p.product.replace(/^(Waitrose|Duchy Organic|Essential|No\.1|Cooks' Ingredients)\s+/i,"").replace(/\s+\d.*$/,"");
  const body={kind:it.kind,name:short||p.product,product:p.product,aisle:p.aisle||(it.kind==="household"?"Household":it.kind==="drinks"?"Drinks":"Food Cupboard"),qty:1,everyDays:it.everyWeeks*7,addedAt:new Date().toISOString()};
  if(p.price!=null) body.price=p.price; if(p.pending) body.pending=true;
  try{ await db.collection("items").doc(id).set(body); invUI.item=blankItem(); invUI.q=""; invUI.msg=`Now tracking ${body.name}. Set its stock level on the Stock tab.`; }
  catch(e){ invUI.msg="Couldn't save the item."; }
  renderInv();
}
function invClick(t){
  if(t.id==="invClose"){if(invUI.build&&invUI.build.ctl)invUI.build.ctl.abort();closeInv();return;}
  if(t.dataset.openrec){openRec(t.dataset.openrec);return;}
  if(t.id==="buildStop"){if(invUI.build&&invUI.build.ctl)invUI.build.ctl.abort();return;}
  if(t.dataset.buildrec!=null){ const name=t.dataset.buildrec, reg=t.dataset.buildreg||"", prot=t.dataset.buildprot||"", din=+t.dataset.builddin||0;
    if(sampleFn){ buildRecipe(name,reg,prot,din); }
    else { rv={id:null,mode:"edit",done:{},q:"",msg:"",draft:Object.assign(blankDraft(),{name,region:reg,protein:PROTEINS.includes(prot)?prot:"other",dinners:din||1})}; loadCatalogue(); renderRec(); }
    return; }
  if(t.id==="recBlank"){ rv={id:null,mode:"edit",done:{},q:"",msg:"",draft:Object.assign(blankDraft(),{name:(invUI.rq||"").trim()})}; loadCatalogue(); renderRec(); return; }
  if(t.dataset.invtab){invUI.tab=t.dataset.invtab;invUI.q="";invUI.msg="";renderInv();return;}
  if(t.dataset.lvl){invUI.draft[t.dataset.lvl]=+t.dataset.v;renderInv();return;}
  if(t.dataset.clearov){invUI.draft[t.dataset.clearov]=null;renderInv();return;}
  if(t.id==="invSave"){saveStock();return;}
  if(t.dataset.recdin){invUI.recipe.dinners=+t.dataset.recdin;renderInv();return;}
  if(t.dataset.recprot){invUI.recipe.protein=t.dataset.recprot;renderInv();return;}
  if(t.dataset.pick){const p=pickFromCatalogue(t.dataset.pick); if(!p)return; if(t.dataset.target==="recipe"){invUI.recipe.buy.push(p);} else {invUI.item.pick=p;} invUI.q="";renderInv();const q=$("catQ");if(q)q.focus();return;}
  if(t.dataset.ask){const text=invUI.q.trim(); if(!text)return; const p={product:text,qty:1,pending:true,aisle:"Other"};
    if(t.dataset.ask==="recipe"){invUI.recipe.buy.push(p); requestLookup(text,"recipe: "+(invUI.recipe.name||"new recipe"));} else {invUI.item.pick=p; requestLookup(text,"item");}
    invUI.q="";renderInv();return;}
  if(t.dataset.recqty){const i=+t.dataset.recqty,d=+t.dataset.d;const b=invUI.recipe.buy[i];b.qty=Math.max(1,Math.min(10,b.qty+d));renderInv();return;}
  if(t.dataset.recdel){invUI.recipe.buy.splice(+t.dataset.recdel,1);renderInv();return;}
  if(t.id==="recCheckAdd"){const v=$("recCheck").value.trim(); if(v){invUI.recipe.check.push(v);} renderInv(); const f=$("recCheck"); if(f) f.focus(); return;}
  if(t.dataset.recchk){invUI.recipe.check.splice(+t.dataset.recchk,1);renderInv();return;}
  if(t.id==="recSave"){saveRecipe();return;}
  if(t.dataset.recremove){db.collection("recipes").doc(t.dataset.recremove).delete().catch(()=>{});return;}
  if(t.dataset.itemkind){invUI.item.kind=t.dataset.itemkind;renderInv();return;}
  if(t.dataset.itemfreq){invUI.item.everyWeeks=+t.dataset.itemfreq;renderInv();return;}
  if(t.id==="itemUnpick"){invUI.item.pick=null;renderInv();return;}
  if(t.id==="itemSave"){saveItem();return;}
  if(t.dataset.itemremove){db.collection("items").doc(t.dataset.itemremove).delete().catch(()=>{});return;}
}

/* ---------- meal suggestions ---------- */
function suggest(){ change(r=>{r.meals=pickMeals(r);}); }

/* ---------- events ---------- */
document.addEventListener("click",e=>{
  const t=e.target.closest("button"); if(!t) return;
  if(rv){recClick(t);return;}
  if(t.dataset.reckind){recKind=t.dataset.reckind; if(invUI) renderInv(); render(); return;}
  if(t.dataset.rmserves){rf.serves=t.dataset.rmserves; refreshRm(); return;}
  if(t.dataset.rmmethod){const k=t.dataset.rmmethod; rf.methods=rf.methods.includes(k)?rf.methods.filter(x=>x!==k):[...rf.methods,k]; refreshRm(); return;}
  if(t.dataset.rmweek){const r=readyMeals.find(x=>x.id===t.dataset.rmweek); if(r){rmToggleWeek(r); refreshRm();} return;}
  if(t.dataset.rmqty){const r=readyMeals.find(x=>x.id===t.dataset.rmqty); if(r){rmSetQty(r,+t.dataset.d); refreshRm();} return;}
  if(t.dataset.rmfav){const r=readyMeals.find(x=>x.id===t.dataset.rmfav); if(r) rmToggleFav(r); return;}
  if(invUI){invClick(t);return;}
  if(t.dataset.view){view=t.dataset.view;render();window.scrollTo({top:0});return;}
  if(t.dataset.rectab){recTab=t.dataset.rectab;render();return;}
  if(t.dataset.region){recRegion=t.dataset.region;render();return;}
  if(t.dataset.openrec){openRec(t.dataset.openrec);return;}
  if(t.id==="recNew"){rv={id:null,mode:"edit",done:{},q:"",msg:"",draft:blankDraft()};loadCatalogue();renderRec();return;}
  if(t.id==="findMore"){if(sampleFn)findMore(recRegion);return;}
  if(t.id==="findStop"){if(finding&&finding.ctl)finding.ctl.abort();return;}
  if(t.id==="openInv"){openInv();return;}
  if(t.id==="newRun"){if(master)openSheet(true);return;}
  if(sheet){
    if(t.dataset.pickmode){sheet.mode=t.dataset.pickmode;renderSheet();return;}
    if(t.dataset.sheetsrc){sheet.src=t.dataset.sheetsrc;renderSheet();return;}
    if(t.dataset.sheetreg){const r=t.dataset.sheetreg;sheet.regions=sheet.regions.includes(r)?sheet.regions.filter(x=>x!==r):[...sheet.regions,r];renderSheet();return;}
    if(t.dataset.sheetdin){sheet.dinners=+t.dataset.sheetdin;renderSheet();return;}
    if(t.id==="sheetGo"){sheetGo();return;}
    if(t.id==="sheetClose"){closeSheet();return;}
    return;
  }
  if(t.id==="modeBtn"){openSheet(false);return;}
  if(t.id==="pickToggle"){pickOpen=!pickOpen;render();return;}
  if(t.id==="priceCheck"){ if(db) db.doc("requests/prices").set({requestedAt:new Date().toISOString()}).then(()=>{},e=>{saveMsg="Couldn't request a price check";renderBar();}); priceReq={requestedAt:new Date().toISOString()}; render(); return; }
  if(t.id==="toggleAll"){showAll=!showAll;render();return;}
  if(t.id==="editBreakfast"){showAll=true;step=0;render();window.scrollTo({top:0});return;}
  if(t.dataset.step!=null){const s=+t.dataset.step;if(!visibleSteps().includes(s))showAll=true;step=s;render();window.scrollTo({top:0});return;}
  if(t.id==="back"||t.id==="next"){const vis=visibleSteps(),k=vis.indexOf(step)+(t.id==="next"?1:-1);if(k>=0&&k<vis.length){step=vis[k];render();window.scrollTo({top:0});}return;}
  if(!run) return;
  if(t.dataset.decline){const [kind,id]=t.dataset.decline.split(":");decline(kind,id);return;}
  if(t.dataset.dinners){const n=+t.dataset.dinners;change(r=>{r.dinners=n;if(modeOf()==="auto")topUpMeals(r,n);});return;}
  if(t.dataset.zoe||t.dataset.owen){const who=t.dataset.zoe?"zoe":"owen",id=t.dataset.zoe||t.dataset.owen;change(r=>{const b=bf();b[who]=b[who].includes(id)?b[who].filter(x=>x!==id):[...b[who],id];});return;}
  if(t.dataset.cereal){change(r=>{bf().cereal=t.dataset.cereal;});return;}
  if(t.dataset.cerealqty){const d=+t.dataset.d;change(r=>{const b=bf();b.cerealQty=Math.max(0,Math.min(5,(b.cerealQty||0)+d));});return;}
  if(t.dataset.weekend!=null){change(r=>{bf().weekend=t.dataset.weekend==="1";});return;}
  if(t.dataset.wk){const id=t.dataset.wk;change(r=>{const b=bf();b.weekendPicks=b.weekendPicks.includes(id)?b.weekendPicks.filter(x=>x!==id):[...b.weekendPicks,id];});return;}
  if(t.dataset.wkdel!=null){const i=+t.dataset.wkdel;change(r=>{const b=bf();b.weekendCustom=b.weekendCustom.filter((_,j)=>j!==i);});return;}
  if(t.id==="wkAddBtn"){addWeekend();return;}
  if(t.dataset.meal){const id=t.dataset.meal;change(r=>{r.meals=r.meals.includes(id)?r.meals.filter(x=>x!==id):[...r.meals,id];});return;}
  if(t.id==="suggest"){suggest();return;}
  if(t.dataset.toggle){const kind=t.dataset.toggle,id=t.dataset.id;const item=master[kind].find(i=>i.id===id);
    change(r=>{const cur=kind==="staples"?((r.staples[id]!=null)?r.staples[id]:item.qty):(r[kind][id]||0);r[kind][id]=cur>0?0:(item.qty||1);});return;}
  if(t.dataset.qty){const kind=t.dataset.qty,id=t.dataset.id,d=+t.dataset.d;const item=master[kind].find(i=>i.id===id);
    change(r=>{const cur=kind==="staples"?((r.staples[id]!=null)?r.staples[id]:item.qty):(r[kind][id]||0);r[kind][id]=Math.max(0,Math.min(20,cur+d));});return;}
  if(t.dataset.cup!=null){const c=t.dataset.cup;change(r=>{r.cupboard=r.cupboard.includes(c)?r.cupboard.filter(x=>x!==c):[...r.cupboard,c];});return;}
  if(t.id==="cupAddBtn"){const v=$("cupAdd").value.trim();if(v)change(r=>{if(!r.cupboard.includes(v))r.cupboard=[...r.cupboard,v];});return;}
  if(t.dataset.edit!=null){const k=t.dataset.edit,base=+t.dataset.base,d=+t.dataset.d;
    change(r=>{r.edits=r.edits||{};const cur=(r.edits[k]!=null)?r.edits[k]:base;const nv=Math.max(0,Math.min(30,cur+d));if(nv===base)delete r.edits[k];else r.edits[k]=nv;});return;}
  if(t.id==="extraAddBtn"){addExtra();return;}
  if(t.id==="ready"){change(r=>{r.status="ready";r.readyAt=new Date(Date.now()+1000).toISOString();r.finalList=buildList().filter(e=>e.qty>0).map(e=>({product:e.product,qty:e.qty,price:e.price==null?null:e.price,aisle:e.aisle}));});return;}
  if(t.id==="unready"){change(r=>{r.status="planning";});return;}
  if(t.id==="copy"){copyList(t);return;}
});
function parseQty(v){let qty=1;const m=v.match(/^(.*?)\s*[x×]\s*(\d+)$/i);if(m){v=m[1].trim();qty=+m[2];}return {text:v,qty};}
function addExtra(){const v=$("extraAdd").value.trim();if(!v)return;const x=parseQty(v);change(r=>{r.extras=[...(r.extras||[]),x];});}
function addWeekend(){const v=$("wkAdd").value.trim();if(!v)return;const x=parseQty(v);change(r=>{const b=bf();b.weekendCustom=[...b.weekendCustom,x];});}
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&rv){ if(rv.mode==="edit"&&rv.id){rv.mode="view";rv.draft=null;} else rv=null; renderRec(); return; }
  if(rv&&e.key==="Enter"&&e.target.id==="edQ"){e.preventDefault();const first=document.querySelector("#edRes .result");if(first)first.click();return;}
  if(rv&&e.key==="Enter"&&e.target.id==="edChk"){e.preventDefault();$("edChkAdd").click();return;}
  if(e.key==="Escape"&&invUI){closeInv();return;}
  if(invUI&&e.key==="Enter"&&e.target.id==="recFind"){e.preventDefault();const first=document.querySelector("#recFindRes .result");if(first)first.click();return;}if(e.key==="Escape"&&sheet&&run){closeSheet();return;}if(e.key!=="Enter")return;
  if(invUI&&e.target.id==="recCheck"){e.preventDefault();$("recCheckAdd").click();return;}
  if(invUI&&e.target.id==="catQ"){e.preventDefault();const first=document.querySelector("#catRes .result");if(first)first.click();return;}if(e.target.id==="extraAdd"){e.preventDefault();addExtra();}if(e.target.id==="wkAdd"){e.preventDefault();addWeekend();}if(e.target.id==="cupAdd"){e.preventDefault();$("cupAddBtn").click();}});
document.addEventListener("input",e=>{
  if(!run) return;
  if(e.target.id==="notes") change(r=>{r.notes=e.target.value;},{render:false});
  if(e.target.id==="cerealCustom") change(r=>{bf().cerealCustom=e.target.value;},{render:false});
  if(rv&&rv.draft){ const id=e.target.id, d=rv.draft;
    if(id==="edQ"){ rv.q=e.target.value; const box=$("edRes"); if(box) box.innerHTML=catResults("edit",rv.q); return; }
    if(id==="edName"){ d.name=e.target.value; const b=$("edSave"); if(b) b.disabled=!d.name.trim(); return; }
    if(id==="edDesc"){ d.desc=e.target.value; return; }
    if(id==="edTime"){ d.time=Number(e.target.value)||null; return; }
    if(id.startsWith("step-")){ d.steps[+id.slice(5)]=e.target.value; return; }
  }
  if(e.target.id==="rmQmain"||e.target.id==="rmQinv"){ rf.q=e.target.value; const sc=e.target.id.slice(3); const box=$("rmList"+sc); if(box) box.innerHTML=rmList(sc==="inv"?60:undefined); return; }
  if(invUI&&e.target.id==="recFind"){ invUI.rq=e.target.value; const box=$("recFindRes"); if(box) box.innerHTML=recFindResults(); return; }
  if(invUI&&e.target.id==="catQ"){ invUI.q=e.target.value; const box=$("catRes"); if(box) box.innerHTML=catResults(invUI.tab==="recipes"?"recipe":"item"); return; }
  if(invUI&&e.target.id==="recName"){ invUI.recipe.name=e.target.value; const b=$("recSave"); if(b) b.disabled=!(invUI.recipe.name.trim()&&invUI.recipe.buy.length); return; }
});
document.addEventListener("change",e=>{
  if(e.target.id==="runPick"){selectRun(e.target.value);return;}
  if(rv&&rv.draft&&e.target.id==="edRegion"){rv.draft.region=e.target.value;return;}
  if(e.target.id==="delivery"&&e.target.value) change(r=>{r.delivery=e.target.value;});
});
function listText(){
  const items=buildList().filter(e=>e.qty>0); const by={}; items.forEach(e=>{(by[e.aisle]=by[e.aisle]||[]).push(e);});
  let s=`Waitrose shop, delivery ${fmtD(run.delivery)}\n`;
  AISLES.forEach(a=>{if(!by[a])return;s+=`\n${a}\n`+by[a].map(e=>`- ${e.product}${e.qty>1?" x"+e.qty:""}`).join("\n")+"\n";});
  return s;
}
function copyList(btn){
  const txt=listText();
  const done=()=>{btn.textContent="Copied";setTimeout(()=>{btn.textContent="Copy list";},1500);};
  try{navigator.clipboard.writeText(txt).then(done,()=>fallback(txt));}catch(_){fallback(txt);}
}
function fallback(txt){const ta=document.createElement("textarea");ta.value=txt;ta.setAttribute("aria-label","List text");ta.style.width="100%";ta.style.minHeight="200px";$("main").appendChild(ta);ta.focus();ta.select();}

/* ---------- boot ---------- */
render();
(async function(){
  const c=window.claude; if(!c||!c.use){db=null;render();return;}
  db=await c.use("db"); if(!db){render();return;}
  let runsLoaded=false;
  const maybeOpen=()=>{ if(autoOpened||!master||!runsLoaded) return; autoOpened=true; const today=isoD(new Date()); if(!runs.some(r=>r.delivery>=today)) openSheet(true); };
  db.doc("catalog/master").onSnapshot(s=>{baseMaster=s.exists?s.data():null;rebuildMaster();render();maybeOpen();},()=>{});
  db.collection("recipes").onSnapshot(qs=>{userRecipes=qs.docs.map(d=>Object.assign({id:d.id},clone(d.data())));rebuildMaster();render();renderInv();},()=>{});
  db.collection("items").onSnapshot(qs=>{userItems=qs.docs.map(d=>Object.assign({id:d.id},clone(d.data())));rebuildMaster();render();renderInv();},()=>{});
  db.collection("discover").onSnapshot(qs=>{const L={};qs.docs.forEach(d=>{const v=d.data();if(v&&v.region)L[v.region]=clone(v.recipes||[]);});library=L;render();},()=>{});
  getSample();
  db.doc("inventory/levels").onSnapshot(s=>{inv=s.exists?clone(s.data()):{};render();renderInv();},()=>{});
  db.doc("requests/lookups").onSnapshot(s=>{lookups=(s.exists&&s.data().items)||[];renderInv();},()=>{});
  db.doc("requests/prices").onSnapshot(s=>{priceReq=s.exists?s.data():null;render();},()=>{});
  db.collection("runs").orderBy("delivery","desc").limit(40).onSnapshot(qs=>{
    runs=qs.docs.map(d=>Object.assign({id:d.id},clone(d.data())));
    if(!run){ const today=isoD(new Date()); const upcoming=runs.filter(r=>r.delivery>=today).sort((a,b)=>a.delivery.localeCompare(b.delivery)); run=upcoming.length?clone(upcoming[0]):(runs[0]?clone(runs[0]):null); }
    else if(!dirty&&!inflight){ const fresh=runs.find(r=>r.id===run.id); if(fresh&&JSON.stringify(fresh)!==JSON.stringify(run)) run=clone(fresh); }
    else { const fresh=runs.find(r=>r.id===run.id); if(fresh) keepAgentFields(run,fresh); }
    runsLoaded=true; render(); maybeOpen();
  },err=>{saveMsg="Lost connection to the shared list. Reload to reconnect.";renderBar();});
})();
})();
