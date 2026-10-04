import { PILOT_KEY, THEMES, FRIENDS, identity, friendFromName, cleanCollection, loadPilots, discover, useBreeze, storiesFor } from './pilot-data.mjs';

export function mountPersonalFlight(api) {
  const T = api.THREE;
  let stored = null, storageOK = true;
  try { stored = localStorage.getItem(PILOT_KEY); } catch { storageOK = false; }
  const saved = loadPilots(stored);
  const suggestion = new URLSearchParams(location.search).get('pilot');
  let draft = saved.active || identity(FRIENDS[suggestion]?.name || 'New friend', FRIENDS[suggestion]?.theme || 'sunrise');
  let activeRoot = null, preview = null, nameplate = null, pennant = null;
  let pending = 0, recentStory = null, previousFocus = null, elapsed = 0, uiClock = 0;
  let audio = null, audioNodes = new Set(), lastCue = -Infinity, toastTimer;
  const prepared = new Set();
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = new URL('./personal-flight.css', import.meta.url).href;
  document.head.append(css);

  const dialog = document.createElement('dialog');
  dialog.className = 'pilot-hangar'; dialog.setAttribute('aria-labelledby', 'ph-title');
  dialog.innerHTML = `<header class="ph-top"><div><p class="ph-eyebrow">The balloon atelier</p><h2 id="ph-title">Who’s flying?</h2></div><button type="button" class="ph-close" aria-label="Close balloon atelier">×</button></header>
    <div class="ph-layout"><section class="ph-visual" aria-label="Your balloon preview"><div class="ph-preview" role="img" aria-label="Your balloon in three dimensions"><div class="ph-preview-fallback"></div></div><p class="ph-eyebrow">Made for your kind of sky</p><h3 class="ph-theme-name"></h3><p class="ph-theme-story"></p><div class="ph-preview-controls"><button type="button" class="ph-turn" aria-label="Turn balloon preview">↻ Turn</button><span>Drag-free · take a look around</span></div></section>
    <section class="ph-controls" aria-label="Personalize your flight"><label class="ph-field"><span>Pick a welcome</span><select id="ph-person"><option value="new">I’m a new friend</option><option value="cale">Cale · SXSW to Gryphus</option><option value="gordon">Gordon · your own little world</option></select></label><label class="ph-field"><span>Your name on the balloon</span><input id="ph-name" type="text" maxlength="40" autocomplete="off" placeholder="What should we call you?"></label><p class="ph-eyebrow">Choose your colors & sound</p><div class="ph-themes" role="group" aria-label="Balloon theme"></div><div class="ph-sound"><button type="button" id="ph-preview-sound">Add sound & preview</button><small class="ph-sound-label"></small></div><p class="ph-description"></p><p class="ph-status" role="status" aria-live="polite"></p><button type="button" class="ph-apply"><span>Make this my balloon</span><span aria-hidden="true">↗</span></button><p class="ph-privacy">No account needed. Your name, colors and discoveries stay in this browser. This changes your balloon; your island progress stays with you.</p></section></div>
    <section class="ph-stories"><p class="ph-eyebrow">Little things to take with you</p><h3>Your flight keepsakes</h3><p>Discover these on your first lift, landing and toy win—or read them here whenever you like. Everyone gets a welcome breeze.</p><div class="ph-collection"></div><div class="ph-story-list"></div><p>A breeze refills your burner and gives you a lift. Your first toy win adds another, plus a pennant for your basket. Personal bonuses rest during Joy Circuit races, so everyone races by the same rules.</p></section>`;
  document.body.append(dialog);
  const q = s => dialog.querySelector(s);
  const person = q('#ph-person'), name = q('#ph-name'), status = q('.ph-status');
  for (const [key, theme] of Object.entries(THEMES)) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ph-theme'; b.dataset.theme = key;
    const dot = document.createElement('span'); dot.className = 'ph-swatch'; dot.setAttribute('aria-hidden', 'true');
    dot.style.background = `repeating-linear-gradient(90deg,${theme.colors[0]} 0 7px,${theme.colors[1]} 7px 14px)`;
    b.append(dot, document.createTextNode(theme.short));
    b.onclick = () => { draft = identity(name.value, key, person.value); refreshDraft(); };
    q('.ph-themes').append(b);
  }
  const invite = document.createElement('button'); invite.type = 'button'; invite.className = 'pilot-invite';
  invite.innerHTML = '<span class="pilot-dot" aria-hidden="true"></span><span class="pilot-invite-label"></span>';
  const start = document.querySelector('#start .panel');
  if (start) start.insertBefore(invite, start.querySelector('.row.primary'));
  const bar = document.createElement('div'); bar.className = 'pilot-flightbar'; bar.hidden = true;
  bar.setAttribute('aria-label', 'Your personal flight');
  bar.innerHTML = '<button type="button" class="pilot-edit">My balloon</button><button type="button" class="pilot-gift" hidden></button><button type="button" class="pilot-pending" hidden></button>';
  document.body.append(bar);
  const gift = bar.querySelector('.pilot-gift'), inbox = bar.querySelector('.pilot-pending');
  const toast = document.createElement('div'); toast.className = 'ph-toast'; toast.hidden = true; toast.setAttribute('role', 'status');
  document.body.append(toast);
  function announce(text) { toast.textContent = text; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4200); }
  function collection(pilot = saved.active) { return cleanCollection(saved.profiles[pilot?.key]); }
  function persist() {
    const keys = Object.keys(saved.profiles);
    for (const k of keys.slice(0, Math.max(0, keys.length - 24))) if (k !== saved.active?.key) delete saved.profiles[k];
    try { localStorage.setItem(PILOT_KEY, JSON.stringify(saved)); } catch { storageOK = false; }
  }
  function setColors(el, theme) { el.style.setProperty('--pilot-a', theme.colors[0]); el.style.setProperty('--pilot-b', theme.colors[1]); }
  function updateLabels() {
    const p = saved.active, display = p || draft;
    setColors(invite, THEMES[display.theme]);
    const label = invite.querySelector('.pilot-invite-label'); label.replaceChildren();
    label.append(document.createTextNode(p ? `${p.name}’s balloon` : suggestion === 'cale' ? 'Cale, your balloon is waiting' : 'Make the balloon yours'));
    const small = document.createElement('small'); small.textContent = p ? `${THEMES[p.theme].name} · change anytime` : 'Your name, your colors, little surprises'; label.append(small);
    bar.querySelector('.pilot-edit').textContent = p ? `${p.name}’s balloon` : 'My balloon';
    const c = collection(), s = api.getState();
    bar.hidden = !s.started || s.circuit;
    gift.hidden = !p;
    gift.textContent = `${p?.friend === 'cale' ? 'Backstage breeze' : 'Welcome breeze'} · ${c.fuel}`;
    gift.disabled = !p || !c.fuel || s.mode !== 'fly' || s.paused || s.circuit;
    gift.title = c.fuel ? 'Refill your burner and catch a lift' : 'Your first toy win adds another breeze';
    inbox.hidden = !pending; inbox.textContent = pending === 1 ? 'A keepsake for you ↗' : `${pending} keepsakes for you ↗`;
  }
  function renderStories() {
    const c = collection(draft), list = q('.ph-story-list'); list.replaceChildren();
    q('.ph-collection').textContent = `${c.found.length} of 3 found in flight · ${c.fuel} ${c.fuel === 1 ? 'breeze' : 'breezes'} aboard`;
    for (const story of storiesFor(draft)) {
      const details = document.createElement('details'); details.className = 'ph-story';
      details.dataset.story = story.id;
      const summary = document.createElement('summary'); summary.append(document.createTextNode(story.title));
      const flag = document.createElement('small'); flag.textContent = c.found.includes(story.id) ? '✓ Found in flight' : ({lift:'First lift',land:'First landing',win:'First toy win'}[story.id]); summary.append(flag);
      const eyebrow = document.createElement('p'); eyebrow.className = 'ph-eyebrow'; eyebrow.textContent = story.label;
      const text = document.createElement('p'); text.textContent = story.text;
      details.append(summary, eyebrow, text);
      if (story.image) { const img = document.createElement('img'); img.src = new URL('../' + story.image, import.meta.url).href; img.alt = story.alt; img.loading = 'lazy'; img.width = 640; img.height = 640; details.append(img); }
      list.append(details);
    }
  }
  function refreshDraft() {
    const theme = THEMES[draft.theme];
    q('.ph-theme-name').textContent = theme.name; q('.ph-theme-story').textContent = theme.story;
    q('.ph-sound-label').textContent = theme.sound;
    q('.ph-description').textContent = FRIENDS[draft.friend]?.subtitle || `${draft.name === 'New friend' ? 'A new friend' : draft.name} belongs in this little world. Pick a sky that feels like you.`;
    for (const b of dialog.querySelectorAll('[data-theme]')) b.setAttribute('aria-pressed', String(b.dataset.theme === draft.theme));
    setColors(q('.ph-visual'), theme);
    q('.ph-preview').setAttribute('aria-label', `${draft.name}’s ${theme.name} balloon, in three dimensions`);
    paint(draft); renderStories(); syncAudio();
  }
  function openHangar(showStories = false) {
    previousFocus = document.activeElement;
    draft = saved.active || identity(FRIENDS[suggestion]?.name || 'New friend', FRIENDS[suggestion]?.theme || 'sunrise');
    person.value = draft.friend || 'new'; name.value = draft.name === 'New friend' ? '' : draft.name;
    status.textContent = '';
    api.clearInput(); document.documentElement.classList.add('pilot-open');
    dialog.showModal(); dialog.scrollTop = 0; ensurePreview(); refreshDraft();
    if (showStories) {
      const item = recentStory && q(`[data-story="${recentStory}"]`); if (item) item.open = true;
      q('.ph-stories').scrollIntoView({block:'start'}); pending = 0; updateLabels();
    } else name.focus({preventScroll:true});
  }
  invite.onclick = () => openHangar(); bar.querySelector('.pilot-edit').onclick = () => openHangar(); inbox.onclick = () => openHangar(true);
  q('.ph-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { document.documentElement.classList.remove('pilot-open'); api.clearInput(); paint(saved.active); stopAudio(); previousFocus?.focus({preventScroll:true}); });
  dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
  person.onchange = () => { const f = FRIENDS[person.value]; name.value = f?.name || ''; draft = identity(name.value, f?.theme || draft.theme, person.value); status.textContent = ''; refreshDraft(); };
  name.oninput = () => { const f = friendFromName(name.value); const changed = f !== draft.friend; person.value = f || 'new'; draft = identity(name.value, changed && f ? FRIENDS[f].theme : draft.theme, f); refreshDraft(); };
  q('.ph-apply').onclick = () => {
    saved.active = identity(name.value, draft.theme, person.value); saved.profiles[saved.active.key] = collection(saved.active); persist();
    draft = saved.active; pending = 0; updateLabels(); dialog.close(); paint(saved.active);
    announce(`${saved.active.name}, your ${THEMES[saved.active.theme].short} balloon is ready.${storageOK ? '' : ' Saving is unavailable in this browser; your balloon is ready for this visit.'}`);
  };
  gift.onclick = () => {
    if (!saved.active) return;
    const result = useBreeze(collection(), api.getState());
    if (result.used && api.lift()) { saved.profiles[saved.active.key] = result.collection; persist(); updateLabels(); cue('lift'); announce('A little lift. Your burner is full again.'); }
  };

  function prepareMesh(mesh) {
    if (!mesh.isMesh || !mesh.geometry?.attributes.position || mesh.userData.pilotMaterial) return;
    mesh.geometry.computeBoundingBox(); const bb = mesh.geometry.boundingBox;
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(original => {
      const material = original.clone();
      const u = { pilotEnabled:{value:0}, pilotLow:{value:bb.min.y}, pilotSpan:{value:Math.max(.001,bb.max.y-bb.min.y)}, pilotCenter:{value:new T.Vector2((bb.min.x+bb.max.x)/2,(bb.min.z+bb.max.z)/2)}, pilotA:{value:new T.Color()}, pilotB:{value:new T.Color()}, pilotC:{value:new T.Color()} };
      material.userData.pilotUniforms = u;
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, u);
        shader.vertexShader = 'varying vec3 pilotPosition;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\npilotPosition = position;');
        shader.fragmentShader = 'varying vec3 pilotPosition; uniform float pilotEnabled; uniform float pilotLow; uniform float pilotSpan; uniform vec2 pilotCenter; uniform vec3 pilotA; uniform vec3 pilotB; uniform vec3 pilotC;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          float pilotAngle = (atan(pilotPosition.z-pilotCenter.y,pilotPosition.x-pilotCenter.x)+3.14159265)/6.2831853;
          float pilotPanel = fract(pilotAngle*6.0);
          float pilotHeight = (pilotPosition.y-pilotLow)/pilotSpan;
          float pilotFabric = smoothstep(.36,.43,pilotHeight)*pilotEnabled;
          vec3 pilotPaint = mix(pilotA,pilotB,step(.5,pilotPanel));
          float pilotHem = (1.0-smoothstep(.015,.03,abs(pilotHeight-.65)))*.85;
          pilotPaint = mix(pilotPaint,pilotC,pilotHem);
          float pilotDetail = clamp(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)),0.0,1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb,pilotPaint*(.64+.36*pilotDetail),pilotFabric);`);
      };
      material.customProgramCacheKey = () => 'personal-flight-fabric-v1'; material.needsUpdate = true;
      prepared.add(material); return material;
    });
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0]; mesh.userData.pilotMaterial = true;
  }
  function removeAdornment(object) { if (!object) return; object.removeFromParent(); object.geometry?.dispose(); object.material?.map?.dispose(); object.material?.dispose(); }
  function paint(pilot) {
    const theme = THEMES[pilot?.theme || 'sunrise'];
    for (const material of prepared) { const u = material.userData.pilotUniforms; u.pilotEnabled.value = pilot ? 1 : 0; u.pilotA.value.set(theme.colors[0]); u.pilotB.value.set(theme.colors[1]); u.pilotC.value.set(theme.colors[2]); }
    preview?.nameplate?.removeFromParent(); if (preview) preview.nameplate = null;
    removeAdornment(nameplate); removeAdornment(pennant); nameplate = null; pennant = null;
    if (!pilot) return;
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128; const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = theme.colors[2]; ctx.beginPath(); ctx.roundRect(4,4,504,120,25); ctx.fill();
      ctx.fillStyle = theme.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 55px sans-serif';
      if (ctx.measureText(pilot.name).width > 448) ctx.font = `bold ${Math.max(20,55*448/ctx.measureText(pilot.name).width)}px sans-serif`;
      ctx.fillText(pilot.name,256,66); const map = new T.CanvasTexture(canvas); map.colorSpace = T.SRGBColorSpace;
      nameplate = new T.Sprite(new T.SpriteMaterial({map,depthWrite:false})); nameplate.position.set(0,1.12,.87); nameplate.scale.set(1.05,.263,1); api.container.add(nameplate);
      if (preview) { preview.nameplate = nameplate.clone(); preview.group.add(preview.nameplate); }
    }
    if (collection(pilot).found.includes('win')) {
      const shape = new T.Shape(); shape.moveTo(0,0); shape.lineTo(.5,.12); shape.lineTo(0,.25); shape.closePath();
      pennant = new T.Mesh(new T.ShapeGeometry(shape),new T.MeshStandardMaterial({color:theme.colors[2],side:T.DoubleSide,roughness:.8}));
      pennant.position.set(.32,.47,.15); api.container.add(pennant);
    }
  }
  function disposePreviewRoot() {
    if (!preview?.root) return;
    preview.root.traverse(o => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) { prepared.delete(m); m.dispose(); } });
    preview.root.removeFromParent(); preview.root = null;
  }
  function ensurePreview() {
    if (!activeRoot) return;
    if (!preview) {
      try {
        const renderer = new T.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'}); renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)); renderer.outputColorSpace = T.SRGBColorSpace;
        const scene = new T.Scene(), camera = new T.PerspectiveCamera(35,1,.05,30); camera.position.set(0,1.4,6.2); camera.lookAt(0,1.4,0);
        scene.add(new T.HemisphereLight(0xfff6dd,0x355a57,2.8)); const light = new T.DirectionalLight(0xffd7a0,3); light.position.set(3,5,4); scene.add(light);
        const group = new T.Group(); scene.add(group); q('.ph-preview').append(renderer.domElement);
        preview = {renderer,scene,camera,group,root:null,width:0,height:0}; q('.ph-preview').dataset.live = 'true';
      } catch { q('.ph-preview').setAttribute('aria-label','Your balloon colors; 3D preview is unavailable on this device.'); return; }
    }
    if (!preview.root) {
      const root = activeRoot.clone(true); root.traverse(o => { if (o.isMesh) { o.userData.pilotMaterial = false; prepareMesh(o); } });
      preview.group.add(root); preview.root = root; paint(dialog.open ? draft : saved.active);
    }
  }
  q('.ph-turn').onclick = () => { if (preview) preview.group.rotation.y += Math.PI/2; };
  function setBalloon(root) { activeRoot = root; root.traverse(prepareMesh); disposePreviewRoot(); if (dialog.open) ensurePreview(); paint(dialog.open ? draft : saved.active); }

  function stopAudio() { for (const node of audioNodes) { try { node.stop(); } catch {} } audioNodes.clear(); }
  function syncAudio() {
    const s = api.getState(); if (!s.sound || !s.fx || document.hidden) stopAudio();
    q('#ph-preview-sound').textContent = s.sound && s.fx ? 'Preview sound' : 'Add sound & preview';
  }
  async function cue(kind, explicit = false) {
    const s = api.getState(), pilot = dialog.open ? draft : saved.active;
    if (!pilot || !s.sound || !s.fx || document.hidden || (!explicit && performance.now()-lastCue<1100)) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)(); await audio.resume();
      const current = api.getState(); if (!current.sound || !current.fx || document.hidden) return;
      lastCue = performance.now(); stopAudio();
      const theme = THEMES[pilot.theme], now = audio.currentTime + .025;
      const notes = kind === 'lift' && !explicit ? theme.notes.slice(0,2) : kind === 'win' ? [...theme.notes,theme.notes.at(-1)+12] : theme.notes;
      notes.forEach((note,i) => {
        const oscillator = audio.createOscillator(), gain = audio.createGain(), filter = audio.createBiquadFilter();
        oscillator.type = theme.type; oscillator.frequency.value = 440*Math.pow(2,(note-69)/12); filter.type='lowpass'; filter.frequency.value = theme.type==='sawtooth'?1100:3200;
        const t = now + i*theme.pace; gain.gain.setValueAtTime(0,t); gain.gain.linearRampToValueAtTime(.065,t+.014); gain.gain.exponentialRampToValueAtTime(.001,t+.6);
        oscillator.connect(filter); filter.connect(gain); gain.connect(audio.destination); oscillator.start(t); oscillator.stop(t+.65); audioNodes.add(oscillator);
        oscillator.onended = () => { oscillator.disconnect(); filter.disconnect(); gain.disconnect(); audioNodes.delete(oscillator); };
      });
      if (explicit) status.textContent = `${theme.name}: an original little sound for your flight. Sound can be switched off anytime.`;
    } catch { if (explicit) status.textContent = 'Sound could not start on this device. Your balloon is still ready to fly.'; }
  }
  q('#ph-preview-sound').onclick = () => {
    if (!api.getState().sound) document.querySelector('#sound')?.click();
    if (!api.getState().fx) document.querySelector('#fxBtn')?.click();
    cue('preview',true);
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAudio(); });
  function event(type) {
    if (!saved.active || api.getState().circuit) return;
    const id = {boost:'lift',land:'land',win:'win'}[type]; if (!id) return;
    const result = discover(collection(),id);
    if (result.fresh) {
      saved.profiles[saved.active.key] = result.collection; persist(); pending++; recentStory=id;
      announce(id==='win' ? 'A pennant for your balloon. And one more breeze for the way home.' : `${saved.active.name}, there’s a little keepsake waiting in My balloon.`);
      if (id==='win') paint(saved.active); updateLabels();
    }
    if (result.fresh || id !== 'lift') cue(id);
  }
  function tick(dt) {
    elapsed += dt; uiClock += dt;
    if (uiClock>.2) { updateLabels(); uiClock=0; }
    if (pennant && !api.getState().calm) pennant.rotation.y = Math.sin(elapsed*2.1)*.18;
    if (!dialog.open || !preview) return;
    const r = q('.ph-preview').getBoundingClientRect();
    if (r.width && r.height && (preview.width!==r.width || preview.height!==r.height)) { preview.width=r.width; preview.height=r.height; preview.renderer.setSize(r.width,r.height,false); preview.camera.aspect=r.width/r.height; preview.camera.updateProjectionMatrix(); }
    if (!api.getState().calm) preview.group.rotation.y += dt*.18;
    preview.renderer.render(preview.scene,preview.camera);
  }
  updateLabels();
  return {setBalloon,tick,event,syncAudio};
}
