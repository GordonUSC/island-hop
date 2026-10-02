// Player-authored motion: a visible timing decision, not a right-answer quiz.
export const BEATS=Object.freeze(['prepare','leap','land','settle']);
export const BRIEFS=Object.freeze({
  weight:{title:'Make the landing feel heavy',hint:'Give the preparation and landing more time than the leap.',initial:[3,3,3,3]},
  surprise:{title:'Give the leap a little surprise',hint:'Build anticipation, move quickly, then let the pose read.',initial:[3,3,3,3]},
  float:{title:'Let it float, then come home',hint:'Give the leap the most time. Leave room for a soft landing.',initial:[3,3,3,3]}
});
Object.values(BRIEFS).forEach(b=>{Object.freeze(b.initial);Object.freeze(b)});
export function createComposition({runId,brief='weight'}){if(!BRIEFS[brief]||typeof runId!=='string'||!runId)throw new TypeError('Invalid brief or runId');return {runId,revision:0,phase:'composing',paused:false,brief,beats:[...BRIEFS[brief].initial],history:[],watchedRevision:null,result:null}}
export function compositionView(s){const [prepare,leap,land,settle]=s.beats;const checks=s.brief==='weight'?[prepare>=4,leap<=2,land>=4]:s.brief==='surprise'?[prepare>=5,leap<=2,settle>=3]:[leap>=5,land>=2,settle>=3];
  const labels=s.brief==='weight'?['Anticipation has weight','Leap is quick','Landing has time to settle']:s.brief==='surprise'?['Anticipation builds','Leap surprises','Pose has room to read']:['Flight has room','Landing is gentle','Finish has breathing room'];
  const met=checks.filter(Boolean).length;
  return {title:BRIEFS[s.brief].title,hint:BRIEFS[s.brief].hint,beats:BEATS.map((id,i)=>({id,ticks:s.beats[i]})),budget:12,criteria:checks.map((met,i)=>({label:labels[i],met})),met,total:3,
    canFinish:s.phase==='composing'&&!s.paused&&met===3&&s.watchedRevision===s.beats.join(','),
    mustWatch:s.watchedRevision!==s.beats.join(','),previewScore:met*60,earned:s.result?.total??0,
    feedback:met===3?(s.watchedRevision===s.beats.join(',')?'That reads clearly. Keep your performance.':'Watch your timing come to life before you keep it.'):'Try moving one beat of time, then watch what changes.'};}
export function reduceComposition(s,a){if(!a||a.runId!==s.runId||a.revision!==s.revision||s.phase!=='composing')return s;
  const next=patch=>({...s,...patch,revision:s.revision+1});
  if(a.type==='CANCEL')return next({phase:'cancelled'});
  if(a.type==='PAUSE'||a.type==='RESUME'){const paused=a.type==='PAUSE';return paused===s.paused?s:next({paused})}
  if(s.paused)return s;
  if(a.type==='TRANSFER'){const from=BEATS.indexOf(a.from),to=BEATS.indexOf(a.to);if(from<0||to<0||from===to||s.beats[from]<=1||s.beats[to]>=7)return s;const beats=[...s.beats];beats[from]--;beats[to]++;return next({beats,history:[...s.history,s.beats],watchedRevision:null})}
  if(a.type==='UNDO'){if(!s.history.length)return s;return next({beats:[...s.history.at(-1)],history:s.history.slice(0,-1),watchedRevision:null})}
  // Adapter sends WATCHED only after a complete, unpaused playback for this revision.
  if(a.type==='WATCHED')return next({watchedRevision:s.beats.join(',')});
  if(a.type==='FINISH'&&compositionView(s).canFinish)return next({phase:'complete',result:{total:180,beats:[...s.beats],brief:s.brief,steps:[{cause:'A readable performance',points:180}]}});
  return s;
}
export function poseAt(beats,t){if(!Array.isArray(beats)||beats.length!==4||beats.some(n=>!Number.isInteger(n)||n<1)||!Number.isFinite(t))throw new TypeError('Invalid timing');
  const total=beats.reduce((a,b)=>a+b,0);let tick=Math.max(0,Math.min(total,t*total));let index=0;while(index<3&&tick>=beats[index]){tick-=beats[index];index++}const u=Math.max(0,Math.min(1,tick/beats[index]));
  if(index===0)return {phase:'prepare',x:0,y:0,scaleY:1-.28*u};
  if(index===1)return {phase:'leap',x:u*3,y:Math.sin(u*Math.PI)*3,scaleY:1+.18*Math.sin(u*Math.PI)};
  if(index===2)return {phase:'land',x:3,y:0,scaleY:.72+.28*u};
  return {phase:'settle',x:3,y:0,scaleY:1};
}
