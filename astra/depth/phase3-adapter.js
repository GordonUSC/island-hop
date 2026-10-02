import {FESTIVAL, TOUR, createRoute, routeView, reduceRoute} from './routes.mjs';
import {BEATS, BRIEFS, createComposition, compositionView, reduceComposition, poseAt} from './composition.mjs';

const INK=0x173c39, PAPER=0xfff8e9, TEAL=0x239a88, GOLD=0xffcd6e, CORAL=0xe97562;
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,title,enabled=true,detail='')=>`<button type="button" data-a="${esc(action)}" ${enabled?'':'disabled'} style="min-height:44px;white-space:normal;text-align:left;opacity:${enabled?1:.62}${action==='finish'&&enabled?';background:#176b61;color:#fff8e9':''}"><b>${esc(title)}</b>${detail?`<small style="display:block;font-size:11px;font-weight:500;line-height:1.35;margin-top:4px">${esc(detail)}</small>`:''}</button>`;
const panel=(content,footer='')=>`<div class="depth-options" style="width:100%"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:7px;max-height:min(30dvh,300px);overflow:auto;overscroll-behavior:contain">${content}</div>${footer?`<div style="display:flex;gap:6px;flex-wrap:wrap;background:#fff8e9;padding-top:8px">${footer}</div>`:''}</div>`;
const frame=html=>`<div data-depth-ui style="width:100%;min-width:0"><style>.hud:has(.depth-options) .banner{left:auto;right:18px;translate:none;width:min(410px,calc(100vw - 24px))}.hud:has(.depth-options) .banner h3{padding-right:86px}.depth-options button:focus-visible{outline:3px solid #176b61;outline-offset:-3px}@media(max-width:700px){.hud:has(.depth-options) .banner{left:12px;right:12px;width:auto}.hud:has(.depth-options) .banner p{font-size:12px;line-height:1.35}.hud:has(.depth-review) .banner{top:auto;bottom:92px}.hud:has(.depth-review) .journey{top:65px!important;bottom:auto!important;max-height:120px!important;width:calc(100vw - 24px)!important}.hud:has(.depth-review) .journey .pf-more,.hud:has(.depth-review) .journey .pf-event{display:none!important}}</style>${html}</div>`;
const routeFeedback=v=>v.canFinish&&!v.options.some(o=>o.allowed)?'Your route is ready. Finish to keep it.':v.feedback.replace('1 more stops','1 more stop');
const actionOf=input=>typeof input==='string'?input:input?.target?.closest?.('[data-a]')?.dataset?.a;

/** Engine-facing rendering adapter. All scores and persistence remain engine-owned. */
export function createIslandToy(kind,b){
  if(!['pier','studio','campus'].includes(kind))throw new TypeError('Unsupported island toy');
  for(const name of ['mat','banner','choices','info','scoreBase','win','clock'])if(typeof b[name]!=='function')throw new TypeError(`Missing bridge.${name}`);
  if(!b.THREE||!b.root)throw new TypeError('THREE and positioned root required');
  const T=b.THREE, runId=b.runId||`${kind}-${Number(b.seed)>>>0}`;
  let live=true,credited=false,paused=false,selected=null,playback=null,record=null,renderToken=0,reviewing=false;
  const owned=new T.Group(); b.root.add(owned);
  const geometry=new Set(),materials=new Set();
  const material=(color,opts={})=>{const source=b.mat(color,opts),m=source.clone?source.clone():source;materials.add(m);return m};
  const mesh=(g,color,parent=owned)=>{geometry.add(g);const m=new T.Mesh(g,material(color));parent.add(m);return m};
  const cylinder=(radius,height,color,parent=owned)=>mesh(new T.CylinderGeometry(radius,radius,height,24),color,parent);
  const ball=(radius,color,parent=owned)=>mesh(new T.SphereGeometry(radius,20,14),color,parent);
  const at=(object,x,y,z)=>{object.position.set(x,y,z);return object};
  const line=(a,z,color,opacity=1)=>{
    const delta=z.clone().sub(a),m=mesh(new T.CylinderGeometry(.055,.055,delta.length(),8),color);
    m.position.copy(a.clone().add(z).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());
    m.material.transparent=opacity<1;m.material.opacity=opacity;return m;
  };
  const signal=(cause,n=5)=>{b.event?.(cause);b.chime?.(n,.1)};
  function dispose(){if(!live)return;live=false;playback=null;owned.removeFromParent?.();for(const g of geometry)g.dispose?.();for(const m of materials)m.dispose?.();geometry.clear();materials.clear();}
  function finish(state){
    if(credited||!live||!state.result)return;
    credited=true;playback=null;
    const result=state.result;
    record={version:1,kind,total:result.total,...(kind==='campus'?{brief:state.brief,beats:[...result.beats]}:{path:[...state.path],visits:result.visits})};
    for(const step of result.steps)b.scoreBase(step.points,step.cause);
    b.choices('',()=>{});
    b.info(kind==='campus'?'Your timing is yours. Watch for it when you return.':'Route complete. Your choices made this afternoon.');
    signal(kind==='campus'?'Your performance is ready.':`Route complete: ${result.visits} stops, ${result.total} points.`,10);
    b.burst?.(owned.getWorldPosition(new T.Vector3()).add(new T.Vector3(0,3,0)),50,5,6);
    b.win();
  }
  const api={untimed:true,rawTally:true,rawHit:true,depthToy:true,tapAnywhere:null,cancel(){if(!live)return;state=reduce(state,{type:'CANCEL',runId,revision:state.revision});dispose();},dispose,
    setPaused(value){if(!live||credited||paused===!!value)return;paused=!!value;playback=null;state=reduce(state,{type:paused?'PAUSE':'RESUME',runId,revision:state.revision});render();},
    get result(){return record?JSON.parse(JSON.stringify(record)):null},
    snapshot(){return {kind,phase:state.phase,paused,preview:kind==='campus'?compositionView(state):routeView(state),result:record?JSON.parse(JSON.stringify(record)):null}},
    tick(t,dt){if(!live||credited||paused||!Number.isFinite(dt)||dt<=0)return;animate(t,Math.min(dt,.1));},
    tap(object){if(!live||credited||paused)return;let hit=object;while(hit&&hit!==b.root&&!hit.userData?.depthAction)hit=hit.parent;const a=hit?.userData?.depthAction;if(a)dispatch(a,state.revision);}
  };
  let state,reduce,render,dispatch,animate,choiceContainer;
  function refreshWithFocus(){
    const action=choiceContainer?.querySelector('button[data-a]:focus')?.dataset.a;
    render();
    if(action){const target=[...choiceContainer.querySelectorAll('button[data-a]')].find(n=>!n.disabled&&n.dataset.a===action);target?.focus();}
  }
  function handleChoice(input,token,revision){
    if(token!==renderToken)return;
    const action=actionOf(input),container=input?.target?.closest?.('[data-depth-ui]')?.parentElement;
    if(container)choiceContainer=container;
    dispatch(action,revision);
    // Keep keyboard users inside their activity after the choice markup changes.
    // Read and focus only the engine-provided choices container, never other DOM.
    if(container&&live&&!credited){const options=[...container.querySelectorAll('button[data-a]')].filter(n=>!n.disabled);const target=options.find(n=>n.dataset.a===action)||options[0];target?.focus();}
  }

  if(kind!=='campus'){
    const config=kind==='pier'?FESTIVAL:TOUR;
    state=createRoute({kind:kind==='pier'?'festival':'tour',runId});reduce=reduceRoute;
    const positions={},nodes={},routeLines=[],ids=Object.keys(config.stops);
    const tourXY={welcome:[0,3],studio:[-3,0],gallery:[3,0],lab:[-2,-3],garden:[0,0],showcase:[2,-3]};
    for(const [id,stop] of Object.entries(config.stops)){
      const [x,z]=kind==='pier'?[(stop.x-1)*3,(stop.y-.5)*4]:tourXY[id];
      positions[id]=new T.Vector3(x,3,z);
      const node=new T.Group();node.position.copy(positions[id]);node.userData={tap:id!==config.finish,depthAction:`visit:${id}`};owned.add(node);
      const base=cylinder(.62,.16,id===config.finish?INK:TEAL,node);base.position.y=.1;
      const pin=ball(.25,id===config.finish?GOLD:PAPER,node);pin.position.y=.5;
      if(stop.kind==='music'||stop.kind==='sharing'){const flag=mesh(new T.BoxGeometry(.65,.45,.12),CORAL,node);flag.position.set(.22,1,0);const pole=cylinder(.045,.9,GOLD,node);pole.position.set(-.12,.6,0);}
      else if(stop.kind==='discovery'){const gem=mesh(new T.OctahedronGeometry(.34),GOLD,node);gem.position.y=1.05;}
      else if(stop.kind==='rest'){const leaf=ball(.4,TEAL,node);leaf.scale.set(1,.5,1);leaf.position.y=.85;}
      nodes[id]={node,base,pin};
    }
    const links=new Set();
    for(const id of ids){for(const to of (config.stops[id].edges||[])){const key=[id,to].sort().join('|');if(links.has(key))continue;links.add(key);line(positions[id],positions[to],PAPER,.35);}}
    if(kind==='pier'){for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const a=config.stops[ids[i]],c=config.stops[ids[j]];if(Math.abs(a.x-c.x)+Math.abs(a.y-c.y)===1)line(positions[ids[i]],positions[ids[j]],PAPER,.4);}}
    const previous=b.previous;
    if(previous?.version===1&&previous.kind===kind&&Array.isArray(previous.path)&&previous.path.every(id=>positions[id]))for(let i=1;i<previous.path.length;i++)line(positions[previous.path[i-1]],positions[previous.path[i]],GOLD,.2);
    const avatar=ball(.18,CORAL);avatar.position.copy(positions[state.at]).add(new T.Vector3(0,1.55,0));
    render=()=>{
      const view=routeView(state),revision=state.revision,token=++renderToken;
      b.banner(config.title,`${view.goal} Time ${view.time}/${view.budget}${view.energy===null?'':` · Energy ${view.energy}/${view.maxEnergy}`}. ${routeFeedback(view)}`,config.minVisits);
      b.meter?.(Math.min(view.visited,config.minVisits));
      const content=view.options.map(o=>button(`visit:${o.id}`,o.name,o.allowed,
        state.visited.includes(o.id)?'Visited':o.allowed?`${o.points} route points · finish at ${o.end}${o.wait?` · wait ${o.wait}`:''}${view.energy===null?'':` · energy cost ${o.cost}`}`:o.reason)).join('');
      const footer=button('undo','Undo last stop',view.canUndo)+button('finish',view.canFinish?`Finish · ${view.previewScore} points`:'Finish route',view.canFinish,view.canFinish?`Back by ${view.finishAt}/${view.budget}`:`${view.required} stops${kind==='studio'?' + 2 discoveries':''} required`);
      const itinerary=`<p style="font-size:12px;margin:6px 0;color:#173c39">${esc(state.visited.length?state.visited.map(id=>config.stops[id].name).join(' → '):'Choose your first stop. Nothing is on a real-time clock.')}</p>`;
      b.choices(frame(panel(content,footer)+itinerary),input=>handleChoice(input,token,revision));
      for(const id of ids){const n=nodes[id],visited=state.visited.includes(id);n.base.material.color.setHex(visited?GOLD:id===config.finish?INK:TEAL);n.pin.scale.setScalar(id===state.at?1.5:1);}
      avatar.position.copy(positions[state.at]).add(new T.Vector3(0,1.55,0));
      for(const m of routeLines){owned.remove(m);geometry.delete(m.geometry);materials.delete(m.material);m.geometry.dispose?.();m.material.dispose?.();}routeLines.length=0;
      for(let i=1;i<state.path.length;i++)routeLines.push(line(positions[state.path[i-1]].clone().add(new T.Vector3(0,.12,0)),positions[state.path[i]].clone().add(new T.Vector3(0,.12,0)),GOLD));
    };
    dispatch=(action,revision)=>{
      if(!live||credited||paused||revision!==state.revision||!action)return;
      const a=action.startsWith('visit:')?{type:'VISIT',stop:action.slice(6)}:{type:{undo:'UNDO',finish:'FINISH'}[action]};
      const next=reduce(state,{...a,runId,revision});if(next===state)return;state=next;
      if(state.phase==='complete'){finish(state);return;}render();signal(action==='undo'?'A little room to rethink your route.':`${config.stops[state.at].name}. ${routeFeedback(routeView(state))}`);
    };
    animate=(t)=>{if(!b.reducedMotion)avatar.position.y=positions[state.at].y+1.55+Math.sin(t*2)*.1;};
  } else {
    const saved=b.previous,brief=saved?.version===1&&saved.kind===kind&&BRIEFS[saved.brief]?saved.brief:Object.keys(BRIEFS)[(Number(b.seed)>>>0)%3];
    state=createComposition({runId,brief});reduce=reduceComposition;
    if(saved?.version===1&&saved.kind===kind&&Array.isArray(saved.beats)&&saved.beats.length===4&&saved.beats.every(n=>Number.isInteger(n)&&n>=1&&n<=7)&&saved.beats.reduce((a,n)=>a+n,0)===12)state={...state,beats:[...saved.beats]};
    const stage=cylinder(3.1,.18,PAPER);stage.position.set(0,2.65,0);stage.scale.z=.6;
    for(const x of[-1.5,1.5])at(cylinder(.65,.08,TEAL),x,2.8,0);
    const creature=new T.Group();owned.add(creature);
    at(ball(.72,CORAL,creature),0,.8,0);at(ball(.5,GOLD,creature),0,1.5,0);
    for(const x of[-.19,.19]){at(ball(.1,INK,creature),x,1.52,.44);at(ball(.03,PAPER,creature),x-.02,1.55,.52);at(ball(.2,TEAL,creature),x*2,.15,.12);}
    const setPose=p=>{creature.position.set(p.x-1.5,2.85+p.y,0);creature.scale.set(1/Math.sqrt(p.scaleY),p.scaleY,1/Math.sqrt(p.scaleY));};
    setPose(poseAt(state.beats,0));
    render=()=>{
      const view=compositionView(state),revision=state.revision,token=++renderToken;
      if(reviewing){
        b.banner('Your timing, in motion',playback?'Watch the anticipation, leap and landing.':view.mustWatch?'Restart the preview to watch your whole performance.':'How does that feel? Keep it, or adjust a beat.',0);
        b.choices(frame('<span class="depth-review" hidden></span>'+panel(button('watch',playback?'Restart preview':'Watch again',!paused)+button('adjust','Adjust timing',!paused)+button('finish','Keep this performance',view.canFinish))),input=>handleChoice(input,token,revision));return;
      }
      b.banner(view.title,view.hint,3);b.meter?.(view.met);
      const controls=view.beats.map(beat=>button(`beat:${beat.id}`,`${beat.id[0].toUpperCase()+beat.id.slice(1)} · ${beat.ticks}`,!paused,
        selected===beat.id?'Selected: choose where its beat should go.':selected?'Give this phase one beat.':'Take one beat from here.')).join('');
      const criteria=view.criteria.map(c=>`<span style="display:block">${c.met?'✓':'○'} ${esc(c.label)}</span>`).join('');
      const briefButtons=Object.entries(BRIEFS).map(([id,brief])=>button(`brief:${id}`,id===state.brief?`${id} · selected`:id,!paused,brief.title)).join('');
      const content=`<div style="grid-column:1/-1;color:#173c39;font-size:12px;line-height:1.6">${criteria}</div>${controls}`;
      const footer=button('watch',playback?'Restart preview':'Watch your timing',!paused)+button('undo','Undo',!paused&&state.history.length>0)+button('finish','Keep this performance',view.canFinish);
      b.choices(frame(panel(content,footer)+`<p style="font-size:12px;color:#173c39;margin:6px 0">${esc(view.feedback)} Twelve beats in total.</p><details style="font-size:12px;color:#173c39"><summary style="min-height:44px;display:flex;align-items:center">Try another brief</summary><div style="display:flex;gap:6px;flex-wrap:wrap">${briefButtons}</div></details>`),input=>handleChoice(input,token,revision));
    };
    dispatch=(action,revision)=>{
      if(!live||credited||paused||revision!==state.revision||!action)return;
      if(action==='adjust'){playback=null;reviewing=false;render();return;}
      if(action==='watch'){selected=null;reviewing=true;playback={elapsed:0,revision:state.revision,beats:[...state.beats]};setPose(poseAt(playback.beats,0));render();return;}
      if(action.startsWith('brief:')){reviewing=false;const next=action.slice(6);if(!BRIEFS[next]||next===state.brief)return;playback=null;selected=null;state={...createComposition({runId,brief:next}),revision:state.revision+1};setPose(poseAt(state.beats,0));render();return;}
      if(action.startsWith('beat:')){
        const to=action.slice(5);if(!BEATS.includes(to))return;
        if(!selected){if(state.beats[BEATS.indexOf(to)]<=1){b.info('Leave at least one beat in each phase. Take time from another phase.');return;}selected=to;render();return;}
        if(selected===to){selected=null;render();return;}
        const next=reduce(state,{type:'TRANSFER',from:selected,to,runId,revision});selected=null;playback=null;
        if(next===state){b.info('That phase is full. Choose another place for the beat.');render();return;}state=next;setPose(poseAt(state.beats,0));render();b.sfx?.('pop',.3);return;
      }
      const next=reduce(state,{type:{undo:'UNDO',finish:'FINISH'}[action],runId,revision});if(next===state)return;state=next;playback=null;selected=null;
      if(state.phase==='complete'){finish(state);return;}setPose(poseAt(state.beats,0));render();
    };
    animate=(t,dt)=>{
      if(!playback)return;playback.elapsed+=dt;setPose(poseAt(playback.beats,Math.min(1,playback.elapsed/3)));
      if(playback.elapsed+1e-9>=3){const revision=playback.revision;playback=null;const next=reduce(state,{type:'WATCHED',runId,revision});if(next!==state){state=next;refreshWithFocus();signal('That is your timing. Keep it, or change a beat.',7);}}
    };
  }
  render();return api;
}
