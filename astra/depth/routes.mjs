// Deterministic planning toys. No timers, RNG, DOM, storage, rewards or global state.
const freeze = x => {Object.values(x).forEach(v=>{if(v&&typeof v==='object')freeze(v)});return Object.freeze(x)};
export const FESTIVAL = freeze({id:'festival-route-v1',title:'Make an afternoon of it',budget:14,minVisits:3,start:'gate',finish:'gate',
  stops:{gate:{name:'Festival gate',x:0,y:0,duration:0,open:0,close:14,kind:'home',cost:0},
    grove:{name:'Grove stage',x:1,y:0,duration:2,open:0,close:6,kind:'music',points:40},
    cove:{name:'Cove stage',x:2,y:0,duration:2,open:3,close:11,kind:'music',points:50},
    lookout:{name:'Sunset lookout',x:1,y:1,duration:1,open:6,close:12,kind:'discovery',points:40},
    mural:{name:'Mural walk',x:0,y:1,duration:1,open:0,close:10,kind:'discovery',points:30},
    garden:{name:'Listening garden',x:2,y:1,duration:2,open:0,close:13,kind:'rest',points:40}}});
export const TOUR = freeze({id:'tour-path-v1',title:'Make room for discovery',budget:8,minVisits:3,start:'welcome',finish:'welcome',maxEnergy:4,
  stops:{welcome:{name:'Welcome desk',edges:['studio','garden','gallery'],duration:0,cost:0,kind:'home'},
    studio:{name:'Studio introduction',edges:['lab','gallery','welcome'],duration:1,cost:1,kind:'access',grants:'pass',points:30},
    garden:{name:'Courtyard pause',edges:['studio','gallery','lab','welcome'],duration:1,cost:0,restore:2,kind:'rest',points:20},
    gallery:{name:'Art gallery',edges:['studio','garden','showcase','welcome'],duration:1,cost:1,kind:'discovery',points:40},
    lab:{name:'Animation workshop',edges:['garden','showcase','welcome'],duration:2,cost:2,requires:'pass',kind:'discovery',points:60},
    showcase:{name:'Share what you found',edges:['welcome'],duration:1,cost:1,requires:'two-discoveries',kind:'sharing',points:60}}});
function config(kind){if(kind==='festival')return FESTIVAL;if(kind==='tour')return TOUR;throw new TypeError('Unknown route kind')}
export function createRoute({kind,runId}){const c=config(kind);if(typeof runId!=='string'||!runId)throw new TypeError('runId required');return {kind,runId,revision:0,phase:'planning',paused:false,path:[c.start],history:[],at:c.start,time:0,energy:c.maxEnergy??null,visited:[],passes:[],score:0,steps:[],result:null}}
function distance(a,b){return Math.abs(a.x-b.x)+Math.abs(a.y-b.y)}
function quote(s,id){const c=config(s.kind),to=c.stops[id],from=c.stops[s.at];if(!to)return {allowed:false,reason:'Choose a stop on this map.'};
  if(s.phase!=='planning'||s.paused)return {allowed:false,reason:s.paused?'Paused. Your route is here when you return.':'This route is finished.'};
  if(id===s.at)return {allowed:false,reason:'You are already here.'};
  if(id===c.finish)return {allowed:false,reason:'Use Finish route to return to the start.'};
  if(s.visited.includes(id))return {allowed:false,reason:'You already visited this stop.'};
  if(s.kind==='festival'){
    const travel=distance(from,to),arrival=s.time+travel,wait=Math.max(0,to.open-arrival),end=arrival+wait+to.duration,returnCost=distance(to,c.stops[c.finish]);
    if(end>to.close)return {allowed:false,reason:`This stop ends at ${to.close}; you would finish at ${end}.`,arrival,wait,end,travel,returnCost};
    if(end+returnCost>c.budget)return {allowed:false,reason:`That leaves too little time to return by ${c.budget}.`,arrival,wait,end,travel,returnCost};
    return {allowed:true,travel,arrival,wait,end,returnCost,cost:0};
  }
  if(!from.edges.includes(id))return {allowed:false,reason:'No path from this stop. Try another connection.'};
  if(to.requires==='pass'&&!s.passes.includes('pass'))return {allowed:false,reason:'Visit the studio introduction for a workshop pass.'};
  if(to.requires==='two-discoveries'&&s.visited.filter(v=>c.stops[v].kind==='discovery').length<2)return {allowed:false,reason:'Find two discoveries before sharing them.'};
  const end=s.time+to.duration;
  if(end+1>c.budget)return {allowed:false,reason:'Keep one time step to return to the welcome desk.'};
  if(to.cost>s.energy)return {allowed:false,reason:'A courtyard pause restores energy before this stop.'};
  return {allowed:true,travel:0,arrival:s.time,wait:0,end,returnCost:1,cost:to.cost};
}
export function routeView(s){const c=config(s.kind),returnCost=s.kind==='festival'?distance(c.stops[s.at],c.stops[c.finish]):s.at===c.start?0:1;
  const variety=new Set(s.visited.map(id=>c.stops[id].kind)).size;
  const discoveries=s.visited.filter(id=>c.stops[id].kind==='discovery').length;
  const ready=s.visited.length>=c.minVisits&&(s.kind!=='tour'||discoveries>=2);
  const finishAt=s.time+returnCost,bonus=ready?Math.max(0,c.budget-finishAt)*5+(variety>=3?30:0):0;
  return {title:c.title,goal:s.kind==='festival'?'Enjoy three stops and return to the gate.':'Visit three stops, find two discoveries, and return.',
    location:c.stops[s.at].name,time:s.time,budget:c.budget,energy:s.energy,maxEnergy:c.maxEnergy??null,visited:s.visited.length,required:c.minVisits,discoveries,
    options:Object.entries(c.stops).filter(([id])=>id!==c.finish).map(([id,v])=>({id,name:v.name,kind:v.kind,points:v.points,...quote(s,id)})),
    canUndo:s.phase==='planning'&&!s.paused&&s.history.length>0,canFinish:s.phase==='planning'&&!s.paused&&ready&&finishAt<=c.budget,
    finishAt,returnCost,previewScore:s.score+bonus,bonus,earned:s.phase==='complete'?s.result.total:0,
    feedback:ready?'A good route. Finish now, or see what else fits.':s.kind==='tour'&&discoveries<2?`${2-discoveries} more ${discoveries===1?'discovery':'discoveries'} to find.`:`${Math.max(0,c.minVisits-s.visited.length)} more stops to make your route.`,
    result:s.result};}
export function reduceRoute(s,a){if(!a||a.runId!==s.runId||a.revision!==s.revision||s.phase!=='planning')return s;
  const next=patch=>({...s,...patch,revision:s.revision+1});
  if(a.type==='CANCEL')return next({phase:'cancelled'});
  if(a.type==='PAUSE'||a.type==='RESUME'){const paused=a.type==='PAUSE';return paused===s.paused?s:next({paused})}
  if(s.paused)return s;
  if(a.type==='UNDO'){const old=s.history.at(-1);return old?{...old,revision:s.revision+1,history:s.history.slice(0,-1)}:s}
  if(a.type==='FINISH'){const v=routeView(s);if(!v.canFinish)return s;const steps=[...s.steps];if(v.bonus)steps.push({cause:'Time to spare and a varied route',points:v.bonus});return next({phase:'complete',time:v.finishAt,at:config(s.kind).finish,path:[...s.path,config(s.kind).finish],result:{total:v.previewScore,steps,visits:s.visited.length}})}
  if(a.type!=='VISIT')return s;const q=quote(s,a.stop);if(!q.allowed)return s;const c=config(s.kind),to=c.stops[a.stop];
  return next({history:[...s.history,{...s,history:[]}],path:[...s.path,a.stop],at:a.stop,time:q.end,
    energy:s.kind==='tour'?Math.min(c.maxEnergy,s.energy-to.cost+(to.restore||0)):null,
    visited:[...s.visited,a.stop],passes:to.grants?[...new Set([...s.passes,to.grants])]:s.passes,
    score:s.score+to.points,steps:[...s.steps,{cause:to.name,points:to.points}]});
}
