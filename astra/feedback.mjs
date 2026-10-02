// Presentation only: the game owns scores, goals, persistence and event identity.
const number = n => Number.isFinite(n) && n >= 0 ? n : null;
const fmt = n => n.toLocaleString('en-US');
const text = v => typeof v === 'string' ? v : '';
export function presentFeedback(s) {
  const circuit = s.mode === 'circuit';
  const points = number(s.score?.value);
  const target = number(s.score?.target);
  const bankable = number(s.risk?.bankable);
  const goal = s.goal || {};
  const done = number(goal.done), total = number(goal.total);
  const progress = done !== null && total > 0
    ? {done: Math.min(done, total), total, label: `${fmt(Math.min(done,total))} / ${fmt(total)} ${text(goal.unit)}`.trim()} : null;
  const delta = typeof s.score?.scope === 'string' && s.score.scope.length > 0 && s.lastEvent?.scope === s.score.scope && Number.isFinite(s.lastEvent?.delta)
    ? `${s.lastEvent.delta >= 0 ? '+' : '−'}${fmt(Math.abs(s.lastEvent.delta))} · ` : '';
  const upgrades = (s.upgrades || []).filter(u => u.confirmed).map(u => ({
    name: text(u.name), detail: circuit ? 'Saved for exploration · inactive in this circuit' : text(u.effect)
  }));
  const mastery = (s.mastery || []).filter(m => number(m.done)!==null && number(m.total)>0)
    .map(m => `${Math.min(m.done,m.total)} / ${m.total} ${text(m.label)}`);
  const held = s.equipment?.name ? `${text(s.equipment.name)} · ${text(s.equipment.next)}` : '';
  return {
    mode: circuit ? 'This circuit' : 'Explore & build',
    objective: text(goal.title) || 'Choose an island to explore',
    next: text(goal.next), progress,
    score: points === null ? null : {
      label: text(s.score.label) || (circuit ? 'Circuit points' : 'Activity points'), value: fmt(points),
      detail: target > 0 ? points >= target ? `Target ${fmt(target)} reached` : `${fmt(target-points)} to target ${fmt(target)}` : text(s.score?.explanation),
      retained: text(s.score?.retained)
    },
    risk: bankable === null ? '' : `${fmt(bankable)} available to bank · not yet earned${s.risk.requiredAbove > 0 ? ` · must beat ${fmt(s.risk.requiredAbove)}` : ''}`,
    event: s.lastEvent ? `${delta}${text(s.lastEvent.cause)}` : '',
    equipment: held, mastery, upgrades,
    paused: !!s.paused,
    save: s.saveStatus === 'saved' ? 'Progress saved on this device' : s.saveStatus === 'failed' ? 'Progress could not be saved on this device' : ''
  };
}

export function mountFeedback(root) {
  const doc = root.ownerDocument;
  function el(tag, className, parent=root) { const n=doc.createElement(tag);n.className=className;parent.append(n);return n; }
  root.classList.add('player-feedback'); root.setAttribute('aria-label','Your progress');
  const mode=el('small','pf-mode'), title=el('h2','pf-goal'), next=el('p','pf-next');
  const meter=el('progress','pf-meter'); const count=el('p','pf-count');
  const score=el('div','pf-score'), scoreLabel=el('span','',score), value=el('strong','',score), detail=el('small','',score);
  const risk=el('p','pf-risk'), event=el('p','pf-event');
  event.setAttribute('role','status'); event.setAttribute('aria-live','polite'); event.setAttribute('aria-atomic','true');
  const held=el('p','pf-equipment'), more=el('details','pf-more'), summary=el('summary','',more);
  summary.textContent='My progress & abilities';
  const retained=el('p','',more), mastery=el('p','',more), upgrades=el('ul','',more), saved=el('p','pf-save',more);
  let lastEventKey=null, previous='';
  const put=(n,t)=>{if(n.textContent!==t)n.textContent=t;n.hidden=!t;};
  return {update(snapshot) {
    const p=presentFeedback(snapshot), serialized=JSON.stringify(p);
    if(serialized===previous && snapshot.lastEvent?.id===lastEventKey)return p;
    previous=serialized;
    put(mode,`${p.mode}${p.paused?' · Paused':''}`);put(title,p.objective);put(next,p.next);
    meter.hidden=!p.progress;
    if(p.progress){meter.max=p.progress.total;meter.value=p.progress.done;meter.setAttribute('aria-label',p.objective);}
    put(count,p.progress?.label||'');score.hidden=!p.score;
    put(scoreLabel,p.score?.label||'');put(value,p.score?.value||'');put(detail,p.score?.detail||'');
    put(risk,p.risk);put(held,p.equipment);put(retained,p.score?.retained||'');put(mastery,p.mastery.join(' · '));put(saved,p.save);
    // Reconcile semantic events when score context changes; frames never announce scores.
    const eventKey=snapshot.lastEvent?.id??null;
    if(eventKey!==lastEventKey||event.textContent!==p.event){put(event,p.event);lastEventKey=eventKey;}
    upgrades.replaceChildren();
    for(const u of p.upgrades){const li=doc.createElement('li');li.textContent=`${u.name} · ${u.detail}`;upgrades.append(li);}
    return p;
  }, destroy(){root.replaceChildren();root.classList.remove('player-feedback');root.removeAttribute('aria-label');}};
}
