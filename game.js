/* Island Hop. Cel-shaded toy diorama: MeshToonMaterial on Meshy-lifted GLBs, inverted-hull ink
   outlines, bloom, and a tilt-shift pass. The content lives in the markup (.ch articles);
   this file turns each article into an island with a toy you play to earn its stamp. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as JC from './astra/circuit.js';
import * as TT from './astra/tabletop.mjs';
import { mountFeedback } from './astra/feedback.mjs';
import { createIslandToy } from './astra/depth/phase3-adapter.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
const ENV = new URLSearchParams(location.search).get('env') || 'hdr';
const LOOK = new URLSearchParams(location.search).get('look') || 'lit';

const $ = (s) => document.querySelector(s);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
/* first 60 seconds (Darby 10/2): calm motion follows the OS setting by default and can be switched on the start card; stored under islandhop-calm */
let calm = reduce; try { const c = localStorage.getItem('islandhop-calm'); if (c !== null) calm = c === '1'; } catch (e) {}
document.documentElement.classList.toggle('calm', calm);
const canvas = $('#world');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
catch (e) { throw new Error('no webgl'); }
document.documentElement.classList.add('has3d');
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
if (LOOK === 'lit') { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18; }

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 600);

/* ---------- light, sky ---------- */
const hemi = new THREE.HemisphereLight(0xe8f0ff, 0xc89a72, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 140 });
sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

const skyU = { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, low: { value: new THREE.Color() } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, toneMapped: false, fog: false, uniforms: skyU,
  vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: 'uniform vec3 top,mid,low; varying vec3 p; void main(){ float h = normalize(p).y; vec3 c = h>0. ? mix(mid,top,smoothstep(0.,.6,h)) : mix(mid,low,smoothstep(0.,.5,-h)); gl_FragColor = vec4(c,1.); }'
}));
scene.add(sky); sky.renderOrder = -20;
/* first80 (Darby 10/3): Astra's Higgsfield painted sky as a camera-facing distant backdrop drawn over the gradient dome; the CC0 HDR below stays for lighting only */
const skyArt = (() => {
  const mat = new THREE.MeshBasicMaterial({ transparent: false, depthWrite: false, depthTest: true, fog: false, toneMapped: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat); m.renderOrder = -10; m.frustumCulled = false; m.visible = false; scene.add(m); /* opaque queue, drawn early, depth-tested: every nearer shape paints over it (Astra's review) */
  const tex = {}, tl = new THREE.TextureLoader();
  ['day', 'night'].forEach((k) => tl.load(k === 'day' ? 'art/sky-higgsfield.webp' : 'art/sky-higgsfield-night.webp', (t) => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; tex[k] = t; if (!mat.map) { mat.map = t; mat.needsUpdate = true; } }, undefined, () => {}));
  return { m, mat, tex, want: 'day', fade: 0 };
})();
function skyArtTheme(night) { skyArt.want = night ? 'night' : 'day'; const t = skyArt.tex[skyArt.want]; if (t && skyArt.mat.map !== t) { skyArt.mat.map = t; skyArt.mat.needsUpdate = true; } }
function skyArtPlace(rdt) {
  const t = skyArt.tex[skyArt.want] || skyArt.mat.map; if (!t) return;
  if (skyArt.mat.map !== t) { skyArt.mat.map = t; skyArt.mat.needsUpdate = true; }
  skyArt.fade = Math.min(1, skyArt.fade + rdt * 0.8); skyArt.m.visible = true; skyArt.mat.color.setScalar(0.6 + 0.4 * skyArt.fade); /* fade through colour, not alpha */
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir); const D = 380;
  skyArt.m.position.copy(camera.position).addScaledVector(dir, D); skyArt.m.quaternion.copy(camera.quaternion);
  const h = 2 * D * Math.tan((camera.fov * Math.PI / 180) / 2) * 1.25, w = Math.max(h * camera.aspect * 1.25, h * 16 / 9);
  skyArt.m.scale.set(w, Math.max(h, w * 9 / 16), 1);
  const ph = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); t.offset.x = (ph / (Math.PI * 2) - 0.5) * 0.08; /* a little parallax with the turn, inside the clamped edge */
}
if (LOOK === 'lit') {
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  if (ENV === 'hdr') {
    /* CC0 Poly Haven cloud_layers (Greg Zaal), lighting only; the painted sky stays */
    fetch('art/sky.hdr.txt').then((r) => r.text()).then((b64) => {
      const bin = Uint8Array.from(atob(b64.trim()), (c) => c.charCodeAt(0));
      const tex = new RGBELoader().parse(bin.buffer); const t = new THREE.DataTexture(tex.data, tex.width, tex.height, THREE.RGBAFormat, tex.type);
      t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.LinearSRGBColorSpace; t.flipY = true; t.needsUpdate = true;
      scene.environment = pm.fromEquirectangular(t).texture; scene.environmentIntensity = 0.5;
    }).catch(() => {});
  }
  scene.fog = new THREE.Fog(0xa8cfff, 70, 230);
}

/* ---------- toon kit ---------- */
function ramp(steps) {
  const d = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => d.set([v, v, v, 255], i * 4));
  const t = new THREE.DataTexture(d, steps.length, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
}
const RAMP = ramp([110, 185, 255]);
const INK = new THREE.ShaderMaterial({
  side: THREE.BackSide, uniforms: { color: { value: new THREE.Color(0x2b2140) }, w: { value: LOOK === 'lit' ? 0.0013 : 0.0022 } },
  vertexShader: 'uniform float w; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vec3 n = normalize(normalMatrix*normal); mv.xyz += n * w * -mv.z; gl_Position = projectionMatrix*mv; }',
  fragmentShader: 'uniform vec3 color; void main(){ gl_FragColor = vec4(color,1.); }'
});
const toonCache = new Map();
function toon(color, opts = {}) {
  const k = color + JSON.stringify(opts);
  if (!toonCache.has(k)) toonCache.set(k, new THREE.MeshToonMaterial({ color, gradientMap: RAMP, ...opts }));
  return toonCache.get(k);
}
function inked(mesh, w) {
  const o = new THREE.Mesh(mesh.geometry, w ? INK.clone() : INK);
  if (w) o.material.uniforms.w.value = w;
  o.raycast = () => {}; mesh.add(o); return mesh;
}
function M(geo, color, opts) {
  const m = new THREE.Mesh(geo, toon(color, opts)); m.castShadow = true; m.receiveShadow = true; return m;
}

/* ---------- post: bloom + tilt-shift miniature ---------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.5, 0.86);
composer.addPass(bloom);
const tilt = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, res: { value: new THREE.Vector2(1, 1) }, focus: { value: 0.5 }, band: { value: 0.16 }, amount: { value: 1 }, sat: { value: 1.15 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 res; uniform float focus, band, amount, sat; varying vec2 vUv;
    void main(){
      float d = smoothstep(band, band + .32, abs(vUv.y - focus)) * amount;
      vec4 c = vec4(0.);
      for (int i = 0; i < 16; i++) { float a = float(i) * 2.39996; float r = sqrt(float(i) + .5) * .25;
        c += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * r * d * 9. / res); }
      c /= 16.;
      float l = dot(c.rgb, vec3(.299, .587, .114)); c.rgb = mix(vec3(l), c.rgb, sat);
      vec2 q = vUv - .5; c.rgb *= 1. - dot(q, q) * .4;
      gl_FragColor = c; }`
});
composer.addPass(tilt);
composer.addPass(new OutputPass());

/* ---------- sound ---------- */
const sfx = {};
document.querySelectorAll('audio[data-sfx]').forEach((a) => (sfx[a.dataset.sfx] = a));
const liveSounds = new Set();
function play(name, vol = 0.6) { const a = sfx[name]; if (!a || muted.fx) return; try { const c = a.cloneNode(); c.volume = vol; liveSounds.add(c); c.onended = () => liveSounds.delete(c); c.play().catch(() => {}); } catch (e) {} }
const muted = { fx: false };

/* ---------- islands from markup ---------- */
const chapters = [...document.querySelectorAll('.ch')];
const N = chapters.length, R = 20, HEIGHTS = [0, 3, -1.5, 2, -0.5, 2.5, 3.5, 0.5];
const islands = chapters.map((el, i) => {
  const a = (i / N) * Math.PI * 2 - Math.PI / 2;
  const g = new THREE.Group();
  g.position.set(Math.cos(a) * R, HEIGHTS[i % HEIGHTS.length], Math.sin(a) * R);
  g.rotation.y = -a + Math.PI / 2 + (+el.dataset.ry || 0);
  scene.add(g);
  return { i, el, g, kind: el.dataset.kind, top: 4, phase: i * 1.7, done: false, base: g.position.y };
});

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
/* models ship as base64 text (the host serves .txt, not .glb); same bytes, decoded here */
loader.load = function (url, onLoad, onProgress, onError) {
  fetch(url).then((r) => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.text(); })
    .then((b64) => { const bin = Uint8Array.from(atob(b64.trim()), (c) => c.charCodeAt(0)); loader.parse(bin.buffer, '', onLoad, onError); })
    .catch((e) => onError && onError(e));
};
function prepModel(root, size) {
  const box = new THREE.Box3().setFromObject(root), s = new THREE.Vector3(); box.getSize(s);
  const k = size / Math.max(s.x, s.z);
  root.scale.setScalar(k);
  const c = new THREE.Vector3(); box.getCenter(c);
  root.position.set(-c.x * k, -box.min.y * k - s.y * k * 0.62, -c.z * k);
  const meshes = []; root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  meshes.forEach((o) => {
    const src = o.material;
    o.material = LOOK === 'lit'
      ? new THREE.MeshStandardMaterial({ map: src.map || null, color: src.map ? 0xffffff : src.color, roughness: 0.82, metalness: 0 })
      : new THREE.MeshToonMaterial({ map: src.map || null, color: src.map ? 0xffffff : src.color, gradientMap: RAMP });
    if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
    o.castShadow = o.receiveShadow = true;
    if (LOOK !== 'lit') inked(o);
  });
  return s.y * k * 0.38;
}
const ready = Promise.all(islands.map((isl) => new Promise((res) => {
  loader.load(isl.el.dataset.model, (gl) => {
    isl.top = prepModel(gl.scene, 11.5);
    isl.g.add(gl.scene);
    gl.scene.traverse((o) => (o.userData.island = isl.i));
    res();
  }, undefined, (err) => { console.error("GLB fail", isl.el.dataset.model, err && (err.message || err)); fallbackIsland(isl); res(); });
})));
function fallbackIsland(isl) {
  const top = inked(M(new THREE.CylinderGeometry(4.6, 4.2, 1.2, 9), 0x7fcf6a)); top.position.y = 0.6;
  const rock = inked(M(new THREE.ConeGeometry(4.2, 6, 9), 0x9c6b47)); rock.rotation.x = Math.PI; rock.position.y = -3;
  isl.g.add(top, rock); isl.top = 1.6;
  isl.g.traverse((o) => (o.userData.island = isl.i));
}

/* beacons: a spinning toon star above every unstamped island */
function starGeo() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.45 : 1, a = (i / 10) * Math.PI * 2 + Math.PI / 2; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 }); g.center(); return g;
}
const STAR = starGeo();
islands.forEach((isl) => {
  const b = inked(M(STAR, 0xffd23f, { emissive: 0xffb000, emissiveIntensity: 0.9 }));
  b.scale.setScalar(0.6); isl.beacon = b; scene.add(b);
});

/* clouds */
const clouds = [];
for (let c = 0; c < 22; c++) {
  const cl = new THREE.Group();
  const n = 3 + (c % 3);
  const cm = LOOK === 'lit' ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.95, depthWrite: false }) : null; cl.userData.mat = cm;
  for (let k = 0; k < n; k++) { const s = cm ? new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 + Math.random() * 1.2, 3), cm) : M(new THREE.IcosahedronGeometry(1.4 + Math.random() * 1.2, 2), 0xffffff); if (!cm) inked(s, 0.003); s.position.set(k * 1.7 - n * 0.8, Math.random() * 0.6, Math.random()); s.castShadow = false; cl.add(s); }
  const a = Math.random() * Math.PI * 2, low = c % 2 === 0, r = low ? 8 + Math.random() * 40 : 40 + Math.random() * 40;
  cl.position.set(Math.cos(a) * r, low ? -16 + Math.random() * 5 : -6 + Math.random() * 22, Math.sin(a) * r);
  cl.userData.v = 0.4 + Math.random() * 0.6; scene.add(cl); clouds.push(cl);
}

/* ---------- the balloon (player) ---------- */
const player0 = { g: new THREE.Group(), pos: new THREE.Vector3(0, 6, 0) };
scene.add(player0.g);
loader.load($('#world').dataset.balloon, (gl) => {
  const root = gl.scene; const box = new THREE.Box3().setFromObject(root), s = new THREE.Vector3(); box.getSize(s);
  const k = 2.8 / s.y; root.scale.setScalar(k);
  const c = new THREE.Vector3(); box.getCenter(c); root.position.set(-c.x * k, -box.min.y * k, -c.z * k);
  const bm = []; root.traverse((o) => { if (o.isMesh) bm.push(o); });
  bm.forEach((o) => { o.material = LOOK === 'lit' ? new THREE.MeshStandardMaterial({ map: o.material.map || null, roughness: 0.6 }) : new THREE.MeshToonMaterial({ map: o.material.map || null, gradientMap: RAMP }); if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace; o.castShadow = true; if (LOOK !== 'lit') inked(o); });
  player0.g.add(root);
}, undefined, () => {
  const env = inked(M(new THREE.SphereGeometry(1, 20, 14), 0xff5d73)); env.scale.set(1, 1.15, 1); env.position.y = 1.9;
  const bas = inked(M(new THREE.BoxGeometry(0.6, 0.45, 0.6), 0xb07a45)); bas.position.y = 0.25;
  player0.g.add(env, bas);
});
const shadowDisc = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshBasicMaterial({ color: 0x241b3a, transparent: true, opacity: 0.22, depthWrite: false }));
shadowDisc.rotation.x = -Math.PI / 2; scene.add(shadowDisc);

/* ---------- particles: confetti + sparkles ---------- */
const MAXP = 600;
const pGeo = new THREE.PlaneGeometry(0.22, 0.12);
const pMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, vertexColors: false });
const parts = new THREE.InstancedMesh(pGeo, pMat, MAXP);
parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
const pData = Array.from({ length: MAXP }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), s: 1 }));
const PAL = [0xff4d6d, 0xffb703, 0x8ac926, 0x3a86ff, 0x8338ec, 0xff7bd5, 0x2ec4b6];
const tmpC = new THREE.Color();
for (let i = 0; i < MAXP; i++) parts.setColorAt(i, tmpC.set(PAL[i % PAL.length]));
parts.frustumCulled = false; scene.add(parts);
let pNext = 0;
function burst(at, n = 60, speed = 7, up = 6) {
  if (reduce) n = Math.min(n, 12);
  for (let k = 0; k < n; k++) {
    const d = pData[pNext]; pNext = (pNext + 1) % MAXP;
    d.life = 1.6 + Math.random(); d.p.copy(at);
    d.v.set((Math.random() - 0.5) * speed, Math.random() * up + 2, (Math.random() - 0.5) * speed);
    d.r.set(Math.random() * 6, Math.random() * 6, 0); d.s = 0.6 + Math.random() * 0.9;
  }
}
const dummy = new THREE.Object3D();
function stepParticles(dt) {
  for (let i = 0; i < MAXP; i++) {
    const d = pData[i];
    if (d.life > 0) {
      d.life -= dt; d.v.y -= 9 * dt; d.v.multiplyScalar(1 - dt * 0.8); d.p.addScaledVector(d.v, dt);
      d.r.x += dt * 7; d.r.y += dt * 5;
      dummy.position.copy(d.p); dummy.rotation.copy(d.r); dummy.scale.setScalar(d.life > 0 ? d.s * Math.min(1, d.life * 2) : 0);
    } else dummy.scale.setScalar(0);
    dummy.updateMatrix(); parts.setMatrixAt(i, dummy.matrix);
  }
  parts.instanceMatrix.needsUpdate = true;
}


/* far-off balloons drifting in the haze, like the trailer */
const farBalloons = [];
for (let k = 0; k < 9; k++) {
  const g = new THREE.Group(); const c = [0xff4d6d, 0xffb703, 0x3a86ff, 0x8ac926, 0xff7bd5, 0x2ec4b6][k % 6];
  const env = M(new THREE.SphereGeometry(1, 16, 12), c); env.scale.set(1, 1.18, 1); env.position.y = 1.6; env.castShadow = false;
  const bas = M(new THREE.BoxGeometry(0.4, 0.3, 0.4), 0xb07a45); bas.position.y = 0.3; bas.castShadow = false;
  g.add(env, bas); const a = Math.random() * Math.PI * 2, r = 42 + Math.random() * 40;
  g.position.set(Math.cos(a) * r, -4 + Math.random() * 20, Math.sin(a) * r); g.userData = { a, r, v: 0.01 + Math.random() * 0.02, y: g.position.y };
  scene.add(g); farBalloons.push(g);
}
/* ---------- HUD ---------- */
const hud = { prompt: $('#prompt'), banner: $('#banner'), bTitle: $('#bannerTitle'), bText: $('#bannerText'), meter: $('#meter'), pass: $('#passport'), card: $('#book'), choices: $('#choices'), hint: $('#hint'), verb: $('#verb'), timer: $('#timer'), joy: $('#joy'), combo: $('#combo'), heat: $('#heat'), lines: $('#speedlines') };
const stampEls = [];
const progress = chapters.map(() => ({ done: false, stars: [false, false, false] }));
chapters.forEach((c, i) => {
  const s = document.createElement('button'); s.type = 'button'; s.className = 'stamp'; s.style.setProperty('--c', c.dataset.color);
  s.innerHTML = `<i>${i + 1}</i><em class="pips"><b></b><b></b><b></b></em><span>${c.dataset.label}</span>`; s.title = c.dataset.label;
  s.onclick = () => { if (islands[i].done) openCard(i); else autopilot(i, true); }; /* Astra: an unstamped stop flies there and lands */
  hud.pass.appendChild(s); stampEls.push(s);
});
let joyCount = 0;
try {
  const sv = JSON.parse(localStorage.getItem('islandhop-v3') || 'null');
  if (sv && Array.isArray(sv.p)) { sv.p.forEach((p, i) => { if (progress[i] && p && Array.isArray(p.stars)) progress[i] = { done: !!p.done, stars: [0, 1, 2].map((k) => !!p.stars[k]) }; }); joyCount = +sv.joy || 0; }
} catch (e) {}
const saveFails = new Set(); let saveAny = false;
function store(key, val) { try { localStorage.setItem(key, val); saveFails.delete(key); saveAny = true; return true; } catch (e) { saveFails.add(key); return false; } }
function save() { return store('islandhop-v3', JSON.stringify({ p: progress, joy: joyCount })); }
/* a failed key keeps retrying quietly while the page is open, so progress lands if storage recovers before a reload */
setInterval(() => { if (saveFails.has('islandhop-v3')) save(); if (saveFails.has('islandhop-depth') && typeof DEPTH === 'object') store('islandhop-depth', JSON.stringify(DEPTH)); if (saveFails.has('islandhop-best') && typeof BEST === 'object') store('islandhop-best', JSON.stringify(BEST)); if (typeof pending !== 'undefined' && pending && pending.chosen && !saveFails.size) finalizePending(); }, 3000);
function paintStamps() {
  progress.forEach((p, i) => {
    islands[i].done = p.done; stampEls[i].classList.toggle('got', p.done);
    [...stampEls[i].querySelectorAll('.pips b')].forEach((b, k) => b.classList.toggle('on', p.stars[k]));
  });
  $('#count').textContent = progress.filter((p) => p.done).length;
  $('#stars').textContent = progress.reduce((a, p) => a + p.stars.filter(Boolean).length, 0);
  hud.joy.textContent = joyCount;
}
function showBanner(title, text, meter) {
  hud.bTitle.textContent = title; hud.bText.textContent = text || ''; hud.banner.hidden = false;
  hud.meter.innerHTML = meter ? Array.from({ length: meter }, () => '<b></b>').join('') : '';
}
function setMeter(k) { [...hud.meter.children].forEach((b, j) => b.classList.toggle('on', j < k)); }
function hideBanner() { hud.banner.hidden = true; hud.choices.hidden = true; hud.choices.innerHTML = ''; hud.timer.hidden = true; }
function openCard(i) {
  chapters.forEach((c, j) => c.classList.toggle('on', j === i));
  const st = progress[i].stars, card = chapters[i];
  if (!card.querySelector('.cardart')) { const im = document.createElement('img'); im.className = 'cardart'; im.alt = ''; im.src = `art/cards/c${i}.webp`; card.insertBefore(im, card.firstChild.nextSibling); }
  card.querySelector('.rate')?.remove();
  const r = document.createElement('div'); r.className = 'rate';
  r.innerHTML = `<span class="mono">Island rating</span><div>${['Toy won', 'Landing', 'Rings'].map((n, k) => `<b class="${st[k] ? 'on' : ''}">★</b><small>${n}</small>`).join('')}</div>`;
  card.insertBefore(r, card.querySelector('.fly'));
  hud.card.classList.add('open'); player.mode = 'card'; player.at = i;
}
function closeCard() {
  hud.card.classList.remove('open'); chapters.forEach((c) => c.classList.remove('on'));
  if (player.mode === 'card') takeOff();
  if (progress.every((p) => p.done) && !longWalk.on && !finaleShown && !circuitOn) startLongWalk();
}
chapters.forEach((c) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'fly'; b.textContent = 'Fly on →'; b.onclick = () => { closeCard(); if (guided) guidedNext(); }; c.appendChild(b);
  /* replay a stamped island: chase missing stars and your best (the stamp is already yours) */
  const ag = document.createElement('button'); ag.type = 'button'; ag.className = 'fly again'; ag.textContent = 'Play again'; ag.onclick = () => { const i = player.at; hud.card.classList.remove('open'); chapters.forEach((x) => x.classList.remove('on')); if (islands[i]) beginGame(i); }; c.appendChild(ag);
});
addEventListener('keydown', (e) => { if (e.key === 'Escape' && hud.card.classList.contains('open')) closeCard(); });
let hintKey = '';
function hint(key, text) { if (hintKey === key) return; hintKey = key; hud.hint.textContent = text; hud.hint.hidden = !text; hud.hint.classList.remove('pop'); void hud.hint.offsetWidth; hud.hint.classList.add('pop'); }
function verbCard(word, sub) {
  hud.verb.innerHTML = `<b>${word}</b>${sub ? `<small>${sub}</small>` : ''}`; hud.verb.hidden = false;
  hud.verb.classList.remove('go'); void hud.verb.offsetWidth; hud.verb.classList.add('go');
  clearTimeout(verbCard.t); verbCard.t = setTimeout(() => (hud.verb.hidden = true), 1300);
}

/* ---------- synth: chimes that climb with the combo (no files needed) ---------- */
let AC = null;
function ac() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (AC && AC.state === 'suspended') AC.resume(); return AC; }
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
function chime(step, vol = 0.12, type = 'triangle') {
  const a = ac(); if (!a || muted.fx) return;
  const f = 523.25 * Math.pow(2, PENTA[Math.min(step, PENTA.length - 1)] / 12), t = a.currentTime;
  const o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.5);
  const o2 = a.createOscillator(), g2 = a.createGain(); o2.type = 'sine'; o2.frequency.value = f * 2;
  g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(vol * 0.4, t + 0.01); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o2.connect(g2).connect(a.destination); o2.start(t); o2.stop(t + 0.35);
}
function burner(on) {
  if (!AC && !on) return;
  const a = ac(); if (!a) return;
  if (!burner.n) {
    const len = a.sampleRate * 1.5, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    const src = a.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 0.7;
    const g = a.createGain(); g.gain.value = 0; src.connect(f).connect(g).connect(a.destination); src.start();
    burner.n = g;
  }
  burner.n.gain.setTargetAtTime(on && !muted.fx ? 0.11 : 0, a.currentTime, 0.06);
}
/* ---------- mini-games: every island is a toy ---------- */
const gameRoot = new THREE.Group(); scene.add(gameRoot);
let game = null;
const GAMES = {
  /* tap the notes before the set ends */
  pier(isl) { return tapTargets(isl, { n: 6, title: 'Catch the set times', text: 'Tap every floating note before Portola ends.', make: noteMesh, move: (o, t) => { const a = o.userData.a + t * 0.9; o.position.set(Math.cos(a) * 4.2, 2.6 + Math.sin(t * 2 + o.userData.a * 3) * 0.6, Math.sin(a) * 4.2); o.rotation.y = t * 2; } }); },
  /* scholars hop; send each one on the tour */
  studio(isl) { return tapTargets(isl, { n: 6, title: 'All aboard the tour', text: 'Tap each hopping scholar to send them through the Blizzard doors.', make: (k) => scholarMesh(k), move: (o, t) => { const a = o.userData.a + t * 0.35; const hop = Math.abs(Math.sin(t * 3.2 + o.userData.a * 5)); o.position.set(Math.cos(a) * 3.6, 1.2 + hop * 1.6, Math.sin(a) * 3.6); o.scale.set(1 + (1 - hop) * 0.2, 1 - (1 - hop) * 0.2, 1 + (1 - hop) * 0.2); } }); },
  /* animation literacy: ones or twos */
  campus(isl) { return onesTwos(isl); },
  /* roll doubles */
  table(isl) { return diceGame(isl); },
  /* hit the drop on the beat */
  arena(isl) { return beatGame(isl); },
  /* pop your way to 56 */
  desert(isl) { return tapTargets(isl, { n: 8, title: 'Pop your way to 56', text: 'Every balloon is a year. Pop all eight.', counter: (k) => `${48 + k}`, make: (k) => balloonMesh(k), move: (o, t) => { o.position.set(o.userData.x, 1.5 + ((t * 0.55 + o.userData.a) % 1) * 4.5, o.userData.z); o.rotation.z = Math.sin(t * 2 + o.userData.a * 6) * 0.15; } }); },
  /* open the chest */
  voxel(isl) { return chestGame(isl); },
  court(isl) { return courtGame(isl); }
};
function anchor(isl) { const p = new THREE.Vector3(); isl.g.getWorldPosition(p); p.y += isl.top; return p; }
function tapTargets(isl, o) {
  const items = [];
  for (let k = 0; k < o.n; k++) { const m = o.make(k); m.userData.a = (k / o.n) * Math.PI * 2; m.userData.x = Math.cos(m.userData.a) * 3; m.userData.z = Math.sin(m.userData.a) * 3; m.userData.tap = true; gameRoot.add(m); items.push(m); }
  let got = 0; showBanner(o.title, o.text, o.n);
  return {
    tick(t) { items.forEach((m) => { if (m.visible) o.move(m, t); }); },
    tap(obj) {
      const m = items.find((x) => x === obj || x.getObjectById(obj.id)); if (!m || !m.visible) return;
      m.visible = false; got++; setMeter(got); play('pop', 0.7);
      scoreBase(15, o.tag || 'Catch'); const now = performance.now(); if (now - (o.lastHit || 0) < 900) scoreMult(1, 'Quick chain'); o.lastHit = now;
      const w = new THREE.Vector3(); m.getWorldPosition(w); burst(w, 26, 5, 4);
      if (o.counter) floatText(w, o.counter(got));
      if (got === o.n) later(winGame, 350);
    }
  };
}
function onesTwos(isl) {
  const ball = inked(M(new THREE.SphereGeometry(0.6, 24, 16), 0xff5d73)); gameRoot.add(ball);
  const floor = inked(M(new THREE.BoxGeometry(7, 0.2, 1.4), 0xffe08a)); floor.position.set(0, 1, 2.6); gameRoot.add(floor);
  let round = 0, right = 0, fps = 12, shown = -1, t0 = 0;
  const pick = () => { fps = Math.random() < 0.5 ? 12 : 24; t0 = performance.now(); };
  pick();
  showBanner('Ones or twos?', 'Watch the bounce. Is it animated on ones (24 drawings a second) or on twos (12)?', 3);
  hud.choices.hidden = false;
  hud.choices.innerHTML = '<button type="button" data-v="24">On ones</button><button type="button" data-v="12">On twos</button>';
  hud.choices.onclick = (e) => {
    const v = +e.target.dataset.v; if (!v) return;
    if (v === fps) { right++; setMeter(right); scoreBase(40, 'Called it'); if (right > 1) scoreMult(1, 'Streak'); play('pop', 0.6); burst(ball.getWorldPosition(new THREE.Vector3()), 24, 5, 4); floatText(ball.getWorldPosition(new THREE.Vector3()), fps === 12 ? 'Twos!' : 'Ones!'); }
    else { play('whoosh', 0.5); floatText(ball.getWorldPosition(new THREE.Vector3()), 'Look again'); hud.banner.classList.remove('shake'); void hud.banner.offsetWidth; hud.banner.classList.add('shake'); }
    if (right >= 3) { hud.choices.onclick = null; hud.choices.hidden = true; later(winGame, 300); return; }
    if (v === fps) { round++; pick(); }
  };
  return {
    tick() {
      const t = (performance.now() - t0) / 1000, f = Math.floor(t * fps);
      if (f === shown) return; shown = f;
      const tt = f / fps, ph = (tt % 1.1) / 1.1;
      const x = -3 + ((tt * 2.2) % 6), y = 1.7 + Math.abs(Math.sin(ph * Math.PI)) * 3;
      const squash = y < 1.95 ? 0.7 : 1;
      ball.position.set(x, y, 2.6); ball.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    },
    tap() {}
  };
}
function dieTexture(n) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#fffaf0'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#2b2140';
  const P = { 1: [[64, 64]], 2: [[34, 34], [94, 94]], 3: [[30, 30], [64, 64], [98, 98]], 4: [[34, 34], [94, 34], [34, 94], [94, 94]], 5: [[32, 32], [96, 32], [64, 64], [32, 96], [96, 96]], 6: [[34, 30], [94, 30], [34, 64], [94, 64], [34, 98], [94, 98]] };
  P[n].forEach(([a, b]) => { x.beginPath(); x.arc(a, b, 11, 0, 7); x.fill(); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const FACES = [3, 4, 1, 6, 2, 5];
const DIE_MATS = FACES.map((n) => new THREE.MeshToonMaterial({ map: dieTexture(n), gradientMap: RAMP }));
const UP = { 1: [0, 0, 0], 6: [Math.PI, 0, 0], 2: [-Math.PI / 2, 0, 0], 5: [Math.PI / 2, 0, 0], 3: [0, 0, Math.PI / 2], 4: [0, 0, -Math.PI / 2] };
function diceGame(isl) {
  /* three rolls, tap a die to hold it: a pair or better wins (a real decision, Sid Meier style) */
  const dice = [0, 1, 2].map((k) => { const d = inked(new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), DIE_MATS)); d.castShadow = true; d.position.set(-1.6 + k * 1.6, 1.6, 0); d.userData.tap = true; d.userData.k = k; gameRoot.add(d); return d; });
  const ring = dice.map((d) => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.07, 8, 32), toon(0xffd23f, { emissive: 0xffb000, emissiveIntensity: 1.2 })); r.rotation.x = Math.PI / 2; r.position.set(d.position.x, 0.95, 0); r.visible = false; gameRoot.add(r); return r; });
  let rolling = 0, rollsLeft = 3, vals = [0, 0, 0], held = [false, false, false], anim = [], over = false;
  showBanner('Roll for a pair', 'Three rolls. After a roll, tap a die to hold it. Any pair wins the table.', 3);
  const label = () => { hud.bText.textContent = vals[0] ? `Showing ${vals.join(' · ')}. ${rollsLeft} roll${rollsLeft === 1 ? '' : 's'} left. Tap a die to hold, tap the table to roll.` : 'Tap the table to roll.'; setMeter(3 - rollsLeft); };
  const roll = () => {
    if (rolling || over || rollsLeft <= 0) return; rolling = 1; rollsLeft--; play('dice', 0.8);
    vals = vals.map((v, k) => (held[k] && v ? v : 1 + Math.floor(Math.random() * 6)));
    anim = dice.map((d, k) => { if (held[k]) return null; const e = UP[vals[k]]; const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2])); q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6)); return { d, q, spin: new THREE.Vector3(Math.random() * 20 - 10, Math.random() * 20 - 10, Math.random() * 20 - 10), t: 0 }; }).filter(Boolean);
    setTimeout(() => {
      rolling = 0; const kinds = new Set(vals).size;
      if (kinds < 3) { scoreBase(kinds === 1 ? 160 : 70, kinds === 1 ? 'Triple' : 'Pair'); held.forEach((h) => { if (h) scoreMult(1, 'Held die'); }); for (let r = 0; r < rollsLeft; r++) scoreMult(1, 'Roll left over'); over = true; floatText(gameRoot.position.clone().add(new THREE.Vector3(0, 4, 0)), kinds === 1 ? 'TRIPLE!' : 'PAIR!'); later(winGame, 600); return; }
      if (rollsLeft <= 0) { over = true; floatText(gameRoot.position.clone().add(new THREE.Vector3(0, 4, 0)), 'So close!'); later(() => { if (game && game.isl === isl) { gameRoot.clear(); const old = game; game = diceGame(isl); game.isl = isl; game.elapsed = 0; game.limit = old.limit; } }, 1100); return; }
      label();
    }, 1300);
  };
  label();
  return {
    tick(t, dt) {
      anim.forEach((a) => { a.t += dt; const k = Math.min(1, a.t / 1.1);
        if (k < 1) { a.d.position.y = 1.6 + Math.sin(k * Math.PI) * 2.6 * (1 - k * 0.5); a.d.rotation.x += a.spin.x * dt * (1 - k); a.d.rotation.y += a.spin.y * dt * (1 - k); a.d.rotation.z += a.spin.z * dt * (1 - k); }
        if (k > 0.75) a.d.quaternion.slerp(a.q, Math.min(1, (k - 0.75) * 4 + dt * 6)); if (k >= 1) a.d.position.y = 1.6; });
      ring.forEach((r, k) => { r.visible = held[k]; r.rotation.z = t * 2; });
    },
    tap(o) { if (o && o.userData && o.userData.k !== undefined && vals[0] && !rolling && !over) { held[o.userData.k] = !held[o.userData.k]; play('pop', 0.4); label(); } else roll(); },
    tapAnywhere: roll
  };
}
function beatGame(isl) {
  const target = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.12, 12, 48), toon(0x45e0ff, { emissive: 0x45e0ff, emissiveIntensity: 1.6 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.09, 12, 48), toon(0xff4fd8, { emissive: 0xff4fd8, emissiveIntensity: 2 }));
  [target, ring].forEach((m) => { m.position.set(0, 4.5, 0); gameRoot.add(m); });
  const lasers = new THREE.Group(); lasers.position.set(0, 1, 0); gameRoot.add(lasers);
  for (let i = 0; i < 10; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 30, 6), new THREE.MeshBasicMaterial({ color: PAL[i % PAL.length], transparent: true, opacity: 0 })); b.geometry.translate(0, 15, 0); b.rotation.set(0.3 + Math.random() * 0.5, 0, (i - 4.5) * 0.18); lasers.add(b); }
  const beat = 0.8; let start = performance.now(), hits = 0, flash = 0;
  showBanner('Drop the bass', 'Tap anywhere the moment the pink ring lands on the blue one. Four drops to win.', 4);
  let lastBeat = -1;
  const hit = () => {
    if (hits >= 4) return;
    const t = (performance.now() - start) / 1000, ph = (t % beat) / beat, idx = Math.round(t / beat);
    if (idx === lastBeat) return;
    const off = Math.min(ph, 1 - ph) * beat;
    if (off < 0.16) { if (off < 0.06) scoreMult(1, 'Perfect drop'); else scoreBase(45, 'On the beat'); scoreBase(20, 'Drop'); lastBeat = idx; hits++; setMeter(hits); flash = 1; play('pop', 0.5); burst(ring.getWorldPosition(new THREE.Vector3()), 40, 9, 6); floatText(ring.getWorldPosition(new THREE.Vector3()), ['Drop!', 'Bass!', 'Lasers!', 'LateNite!'][hits - 1] || 'Yes!'); if (hits >= 4) later(winGame, 400); }
    else { floatText(ring.getWorldPosition(new THREE.Vector3()), ph < 0.5 ? 'Late' : 'Early'); }
  };
  return {
    tick(t, dt) {
      const tt = (performance.now() - start) / 1000, ph = (tt % beat) / beat;
      const s = 1 + (1 - ph) * 2.2; ring.scale.setScalar(s); ring.rotation.z = tt; target.rotation.z = -tt * 0.5;
      flash = Math.max(0, flash - dt * 1.6);
      lasers.children.forEach((b, j) => { b.material.opacity = 0.15 + flash * 0.8; b.rotation.z = (j - 4.5) * 0.18 + Math.sin(tt * 3 + j) * 0.3 * (0.3 + flash); });
      bloom.strength = baseBloom + flash * 0.9;
    },
    tap: hit, tapAnywhere: hit
  };
}
function chestGame(isl) {
  const chest = new THREE.Group(); chest.position.set(0, 1.6, 0); chest.userData.tap = true; gameRoot.add(chest);
  const body = inked(M(new THREE.BoxGeometry(2, 1.2, 1.3), 0xa0612b)); body.position.y = 0.6;
  const lid = new THREE.Group(); lid.position.set(0, 1.2, -0.65);
  const lidM = inked(M(new THREE.BoxGeometry(2.05, 0.5, 1.35), 0x8a4f22)); lidM.position.set(0, 0.25, 0.65); lid.add(lidM);
  const lock = inked(M(new THREE.BoxGeometry(0.35, 0.4, 0.1), 0xffd23f, { emissive: 0xffa000, emissiveIntensity: 0.5 })); lock.position.set(0, 1.15, 0.7);
  chest.add(body, lid, lock);
  let taps = 0, wob = 0, open = 0;
  showBanner('Open the chest', 'Gordtopia keeps its treasure here. Tap the chest three times.', 3);
  const tap = () => {
    if (taps >= 3) return; taps++; setMeter(taps); scoreBase(50, 'Chest tap'); wob = 1; play(taps < 3 ? 'pop' : 'win', 0.6);
    if (taps === 3) { open = 0.0001; burst(chest.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.5, 0)), 120, 6, 10); floatText(chest.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 2.5, 0)), 'All roads lead home'); later(winGame, 1100); }
  };
  return {
    tick(t, dt) { wob = Math.max(0, wob - dt * 2.5); chest.rotation.z = Math.sin(t * 40) * 0.12 * wob; chest.scale.set(1 + wob * 0.12, 1 - wob * 0.12, 1 + wob * 0.12); if (open) { open = Math.min(1, open + dt * 3); lid.rotation.x = -open * 1.9; } },
    tap, tapAnywhere: null
  };
}
function noteMesh(k) {
  const g = new THREE.Group(); const c = PAL[k % PAL.length];
  const head = inked(M(new THREE.SphereGeometry(0.42, 18, 12), c, { emissive: c, emissiveIntensity: 0.35 })); head.scale.set(1.25, 0.9, 0.9);
  const stem = inked(M(new THREE.BoxGeometry(0.1, 1.2, 0.1), c)); stem.position.set(0.42, 0.6, 0);
  const flag = inked(M(new THREE.BoxGeometry(0.45, 0.14, 0.1), c)); flag.position.set(0.62, 1.15, 0); flag.rotation.z = -0.5;
  g.add(head, stem, flag); return g;
}
function scholarMesh(k) {
  const g = new THREE.Group(); const c = PAL[k % PAL.length];
  const body = inked(M(new THREE.CapsuleGeometry(0.38, 0.5, 6, 12), c)); body.position.y = 0.5;
  const head = inked(M(new THREE.SphereGeometry(0.32, 16, 12), [0x8d5524, 0xc68642, 0xe0ac69, 0x5c3a21, 0xf1c27d, 0xa0663d][k % 6])); head.position.y = 1.25;
  g.add(body, head);
  const hair = [0x1b1210, 0x3b2314, 0x6b3f1d, 0x0f0d0c, 0xc9a26b, 0x2a1a12][k % 6], style = k % 4;
  if (style === 0) { const cap = inked(M(new THREE.BoxGeometry(0.75, 0.08, 0.75), 0x2b2140)); cap.position.y = 1.55; cap.rotation.y = 0.6; g.add(cap); }
  else if (style === 1) { for (let q = 0; q < 7; q++) { const a = (q / 7) * Math.PI * 2; const c = M(new THREE.SphereGeometry(0.13, 8, 6), hair); c.position.set(Math.cos(a) * 0.24, 1.42 + Math.sin(q) * 0.04, Math.sin(a) * 0.24); g.add(c); } }
  else if (style === 2) { const top = M(new THREE.SphereGeometry(0.34, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), hair); top.position.y = 1.27; const bun = M(new THREE.SphereGeometry(0.14, 10, 8), hair); bun.position.set(0, 1.6, -0.1); g.add(top, bun); }
  else { const top = M(new THREE.SphereGeometry(0.34, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), hair); top.position.y = 1.29; g.add(top); body.scale.set(1.15, 0.9, 1.15); }
  return g;
}
function balloonMesh(k) {
  const g = new THREE.Group(); const c = PAL[k % PAL.length];
  const b = inked(M(new THREE.SphereGeometry(0.55, 20, 14), c, { emissive: c, emissiveIntensity: 0.2 })); b.scale.y = 1.2;
  const knot = inked(M(new THREE.ConeGeometry(0.1, 0.18, 8), c)); knot.position.y = -0.72; knot.rotation.x = Math.PI;
  g.add(b, knot); return g;
}
/* floating text, drawn to a sprite */
const floaters = [];
function floatText(at, text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x = c.getContext('2d');
  x.font = '800 72px "Bricolage Grotesque", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 14; x.strokeStyle = '#2b2140'; x.strokeText(text, 256, 64); x.fillStyle = '#fff6c2'; x.fillText(text, 256, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false })); s.scale.set(4, 1, 1); s.position.copy(at); s.renderOrder = 10;
  scene.add(s); floaters.push({ s, life: 1.4 });
}


/* ---------- the dodgeball court: dodge red, catch gold, throw it back (his favorite game) ---------- */
function courtGame(isl) {
  const W = 3.2, NEAR = 2.2, FAR = -2.6;
  { const top = anchor(isl), rc = new THREE.Raycaster(top.clone().add(new THREE.Vector3(0, 12, 0)), new THREE.Vector3(0, -1, 0)); const hit = rc.intersectObject(isl.g, true)[0]; if (hit) gameRoot.position.y = hit.point.y - 0.95 * 1.45; gameRoot.quaternion.copy(isl.g.quaternion); gameRoot.scale.setScalar(1.45); }
  const me = new THREE.Group();
  const body = M(new THREE.CapsuleGeometry(0.22, 0.36, 6, 12), 0x8338ec); body.position.y = 0.42;
  const head = M(new THREE.SphereGeometry(0.2, 14, 10), 0x6b4423); head.position.y = 0.92;
  const band = M(new THREE.TorusGeometry(0.2, 0.04, 6, 18), 0xffd23f); band.rotation.x = Math.PI / 2; band.position.y = 1.02;
  const you = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.58, 32), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })); you.rotation.x = -Math.PI / 2; you.position.y = 0.04;
  const tag = (() => { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96; const x = cv.getContext('2d'); x.font = '800 64px "Bricolage Grotesque", system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = 12; x.strokeStyle = '#3a2a1e'; x.strokeText('YOU', 128, 48); x.fillStyle = '#ffd23f'; x.fillText('YOU', 128, 48); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.scale.set(1.1, 0.42, 1); s.position.y = 1.55; s.renderOrder = 9; return s; })();
  me.add(body, head, band, you, tag); me.position.set(0, 1, NEAR); gameRoot.add(me);
  const crew = ['Darby', 'Astra'].map((n, k) => { const g = new THREE.Group(); const b = M(new THREE.CapsuleGeometry(0.2, 0.3, 6, 10), k ? 0x2ec4b6 : 0xff7b2e); b.position.y = 0.38; const h = M(new THREE.SphereGeometry(0.18, 12, 10), 0xd9d4e8); h.position.y = 0.82; g.add(b, h); g.position.set(k ? 1.6 : -1.6, 1, FAR); gameRoot.add(g); return g; });
  let survived = 0;
  const balls = []; let spawnT = 0.6, caught = 0, hearts = 3, score = 0, chain = 0, over = false, inv = 0, dash = 0;
  const goal = 5, best = +BEST.court || 0; /* one score model: the tally's Base x Mult; best is the final result in the same units */
  const practice = !!(joyride.on && joyride.chosen === isl.i && !progress[isl.i].done); /* first80: the joyride's first visit is a labelled practice round, no outs; replay restores the full challenge */
  const noOuts = relaxed || practice; let thrown = 0;
  const pts = () => (game && game.sc ? game.sc.base * game.sc.mult : 0), sub = () => (game && game.sc ? `${game.sc.base} \u00d7 ${game.sc.mult} = ${pts()}` : '0');
  if (practice) showBanner('Practice round: catch gold, dodge red', `No outs this first time. ${coarse ? 'Stick to move, tap' : 'W A S D to move, Space or tap'} to catch a gold ball. ${goal} catches, or stay in for 30 seconds, earns the stamp for real.`, goal);
  else showBanner('Dodge red. Catch gold.', `Move with W A S D or the stick. Tap or Space to catch a gold ball and fire it back. ${goal} catches, or survive 30 seconds. Catching heals a heart.${relaxed ? ' Relaxed: no outs.' : ''} Your best: ${best}.`, goal);
  const ballGeo = new THREE.SphereGeometry(0.2, 16, 12);
  function throwBall() {
    const firstPractice = practice && thrown === 0; thrown++;
    const gold = firstPractice ? true : Math.random() < 0.38, from = crew[Math.floor(Math.random() * 2)];
    const m = M(ballGeo, gold ? 0xffd23f : 0xe63946, gold ? { emissive: 0xffb000, emissiveIntensity: 0.6 } : {});
    m.position.set(from.position.x, 1.6, FAR + 0.3); gameRoot.add(m);
    const target = new THREE.Vector3(me.position.x + (firstPractice ? 0 : (Math.random() - 0.5) * 2.2), 1.2, NEAR + 0.4); /* the practice opener is gold, straight at you, and slow */
    const v = target.sub(m.position).normalize().multiplyScalar(firstPractice ? 3.2 : 4.2 + Math.min(3, caught * 0.5) + Math.random());
    from.userData.kick = 1; play('pop', 0.25);
    balls.push({ m, v, gold, out: false, back: false });
  }
  function tryCatch() {
    if (over) return;
    const b = balls.find((x) => x.gold && !x.back && !x.out && x.m.position.distanceTo(me.position.clone().add(new THREE.Vector3(0, 0.7, 0))) < 1.15);
    if (b) {
      b.back = true; b.v.set((Math.random() - 0.5) * 2, 2.5, -9); caught++; chain++; scoreBase(50, 'Catch'); if (chain > 1) scoreMult(1, 'Catch chain'); if (!noOuts && hearts < 3) { hearts++; floatText(me.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 2.6, 0)), 'HEAL'); } freeze = 0.05; setMeter(caught);
      burst(b.m.getWorldPosition(new THREE.Vector3()), 30, 6, 5); chime(3 + chain, 0.15); play('cheer', 0.55); trauma = Math.min(1, trauma + 0.25);
      floatText(me.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 2, 0)), chain > 1 ? `CATCH x${chain}` : 'CATCH!');
      if (caught >= goal) { if (chain >= 3) game.niceCatch = true; over = true; floatText(gameRoot.position.clone().add(new THREE.Vector3(0, 4, 0)), `${pts()} so far`); later(winGame, 700); }
    } else { dash = 0.25; }
  }
  return {
    tick(t, dt) {
      if (over) return;
      const ix = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0) + (stick.id !== null ? stick.dx : 0);
      const iz = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0) + (stick.id !== null ? stick.dy : 0);
      const sp = dash > 0 ? 9 : 4.2; dash = Math.max(0, dash - dt);
      me.position.x = Math.max(-W, Math.min(W, me.position.x + ix * sp * dt));
      me.position.z = Math.max(0.4, Math.min(NEAR + 0.6, me.position.z + iz * sp * dt));
      me.rotation.z = -ix * 0.15; inv = Math.max(0, inv - dt); me.visible = inv > 0 ? Math.sin(t * 40) > 0 : true;
      crew.forEach((c, k) => { c.position.x += Math.sin(t * (0.8 + k * 0.3) + k * 2) * dt * 1.2; c.userData.kick = Math.max(0, (c.userData.kick || 0) - dt * 3); c.rotation.x = -c.userData.kick * 0.4; });
      survived += dt; if (!over && survived >= 30 && hearts > 0) { over = true; scoreBase(150, 'Survived 30 s'); floatText(gameRoot.position.clone().add(new THREE.Vector3(0, 4, 0)), 'SURVIVED'); later(winGame, 600); return; }
      spawnT -= dt; if (spawnT <= 0) { throwBall(); spawnT = Math.max(0.55, 1.25 - caught * 0.1) + Math.random() * 0.4; }
      for (let k = balls.length - 1; k >= 0; k--) {
        const b = balls[k]; b.v.y -= dt * (b.back ? 6 : 2.2); b.m.position.addScaledVector(b.v, dt);
        if (b.m.position.y < 1.2 && !b.back) { b.m.position.y = 1.2; b.v.y = Math.abs(b.v.y) * 0.6; if (Math.abs(b.v.y) > 0.6) play('bounce', 0.3); }
        b.m.rotation.x += dt * 8;
        if (!b.gold && !b.out && !b.near && inv <= 0) { const dd = b.m.position.distanceTo(me.position.clone().add(new THREE.Vector3(0, 0.6, 0))); if (dd < 1.0 && dd >= 0.55) { b.near = true; scoreMult(1, 'Near miss'); chime(7, 0.08, 'sine'); } }
        if (!b.gold && !b.out && inv <= 0 && b.m.position.distanceTo(me.position.clone().add(new THREE.Vector3(0, 0.6, 0))) < 0.55) {
          b.out = true; chain = 0; inv = 1.2; trauma = Math.min(1, trauma + 0.45); play('bounce', 0.6);
          if (!noOuts) { hearts--; floatText(me.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 2, 0)), hearts > 0 ? `HIT! ${hearts} left` : 'OUT!'); if (hearts <= 0) { over = true; later(failGame, 900); } }
          else floatText(me.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 2, 0)), 'Shake it off');
        }
        if (b.m.position.z > NEAR + 2 || b.m.position.z < FAR - 3 || Math.abs(b.m.position.x) > 7) { if (!b.gold && !b.out && !b.back) scoreBase(8, 'Dodge'); gameRoot.remove(b.m); balls.splice(k, 1); }
      }
      hud.bText.textContent = `${coarse ? 'Stick to move, tap to catch' : 'W A S D to move, Space or tap to catch'} · Catches ${caught}/${goal} or survive ${Math.min(30, Math.floor(survived))}/30 s · Round ${sub()}${chain > 1 ? ` · chain x${chain}` : ''} · ${practice ? 'practice, no outs' : relaxed ? 'relaxed' : '♥'.repeat(Math.max(0, hearts))}${best ? ` · best ${best}` : ''}`;
    },
    tap() { tryCatch(); }, tapAnywhere: tryCatch
  };
}

/* ---------- cohesion: All Roads Lead Home. Every stamp brings people aboard the basket ---------- */
const PASSENGERS = ['Dave + Trent', 'Alex + the scholars', 'your students', 'Sinjin + the GGP crew', 'Brennan', 'Matt + the Sin City crew', 'Joe, Mason + Alex', 'James, Henry + Oscar'];
const crew = new THREE.Group(); crew.position.y = 0.42; player0.g.add(crew);
function seatPassengers() {
  crew.clear();
  progress.forEach((p, i) => {
    if (!p.done) return;
    const a = (i / progress.length) * Math.PI * 2, c = PAL[i % PAL.length];
    const f = new THREE.Group(); f.position.set(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2);
    const body = M(new THREE.CapsuleGeometry(0.05, 0.08, 4, 8), c); body.position.y = 0.05;
    const head = M(new THREE.SphereGeometry(0.045, 10, 8), [0x8d5524, 0xc68642, 0xe0ac69, 0x5c3a21, 0xf1c27d, 0xa0663d, 0xc68642, 0x6b4423][i % 8]); head.position.y = 0.16;
    f.add(body, head); crew.add(f);
  });
}

/* ---------- keepsakes: hidden pieces of his life, tap or fly through to find ---------- */
const KEEP = [
  { id: 'dogs', at: 'sky', pos: [7, 11, 6], title: 'Cyber + Cooper', text: 'Cyber Jasper, 2002. Cooper Jacob, 2004. The handle you have carried everywhere for twenty years: @cybercooper.', make: () => { const g = new THREE.Group(); const env = M(new THREE.SphereGeometry(0.9, 16, 12), 0x7ad1ff); env.scale.y = 1.15; env.position.y = 1.5; const bas = M(new THREE.BoxGeometry(0.6, 0.35, 0.5), 0xb07a45); bas.position.y = 0.3; g.add(env, bas); [[-0.14, 0x5b3a1e], [0.14, 0x1f1f1f]].forEach(([x, c]) => { const d = M(new THREE.SphereGeometry(0.12, 10, 8), c); d.position.set(x, 0.6, 0); const e = M(new THREE.ConeGeometry(0.05, 0.12, 6), c); e.position.set(x, 0.74, 0); g.add(d, e); }); return g; } },
  { id: 'cafe', at: 'sky', pos: null, between: [6, 7], fly: true, title: 'Together Again', text: () => `The Cafe, San Francisco, February 8, 1998. ${Math.floor((Date.now() - new Date(1998, 1, 8)) / 864e5).toLocaleString()} days and counting with Joe.`, make: () => { const g = new THREE.Group(); const r = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.2, 12, 48), toon(0xff7bd5, { emissive: 0xff4fb0, emissiveIntensity: 1.3 })); g.add(r); const h = new THREE.Shape(); h.moveTo(0, -0.6); h.bezierCurveTo(-1.2, 0.2, -0.5, 1, 0, 0.45); h.bezierCurveTo(0.5, 1, 1.2, 0.2, 0, -0.6); const hm = new THREE.Mesh(new THREE.ExtrudeGeometry(h, { depth: 0.2, bevelEnabled: false }), toon(0xff4d6d, { emissive: 0xff2050, emissiveIntensity: 0.8 })); hm.position.z = -0.1; g.add(hm); return g; } },
  { id: 'dodge', at: 5, off: [3.6, 0.6, -2.2], title: 'Tuesday nights', text: 'Your words, 2017: "I LOVE dodgeball but never get to play, we\'ll need subs all summer long Tuesday Nights."', make: () => { const g = new THREE.Group(); [[0, 0xe63946], [0.9, 0xffb703], [-0.9, 0x3a86ff]].forEach(([x, c], k) => { const b = M(new THREE.SphereGeometry(0.42, 18, 12), c); b.position.set(x, 0.5 + (k === 0 ? 0.5 : 0), 0); g.add(b); }); return g; } },
  { id: 'despacio', at: 0, off: [3.6, 0.6, 2.2], title: 'Despacio', text: 'Portola, both days. Despacio is ours. Your ride or die.', make: () => { const g = new THREE.Group(); const b = M(new THREE.BoxGeometry(0.9, 1.3, 0.7), 0x26222e); b.position.y = 0.65; g.add(b); [0.95, 0.4].forEach((y, k) => { const c = M(new THREE.CylinderGeometry(k ? 0.22 : 0.3, k ? 0.22 : 0.3, 0.06, 20), 0xffb703); c.rotation.x = Math.PI / 2; c.position.set(0, y, 0.37); g.add(c); }); return g; } },
  { id: 'see', at: 1, off: [-3.4, 0.6, 2.4], title: 'Why the tour', text: 'It is hard to be something if you cannot see it. Today they saw it.', make: () => signMesh(0x3a86ff) },
  { id: 'show', at: 2, off: [3.4, 0.6, -2.2], title: 'Game show night', text: 'Russian Roulette, 2002. You won. Contestant, then teacher of the people who make the games.', make: () => { const g = new THREE.Group(); const p = M(new THREE.CylinderGeometry(0.55, 0.7, 1.2, 8), 0xe63946); p.position.y = 0.6; const t = M(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 8), 0xffd23f); t.position.y = 1.26; const b = M(new THREE.SphereGeometry(0.16, 12, 8), 0xff4d6d); b.position.y = 1.38; g.add(p, t, b); return g; } },
  { id: 'niche', at: 3, off: [-3.6, 0.6, -1.8], title: 'Not niche', text: 'We serve all audiences. Our excellence is universal. We are not niche.', make: () => signMesh(0x8ac926) },
  { id: 'bren', at: 4, off: [3.8, 0.8, 1.6], title: 'Where it started', text: 'BrenBren introduced me to Alison and EDM in the first place. LYMI.', make: () => { const g = new THREE.Group(); const v = M(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 32), 0x15121c); v.rotation.x = Math.PI / 2.4; v.position.y = 0.8; const l = M(new THREE.CylinderGeometry(0.26, 0.26, 0.07, 20), 0xff4fd8, { emissive: 0xff4fd8, emissiveIntensity: 0.8 }); l.rotation.x = Math.PI / 2.4; l.position.y = 0.8; g.add(v, l); return g; } },
  { id: 'cake', at: 6, off: [-3.2, 0.6, 2.4], title: 'Fifty-six', text: () => { const d = Math.round((new Date(new Date().getFullYear() + (new Date() > new Date(new Date().getFullYear(), 10, 9, 23) ? 1 : 0), 10, 9) - new Date().setHours(0, 0, 0, 0)) / 864e5); return d === 0 ? 'Happy birthday, Gordon. Fifty-six looks good on you.' : `Monday, November 9, the morning after the parade. ${d} days to go.`; }, make: () => { const g = new THREE.Group(); [[0.7, 0.4, 0xfff6e8], [0.5, 0.35, 0xff9fc6]].forEach(([r, h, c], k) => { const m = M(new THREE.CylinderGeometry(r, r, h, 24), c); m.position.y = 0.2 + k * 0.38; g.add(m); }); for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; const cnd = M(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 6), RAINBOW6[k]); cnd.position.set(Math.cos(a) * 0.3, 0.88, Math.sin(a) * 0.3); const fl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd23f })); fl.position.set(Math.cos(a) * 0.3, 1.05, Math.sin(a) * 0.3); g.add(cnd, fl); } return g; } },
  { id: 'gate', at: 7, off: [3.4, 0.8, 2], title: 'The Sleeping Gate', text: 'An unlit portal is not unfinished; it has chosen its moment.', make: () => { const g = new THREE.Group(); [[-0.6, 0.9, 0.3, 1.8], [0.6, 0.9, 0.3, 1.8], [0, 1.95, 1.5, 0.3], [0, -0.1, 1.5, 0.3]].forEach(([x, y, w, h]) => { const b = M(new THREE.BoxGeometry(w, h, 0.3), 0x1a1030); b.position.set(x, y, 0); g.add(b); }); const p = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.75), new THREE.MeshBasicMaterial({ color: 0x8338ec, transparent: true, opacity: 0.0, side: THREE.DoubleSide })); p.position.y = 0.9; p.userData.portal = true; g.add(p); return g; } },
];
const RAINBOW6 = [0xe8413c, 0xf39a2b, 0xf7d23e, 0x4caf50, 0x3b7fd9, 0x8a4fc6];
function signMesh(c) { const g = new THREE.Group(); const post = M(new THREE.BoxGeometry(0.12, 1.4, 0.12), 0x8a5a3b); post.position.y = 0.7; const board = M(new THREE.BoxGeometry(1.2, 0.7, 0.1), c); board.position.y = 1.35; g.add(post, board); return g; }
const sparkTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, '#fff'); gr.addColorStop(0.3, '#ffe27a'); gr.addColorStop(1, '#ffe27a00'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t; })();
let found = new Set();
try { const f = JSON.parse(localStorage.getItem('islandhop-keep') || '[]'); if (Array.isArray(f)) found = new Set(f); } catch (e) {}
function buildKeepsakes() {
  KEEP.forEach((k) => {
    const g = k.make(); g.scale.setScalar(1.15); g.traverse((o) => (o.userData.keep = k.id));
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); sp.scale.setScalar(1.6); sp.position.y = 2.4; sp.raycast = () => {}; g.add(sp);
    k.g = g; k.spark = sp; scene.add(g);
  });
  $('#keepCount').textContent = found.size;
}
function placeKeepsakes(t) {
  KEEP.forEach((k) => {
    if (!k.g || k.custom) return;
    if (k.at === 'sky' && k.pos) k.g.position.set(k.pos[0] + Math.sin(t * 0.3) * 2, k.pos[1] + Math.sin(t * 0.7) * 0.6, k.pos[2]);
    else if (k.between) { const a = anchor(islands[k.between[0]]), b = anchor(islands[k.between[1]]); k.g.position.copy(a).lerp(b, 0.5).add(new THREE.Vector3(0, 7 + Math.sin(t * 0.8) * 0.5, 0));  k.g.lookAt(b.x, k.g.position.y, b.z); k.g.rotateY(Math.PI / 2); }
    else { const isl = islands[k.at]; const o = new THREE.Vector3(...k.off); o.applyQuaternion(isl.g.quaternion); k.g.position.copy(anchor(isl)).add(o); }
    k.spark.material.opacity = found.has(k.id) ? 0.25 : 0.6 + Math.sin(t * 4 + k.g.position.x) * 0.4;
    k.spark.scale.setScalar(found.has(k.id) ? 0.9 : 1.4 + Math.sin(t * 3) * 0.2);
  });
}
function findKeepsake(id) {
  const k = KEEP.find((x) => x.id === id); if (!k) return;
  const first = !found.has(id); found.add(id);
  try { localStorage.setItem('islandhop-keep', JSON.stringify([...found])); } catch (e) {}
  $('#keepCount').textContent = found.size;
  const txt = typeof k.text === 'function' ? k.text() : k.text;
  $('#keepTitle').textContent = k.title; $('#keepText').textContent = txt; $('#keepNo').textContent = `Keepsake ${KEEP.indexOf(k) + 1} of ${KEEP.length}`;
  $('#keep').hidden = false; $('#keep').classList.remove('pop'); void $('#keep').offsetWidth; $('#keep').classList.add('pop');
  if (first) { voice('keepsake_found'); journeyEvent(`Keepsake found: ${k.title}`); burst(k.g.position.clone().add(new THREE.Vector3(0, 1.5, 0)), 70, 7, 7); chime(10, 0.16); setTimeout(() => chime(12, 0.14), 120); joyCount += 5; save(); }
  if (k.id === 'gate') k.g.children.forEach((c) => { if (c.userData.portal) c.material.opacity = 0.75; });
}
$('#keepClose').onclick = () => ($('#keep').hidden = true);

/* special days, year after year */
function specialDay() {
  const d = new Date(), m = d.getMonth() + 1, day = d.getDate();
  if (m === 11 && day === 9) return ['HAPPY 56!', 'the whole sky is yours today'];
  if (m === 5 && day === 3) return ['HEALLY-BELLAMY', 'San Ramon, May 3, 2014'];
  if (m === 2 && day === 8) return ['TOGETHER AGAIN', 'The Cafe, February 8, 1998'];
  if (m === 12 && day === 31) return ['COUNTDOWN', 'your one rave a year with Joe'];
  return null;
}

/* ---------- island toys get a verb, a clock, and a gentle retry (WarioWare framing) ---------- */
const VERB = { pier: ['CATCH!', 'the set times'], studio: ['ALL ABOARD!', 'tap every scholar'], campus: ['CALL IT!', 'ones or twos'], table: ['ROLL!', 'doubles win'], arena: ['DROP!', 'tap on the beat'], desert: ['POP!', 'count to 56'], voxel: ['OPEN!', 'the Gordtopia chest'], court: ['DODGE!', 'catch the gold ones'] };
const LIMIT = { pier: 22, studio: 22, campus: 40, table: 40, arena: 30, desert: 22, voxel: 15, court: 60 };
const VO = ['vo0', 'vo1', 'vo2', 'vo3', 'vo4', 'vo8', 'vo5', 'vo6'];
let runId = 0, relaxed = false;
function later(fn, ms) { const id = runId; setTimeout(() => { if (id === runId) fn(); }, ms); }
let landGrade = 'auto';
function beginGame(i) {
  const isl = islands[i]; player.mode = 'game'; player.at = i; runId++; refreshCorridor();
  gameRoot.position.copy(anchor(isl)); gameRoot.clear(); gameRoot.quaternion.identity(); gameRoot.scale.setScalar(1);
  const v = VERB[isl.kind] || ['PLAY!', ''];
  verbCard(v[0], v[1]); hint('', '');
  later(() => {
    if (player.mode !== 'game' || player.at !== i) return;
    jResult = null; game = (GAMES[isl.kind] || GAMES.pier)(isl); game.isl = isl; game.scope = isl.kind === 'table' && tableLive ? tableLive.runKey : `${isl.kind}-${runId}-${Date.now().toString(36)}`; game.elapsed = 0; game.limit = LIMIT[isl.kind] || 25;
    hud.timer.hidden = relaxed || !!game.untimed;
  }, 900);
  hud.prompt.hidden = true;
}
function failGame() {
  if (game && game.cancel) try { game.cancel(); } catch (e) {}
  if (game && game.dispose) try { game.dispose(); } catch (e) {}
  const i = game.isl.i; hideBanner(); gameRoot.clear(); game = null; runId++;
  verbCard('TIME!', 'one more go'); play('whoosh', 0.5);
  const rid = runId; setTimeout(() => { if (rid === runId && player.mode === 'game') beginGame(i); }, 1400);
}
/* one idempotent completion for live and resumed wins (Astra 1c P1): facts are frozen when earned, re-running only sets booleans and maxes */
function completionFacts(isl, score) { const c = corridors[isl.i]; return { i: isl.i, kind: isl.kind, score: Math.max(0, score | 0), star1: landGrade === 'bull' || landGrade === 'great', star2: !!(c && c.total && c.got / c.total >= 0.8) }; }
/* the exact total winGame's tally will show: raw causes, plus the clear bonus and bullseye Mult for non-raw toys */
function finalScore(g) { const sc = g.sc || newScore(); let b = sc.base, m = sc.mult; if (!g.rawTally) { b += 100; if (landGrade === 'bull') m += 1; } return b * m; }
/* commit an earned completion now, before any timer or tally can be interrupted (Home build, creations) */
function commitCompletion(isl) { if (!game || game.won || game.depthFacts) return; game.priorBest = +BEST[isl.kind] || 0; const f = completionFacts(isl, finalScore(game)); game.depthFacts = f; game.freshComplete = completeIsland(f, false).fresh; }
function celebrateStamp(i) { stampEls[i].classList.add('fresh'); setTimeout(() => stampEls[i].classList.remove('fresh'), 900); seatPassengers(); setTimeout(() => floatText(player.pos.clone().add(new THREE.Vector3(0, 3.6, 0)), `${PASSENGERS[i]} aboard`), 700); }
function completeIsland(f, celebrate = true) {
  const p = progress[f.i]; if (!p) return { fresh: false, ok: false };
  const fresh = !p.done; p.done = true; p.stars[0] = true; if (f.star1) p.stars[1] = true; if (f.star2) p.stars[2] = true;
  let ok = true; if (f.score > (+BEST[f.kind] || 0)) BEST[f.kind] = f.score;
  if (f.score > 0) ok = store('islandhop-best', JSON.stringify(BEST)) && ok;
  ok = save() && ok; paintStamps();
  if (fresh && celebrate) celebrateStamp(f.i);
  return { fresh, ok };
}
async function winGame() {
  if (!game || game.won) return; game.won = true;
  { const sc = game.sc || newScore(); if (!game.rawTally) { sc.base += 100; sc.steps.push({ kind: 'base', n: 100, tag: 'Island cleared' }); } if (landGrade === 'bull' && !game.rawTally) { sc.mult += 1; sc.steps.unshift({ kind: 'mult', n: 1, tag: 'Bullseye landing' }); } const rid = runId; hideBanner(); gameRoot.visible = true; const depth = !!game.depthToy, complete = depth ? (game.isl.kind === 'campus' ? 'Performance complete' : 'Route complete') : null;
    const res = await runTally(sc, depth ? 0 : relaxed ? 0 : (TARGET[game.isl.kind] || 200), chapters[game.isl.i].dataset.label, game.isl.kind, complete, game.priorBest); if (rid !== runId || !game) return; game.lastScore = res.total;
    if (depth) { jResult = { scope: game.scope, value: res.total, label: game.isl.kind === 'campus' ? 'Performance points' : 'Route points', target: null, explanation: complete, retained: 'Your stamp, stars, best and this creation are saved.' }; journeyEvent(`${complete}: ${label(game.isl.i)}`, game.scope, res.total); }
    else if (!game.rawTally) { const tg = relaxed ? 0 : (TARGET[game.isl.kind] || 200); jResult = { scope: game.scope, value: res.total, label: `${label(game.isl.i)} result`, target: tg || null, explanation: res.ok ? 'Target reached' : `${(tg - res.total).toLocaleString()} short of the target this time`, retained: 'Island points are this round. Your stamp, stars and best are saved.' }; journeyEvent(progress[game.isl.i].done ? `${label(game.isl.i)} cleared again` : `Stamp earned: ${label(game.isl.i)}`, game.scope, res.total); } if (game.draft) { await offerDraft(); if (rid !== runId || !game) return; } }
  const isl = game.isl, facts = game.depthFacts || completionFacts(isl, game.lastScore || 0), deferredFresh = !!game.freshComplete; const at = gameRoot.position.clone().add(new THREE.Vector3(0, 3, 0));
  burst(at, 160, 11, 10); play('win', 0.7); setTimeout(() => play('stamp', 0.8), 450); if (storyVoice) setTimeout(() => voice('story' + isl.i), 1300);
  freeze = 0.09; trauma = Math.min(1, trauma + 0.6);
  if (game.depthToy && game.result) saveDepth(isl.kind, game.result);
  if (game.dispose) try { game.dispose(); } catch (e) {}
  hideBanner(); gameRoot.clear(); game = null; runId++;
  const val = chapters[isl.i].dataset.value; if (val) setTimeout(() => verbCard(val, chapters[isl.i].dataset.label), 250);
  if (completeIsland(facts).fresh || deferredFresh) { if (deferredFresh) celebrateStamp(isl.i); }
  setTimeout(() => { if (player.mode === 'card' && player.at === isl.i) openCard(isl.i); }, 1000);
  player.mode = 'card';
  if (joyride.on) { joyride.on = false; joyride.phase = 'done'; setTimeout(showPostcard, 2600); }
}

/* ---------- courses: a star trail, rings and an updraft between islands (Pilotwings + A Short Hike) ---------- */
const SPAWN = new THREE.Vector3(0, 7, 0);
const corridors = [];
const ringGeo = new THREE.TorusGeometry(1.9, 0.16, 10, 40);
const trailStar = starGeo(); trailStar.scale(0.28, 0.28, 0.28);
const draftMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { t: { value: 0 }, c: { value: new THREE.Color(0x9fe8ff) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: 'uniform float t; uniform vec3 c; varying vec2 vUv; void main(){ float s = sin((vUv.x*6. + vUv.y*3. - t*1.6)*6.2831)*.5+.5; float edge = smoothstep(0.,.15,vUv.y)*smoothstep(1.,.75,vUv.y); gl_FragColor = vec4(c, pow(s,3.)*.14*edge); }'
});
function buildCorridor(i) {
  const from = i === 0 ? SPAWN.clone() : anchor(islands[i - 1]).add(new THREE.Vector3(0, 5, 0));
  const to = anchor(islands[i]).add(new THREE.Vector3(0, 4.5, 0));
  const d = to.clone().sub(from), side = new THREE.Vector3(-d.z, 0, d.x).normalize();
  const pts = [from, from.clone().lerp(to, 0.33).addScaledVector(side, 4).add(new THREE.Vector3(0, 4, 0)), from.clone().lerp(to, 0.66).addScaledVector(side, -3.5).add(new THREE.Vector3(0, 2.5, 0)), to];
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.Group(); g.visible = false; scene.add(g);
  const c = { i, curve, g, rings: [], stars: [], drafts: [], got: 0, total: 0 };
  const hasRings = i > 0, ringTs = hasRings ? [0.22, 0.38, 0.54, 0.7, 0.86] : [];
  ringTs.forEach((t, k) => {
    const p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    const m = new THREE.Mesh(ringGeo, toon(PAL[(i + k) % PAL.length], { emissive: PAL[(i + k) % PAL.length], emissiveIntensity: 0.9 }));
    m.position.copy(p); m.lookAt(p.clone().add(tan)); inked(m, 0.0016); g.add(m);
    c.rings.push({ m, p, n: tan.clone(), done: false, pop: 0 });
  });
  for (let k = 0; k < 16; k++) {
    const t = 0.05 + (k / 15) * 0.9; if (ringTs.some((r) => Math.abs(r - t) < 0.035)) continue;
    const p = curve.getPointAt(t);
    const m = new THREE.Mesh(trailStar, toon(0xffd23f, { emissive: 0xffb000, emissiveIntensity: 0.5 })); m.position.copy(p); g.add(m);
    c.stars.push({ m, home: p.clone(), done: false });
  }
  /* corridor 0 teaches the updraft; later corridors put rings inside it (develop, then twist) */
  const dt = i === 0 ? 0.5 : 0.46, dp = curve.getPointAt(dt);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 20, 28, 1, true), draftMat); col.position.set(dp.x, dp.y - 4, dp.z); g.add(col);
  c.drafts.push({ p: new THREE.Vector3(dp.x, dp.y - 4, dp.z), r: 3, h: 20 });
  c.total = c.rings.length + c.stars.length;
  return c;
}
let activeC = -1;
function refreshCorridor() {
  const next = progress.findIndex((p) => !p.done);
  corridors.forEach((c, k) => (c.g.visible = circuitOn || (k === next && !longWalk.on && player.mode !== 'game')));
  activeC = longWalk.on ? -1 : next;
}

/* landing targets: a floating bullseye on every island */
const padGeo = [new THREE.RingGeometry(1.7, 2.2, 40), new THREE.RingGeometry(0.85, 1.2, 36), new THREE.CircleGeometry(0.42, 28)];
function buildPad(isl) {
  const g = new THREE.Group();
  [0xffffff, 0xff4d6d, 0xffd23f].forEach((c, k) => { const m = new THREE.Mesh(padGeo[k], new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = k * 0.01; g.add(m); });
  scene.add(g); isl.pad = g; return g;
}

/* ---------- the Long Walk Home: after every stamp, a golden ring above every island ---------- */
const longWalk = { on: false, rings: [], next: 0 };
function startLongWalk() {
  longWalk.on = true; longWalk.next = 0; refreshCorridor();
  islands.forEach((isl, k) => {
    const p = anchor(isl).add(new THREE.Vector3(0, 9, 0));
    const m = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.22, 12, 48), toon(0xffd23f, { emissive: 0xffc400, emissiveIntensity: k === 0 ? 1.6 : 0.4 }));
    m.position.copy(p); inked(m, 0.0016); scene.add(m); longWalk.rings.push({ m, p, isl });
  });
  verbCard('THE LONG WALK HOME', 'one golden ring above every island'); hint('walk', 'Fly through the glowing golden ring above each island, in order.');
}

/* ---------- flight ---------- */
const player = { g: player0.g, pos: player0.pos, vel: new THREE.Vector3(), target: null, mode: 'fly', at: -1, heat: 3, burning: false, auto: false };
let yaw = 0.3, pitch = 0.36, dist = 19, lastDrag = -10, trauma = 0, freeze = 0, comboN = 0, comboT = 0, starStep = 0, starT = 0;
const tut = { burned: false, stars: 0, draft: false };
const keys = new Set();
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === ' ' && typeof joyride === 'object' && joyride.on && !(e.target && /input|textarea/i.test(e.target.tagName))) joyride.tapUntil = Math.max(joyride.tapUntil || 0, performance.now() + 220);
  if (e.target && /input|textarea|button/i.test(e.target.tagName) && k === ' ') return;
  if (k.startsWith('arrow') || k === ' ') e.preventDefault();
  keys.add(k);
  if (overlayOpen()) return;
  if ((k === ' ' || k === 'shift') && game && game.tapAnywhere) { if (!e.repeat) game.tapAnywhere(); return; }
  if ((k === 'e' || k === 'enter') && near >= 0 && player.mode === 'fly') { e.preventDefault(); autopilot(near, true); }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => { keys.clear(); burnHeld = false; stick.id = null; stick.dx = stick.dy = 0; });
function leaveGame() { voiceCancel(); tableLive = null; if (game && game.cancel) try { game.cancel(); } catch (e) {} if (game && game.dispose) try { game.dispose(); } catch (e) {} setTimeout(() => resumePending(), 700); if (!game && player.mode !== 'game') return; hideBanner(); gameRoot.clear(); game = null; runId++; verbCard('LATER!', 'the island will wait'); takeOff(); }
$('#leave').onclick = leaveGame;
function autopilot(i, landNow) { if (player.mode === 'game') return; if (player.mode === 'card') closeCard(); player.target = { island: i, land: !!landNow }; player.mode = 'fly'; player.auto = true; play('whoosh', 0.4); }
function takeOff() { player.leftIsl = player.at; player.leftUntil = clock.elapsedTime + 4; player.mode = 'fly'; player.target = null; player.auto = false; player.vel.y = 5; player.at = -1; refreshCorridor(); } /* the island you just left will not catch you again for a moment */
let near = -1;
$('#land').onclick = () => { if (near >= 0) autopilot(near, true); };

/* touch: floating stick on the left, hold-to-burn on the right */
const stick = { id: null, x: 0, y: 0, dx: 0, dy: 0, el: $('#stick'), knob: $('#stick i') };
const burnBtn = $('#burn'); let burnHeld = false;
burnBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); burnHeld = true; burnBtn.setPointerCapture(e.pointerId); if (game && game.tapAnywhere) game.tapAnywhere(); });
burnBtn.addEventListener('pointerup', () => (burnHeld = false)); burnBtn.addEventListener('pointercancel', () => (burnHeld = false));

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' && !game && player.mode !== 'card' && e.clientX < innerWidth * 0.45 && stick.id === null) {
    stick.id = e.pointerId; stick.x = e.clientX; stick.y = e.clientY; stick.dx = stick.dy = 0;
    stick.el.style.left = e.clientX + 'px'; stick.el.style.top = e.clientY + 'px'; stick.el.hidden = false; canvas.setPointerCapture(e.pointerId); return;
  }
  drag = { x: e.clientX, y: e.clientY, yaw, pitch, moved: 0, id: e.pointerId }; canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === stick.id) { let dx = e.clientX - stick.x, dy = e.clientY - stick.y; const L = Math.hypot(dx, dy), m = 48; if (L > m) { dx *= m / L; dy *= m / L; } stick.dx = dx / m; stick.dy = dy / m; stick.knob.style.transform = `translate(${dx}px,${dy}px)`; return; }
  if (!drag || e.pointerId !== drag.id) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
  if (drag.moved > 6) { yaw = drag.yaw - dx * 0.006; pitch = Math.min(1.1, Math.max(0.1, drag.pitch + dy * 0.004)); lastDrag = clock.elapsedTime; }
});
function endPointer(e) {
  if (e.pointerId === stick.id) { stick.id = null; stick.dx = stick.dy = 0; stick.el.hidden = true; stick.knob.style.transform = ''; return; }
  const d = drag; drag = null; if (d && d.moved < 8 && e.type === 'pointerup') click(e);
}
canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); dist = Math.min(40, Math.max(10, dist * (1 + e.deltaY * 0.001))); }, { passive: false });
let glLost = false;
function overlayOpen() { return glLost || !started || !$('#start').hidden || !$('#route').hidden || !$('#postcard').hidden || !$('#circuitEnd').hidden || $('#seenText').classList.contains('open') || document.documentElement.classList.contains('reading') || !$('#tally').hidden || !$('#draft').hidden; }
function click(e) {
  if (overlayOpen()) return;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (game) {
    const h = ray.intersectObjects(gameRoot.children, true).find((x) => x.object.visible);
    if (h) { if (game.rawHit) game.tap(h.object); else { let o = h.object; while (o.parent && o.parent !== gameRoot) o = o.parent; game.tap(o); } }
    else if (game.tapAnywhere) game.tapAnywhere();
    return;
  }
  const kh = ray.intersectObjects(KEEP.map((k) => k.g).filter(Boolean), true).find((x) => x.object.userData.keep);
  if (kh) { findKeepsake(kh.object.userData.keep); return; }
  if (player.mode === 'card') return;
  const hits = ray.intersectObjects(islands.map((x) => x.g), true);
  if (hits.length) { const i = hits[0].object.userData.island; if (i !== undefined) autopilot(i, i === near || !islands[i].done); }
}

/* ---------- theme ---------- */
let baseBloom = 0.45, night = false;
function applyTheme() {
  const r = document.documentElement.dataset.theme;
  night = r === 'dark';
  if (night) { skyU.top.value.set(0x15103a); skyU.mid.value.set(0x40287a); skyU.low.value.set(0x7a3170); sun.intensity = 0.8; sun.color.set(0xa9b8ff); hemi.intensity = 0.5; hemi.color.set(0x9a8cff); baseBloom = 0.9; INK.uniforms.color.value.set(0x120c22); }
  else { skyU.top.value.set(0x1f6fe0); skyU.mid.value.set(0x5aa8ff); skyU.low.value.set(0xa8d4ff); sun.intensity = LOOK === 'lit' ? 3.4 : 2.4; sun.color.set(0xffe2b8); hemi.intensity = LOOK === 'lit' ? 0.75 : 1.1; hemi.color.set(0xdfeeff); baseBloom = 0.3; INK.uniforms.color.value.set(0x2b2140); }
  bloom.strength = baseBloom; skyArtTheme(night);
  if (scene.fog) scene.fog.color.set(night ? 0x3a2a66 : 0x8fc2ff);
  islands.forEach((x) => (x.beacon.material.emissiveIntensity = night ? 1.6 : 0.45));
}
applyTheme();
document.addEventListener('themechange', applyTheme);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
const audioPref = { sound: true, music: true, fx: true };
try { const a = JSON.parse(localStorage.getItem('islandhop-audio') || 'null'); if (a) { audioPref.sound = a.sound !== false; audioPref.music = a.music !== false; audioPref.fx = a.fx !== false; } } catch (e) {}
/* first visit: silent until the player opts in (start card "Add sound" = the same master switch); a returning player keeps the saved choice */
let audioStored = false; try { audioStored = localStorage.getItem('islandhop-audio') !== null; } catch (e) {}
if (!audioStored) audioPref.sound = false;
function applyAudio(persist) {
  musicOn = audioPref.sound && audioPref.music; muted.fx = !(audioPref.sound && audioPref.fx);
  if (!musicOn && typeof MUS === 'object') Object.keys(MUS).forEach((k) => { if (MUS[k]) { MUS[k].volume = 0; musVol[k] = 0; } }); /* silence now; resume fades in */
  if (muted.fx) { burner(false); liveSounds.forEach((c) => c.pause()); liveSounds.clear(); }
  if (!audioPref.sound) voiceCancel(); /* master off silences an active cue now */
  if (musicOn && started) startMusic();
  const set = (id, on, a, b) => { const el = $(id); if (el) { el.textContent = on ? a : b; el.setAttribute('aria-pressed', on); } };
  set('#sound', audioPref.sound, '♪ On', '♪ Off'); set('#soundOpt', audioPref.sound, '♪ Sound on', '♪ Add sound'); set('#musicBtn', audioPref.music, 'Music on', 'Music off'); set('#fxBtn', audioPref.fx, 'Effects on', 'Effects off');
  if (persist) try { localStorage.setItem('islandhop-audio', JSON.stringify(audioPref)); } catch (e) {}
}
$('#sound').addEventListener('click', () => { audioPref.sound = !audioPref.sound; applyAudio(true); });
if ($('#soundOpt')) $('#soundOpt').onclick = () => $('#sound').click(); /* the start card's consent button is the master switch, not a second one */
if ($('#musicBtn')) $('#musicBtn').onclick = () => { audioPref.music = !audioPref.music; applyAudio(true); };
if ($('#fxBtn')) $('#fxBtn').onclick = () => { audioPref.fx = !audioPref.fx; applyAudio(true); };

/* ---------- finale ---------- */
let finaleShown = false, finaleT = 0;
function finale() {
  finaleShown = true; finaleT = 8; play('win', 0.8); trauma = 0.8; freeze = 0.12;
  const stars = progress.reduce((a, p) => a + p.stars.filter(Boolean).length, 0);
  $('#finaleStars').textContent = `${stars} of ${progress.length * 3} stars · ${joyCount} joy · ${found.size} of ${KEEP.length} keepsakes · everyone aboard`;
  $('#rookie').hidden = stars < progress.length * 3;
  $('#finale').hidden = false; hint('', ''); voice('finale');
  longWalk.rings.forEach((r) => scene.remove(r.m)); longWalk.rings = []; longWalk.on = false;
}
$('#finaleClose').onclick = () => { $('#finale').hidden = true; };
$('#replay').onclick = () => { progress.forEach((p) => { p.done = false; p.stars = [false, false, false]; }); joyCount = 0; finaleShown = false; corridors.forEach((c) => { c.got = 0; c.rings.forEach((r) => { r.done = false; r.m.visible = true; r.m.scale.setScalar(1); }); c.stars.forEach((s) => { s.done = false; s.m.visible = true; s.m.position.copy(s.home); }); }); save(); paintStamps(); refreshCorridor(); $('#finale').hidden = true; };

/* ---------- loop ---------- */
const shift = { x: 0, y: 0, gx: 0, gy: 0 };
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  tilt.uniforms.res.value.set(w, h); bloom.resolution.set(w / 2, h / 2);
}
addEventListener('resize', resize); resize();
const clock = new THREE.Clock();
const camPos = new THREE.Vector3(0, 20, 30), camLook = new THREE.Vector3(), tv = new THREE.Vector3(), fwd = new THREE.Vector3(), rgt = new THREE.Vector3(), prevPos = new THREE.Vector3();
let running = true;
document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) { clock.getDelta(); requestAnimationFrame(loop); } else burner(false); });
const coarse = matchMedia('(pointer: coarse)').matches;
function angLerp(a, b, k) { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * k; }

function loop() {
  if (!running) return;
  if (glLost) { requestAnimationFrame(loop); return; } /* nothing to draw until the context returns or the page reloads */
  const rdt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  let dt = rdt; if (freeze > 0) { freeze -= rdt; dt = 0; }
  const paused = overlayOpen(); if (paused) { dt = 0; voiceOverlayCheck(); }
  if (circuitOn) circuitSyncPause(paused || !$('#circuitEnd').hidden); /* before collisions (Astra CIRCUIT-P2-01) */
  tickJourney(performance.now()); playT += dt; if (game && game.setPaused) game.setPaused(paused || document.hidden);

  islands.forEach((isl) => {
    isl.g.position.y = isl.base + (reduce || circuitOn ? 0 : Math.sin(t * 0.5 + isl.phase) * 0.35); /* fixed in the circuit: same course for both players */
    const b = isl.beacon, a = anchor(isl);
    b.visible = !isl.done && !(game && game.isl === isl) && !longWalk.on && !circuitOn; b.position.set(a.x, a.y + 6.2 + Math.sin(t * 2 + isl.phase) * 0.3, a.z); b.rotation.y = t * 1.6;
    if (isl.pad) { isl.pad.position.set(a.x, a.y + 0.45, a.z); isl.pad.visible = player.mode === 'fly' && (circuitOn || !isl.done); isl.pad.rotation.y = t * 0.4; }
  });
  clouds.forEach((c) => { c.position.x += c.userData.v * rdt; if (c.position.x > 80) c.position.x = -80; if (c.userData.mat) { const d = c.position.distanceTo(camera.position); const seg = new THREE.Line3(camera.position, camLook); const cp = new THREE.Vector3(); seg.closestPointToPoint(c.position, true, cp); const off = cp.distanceTo(c.position); c.userData.mat.opacity = Math.max(0, Math.min(0.95, (d - 6) / 10, (off - 3) / 4)); c.visible = c.userData.mat.opacity > 0.02; } });
  farBalloons.forEach((b) => { b.userData.a += b.userData.v * rdt * 0.3; b.position.x = Math.cos(b.userData.a) * b.userData.r; b.position.z = Math.sin(b.userData.a) * b.userData.r; b.position.y = b.userData.y + Math.sin(t * 0.4 + b.userData.r) * 1.2; });
  draftMat.uniforms.t.value = t; placeKeepsakes(t); tickMusic(rdt); tickBuilds(t, dt); joyrideTick(t, dt, paused);
  tilt.uniforms.amount.value += ((game ? 0.35 : joyride.on ? 0.45 : 0.6) - tilt.uniforms.amount.value) * Math.min(1, rdt * 3); /* first80: nearby play sharper than scenery */
  { const cafe = KEEP.find((x) => x.id === 'cafe'); if (cafe && cafe.g && player.mode === 'fly' && player.pos.distanceTo(cafe.g.position) < 2.4 && !(cafe.lastT > t - 3)) { cafe.lastT = t; findKeepsake('cafe'); } }

  /* input */
  fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw)); rgt.set(-fwd.z, 0, fwd.x);
  const steer = new THREE.Vector3();
  if (keys.has('w') || keys.has('arrowup')) steer.add(fwd);
  if (keys.has('s') || keys.has('arrowdown')) steer.sub(fwd);
  if (keys.has('a') || keys.has('arrowleft')) steer.sub(rgt);
  if (keys.has('d') || keys.has('arrowright')) steer.add(rgt);
  if (stick.id !== null) { steer.addScaledVector(rgt, stick.dx); steer.addScaledVector(fwd, -stick.dy); }
  const flying = player.mode === 'fly' && !paused;
  const tapBurn = joyride.on && (joyride.phase === 'lift' || joyride.phase === 'rings') && performance.now() < (joyride.tapUntil || 0); /* first80: a quick tap pays even between frames */
  const wantBurn = flying && (keys.has(' ') || keys.has('shift') || keys.has('q') || burnHeld || tapBurn);
  if (steer.lengthSq() > 0.01 && flying && player.auto) { player.auto = false; player.target = null; }

  /* heat: burn to rise and surge, sink when you let go, updrafts refill (A Short Hike / Journey) */
  player.burning = wantBurn && player.heat > 0.02;
  if (player.burning) { player.heat = Math.max(0, player.heat - dt * 0.6); player.vel.y += dt * 13; tut.burned = true; }
  else player.heat = Math.min(3, player.heat + dt * 0.16);
  burner(player.burning && !paused);
  let inDraft = false;
  (circuitOn ? corridors : (activeC >= 0 && corridors[activeC] ? [corridors[activeC]] : [])).forEach((cc) => cc.drafts.forEach((d) => {
    const hx = Math.hypot(player.pos.x - d.p.x, player.pos.z - d.p.z);
    if (hx < d.r && Math.abs(player.pos.y - d.p.y) < d.h / 2) { inDraft = true; player.vel.y += dt * 10; player.heat = Math.min(3, player.heat + dt * 1.6); tut.draft = true; }
  }));
  if (flying && !player.auto) {
    if (steer.lengthSq() > 0.01) player.vel.addScaledVector(steer.normalize(), dt * (player.burning ? 22 : 14));
    player.vel.y -= dt * (inDraft ? 0 : (joyride.on && joyride.phase !== 'travel' && joyride.phase !== 'free' ? (joyride.firstLift ? 1.7 : 0) : 3.2)); /* the joyride holds height until the first lift, then sinks gently */
  }
  if (joyride.on && flying && joyride.firstLift && (joyride.phase === 'lift' || joyride.phase === 'rings')) { const r = joyride.rings.find((x) => !x.done); if (r) { const d = new THREE.Vector3(r.p.x - player.pos.x, 0, r.p.z - player.pos.z), L = d.length(); if (L > 0.5) player.vel.addScaledVector(d.normalize(), dt * Math.min(12, 3 + L * 1.4)); const dy = r.p.y - player.pos.y, fresh = joyride.alive - joyride.lastBurn < 1.2; if (L < 9 && fresh) player.vel.y += dy * dt * 1.6; /* the ring meets a lift that is roughly right; it never lifts a player who is not lifting */ const cap = Math.max(...joyride.rings.map((x) => x.p.y)) + 3; if (player.pos.y > cap) { player.pos.y = cap; if (player.vel.y > 0) player.vel.y *= 0.2; } } }
  if (player.target && (flying || player.mode === 'landing')) {
    const a = anchor(islands[player.target.island]); tv.set(a.x, a.y + (player.target.land ? 1.4 : 5.5), a.z);
    const d = tv.clone().sub(player.pos), L = d.length();
    player.vel.addScaledVector(d.normalize(), dt * Math.min(30, 6 + L * 2.2));
    if (L < 0.8 && player.target.land) { const i = player.target.island; player.target = null; player.auto = false; landOn(i, 'auto'); }
    else if (L < 0.8) { player.target = null; player.auto = false; }
  }
  if ((player.mode === 'game' || player.mode === 'card') && player.at >= 0) { const a = anchor(islands[player.at]); tv.set(a.x + Math.cos(yaw) * 7.5, a.y + 7, a.z - Math.sin(yaw) * 7.5); player.vel.addScaledVector(tv.sub(player.pos), dt * 6); }
  player.vel.x *= Math.exp(-1.6 * dt); player.vel.z *= Math.exp(-1.6 * dt); player.vel.y *= Math.exp(-1.3 * dt);
  prevPos.copy(player.pos);
  player.pos.addScaledVector(player.vel, dt);
  player.pos.y = Math.min(ceilingAt(), Math.max(-12, player.pos.y));
  const R2 = Math.hypot(player.pos.x, player.pos.z); if (R2 > 60) { player.pos.x *= 60 / R2; player.pos.z *= 60 / R2; }

  /* islands are soft: bump off the sides, land from above */
  if (flying) islands.forEach((isl) => {
    const a = anchor(isl), dx = player.pos.x - a.x, dz = player.pos.z - a.z, hd = Math.hypot(dx, dz);
    if (hd < 5.4 && player.pos.y < a.y + 0.3 && player.pos.y > a.y - 7) { const k = (5.4 - hd) / 5.4; player.pos.x += (dx / (hd || 1)) * k * 0.6; player.pos.z += (dz / (hd || 1)) * k * 0.6; player.vel.y += 2; trauma = Math.min(1, trauma + 0.02); }
    if ((circuitOn || !isl.done) && !player.auto && !(isl.i === player.leftIsl && clock.elapsedTime < player.leftUntil) && hd < 3.4 && player.pos.y < a.y + 2.4 && player.pos.y > a.y + 0.2 && player.vel.y < 1.5) landOn(isl.i, hd < 0.9 ? 'bull' : hd < 1.8 ? 'great' : 'ok');
  });

  /* rings, stars, combos */
  const courseList = circuitOn ? corridors : (activeC >= 0 && corridors[activeC] ? [corridors[activeC]] : []);
  if (flying) courseList.forEach((c) => {
    c.rings.forEach((r) => {
      if (r.done) return;
      const s0 = tv.copy(prevPos).sub(r.p).dot(r.n), s1 = player.pos.clone().sub(r.p).dot(r.n);
      if (s0 < 0 && s1 >= 0 && player.pos.distanceTo(r.p) < 2.1) {
        if (circuitOn && !circuitScore('ring', 'route-' + c.i + '-ring-' + c.rings.indexOf(r), r.p)) return; r.done = true; if (!circuitOn) c.got++; comboN = t - comboT < 5 ? comboN + 1 : 1; comboT = t;
        if (!circuitOn) joyCount += comboN; chime(2 + comboN, 0.16); burst(r.p, 30, 6, 4); trauma = Math.min(1, trauma + 0.3);
        if (!circuitOn) floatText(r.p.clone().add(new THREE.Vector3(0, 2.4, 0)), comboN > 1 ? `RING x${comboN}` : 'RING!'); if (comboN >= 3) freeze = 0.06;
        hud.combo.textContent = comboN > 1 ? `x${comboN}` : ''; hud.combo.classList.remove('pop'); void hud.combo.offsetWidth; hud.combo.classList.add('pop');
      }
    });
    c.stars.forEach((s) => {
      if (s.done) return; const d = s.m.position.distanceTo(player.pos);
      if (d < 3) s.m.position.lerp(player.pos, Math.min(1, dt * 9));
      if (d < 1.1) { if (circuitOn && !circuitScore('star', 'route-' + c.i + '-star-' + c.stars.indexOf(s), s.m.position)) return; s.done = true; s.m.visible = false; if (circuitOn) {} else { c.got++; joyCount++; tut.stars++; } starStep = t - starT < 1.4 ? starStep + 1 : 0; starT = t; chime(starStep % 9, 0.09, 'sine'); }
      s.m.rotation.y = t * 3;
    });
  });
  corridors.forEach((c) => c.rings.forEach((r) => { if (r.done && r.m.visible) { r.pop += rdt * 4; r.m.scale.setScalar(1 + r.pop); r.m.material.opacity = 1 - r.pop; if (r.pop > 1) r.m.visible = false; } else if (!r.done) r.m.rotation.z += rdt * 0.6; }));
  if (longWalk.on && flying && longWalk.rings[longWalk.next]) {
    const r = longWalk.rings[longWalk.next];
    if (player.pos.distanceTo(r.p) < 2.8) {
      chime(3 + longWalk.next, 0.18); burst(r.p, 50, 8, 6); trauma = Math.min(1, trauma + 0.35); r.m.visible = false; longWalk.next++;
      if (longWalk.rings[longWalk.next]) longWalk.rings[longWalk.next].m.material.emissiveIntensity = 1.6;
      floatText(r.p.clone().add(new THREE.Vector3(0, 3, 0)), longWalk.next < islands.length ? `${longWalk.next} / ${islands.length}` : 'HOME');
      if (longWalk.next >= islands.length) finale();
    }
  }
  longWalk.rings.forEach((r, k) => { r.m.rotation.y = t * (k === longWalk.next ? 1.5 : 0.4); });

  /* balloon body: bob, bank into turns, puff when burning */
  player.g.position.copy(player.pos); player.g.position.y += reduce ? 0 : Math.sin(t * 1.8) * 0.15;
  const lat = player.vel.dot(rgt), lon = player.vel.dot(fwd);
  player.g.rotation.z += ((-lat * 0.035) - player.g.rotation.z) * Math.min(1, dt * 5);
  player.g.rotation.x += ((lon * 0.025) - player.g.rotation.x) * Math.min(1, dt * 5);
  player.g.rotation.y = yaw;
  const sq = player.burning ? 1.06 + Math.sin(t * 30) * 0.02 : 1; player.g.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
  if (player.burning && Math.random() < dt * 20) burst(player.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), 1, 0.6, 1.5);

  /* who is near */
  near = -1; let best = 9.5;
  if (flying) islands.forEach((isl) => { const a = anchor(isl); const d = Math.hypot(a.x - player.pos.x, a.z - player.pos.z); if (d < best && Math.abs(player.pos.y - a.y) < 12) { best = d; near = isl.i; } });
  if (near >= 0 && !player.auto) { hud.prompt.hidden = false; $('#promptName').textContent = chapters[near].dataset.label; $('#land').textContent = islands[near].done ? 'Visit again' : 'Auto-land'; }
  else hud.prompt.hidden = true;

  /* coaching, first minute (teach, develop, twist) */
  if (circuitOn) circuitTick(dt, paused || !$('#circuitEnd').hidden);
  if (flying && player.mode === 'fly' && !longWalk.on && !finaleShown && $('#start').hidden && !circuitOn) { /* live mode, not the frame-start flag: an auto-landing in this frame must not leave a burner hint over the toy */
    const B = coarse ? 'BURN' : 'SPACE';
    if ((player.auto && guided) || joyride.on) { /* guided flight or the joyride: one instruction at a time, from the joyride card or the guided hint */ }
    else if (!tut.burned) hint('burn', `Hold ${B} to fire the burner and rise.`);
    else if (tut.stars < 3 && activeC === 0) hint('stars', coarse ? 'Drag the left side to steer. Follow the stars.' : 'Steer with W A S D. Follow the star trail.');
    else if (!tut.draft && activeC === 0 && player.heat < 1.6) hint('draft', 'Low on heat? Ride the swirling updraft to refill.');
    else if (near >= 0 && !islands[near].done) hint('land', 'Sink onto the target to land. Dead center is a Bullseye.');
    else if (activeC >= 1 && corridors[activeC].got === 0) hint('rings', 'Thread the rings in a row to build a combo.');
    else hint('', '');
  }

  /* HUD meters */
  [...hud.heat.children].forEach((p, k) => p.style.setProperty('--f', Math.max(0, Math.min(1, player.heat - k))));
  hud.heat.classList.toggle('low', player.heat < 0.6);
  hud.joy.textContent = joyCount;
  if (t - comboT > 5 && hud.combo.textContent) hud.combo.textContent = '';
  if (game && game.elapsed !== undefined && !game.untimed) { game.elapsed += dt; const left = relaxed ? 1 : 1 - game.elapsed / game.limit; hud.timer.style.setProperty('--left', Math.max(0, left)); if (left <= 0) failGame(); }

  if (game && dt > 0) game.tick(t, dt);
  stepParticles(dt);
  for (let k = floaters.length - 1; k >= 0; k--) { const f = floaters[k]; f.life -= rdt; f.s.position.y += rdt * 1.6; f.s.material.opacity = Math.min(1, f.life * 2); if (f.life <= 0) { scene.remove(f.s); f.s.material.map.dispose(); f.s.material.dispose(); floaters.splice(k, 1); } }
  if (finaleT > 0) { finaleT -= rdt; if (Math.random() < rdt * 9) burst(new THREE.Vector3((Math.random() - 0.5) * 50, 8 + Math.random() * 14, (Math.random() - 0.5) * 50), 50, 14, 6); }

  /* camera: chase behind the motion, frame the island during play */
  const hs = Math.hypot(player.vel.x, player.vel.z);
  if (flying && hs > 2.5 && t - lastDrag > 1.6) yaw = angLerp(yaw, Math.atan2(-player.vel.x, -player.vel.z), Math.min(1, rdt * 1.4));
  let look = player.pos, want;
  if ((player.mode === 'game' || player.mode === 'card') && player.at >= 0) {
    const a = anchor(islands[player.at]); const isCourt = islands[player.at].kind === 'court'; look = a.clone().add(new THREE.Vector3(0, isCourt ? -0.4 : 0.6, 0));
    const D = isCourt ? (innerWidth < 700 ? 20 : 15) : (innerWidth < 700 ? 32 : 26), P = isCourt ? 0.85 : 0.55;
    want = look.clone().add(new THREE.Vector3(Math.sin(yaw) * D * Math.cos(P), D * Math.sin(P), Math.cos(yaw) * D * Math.cos(P)));
  } else {
    /* approaching an island: tilt down and frame balloon and target together */
    let P = pitch, D = dist;
    if (!tut.burned && !circuitOn && started) { look = player.pos.clone().add(new THREE.Vector3(0, -3, -6).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)); P = 0.72; D = 30; }
    if (near >= 0 && flying) { const a = anchor(islands[near]); look = player.pos.clone().lerp(a, 0.45); P = Math.max(pitch, 0.62); D = dist * 1.15; }
    want = look.clone().add(new THREE.Vector3(Math.sin(yaw) * D * Math.cos(P), D * Math.sin(P) + 1.5, Math.cos(yaw) * D * Math.cos(P)));
  }
  const k = 1 - Math.pow(0.015, rdt);
  camPos.lerp(want, k); camLook.lerp(look, k);
  trauma = Math.max(0, trauma - rdt * 1.5);
  const sh = (reduce || calm) ? 0 : trauma * trauma * 0.7;
  camera.position.copy(camPos).add(new THREE.Vector3(Math.sin(t * 47) * sh, Math.sin(t * 61 + 1) * sh, Math.sin(t * 53 + 2) * sh));
  camera.lookAt(camLook); skyArtPlace(rdt);
  const fovT = reduce ? 44 : 44 + Math.min(16, Math.max(0, hs - 5) * 1.6) + (player.burning ? 3 : 0);
  if (Math.abs(camera.fov - fovT) > 0.05) { camera.fov += (fovT - camera.fov) * Math.min(1, rdt * 4); camera.updateProjectionMatrix(); }
  hud.lines.style.opacity = (reduce || calm) ? 0 : Math.max(0, Math.min(0.75, (hs - 9) / 6));
  const cardOpen = hud.card.classList.contains('open'), phone = innerWidth < 700;
  shift.gx = cardOpen && !phone ? innerWidth * 0.2 : 0; shift.gy = cardOpen && phone ? innerHeight * 0.24 : 0;
  shift.x += (shift.gx - shift.x) * k; shift.y += (shift.gy - shift.y) * k;
  if (Math.abs(shift.x) + Math.abs(shift.y) > 0.5) camera.setViewOffset(innerWidth, innerHeight, shift.x, shift.y, innerWidth, innerHeight);
  else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  const sp = camLook.clone().project(camera); tilt.uniforms.focus.value += (((sp.y + 1) / 2) - tilt.uniforms.focus.value) * k;
  sun.position.copy(camLook).add(new THREE.Vector3(30, 50, 20)); sun.target.position.copy(camLook);

  composer.render();
  requestAnimationFrame(loop);
}
function landOn(i, grade) {
  if (player.mode !== 'fly') return;
  if (circuitOn) { circuitLanding(i); return; }
  landGrade = grade; player.vel.set(0, 0, 0); player.at = i; burner(false); if (grade === 'bull') voice('land_bull');
  const a = anchor(islands[i]);
  if (grade !== 'auto') { const word = { bull: 'BULLSEYE!', great: 'GREAT LANDING', ok: 'LANDED' }[grade]; floatText(a.clone().add(new THREE.Vector3(0, 3, 0)), word); if (grade === 'bull') { burst(a.clone().add(new THREE.Vector3(0, 1, 0)), 60, 7, 6); chime(8, 0.16); freeze = 0.07; } trauma = Math.min(1, trauma + 0.25); }
  if (islands[i].done) { player.mode = 'card'; openCard(i); } else beginGame(i);
}
ready.then(() => {
  islands.forEach((isl) => { corridors.push(buildCorridor(isl.i)); buildPad(isl); });
  paintStamps(); refreshCorridor(); buildKeepsakes(); seatPassengers(); applyBuilds(); paintSlot();
  player.pos.copy(SPAWN); camPos.copy(SPAWN).add(new THREE.Vector3(0, 8, 22));
  const a0 = anchor(islands[0]); yaw = Math.atan2(-(a0.x - SPAWN.x), -(a0.z - SPAWN.z));
  document.documentElement.classList.add('loaded');
  { const pr = $('#joyride') || $('#guided'); if (pr && !$('#start').hidden && document.activeElement === document.body) pr.focus({ preventScroll: true }); } /* keyboard: one Enter begins */
  if (progress.every((p) => p.done) && !finaleShown) startLongWalk();
});
requestAnimationFrame(loop);
let started = false;
$('#relaxed').addEventListener('click', () => { relaxed = true; $('#go').click(); });
/* first 60 seconds (Darby 10/2): one guided way in. No steering: the balloon autopilots to the next unstamped island and auto-lands,
   the toy's own retry loop carries the first success, and "Fly on" keeps guiding until every stamp is in. Flight and every other mode are unchanged. */
let guided = false;
function guidedNext() {
  const i = progress.findIndex((p) => !p.done);
  if (i < 0) { guided = false; hint('guided', 'Every stamp is yours. Fly wherever you like.'); return; }
  autopilot(i, true); hint('guided', `Sit back: flying you to ${label(i)}. Tap or click any island to change course.`);
}
if ($('#guided')) $('#guided').addEventListener('click', () => { guided = true; $('#start').hidden = true; if (!started) $('#go').click(); guidedNext(); }); /* synchronous: autopilot is set before the next frame, so no flight tutorial hint flashes first */
/* ---------- first80 (Darby 10/3, Astra's brief FIRST80-DESIGN.md): the joyride, a tutorial state, not a currency ----------
   lift through three generous rings with the player on the boost, choose a route with a visible consequence, arrive at a working toy.
   Nothing here awards stamps, stars, joy or keepsakes; saves and modules are untouched. */
const joyride = { on: false, phase: 'off', rings: [], got: 0, t0: 0, alive: 0, chooseAt: null, boosts: 0, group: null, lastInput: performance.now(), chosen: null, firstLift: false, lastBurn: -9 };
['keydown', 'pointerdown'].forEach((ev) => addEventListener(ev, () => { joyride.lastInput = performance.now(); }, true));
const joyCard = $('#joyCard'), joyLine = $('#joyLine'), joyRingsEl = $('#joyRings'), joyBoost = $('#joyBoost');
function joySay(line, count) { if (joyLine) joyLine.textContent = line; if (joyRingsEl) joyRingsEl.textContent = count || ''; }
function joyrideRings() {
  if (joyride.group) { scene.remove(joyride.group); joyride.rings.length = 0; }
  const g = new THREE.Group(); scene.add(g); joyride.group = g;
  const dir = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x);
  const cap = Math.max(SPAWN.y + 6, ceilingAt() - 2.5);
  [[10, 3.5, 0], [22, 6.5, 2.5], [34, 9.5, -2.5]].forEach(([f, u, sd], k) => {
    const p = SPAWN.clone().addScaledVector(dir, f).addScaledVector(side, sd); p.y = Math.min(cap, SPAWN.y + u);
    const col = PAL[(k + 2) % PAL.length];
    const m = new THREE.Mesh(ringGeo, toon(col, { emissive: col, emissiveIntensity: 1.1 })); m.scale.setScalar(2.3); m.position.copy(p); m.lookAt(p.clone().add(dir)); inked(m, 0.0016); g.add(m);
    joyride.rings.push({ m, p, done: false, k });
  });
}
function joyrideStart() {
  joyride.on = true; joyride.phase = 'lift'; joyride.got = 0; joyride.boosts = 0; joyride.firstLift = false; joyride.chosen = null; joyride.t0 = clock.elapsedTime; joyride.alive = 0; joyride.chooseAt = null; joyride.lastBurn = -9;
  $('#start').hidden = true; if (!started) $('#go').click(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); /* Space must reach the burner, not a hidden button */
  player.auto = false; player.target = null; player.mode = 'fly'; player.vel.set(0, 0, 0); player.pos.copy(SPAWN); player.heat = 3; guided = false;
  document.documentElement.classList.add('joyride'); hint('', ''); hud.prompt.hidden = true;
  joyrideRings(); if (joyCard) joyCard.hidden = false; if (joyBoost) joyBoost.hidden = false;
  joySay(coarse ? 'Tap BOOST to lift.' : 'Tap BOOST to lift. Space works too.', '0 / 3 rings');
  verbCard('LIFT!', 'a little lift, a world to explore');
}
function joyrideEnd(toIsland) {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  document.documentElement.classList.remove('joyride'); if (joyCard) joyCard.hidden = true; if (joyBoost) joyBoost.hidden = true; $('#route').hidden = true;
  if (joyride.group) { joyride.group.visible = false; }
  if (toIsland === null || toIsland === undefined) { joyride.on = false; joyride.phase = 'free'; hint('joyfree', coarse ? 'Tap any island and I will fly you there. Left thumb steers, BURN rises.' : 'Click any island and I will fly you there. W A S D steers, Space rises.'); return; }
  joyride.phase = 'travel'; joyride.chosen = toIsland; guided = true; autopilot(toIsland, true);
  hint('guided', `Sit back: flying you to ${label(toIsland)}. Tap or click any island to change course.`); verbCard('OFF WE GO', label(toIsland));
}
function joyrideTick(t, dt, paused) {
  if (!joyride.on || paused) return; /* dt is the unpaused step; Help, Read and the route card do not count */
  joyride.alive += dt;
  const still = reduce || calm;
  if (joyride.group) joyride.rings.forEach((r, k) => { if (!r.done && !still) { r.m.scale.setScalar(2.3 + Math.sin(t * 3 + k) * 0.12); r.m.rotation.z += dt * 0.6; } });
  if (joyride.phase === 'lift' || joyride.phase === 'rings') {
    if (player.burning) { joyride.lastBurn = joyride.alive; if (!joyride.firstLift) { joyride.firstLift = true; joyride.phase = 'rings'; floatText(player.pos.clone().add(new THREE.Vector3(0, 3.2, 0)), 'Nice lift!'); burst(player.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), still ? 12 : 50, 6, 6); chime(6, 0.2); joySay('Keep tapping BOOST. Fly through the glowing rings.', `${joyride.got} / 3 rings`); } }
    const r = joyride.rings.find((x) => !x.done);
    /* a ring counts only after the player has lifted at least once; no input earns nothing */
    if (joyride.firstLift && r && Math.hypot(r.p.x - player.pos.x, r.p.z - player.pos.z) < 4.6 && Math.abs(r.p.y - player.pos.y) < 5.5) {
      r.done = true; joyride.got++; r.m.material.emissiveIntensity = 0.25; r.m.scale.setScalar(1.6);
      burst(r.p, still ? 16 : 60, 8, 7); chime(4 + joyride.got * 2, 0.18); floatText(r.p.clone().add(new THREE.Vector3(0, 3, 0)), joyride.got < 3 ? `RING ${joyride.got} / 3` : 'ALL THREE!'); if (!still) trauma = Math.min(1, trauma + 0.2);
      joySay(joyride.got < 3 ? (joyride.got === 1 ? 'One. Two more ahead, a little higher.' : 'Two. One more, then you choose where to go.') : 'That is the whole lesson. Now pick a route.', `${joyride.got} / 3 rings`);
      if (joyride.got >= 3) joyride.chooseAt = joyride.alive + 0.7; /* paused-aware: resolved in this tick, not by a timer */
    }
    const idle = (performance.now() - joyride.lastInput) / 1000;
    if (joyBoost) joyBoost.classList.toggle('pulse', idle > 6);
    if (joyride.alive > 28 && joyride.chooseAt === null) { joySay(joyride.got ? `${joyride.got} of 3 is plenty. Pick a route.` : 'No rush. Pick a route and I will fly.', `${joyride.got} / 3 rings`); joyride.chooseAt = joyride.alive + 0.9; }
    if (joyride.chooseAt !== null && joyride.alive >= joyride.chooseAt) joyrideChoose();
  }
}
function joyrideCancel(why) {
  if (!joyride.on && joyride.phase === 'off') return;
  joyride.on = false; joyride.phase = 'off'; joyride.chooseAt = null; joyride.chosen = null;
  document.documentElement.classList.remove('joyride'); if (joyCard) joyCard.hidden = true; if (joyBoost) joyBoost.hidden = true; if ($('#route')) $('#route').hidden = true;
  if (joyride.group) joyride.group.visible = false; burnHeld = false;
}
['#go', '#relaxed', '#circuit1', '#circuit2'].forEach((id) => { const el = $(id); if (el) el.addEventListener('click', (e) => { if (e.isTrusted) joyrideCancel(id); }, true); }); /* capture, trusted only: the joyride's own programmatic #go click does not cancel it */
let routeOpenedAt = 0;
function joyrideChoose() { if (!joyride.on || !(joyride.phase === 'lift' || joyride.phase === 'rings') || overlayOpen()) return; joyride.phase = 'choose'; joyride.chooseAt = null; if (joyCard) joyCard.hidden = true; if (joyBoost) joyBoost.hidden = true; burnHeld = false; keys.clear(); $('#route').hidden = false; routeOpenedAt = performance.now(); const pnl = $('#routePanel'); if (pnl) pnl.focus({ preventScroll: true }); /* the panel takes focus; the first choice is one Tab away, so a held key cannot choose */ }
const courtIdx = () => islands.findIndex((x) => x.kind === 'court');
const routeGuard = (fn) => () => { if (performance.now() - routeOpenedAt < 450) return; fn(); }; /* absorbs a key still held from the rings */
if ($('#routeCatch')) $('#routeCatch').onclick = routeGuard(() => joyrideEnd(courtIdx()));
if ($('#routeHome')) $('#routeHome').onclick = routeGuard(() => joyrideEnd(homeIdx()));
if ($('#routeFree')) $('#routeFree').onclick = routeGuard(() => joyrideEnd(null));
if ($('#joySkip')) $('#joySkip').onclick = () => { joyride.chooseAt = joyride.alive; joyrideChoose(); };
const joyTap = () => { if (joyride.on) joyride.tapUntil = Math.max(joyride.tapUntil || 0, performance.now() + 220); };
if (joyBoost) { joyBoost.addEventListener('pointerdown', (e) => { e.preventDefault(); burnHeld = true; joyTap(); try { joyBoost.setPointerCapture(e.pointerId); } catch (x) {} }); joyBoost.addEventListener('click', joyTap); /* assistive clicks arrive without pointerdown */ ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => joyBoost.addEventListener(ev, () => (burnHeld = false))); joyBoost.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); burnHeld = true; joyTap(); } }); joyBoost.addEventListener('keyup', () => (burnHeld = false)); }
/* idle nudges outside the joyride: eight quiet seconds in a toy pulses its first choice; eight in free flight offers the autopilot */
setInterval(() => {
  if (!started || overlayOpen() || document.hidden) return;
  const idle = (performance.now() - joyride.lastInput) / 1000;
  const first = $('#choices button'); if (first) first.classList.toggle('pulse', idle > 8 && player.mode === 'game');
  if (idle > 8 && player.mode === 'fly' && !player.auto && !circuitOn && !longWalk.on && hintKey === '') hint('idlefly', coarse ? 'Tap any island and I will fly you there.' : 'Click any island and I will fly you there.');
}, 1000);
/* the fresh postcard: shown once per device after the first result of a joyride; never a stamp, never a lock */
let postcardShown = false; try { postcardShown = localStorage.getItem('islandhop-postcard-20261003') === '1'; } catch (e) {}
let postcardCalls = 0;
function showPostcard(tries) { postcardCalls++; if (postcardShown || !$('#postcard')) return;
  const quiet = !overlayOpen() && (player.mode === 'card' || player.mode === 'fly') && !circuitOn && !longWalk.on;
  if (!quiet) { if ((tries || 0) < 20) setTimeout(() => showPostcard((tries || 0) + 1), 3000); return; } postcardShown = true; try { localStorage.setItem('islandhop-postcard-20261003', '1'); } catch (e) {} $('#postcard').hidden = false; const b = $('#postcardHome'); if (b) b.focus({ preventScroll: true }); }
if ($('#postcardClose')) $('#postcardClose').onclick = () => ($('#postcard').hidden = true);
if ($('#postcardHome')) $('#postcardHome').onclick = () => { $('#postcard').hidden = true; if (player.mode === 'card') closeCard(); guided = true; autopilot(homeIdx(), true); hint('guided', `Sit back: flying you to ${label(homeIdx())}.`); };
/* start card: a first visit gets the joyride as the main action; a returning player keeps flying and can replay it */
const returning = progress.some((p) => p.done) || found.size > 0;
if ($('#joyride')) {
  if (returning) { $('#joyride').textContent = '▶ Keep flying'; if ($('#guided')) $('#guided').textContent = 'Replay the joyride'; }
  $('#joyride').addEventListener('click', () => { if (returning) { joyrideCancel('#joyride'); guided = true; $('#start').hidden = true; if (!started) $('#go').click(); guidedNext(); } else joyrideStart(); });
  if ($('#guided')) { const g2 = $('#guided').cloneNode(true); $('#guided').replaceWith(g2); g2.addEventListener('click', () => { if (returning) joyrideStart(); else { joyrideCancel('#guided'); guided = true; $('#start').hidden = true; if (!started) $('#go').click(); guidedNext(); } }); }
}
if ($('#calmBtn')) {
  const paintCalm = () => { $('#calmBtn').textContent = calm ? 'Calm motion on' : 'Calm motion off'; $('#calmBtn').setAttribute('aria-pressed', calm); document.documentElement.classList.toggle('calm', calm); };
  paintCalm(); $('#calmBtn').onclick = () => { calm = !calm; try { localStorage.setItem('islandhop-calm', calm ? '1' : '0'); } catch (e) {} paintCalm(); };
}
$('#go').addEventListener('click', () => {
  if (!started) { started = true; player.pos.copy(SPAWN); player.vel.set(0, 0, 0); player.heat = 3; } const sd = specialDay(); if (sd) setTimeout(() => { verbCard(sd[0], sd[1]); burst(player.pos.clone().add(new THREE.Vector3(0, 4, 0)), 120, 10, 10); }, 600); });
window.__hop = { islands, progress, corridors, player, landOn, autopilot, beginGame, winGame, get game() { return game; }, startLongWalk, refreshCorridor };

window.__hop.joyride = joyride; window.__hop.skyArt = skyArt;
/* first80 (Astra QA): a lost graphics context must never leave an invisible game running */
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); glLost = true; burner(false); if ($('#gl')) $('#gl').hidden = false; const b = $('#glReload'); if (b) b.focus({ preventScroll: true }); });
canvas.addEventListener('webglcontextrestored', () => { glLost = false; if ($('#gl')) $('#gl').hidden = true; try { renderer.resetState(); } catch (x) {} });
if ($('#glReload')) $('#glReload').onclick = () => location.reload();
if ($('#glRead')) $('#glRead').onclick = () => { if ($('#gl')) $('#gl').hidden = true; $('#read').click(); };
window.__hop.glLost = () => glLost; window.__hop.postcard = () => ({ calls: postcardCalls, shown: postcardShown, hidden: $('#postcard') ? $('#postcard').hidden : null });
/* ---------- Joy Circuit (Astra's module): a 90-second score attack over the real course, solo or pass-the-device ---------- */
let circuit = null, circuitOn = false, cToken = null, cSnap = null, cWasPaused = false;
function circuitStart(players) {
  if (game) leaveGame(); if (hud.card.classList.contains('open')) { hud.card.classList.remove('open'); chapters.forEach((c) => c.classList.remove('on')); }
  if (!circuitOn || !cSnap) cSnap = corridors.map((c) => ({ got: c.got, rings: c.rings.map((r) => r.done), stars: c.stars.map((s) => s.done) }));
  circuit = JC.createCircuit({ players, seed: 20261002 }); circuitOn = true;
  $('#circuitEnd').hidden = true; circuitTurn();
}
function resetCourse() {
  corridors.forEach((c) => { c.rings.forEach((r) => { r.done = false; r.pop = 0; r.m.visible = true; r.m.scale.setScalar(1); }); c.stars.forEach((s) => { s.done = false; s.m.visible = true; s.m.position.copy(s.home); }); });
  islands.forEach((isl) => (isl.cLanded = false));
}
function circuitTurn() {
  resetCourse(); refreshCorridor();
  player.pos.copy(SPAWN); player.vel.set(0, 0, 0); player.heat = 3; player.mode = 'fly'; player.target = null; player.auto = false; player.at = -1;
  keys.clear(); burnHeld = false; drag = null; pitch = 0.36; dist = 19; lastDrag = -10; camPos.set(0, 20, 30); camLook.set(0, 0, 0); /* same input and camera baseline for every turn */
  player.leftIsl = -1; player.leftUntil = 0; burner(false); if (stick) { stick.id = null; stick.dx = 0; stick.dy = 0; if (stick.el) stick.el.hidden = true; }
  const a0 = anchor(islands[0]); yaw = Math.atan2(-(a0.x - SPAWN.x), -(a0.z - SPAWN.z));
  cToken = JC.beginTurn(circuit);
  $('#circuitHud').hidden = false; hint('', '');
  verbCard('JOY CIRCUIT', circuit.players === 2 ? `player ${circuit.turn} of 2 · 90 seconds` : '90 seconds · chain it all');
}
function circuitScore(kind, id, at) {
  if (!circuitOn || !circuit || circuit.status !== 'playing') return false;
  const r = JC.collectCircuit(circuit, id, kind, cToken); if (!r) return false;
  floatText(at.clone().add(new THREE.Vector3(0, 2.2, 0)), `+${r.points}${r.combo > 1 ? ` x${r.combo}` : ''}`);
  chime(Math.min(10, 2 + r.combo), 0.14); if (r.combo >= 4) freeze = 0.05;
  return true;
}
function circuitLanding(i) {
  const isl = islands[i]; if (isl.cLanded) return; isl.cLanded = true;
  const a = anchor(isl); circuitScore('landing', `pad-${i}`, a); burst(a.clone().add(new THREE.Vector3(0, 1, 0)), 40, 7, 6);
  player.vel.y = 9; trauma = Math.min(1, trauma + 0.25);
}
function circuitSyncPause(paused) {
  if (!circuitOn || !circuit) return;
  if (paused && circuit.status === 'playing') { JC.pauseCircuit(circuit, cToken); cWasPaused = true; }
  else if (!paused && cWasPaused) { JC.resumeCircuit(circuit, cToken); cWasPaused = false; }
}
function circuitTick(dt, paused) {
  if (!circuitOn || !circuit) return;
  circuitSyncPause(paused);
  const done = paused ? null : JC.tickCircuit(circuit, dt, cToken);
  const s = JC.circuitSummary(circuit);
  $('#cTime').textContent = s.secondsLeft; $('#cScore').textContent = s.score.toLocaleString(); $('#cCombo').textContent = s.combo > 1 ? `x${s.combo}` : ''; $('#cPlayer').textContent = circuit.players === 2 ? `P${circuit.turn}` : 'SOLO';
  if (done) circuitTurnOver();
}
function circuitTurnOver() {
  const s = JC.circuitSummary(circuit); $('#circuitHud').hidden = true;
  const key = circuit.players === 2 ? 'islandhop-circuit-best-duo' : 'islandhop-circuit-best-solo';
  let best = 0; try { best = +localStorage.getItem(key) || 0; } catch (e) {}
  const top = Math.max(...s.results.map((r) => r.score));
  if (s.status === 'complete' && top > best) { try { localStorage.setItem(key, top); } catch (e) {} }
  const box = $('#circuitEnd'); box.hidden = false;
  if (s.status === 'between') {
    $('#cEndTitle').textContent = `Player 1: ${s.results[0].score.toLocaleString()}`;
    $('#cEndText').textContent = 'Pass the device. Same sky, same course, same seed. Player 2, you are up.';
    $('#cEndGo').textContent = 'Player 2, go'; $('#cEndGo').onclick = () => { box.hidden = true; circuitTurn(); };
  } else {
    const w = s.winners;
    $('#cEndTitle').textContent = circuit.players === 2 ? (w.length > 1 ? `A tie at ${top.toLocaleString()}!` : `Player ${w[0]} wins`) : `${top.toLocaleString()} points`;
    $('#cEndText').textContent = circuit.players === 2 ? s.results.map((r) => `P${r.player}: ${r.score.toLocaleString()} (best chain x${r.maxCombo})`).join(' · ') + ` · Best single turn in 2-player mode ${Math.max(best, top).toLocaleString()}` : `Best chain x${s.results[0].maxCombo} · ${s.results[0].targets} targets · Solo best ${Math.max(best, top).toLocaleString()}`;
    $('#cEndGo').textContent = 'Run it back'; $('#cEndGo').onclick = () => circuitStart(circuit.players);
  }
  play('win', 0.6); burst(player.pos.clone().add(new THREE.Vector3(0, 3, 0)), 90, 9, 8);
  if (s.status === 'complete') voice(best > 0 && top > best ? 'new_best' : 'circuit_end');
}
function circuitExit() {
  if (circuit) JC.cancelCircuit(circuit); circuitOn = false; circuit = null; cToken = null;
  $('#circuitHud').hidden = true; $('#circuitEnd').hidden = true;
  if (cSnap) corridors.forEach((c, k) => { const sn = cSnap[k]; c.got = sn.got; c.rings.forEach((r, j) => { r.done = sn.rings[j]; r.m.visible = !r.done; r.m.scale.setScalar(1); r.pop = r.done ? 2 : 0; }); c.stars.forEach((s, j) => { s.done = sn.stars[j]; s.m.visible = !s.done; s.m.position.copy(s.home); }); });
  cSnap = null; refreshCorridor(); takeOff(); player.pos.copy(SPAWN);
}
$('#circuit1').onclick = () => { $('#start').hidden = true; if (!started) $('#go').click(); circuitStart(1); };
$('#circuit2').onclick = () => { $('#start').hidden = true; if (!started) $('#go').click(); circuitStart(2); };
$('#cExit').onclick = circuitExit; $('#cEndExit').onclick = circuitExit;

window.__hop.circuit = () => circuit; window.__hop.circuitTurnOver = () => { if (circuit && cToken) { JC.finishTurn(circuit, cToken); circuitTurnOver(); } };

/* ---------- adaptive music: four ElevenLabs versions in F at 150 BPM, crossfaded by state (Balatro-style stems, no hard stops) ---------- */
/* one motif (F A C F) in nine identities: each island has its own instrumentation; flying near an island lets its theme drift in
   (ElevenLabs music v2.5, flow DfOiy6n5549IJTUoqjRd; loudness matched to -18 LUFS; UNLISTENED by a human as of this build) */
let musicOn = true, musicStarted = false;
const ISLAND_KINDS = ['pier', 'studio', 'campus', 'table', 'arena', 'court', 'desert', 'voxel'];
const MUS = { flight: null, toy: $('#mToy'), boss: $('#mBoss'), finale: $('#mFinale') };
const musVol = { flight: 0, toy: 0, boss: 0, finale: 0 };
const isleTrack = (k) => { if (!MUS[k]) { const a = new Audio(`audio/islands/${k}.mp3`); a.loop = true; a.preload = 'auto'; a.volume = 0; MUS[k] = a; musVol[k] = 0; if (musicStarted) a.play().catch(() => {}); } return MUS[k]; };
MUS.flight = isleTrack('flight'); if ($('#music')) $('#music').removeAttribute('src');
function startMusic() {
  if (musicStarted) return; musicStarted = true;
  Object.values(MUS).forEach((a) => { if (!a) return; a.volume = 0; a.loop = true; a.play().catch(() => {}); });
}
/* returns {layer: weight}; weights sum to 1 */
function musicMix() {
  if (finaleShown || finaleT > 0) return { finale: 1 };
  if (circuitOn || (game && game.boss)) return { boss: 1 };
  if ((player.mode === 'game' || player.mode === 'card') && islands[player.at]) { const k = islands[player.at].kind; return ISLAND_KINDS.includes(k) ? { [k]: 1 } : { toy: 1 }; }
  if (typeof near === 'number' && near >= 0 && islands[near]) return { flight: 0.55, [islands[near].kind]: 0.45 };
  return { flight: 1 };
}
function musicState() { const m = musicMix(); return Object.keys(m).sort((a, b) => m[b] - m[a])[0]; }
function tickMusic(dt) {
  if (!musicStarted) return;
  const mix = musicMix(), master = (musicOn && !document.hidden ? 0.34 : 0) * (vPlaying ? 0.5 : 1);
  Object.keys(mix).forEach((k) => ISLAND_KINDS.includes(k) && isleTrack(k));
  Object.keys(MUS).forEach((k) => {
    if (!MUS[k]) return;
    const target = (mix[k] || 0) * master;
    musVol[k] += (target - musVol[k]) * Math.min(1, dt * 1.6);
    MUS[k].volume = Math.max(0, Math.min(1, musVol[k]));
  });
}
/* hidden page: silence now, synchronously (the render loop that ramps volume is stopped while hidden) */
document.addEventListener('visibilitychange', () => {
  Object.keys(MUS).forEach((k) => { const a = MUS[k]; if (!a) return; if (document.hidden) { a.volume = 0; musVol[k] = 0; a.pause(); } else if (musicStarted) a.play().catch(() => {}); });
});
$('#go').addEventListener('click', startMusic);

/* ---------- the tally: Base x Mult, staged reveal (Balatro); rising pitch, fire past 2x target, speed dial ---------- */
let tallySpeed = 1;
try { tallySpeed = +localStorage.getItem('islandhop-speed') || 1; } catch (e) {}
const speedBtn = $('#tallySpeed'); if (speedBtn) { speedBtn.textContent = `${tallySpeed}x`; speedBtn.onclick = () => { tallySpeed = tallySpeed >= 4 ? 1 : tallySpeed * 2; speedBtn.textContent = `${tallySpeed}x`; try { localStorage.setItem('islandhop-speed', tallySpeed); } catch (e) {} }; }
function newScore() { return { base: 0, mult: 1, steps: [] }; }
function scoreBase(n, tag) { if (!game) return; game.sc = game.sc || newScore(); game.sc.base += n; game.sc.steps.push({ kind: 'base', n, tag }); }
function scoreMult(n, tag) { if (!game) return; game.sc = game.sc || newScore(); game.sc.mult += n; game.sc.steps.push({ kind: 'mult', n, tag }); }
const TARGET = { pier: 120, studio: 145, campus: 150, table: 120, arena: 400, court: 320, desert: 200, voxel: 150 };
/* personal bests per island: the tally says where you stand, not only pass or miss */
let BEST = {}; try { BEST = JSON.parse(localStorage.getItem('islandhop-best') || '{}') || {}; } catch (e) {}
function runTally(sc, target, title, bestKey, complete, priorIn) {
  return new Promise((resolve) => {
    const box = $('#tally'), list = $('#tallyList'), B = $('#tallyBase'), Mu = $('#tallyMult'), T = $('#tallyTotal'), tg = $('#tallyTarget');
    const prior = Number.isFinite(priorIn) ? priorIn : bestKey ? +BEST[bestKey] || 0 : 0; /* the best before this result, even if it was already saved */
    $('#tallyTitle').textContent = title; tg.textContent = complete ? `${complete}${prior ? ` · Your best ${prior.toLocaleString()}` : ''}` : `Target ${target.toLocaleString()}${prior ? ` · Your best ${prior.toLocaleString()}` : ''}`;
    list.innerHTML = ''; B.textContent = '0'; Mu.textContent = '1'; T.textContent = ''; box.classList.remove('fire', 'clear', 'miss', 'best'); box.hidden = false;
    /* group repeated tags so the reveal reads as causes, not a log */
    const groups = []; sc.steps.forEach((s) => { const g = groups.find((x) => x.tag === s.tag && x.kind === s.kind); if (g) { g.n += s.n; g.count++; } else groups.push({ ...s, count: 1 }); });
    let b = 0, m = 1, i = 0;
    const step = () => {
      if (i < groups.length) {
        const g = groups[i++];
        if (g.kind === 'base') b += g.n; else m += g.n;
        const li = document.createElement('li'); li.className = g.kind;
        li.innerHTML = `<span>${g.tag}${g.count > 1 ? ` ×${g.count}` : ''}</span><b>${g.kind === 'base' ? '+' + g.n : '+' + g.n + ' Mult'}</b>`;
        list.appendChild(li); B.textContent = b; Mu.textContent = m;
        (g.kind === 'base' ? B : Mu).classList.remove('bump'); void B.offsetWidth; (g.kind === 'base' ? B : Mu).classList.add('bump');
        chime(Math.min(10, i), 0.1, g.kind === 'mult' ? 'square' : 'triangle');
        setTimeout(step, 260 / tallySpeed);
      } else {
        const total = b * m; let shown = 0; const t0 = performance.now(), dur = 700 / tallySpeed;
        play('stamp', 0.6); trauma = Math.min(1, trauma + 0.35);
        const count = () => {
          const k = Math.min(1, (performance.now() - t0) / dur); shown = Math.round(total * (1 - Math.pow(1 - k, 3)));
          T.textContent = shown.toLocaleString();
          if (k < 1) requestAnimationFrame(count);
          else {
            const ok = complete ? true : total >= target; box.classList.add(ok ? 'clear' : 'miss'); /* a finished creation is never a miss */ if (total >= target * 2) box.classList.add('fire');
            if (bestKey && total > prior) { BEST[bestKey] = total; try { localStorage.setItem('islandhop-best', JSON.stringify(BEST)); } catch (e) {} if (prior > 0) { tg.textContent = `New best! ${total.toLocaleString()} beats ${prior.toLocaleString()}`; box.classList.add('best'); voice('new_best'); } }
            if (ok) { chime(12, 0.16); setTimeout(() => chime(14, 0.14), 90); } else play('whoosh', 0.4);
            setTimeout(() => { box.hidden = true; resolve({ total, ok }); }, 1300 / tallySpeed + 500);
          }
        };
        count();
      }
    };
    setTimeout(step, 200 / tallySpeed);
  });
}

/* ---------- the linked slice: Table (Astra's tabletop.mjs) → one souvenir → a Home construction that changes a route ---------- */
const SOUVENIRS = {
  reserve: { name: 'Footbridge Kit', art: 'art/cards/c3.webp', text: 'Place one bridge at Home. Open the marked crossing to Palm Springs; riding it refills heat.', build: 'bridge' },
  plank: { name: 'Launch Plank', art: 'art/cards/c7.webp', text: 'Place one launch pad at Home. Reach the upper approach, past the usual ceiling.', build: 'pad' }
};
let slot = null, builds = { bridge: 0, pad: false }, awarded = new Set(), pending = null, attemptSeq = 0;
/* one saved envelope: slot, builds, granted attempt ids and the earned-but-unchosen reward travel together (Astra P1) */
try {
  const s = JSON.parse(localStorage.getItem('islandhop-slice') || 'null');
  if (s && typeof s === 'object') {
    slot = SOUVENIRS[s.slot] ? s.slot : null; builds.bridge = Math.max(0, Math.min(6, +s.bridge || 0)); builds.pad = !!s.pad; builds.padSpot = [0, 1, 2].includes(s.padSpot) ? s.padSpot : 0;
    if (Array.isArray(s.awarded)) awarded = new Set(s.awarded.slice(-200));
    if (s.pending && typeof s.pending.id === 'string' && !awarded.has(s.pending.id)) {
      const f = s.pending.facts, okF = f && Number.isInteger(f.i) && f.i >= 0 && f.i < 8 && typeof f.kind === 'string';
      pending = { id: s.pending.id, payout: +s.pending.payout || 0, kind: String(s.pending.kind || ''), facts: okF ? { i: f.i, kind: f.kind, score: Math.max(0, +f.score || 0), star1: !!f.star1, star2: !!f.star2 } : null, chosen: SOUVENIRS[s.pending.chosen] ? s.pending.chosen : null, granted: !!s.pending.granted };
    }
    attemptSeq = Math.max(0, +s.seq || 0);
  }
  const old = JSON.parse(localStorage.getItem('islandhop-awards') || '[]'); if (Array.isArray(old)) old.forEach((id) => awarded.add(id)); /* migrate the 1b key */
} catch (e) {}
function saveSlice() { const ok = store('islandhop-slice', JSON.stringify({ v: 2, slot, bridge: builds.bridge, pad: builds.pad, padSpot: builds.padSpot || 0, awarded: [...awarded].slice(-200), pending, seq: attemptSeq })); if (ok) try { localStorage.removeItem('islandhop-awards'); } catch (e) {} return ok; }
/* a durable attempt id: persisted sequence plus a random nonce, never reset by a reload */
function newAttempt() { attemptSeq++; saveSlice(); return `table-${attemptSeq}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
let tableVisits = 0;
function paintSlot() {
  const el = $('#slot'); if (!el) return;
  if (slot) { el.innerHTML = `<img src="${SOUVENIRS[slot].art}" alt=""><span><b>${SOUVENIRS[slot].name}</b><small>build it at Home</small></span>`; el.hidden = false; }
  else el.hidden = true;
}

/* GGP: press your luck, rules and randomness owned by Astra's reducer; this adapter only renders and forwards */
function pressTable(isl) {
  tableVisits++;
  if (pending && !awarded.has(pending.id)) setTimeout(() => resumePending(), 400); /* offer the earlier reward before this attempt can bank */
  const runKey = newAttempt();
  let st = TT.createTable({ seed: 20261002, round: attemptSeq, runId: runKey });
  tableLive = { st, runKey };
  let held = [false, false, false], anim = [], busy = false;
  const dice = [0, 1, 2].map((k) => { const d = inked(new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), DIE_MATS)); d.castShadow = true; d.position.set(-1.6 + k * 1.6, 1.6, 0); d.userData.tap = true; d.userData.k = k; gameRoot.add(d); return d; });
  const ring = dice.map((d) => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.07, 8, 32), toon(0xffd23f, { emissive: 0xffb000, emissiveIntensity: 1.2 })); r.rotation.x = Math.PI / 2; r.position.set(d.position.x, 0.95, 0); r.visible = false; gameRoot.add(r); return r; });
  const orient = (d, v, spin) => { const e = UP[v]; const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2])); q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (d.userData.k - 1) * 0.35)); if (!spin) d.quaternion.copy(q); return q; };
  st.dice.forEach((v, k) => orient(dice[k], v));
  showBanner('Press your luck', '', 0);
  const pct = (n, d) => `${Math.round((n / d) * 100)}%`;
  function render() {
    if (tableLive) tableLive.st = st; const p = TT.bankPreview(st), html = [];
    const line = st.threshold ? `Pressed. Beat ${st.threshold} or it pays 0. ` : '';
    let odds = '';
    if (p.payout > 0) {
      html.push(`<button type="button" data-a="BANK">Bank ${p.payout}</button>`);
      if (p.canPress && held.some((h) => !h)) {
        const pr = TT.previewReroll(st, { type: 'PRESS', held });
        if (pr) { const win = pr.total - (pr.outcomes[0] || 0); odds = `Next roll only: ${pct(win, pr.total)} to beat ${pr.requiredAbove}.`; html.push(`<button type="button" data-a="PRESS">Press: risk ${p.payout}</button>`); }
      }
    } else if (st.rerolls > 0 && held.some((h) => !h)) {
      const pr = TT.previewReroll(st, { type: 'ROLL', held });
      if (pr) { const win = pr.total - (pr.outcomes[0] || 0); odds = `Next roll only: ${pct(win, pr.total)} to score.`; }
      html.push(`<button type="button" data-a="ROLL">Roll</button>`);
      if (st.threshold) html.push(`<button type="button" data-a="BANK">Walk away</button>`);
    } else html.push(`<button type="button" data-a="BANK">${p.payout ? 'Bank ' + p.payout : 'Walk away'}</button>`);
    hud.bText.textContent = `${line}${p.kind === 'none' ? 'No hand yet' : p.kind[0].toUpperCase() + p.kind.slice(1)} · ${st.rerolls} reroll${st.rerolls === 1 ? '' : 's'} left · tap a die to hold it. ${odds}`;
    hud.choices.hidden = false; hud.choices.innerHTML = html.join('');
    ring.forEach((r, k) => (r.visible = held[k]));
  }
  hud.choices.onclick = (e) => {
    const a = e.target.dataset && e.target.dataset.a; if (!a || busy) return;
    if (a === 'BANK' && pending && !awarded.has(pending.id)) { resumePending(); return; } /* never overwrite an earned, unchosen reward */
    const rev = st.revision, prev = st;
    const next = TT.reduceTable(st, a === 'BANK' ? { type: 'BANK', runId: st.runId, revision: rev } : { type: a, runId: st.runId, revision: rev, held: [...held] });
    if (next === st) return;
    st = next; if (tableLive) tableLive.st = st;
    if (a !== 'BANK') {
      busy = true; play('dice', 0.8);
      anim = dice.map((d, k) => held[k] ? null : { d, q: orient(d, st.dice[k], true), spin: new THREE.Vector3(Math.random() * 20 - 10, Math.random() * 20 - 10, Math.random() * 20 - 10), t: 0 }).filter(Boolean);
      later(() => { busy = false; render(); }, 1250);
      hud.choices.innerHTML = '';
    } else if (prev.phase === 'choosing' && st.phase === 'banked') {
      const rewardId = runKey;
      hud.choices.hidden = true; hud.choices.onclick = null;
      if (st.banked > 0 && !awarded.has(rewardId) && !(pending && pending.id === rewardId)) {
        pending = { id: rewardId, payout: st.banked, kind: TT.evaluateDice(st.dice).kind, facts: completionFacts(isl, st.banked) }; saveSlice();
        { const kn = pending.kind[0].toUpperCase() + pending.kind.slice(1); jResult = { scope: rewardId, value: st.banked, label: 'Table points', target: null, explanation: `${kn} banked`, retained: 'Table points are this result. Stamps and builds save separately.' }; journeyEvent(`${kn} banked. Choose what it becomes.`, rewardId, st.banked); }
        tableLive = null; /* earned, not yet chosen: survives a reload */
        scoreBase(st.banked, 'Banked ' + TT.evaluateDice(st.dice).kind); game.rawTally = true; voice('bank');
        game.draft = true; later(winGame, 300);
      } else { tableLive = null; journeyEvent('Walked away. The table is always open for another go.'); floatText(gameRoot.position.clone().add(new THREE.Vector3(0, 4, 0)), 'Walked away'); later(() => failGame(), 900); }
    }
  };
  render();
  return {
    tick(t, dt) {
      anim.forEach((a) => { a.t += dt; const k = Math.min(1, a.t / 1.1);
        if (k < 1) { a.d.position.y = 1.6 + Math.sin(k * Math.PI) * 2.4 * (1 - k * 0.5); a.d.rotation.x += a.spin.x * dt * (1 - k); a.d.rotation.y += a.spin.y * dt * (1 - k); a.d.rotation.z += a.spin.z * dt * (1 - k); }
        if (k > 0.75) a.d.quaternion.slerp(a.q, Math.min(1, (k - 0.75) * 4 + dt * 6)); if (k >= 1) { a.d.position.y = 1.6; a.d.quaternion.copy(a.q); } });
      ring.forEach((r) => (r.rotation.z = t * 2));
    },
    tap(o) { if (busy || !o || !o.userData || o.userData.k === undefined) return; const k = o.userData.k, h = [...held]; h[k] = !h[k]; if (h.every(Boolean)) return; held = h; play('pop', 0.4); render(); },
    tapAnywhere: null, untimed: true, /* a decision, not a reflex test */
    cancel() { tableLive = null; st = TT.reduceTable(st, { type: 'CANCEL', runId: st.runId, revision: st.revision }); }
  };
}
GAMES.table = (isl) => pressTable(isl);
/* an earned reward interrupted by a reload or a leave is offered again before anything else */
function finalizePending() {
  if (!pending) return true;
  const r = pending.facts ? completeIsland(pending.facts) : { ok: true };
  if (pending.chosen && !pending.granted) { slot = pending.chosen; pending.granted = true; } /* the card is handed over once; a consumed kit stays consumed */
  if (r.ok) { awarded.add(pending.id); pending = null; }
  saveSlice(); paintSlot(); return !pending;
}
function resumePending() {
  if (!pending || !$('#draft').hidden) return;
  if (awarded.has(pending.id)) { pending = null; saveSlice(); return; }
  if (pending.chosen) finalizePending(); /* the card was already chosen: retry the writes, never a second card */
  else offerDraft(true);
}
$('#go').addEventListener('click', () => setTimeout(resumePending, 900));
window.__hop.slice = () => ({ slot, builds: { ...builds }, pending, seq: attemptSeq, awarded: awarded.size });
LIMIT.table = 90;

/* souvenir draft: one slot in this slice */
function offerDraft(resumed) {
  if (!pending || pending.chosen) return Promise.resolve(null);
  return new Promise((resolve) => {
    const box = $('#draft'), list = $('#draftCards');
    list.innerHTML = Object.entries(SOUVENIRS).map(([id, s]) => `<button type="button" class="dcard" data-id="${id}"><img src="${s.art}" alt=""><b>${s.name}</b><small>${s.text}</small></button>`).join('');
    $('#draftNote').textContent = (resumed ? `You banked ${pending.payout} last visit. ` : '') + (slot ? `Your slot holds ${SOUVENIRS[slot].name}. Picking a new card replaces it.` : 'One slot. Choose what this win becomes.');
    box.hidden = false;
    list.onclick = (e) => {
      const b = e.target.closest('.dcard'); if (!b) return; const id = b.dataset.id;
      box.hidden = true; list.onclick = null;
      if (!pending || awarded.has(pending.id) || pending.chosen) { if (pending && awarded.has(pending.id)) pending = null; saveSlice(); return resolve(null); } /* never grant twice */
      slot = id; pending.chosen = id; finalizePending(); /* stamp, stars and best first; the record clears only when every write lands */
      floatText(player.pos.clone().add(new THREE.Vector3(0, 3, 0)), `${SOUVENIRS[id].name} equipped`); journeyEvent(`${SOUVENIRS[id].name} in your pack. Build it at Home.`);
      chime(9, 0.15); save(); paintSlot(); resolve(id);
    };
  });
}

/* Home: place the piece (preview, undo, build); otherwise the chest */
const SPOTS = [[2.4, 0.4, 2.2], [-2.6, 0.4, 1.4], [0.4, 0.4, -2.6]];
function surfaceAt(isl, spot) {
  const a = anchor(isl), off = new THREE.Vector3(...spot).applyQuaternion(isl.g.quaternion);
  const from = a.clone().add(off).add(new THREE.Vector3(0, 14, 0)); const rc = new THREE.Raycaster(from, new THREE.Vector3(0, -1, 0));
  const hit = rc.intersectObject(isl.g, true)[0]; const y = hit ? hit.point.y : a.y;
  return new THREE.Vector3(a.x + off.x, y, a.z + off.z);
}
function homeBuild(isl) {
  if (!slot || !SOUVENIRS[slot]) return chestGame(isl);
  const kind = SOUVENIRS[slot].build; let spot = 0;
  const ghost = kind === 'pad' ? (() => { const g = new THREE.Group(); const b = M(new THREE.CylinderGeometry(1, 1.2, 0.35, 20), 0xffb703); const top = M(new THREE.CylinderGeometry(0.75, 0.75, 0.1, 20), 0xff4d6d, { emissive: 0xff4d6d, emissiveIntensity: 0.6 }); top.position.y = 0.25; g.add(b, top); return g; })()
    : (() => { const g = new THREE.Group(); for (let k = 0; k < 3; k++) { const p = M(new THREE.BoxGeometry(0.9, 0.12, 0.5), 0xc68642); p.position.set(0, 0, k * 0.6); g.add(p); } return g; })();
  ghost.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; } });
  gameRoot.add(ghost);
  const place = () => { const w = surfaceAt(isl, SPOTS[spot]); ghost.position.copy(w.sub(gameRoot.position)).add(new THREE.Vector3(0, 0.15, 0)); ghost.userData.y = ghost.position.y; };
  place();
  showBanner(kind === 'pad' ? 'Place the launch pad' : 'Lay the bridge planks', 'Preview a spot, undo if you change your mind, then build. It stays here.', 0);
  hud.choices.hidden = false;
  hud.choices.innerHTML = '<button type="button" data-a="next">Try next spot</button><button type="button" data-a="undo">Undo, keep the card</button><button type="button" data-a="build">Build it</button>';
  hud.choices.onclick = (e) => {
    const a = e.target.dataset && e.target.dataset.a; if (!a) return;
    if (a === 'next') { spot = (spot + 1) % SPOTS.length; place(); play('pop', 0.3); }
    if (a === 'undo') { hud.choices.onclick = null; leaveGame(); }
    if (a === 'build') {
      hud.choices.onclick = null; hud.choices.hidden = true;
      if (kind === 'pad') { builds.pad = true; builds.padSpot = spot; } else builds.bridge = 3;
      journeyEvent(kind === 'pad' ? 'Launch pad built. Ride it up past the old ceiling.' : 'Footbridge laid. Fly the planks to Palm Springs.'); slot = null; saveSlice(); paintSlot(); applyBuilds(); scoreBase(120, kind === 'pad' ? 'Launch pad built' : 'Bridge planks laid'); commitCompletion(isl); /* Home stamp, stars and best are durable at Build */
      burst(ghost.getWorldPosition(new THREE.Vector3()), 80, 7, 8); voice('build_done'); later(winGame, 500);
    }
  };
  const arrow = M(new THREE.ConeGeometry(0.35, 0.7, 4), 0xffd23f, { emissive: 0xffb000, emissiveIntensity: 1 }); arrow.rotation.x = Math.PI; gameRoot.add(arrow);
  return { untimed: true, tick(t) { ghost.position.y = ghost.userData.y + Math.abs(Math.sin(t * 3)) * 0.15; arrow.position.copy(ghost.position).add(new THREE.Vector3(0, 1.6 + Math.sin(t * 4) * 0.2, 0)); arrow.rotation.y = t * 2; }, tap() {}, tapAnywhere: null };
}
GAMES.voxel = (isl) => homeBuild(isl);
const homeIdx = () => islands.findIndex((x) => x.kind === 'voxel');

/* persistent structures and the routes they open */
const buildRoot = new THREE.Group(); scene.add(buildRoot);
let padDraft = null, bridgeLine = null;
function applyBuilds() {
  buildRoot.clear(); padDraft = null; bridgeLine = null;
  const hi = homeIdx(); if (hi < 0) return; const home = islands[hi];
  if (builds.pad) {
    const g = new THREE.Group(); const b = M(new THREE.CylinderGeometry(1, 1.2, 0.35, 20), 0xffb703); const top = M(new THREE.CylinderGeometry(0.75, 0.75, 0.1, 20), 0xff4d6d, { emissive: 0xff4d6d, emissiveIntensity: 0.8 }); top.position.y = 0.25; g.add(b, top);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 30, 24, 1, true), draftMat); col.position.y = 15; g.add(col);
    g.userData.spot = SPOTS[builds.padSpot || 0]; buildRoot.add(g); padDraft = g;
  }
  if (builds.bridge > 0) {
    const ps = islands.findIndex((x) => x.kind === 'desert'); if (ps >= 0) {
      const g = new THREE.Group(); g.userData = { n: builds.bridge, to: ps }; buildRoot.add(g); bridgeLine = g;
      for (let k = 0; k < 12; k++) { const p = M(new THREE.BoxGeometry(1.4, 0.14, 0.8), k < builds.bridge * 2 ? 0xc68642 : 0x9a8f86); p.castShadow = false; p.material = p.material.clone(); if (k >= builds.bridge * 2) { p.material.transparent = true; p.material.opacity = 0.25; } g.add(p); }
    }
  }
}
const VIEW_KEEP = { custom: true, id: 'view', at: 'sky', pos: null, title: 'The view from the top', text: 'From up here every island is one flight away. All roads lead home, and you built this one.', make: () => { const g = new THREE.Group(); const s = new THREE.Mesh(STAR, toon(0xffd23f, { emissive: 0xffc400, emissiveIntensity: 1.4 })); s.scale.setScalar(1.3); g.add(s); return g; } };
KEEP.push(VIEW_KEEP);
function tickBuilds(t, dt) {
  buildRoot.visible = !circuitOn;
  const hi = homeIdx(); if (hi < 0 || circuitOn) { if (VIEW_KEEP.g) VIEW_KEEP.g.visible = false; return; } const ha = anchor(islands[hi]);
  if (padDraft) {
    if (padDraft.userData.yOff === undefined) padDraft.userData.yOff = surfaceAt(islands[hi], padDraft.userData.spot).y - ha.y;
    padDraft.position.copy(ha).add(new THREE.Vector3(...padDraft.userData.spot).applyQuaternion(islands[hi].g.quaternion)); padDraft.position.y = ha.y + padDraft.userData.yOff;
    const hx = Math.hypot(player.pos.x - padDraft.position.x, player.pos.z - padDraft.position.z);
    if (player.mode === 'fly' && hx < 1.8 && player.pos.y > ha.y - 1 && player.pos.y < ha.y + 32) { player.vel.y += dt * 26; player.heat = Math.min(3, player.heat + dt * 2); }
  }
  /* the high keepsake only shows once the pad exists: a route the build made reachable */
  if (VIEW_KEEP.g && padDraft && player.mode === 'fly' && player.pos.distanceTo(VIEW_KEEP.g.position) < 2.6 && !(VIEW_KEEP.lastT > t - 3)) { VIEW_KEEP.lastT = t; findKeepsake('view'); }
  if (VIEW_KEEP.g) { VIEW_KEEP.g.visible = !!padDraft; VIEW_KEEP.g.position.copy(ha).add(new THREE.Vector3(0, 33 + Math.sin(t) * 0.4, 0)); VIEW_KEEP.g.rotation.y = t; }
  if (bridgeLine) {
    const b = anchor(islands[bridgeLine.userData.to]);
    bridgeLine.children.forEach((p, k) => { const f = (k + 0.5) / bridgeLine.children.length; p.position.copy(ha).lerp(b, f); p.position.y += 2 + Math.sin(f * Math.PI) * 3; p.lookAt(b.x, p.position.y, b.z); });
    const solid = bridgeLine.userData.n * 2;
    bridgeLine.children.slice(0, solid).forEach((p) => { if (player.mode === 'fly' && player.pos.distanceTo(p.position) < 1.6) { player.heat = Math.min(3, player.heat + dt * 3); player.vel.addScaledVector(new THREE.Vector3().subVectors(b, ha).setY(0).normalize(), dt * 10); } });
  }
}

function ceilingAt() {
  const hi = homeIdx(); if (!padDraft || hi < 0 || circuitOn) return 30;
  return Math.hypot(player.pos.x - padDraft.position.x, player.pos.z - padDraft.position.z) < 7 ? 44 : 30;
}

window.__hop.padPos = () => padDraft ? padDraft.position.clone() : null;

window.__hop.buildsVisible = () => buildRoot.visible;

/* ---------- voice: Astra's LINES.json (d492efe8), sparse reactions to confirmed events, never narration ----------
   higher priority wins events in the same beat; 10 s global spacing plus each cue's cooldown; one voice, no backlog;
   a cue may play over the result card it belongs to (owner), any other overlay cancels it */
let voiceOn = true, storyVoice = false, vPlaying = null, vLast = -99, vPend = null, vTimer = 0;
try { const v = JSON.parse(localStorage.getItem('islandhop-voice') || 'null'); if (v) { voiceOn = v.on !== false; storyVoice = !!v.story; } } catch (e) {}
const LINES = {
  land_bull: { id: 'landing_clean', priority: 1, cooldown: 45 },
  bank: { id: 'table_banked', priority: 2, cooldown: 20, owner: '#tally' },
  new_best: { id: 'personal_best', priority: 3, cooldown: 40, owner: '#tally' },
  build_done: { id: 'construction_done', priority: 4, cooldown: 30, owner: '#tally' },
  keepsake_found: { id: 'discovery', priority: 3, cooldown: 30 },
  circuit_end: { id: 'circuit_finished', priority: 4, cooldown: 60, owner: '#circuitEnd' },
  finale: { id: 'all_islands', priority: 5, cooldown: 120 }
};
['vo0', 'vo1', 'vo2', 'vo3', 'vo4', 'vo8', 'vo5', 'vo6'].forEach((f, i) => (LINES['story' + i] = { src: `audio/${f}.mp3`, priority: 0, cooldown: 0, story: true }));
const cueLast = {};
function voiceCancel() { clearTimeout(vTimer); vPend = null; if (vPlaying) { try { vPlaying.pause(); } catch (e) {} vPlaying = null; } }
/* a cue may speak over its own result card only while nothing else blocks the screen */
function otherBlocking(owner) { return !started || ['#start', '#circuitEnd', '#tally', '#draft'].some((s) => s !== owner && $(s) && !$(s).hidden) || $('#seenText').classList.contains('open') || document.documentElement.classList.contains('reading'); }
/* the paused loop calls this: keep a cue that is speaking over its own result card */
function voiceOverlayCheck() { if (vPlaying && !(vPlaying.owner && $(vPlaying.owner) && !$(vPlaying.owner).hidden && !otherBlocking(vPlaying.owner))) voiceCancel(); }
function voiceEligible(ev, now) {
  const L = LINES[ev]; if (!L || !voiceOn || !audioPref.sound || document.hidden) return false; /* Voice is its own preference under the master Sound switch */
  if (L.story && !storyVoice) return false;
  if (vPlaying || now - vLast < 10 || now - (cueLast[ev] ?? -1e9) < L.cooldown) return false;
  if (game && !game.won && game.isl && (game.isl.kind === 'arena' || game.isl.kind === 'court')) return false; /* never over timing windows */
  return true;
}
function voice(ev) {
  if (!LINES[ev]) return;
  /* gather events from the same beat, then speak only the highest priority one */
  if (vPend) { if (LINES[ev].priority > LINES[vPend].priority) vPend = ev; return; }
  vPend = ev;
  vTimer = setTimeout(() => {
    const e = vPend; vPend = null; if (!e) return; const now = performance.now() / 1000; if (!voiceEligible(e, now)) return;
    const L = LINES[e]; if (overlayOpen() && !(L.owner && !$(L.owner).hidden && !otherBlocking(L.owner))) return;
    const a = new Audio(L.src || `audio/voice3/${L.id}.mp3`); a.volume = 1; a.owner = L.owner; vPlaying = a; vLast = now; cueLast[e] = now;
    a.onended = a.onerror = () => { if (vPlaying === a) vPlaying = null; };
    a.play().catch(() => { if (vPlaying === a) vPlaying = null; });
  }, 120);
}
function paintVoice() {
  const v = $('#voiceBtn'), s = $('#storyBtn');
  if (v) { v.textContent = voiceOn ? 'Voice on' : 'Voice off'; v.setAttribute('aria-pressed', voiceOn); }
  if (s) { s.textContent = storyVoice ? 'Story voice on' : 'Story voice off'; s.setAttribute('aria-pressed', storyVoice); }
  try { localStorage.setItem('islandhop-voice', JSON.stringify({ on: voiceOn, story: storyVoice })); } catch (e) {}
}
if ($('#voiceBtn')) $('#voiceBtn').onclick = () => { voiceOn = !voiceOn; if (!voiceOn) voiceCancel(); paintVoice(); }; /* cancels the current and the queued cue */
if ($('#storyBtn')) $('#storyBtn').onclick = () => { storyVoice = !storyVoice; paintVoice(); };
paintVoice();
document.addEventListener('visibilitychange', () => { if (document.hidden) voiceCancel(); });
window.__hop.voiceLog = () => ({ playing: vPlaying ? vPlaying.src : null, cueLast: { ...cueLast } });

/* ---------- journey: Astra's feedback presenter (feedback.mjs 4257f90f) fed a read-only snapshot of confirmed state, 4 Hz ----------
   contract: SNAPSHOT-EXAMPLE.json f9ae16f0; score.scope must equal lastEvent.scope for a delta to show */
VERB.table = ['ROLL!', 'bank a pair or better'];
let jEvent = null, jResult = null, jSeq = 0, tableLive = null;
function journeyEvent(cause, scope, delta) { jEvent = { id: `ev-${++jSeq}-${Date.now().toString(36)}`, scope: scope || null, delta: Number.isFinite(delta) ? delta : null, cause }; }
const label = (i) => (chapters[i] ? chapters[i].dataset.label : 'the next island');
const journeyRoot = $('#journey'), journey = journeyRoot ? mountFeedback(journeyRoot) : null;
function journeyGoal() {
  const done = progress.filter((p) => p.done).length, base = { done, total: progress.length, unit: 'stamps' };
  if (circuitOn) return { title: 'Joy Circuit', next: 'Fly through rings and land on pads before the clock runs out.' };
  if (game && game.isl) {
    const k = game.isl.kind, name = label(game.isl.i);
    if (game.depthToy && game.snapshot && !game.won) {
      const pv = (game.snapshot() || {}).preview || {};
      const prog = pv.required ? { done: pv.visited || 0, total: pv.required, unit: 'stops' } : pv.total ? { done: pv.met || 0, total: pv.total, unit: 'criteria met' } : base;
      return { ...prog, title: `${name}: ${pv.title || 'make it yours'}`, next: pv.feedback || pv.goal || pv.hint || 'Plan it, then finish when it feels right.' };
    }
    if (k === 'table') return { ...base, title: `${name}: win a building card`, next: 'Bank a pair or better. Press to risk it for more.' };
    if (k === 'voxel' && slot) return { ...base, title: `Build your ${SOUVENIRS[slot].name}`, next: 'Try a spot, then Build it. It stays and opens a new route.' };
    const v = VERB[k] || ['PLAY!', ''];
    return { ...base, title: `${name}: ${v[0].replace('!', '').toLowerCase()} ${v[1]}`.trim(), next: game.won ? 'Nice. Counting it up.' : 'Clear the goal to earn this island’s stamp.' };
  }
  if (slot) return { ...base, title: `Take your ${SOUVENIRS[slot].name} home`, next: `Fly to ${label(homeIdx())} and land to build it.` };
  if (player.target && islands[player.target.island] && player.auto) return { ...base, title: `Flying to ${label(player.target.island)}`, next: 'Sit back, or tap another island to change course.' };
  if (near >= 0) return { ...base, title: `Land on ${label(near)}`, next: islands[near].done ? 'Land to reread it, then Play again for stars you missed.' : 'Press Land and play.' };
  if (done === progress.length) return { ...base, title: 'Every island stamped', next: 'Follow the golden rings for the Long Walk Home.' };
  const nx = progress.findIndex((p) => !p.done);
  return { ...base, title: `Next stop: ${label(nx)}`, next: 'Burn to climb, steer toward it, then land.' };
}
function journeyScore() {
  if (circuitOn) return { scope: 'circuit', value: +($('#cScore').textContent || '0').replace(/\D/g, '') || 0, label: 'Circuit points', target: null, explanation: 'Rings, pads and chains', retained: 'Circuit points reset each run. Your best run is saved.' };
  if (game && game.isl && game.isl.kind === 'table' && tableLive) return null;
  if (game && game.depthToy && !game.won) return null; /* planning points are a preview, not earned */ /* risk shows instead; nothing is earned yet */
  if (game && game.isl && game.sc && !game.won) {
    const k = game.isl.kind;
    return { scope: game.scope, value: game.sc.base * game.sc.mult, label: `${label(game.isl.i)} points`, target: relaxed ? null : TARGET[k] || null, explanation: `${game.sc.base} × ${game.sc.mult}`, retained: 'Island points are this round. Stamps, stars and your best save.' };
  }
  return jResult;
}
function journeySnapshot() {
  const stars = progress.reduce((a, p) => a + p.stars.filter(Boolean).length, 0);
  const risk = tableLive && tableLive.st.phase === 'choosing' ? { bankable: TT.bankPreview(tableLive.st).payout, requiredAbove: tableLive.st.threshold || 0 } : null;
  const upgrades = [];
  if (builds.pad) upgrades.push({ name: 'Launch pad at Home', effect: 'Ride the updraft past the usual ceiling. Something waits at the top.', confirmed: true });
  if (builds.bridge > 0) upgrades.push({ name: 'Footbridge to Palm Springs', effect: 'Fly along the planks to refill your burner.', confirmed: true });
  return {
    mode: circuitOn ? 'circuit' : 'explore', paused: started && overlayOpen(), goal: journeyGoal(), score: journeyScore(), risk,
    equipment: slot ? { name: SOUVENIRS[slot].name, next: 'build it at Home' } : null, upgrades,
    mastery: [{ label: 'stars', done: stars, total: progress.length * 3 }, { label: 'keepsakes', done: found.size, total: KEEP.length }],
    lastEvent: jEvent, saveStatus: saveFails.size || (pending && pending.chosen) ? 'failed' : saveAny ? 'saved' : null
  };
}
let jLast = 0;
function tickJourney(now) {
  if (!journey || now - jLast < 250) return; jLast = now;
  journeyRoot.hidden = !started;
  if (started) journey.update(journeySnapshot());
}
window.__hop.journey = () => journeySnapshot();
window.__hop.music = () => Object.fromEntries(Object.entries(MUS).filter(([, a]) => a).map(([k, a]) => [k, { vol: +a.volume.toFixed(2), playing: !a.paused }]));

/* ---------- island depth (Astra's phase3-adapter.js on routes.mjs and composition.mjs): SF plans a festival route,
   Blizzard plans a studio tour, Teaching composes animation timing; the engine owns tally, completion and saves ---------- */
let playT = 0;
let DEPTH = {}; try { DEPTH = JSON.parse(localStorage.getItem('islandhop-depth') || '{}') || {}; } catch (e) {}
function saveDepth(kind, rec) { if (!rec || rec.version !== 1) return; DEPTH[kind] = rec; store('islandhop-depth', JSON.stringify(DEPTH)); }
const reducedMotion = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })(); /* seconds of active play: the loop adds dt, which is 0 while any overlay pauses */
function depthBridge(isl) {
  return {
    THREE, root: gameRoot, seed: 20261002 + isl.i, runId: newAttempt(), previous: DEPTH[isl.kind] || null, reducedMotion, /* durable attempt id; previous restores your last route or timing, never credit */
    mat: (c, o = {}) => toon(c, o),
    text: (pos, s) => floatText(pos, s), burst: (p, n, s, z) => burst(p, n, s, z), chime: (n, v) => chime(n, v), sfx: (n, v) => play(n, v),
    banner: (t, x, m) => showBanner(t, x || '', m || 0), meter: (k) => setMeter(k),
    choices: (html, onClick) => { hud.choices.hidden = !html; hud.choices.innerHTML = html || ''; hud.choices.onclick = html ? onClick : null; },
    info: (s) => { hud.bText.textContent = s; },
    scoreBase: (n, tag) => scoreBase(n, tag), scoreMult: (n, tag) => scoreMult(n, tag),
    win: () => {
      if (!game || game.won || game.depthFacts) return;
      const f = completionFacts(isl, (game.result && game.result.total) || 0);
      game.priorBest = +BEST[isl.kind] || 0; game.depthFacts = f; game.freshComplete = completeIsland(f, false).fresh; saveDepth(isl.kind, game.result); /* durable before the tally */
      later(winGame, 500);
    }, fail: () => failGame(),
    later: (fn, ms) => later(fn, ms), event: (cause) => journeyEvent(cause), voice: (e) => voice(e),
    clock: () => playT
  };
}
['pier', 'studio', 'campus'].forEach((k) => { GAMES[k] = (isl) => createIslandToy(k, depthBridge(isl)); });
VERB.pier = ['PLAN!', 'your festival afternoon']; VERB.studio = ['EXPLORE!', 'make room for discovery']; VERB.campus = ['ANIMATE!', 'give it your timing'];
/* a hidden page pauses the toy now, even though the render loop stops */
document.addEventListener('visibilitychange', () => { if (game && game.setPaused) game.setPaused(document.hidden || overlayOpen()); });
applyAudio(false); /* restore saved Sound, Music and Effects preferences once every module is defined */

/* ---------- Phase 2: Bass on the music's own clock, Dodgeball risk and reward, Palm Springs rainbow chain (FEEL.md, ISLAND-REDESIGN.md) ---------- */

/* the clock is the audio: beat = 60/BPM; 150 BPM half-time pulse = 0.8 s, double time = 0.4 s (Itooh: never a custom timer) */
function musicClock() { return playT; } /* Astra P2: one continuous active-play clock; the pink ring is the beat, the music is not claimed to be in sync */
function bassGame(isl) {
  const target = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.12, 12, 48), toon(0x45e0ff, { emissive: 0x45e0ff, emissiveIntensity: 1.6 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.09, 12, 48), toon(0xff4fd8, { emissive: 0xff4fd8, emissiveIntensity: 2 }));
  [target, ring].forEach((m) => { m.position.set(0, 4.5, 0); gameRoot.add(m); });
  const lasers = new THREE.Group(); lasers.position.set(0, 1, 0); gameRoot.add(lasers);
  for (let i = 0; i < 12; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 30, 6), new THREE.MeshBasicMaterial({ color: PAL[i % PAL.length], transparent: true, opacity: 0 })); b.geometry.translate(0, 15, 0); b.rotation.set(0.3 + Math.random() * 0.5, 0, (i - 5.5) * 0.16); lasers.add(b); }
  const GOAL = 6, t0 = playT;
  let hits = 0, chain = 0, flash = 0, lastBeat = -1, beat = 0.8;
  const now = () => musicClock() - t0;
  showBanner('Drop the bass', `Tap on the beat when the pink ring meets the blue. ${GOAL} drops; the last three go double time.`, GOAL);
  const hit = () => {
    if (hits >= GOAL) return;
    const t = now(), idx = Math.round(t / beat); if (idx === lastBeat) return;
    const off = Math.abs(t - idx * beat), where = ring.getWorldPosition(new THREE.Vector3());
    if (off <= 0.08) {
      lastBeat = idx; hits++; chain++; setMeter(hits); flash = 1; freeze = 0.05;
      scoreBase(45, 'On the beat');
      if (off <= 0.04) { scoreMult(1, 'Perfect drop'); floatText(where, chain > 2 ? `PERFECT x${chain}` : 'PERFECT'); chime(5 + Math.min(6, chain), 0.15); }
      else { floatText(where, 'Good'); chime(3 + Math.min(6, chain), 0.12); }
      scoreBase(20, 'Drop'); play('pop', 0.5); burst(where, 40 + chain * 6, 9, 6); trauma = Math.min(1, trauma + 0.2);
      if (hits === 3) { beat = 0.4; lastBeat = Math.round(now() / beat); verbCard('DOUBLE TIME', 'stay with it'); }
      if (hits >= GOAL) later(winGame, 500);
    } else { chain = 0; flash = Math.max(flash, 0.25); } /* Hi-Fi Rush: the action still plays, no MISS text */
  };
  return {
    tick(tt, dt) {
      const t = now(), ph = ((t % beat) + beat) % beat / beat;
      ring.scale.setScalar(1 + (1 - ph) * 2.2); ring.rotation.z = t; target.rotation.z = -t * 0.5;
      target.scale.setScalar(1 + Math.max(0, 0.12 - Math.min(ph, 1 - ph)) * 1.5);
      flash = Math.max(0, flash - dt * 1.6);
      lasers.children.forEach((b, j) => { b.material.opacity = 0.12 + flash * 0.8 + (chain > 2 ? 0.15 : 0); b.rotation.z = (j - 5.5) * 0.16 + Math.sin(t * 3 + j) * 0.3 * (0.3 + flash); });
      bloom.strength = baseBloom + flash * 0.9;
    },
    tap: hit, tapAnywhere: hit, beatInfo: () => ({ t: now(), beat, hits })
  };
}
GAMES.arena = (isl) => bassGame(isl);
LIMIT.arena = 40;

/* Palm Springs: pop in rainbow order for a chain; a wrong color only breaks the chain (no fail) */
const RAIN = [0xe8413c, 0xf39a2b, 0xf7d23e, 0x4caf50, 0x3b7fd9, 0x8a4fc6], RAIN_N = ['red', 'orange', 'yellow', 'green', 'blue', 'violet'];
function rainbowGame(isl) {
  const items = []; let year = 48, next = 0, chain = 0, done = false;
  for (let k = 0; k < 12; k++) {
    const ci = (k * 5) % 6, m = balloonMesh(0); m.children[0].material = toon(RAIN[ci], { emissive: RAIN[ci], emissiveIntensity: 0.2 }); m.children[1].material = toon(RAIN[ci]);
    m.userData = { a: k / 12, ci, x: Math.cos(k * 2.4) * 3, z: Math.sin(k * 2.4) * 3, tap: true }; gameRoot.add(m); items.push(m);
  }
  showBanner('Pop your way to 56', '', 8);
  const paint = () => { hud.bText.textContent = `Every balloon is a year (${year}). Pop them in rainbow order for a chain: next is ${RAIN_N[next]}.${chain > 1 ? ` Chain x${chain}.` : ''}`; };
  paint();
  return {
    tick(t) { items.forEach((m) => { if (!m.visible) return; m.position.set(m.userData.x, 1.5 + ((t * 0.32 + m.userData.a) % 1) * 4.8, m.userData.z); m.rotation.z = Math.sin(t * 2 + m.userData.a * 6) * 0.15; }); },
    tap(obj) {
      if (done) return; /* the result is frozen at the eighth pop */
      const m = items.find((x) => x === obj || x.getObjectById(obj.id)); if (!m || !m.visible) return;
      m.visible = false; year++; setMeter(year - 48); freeze = 0.04;
      const w = m.getWorldPosition(new THREE.Vector3()); burst(w, 26, 5, 4);
      if (m.userData.ci === next) { chain++; next = (next + 1) % 6; scoreBase(20, 'Year'); if (chain > 1) scoreMult(1, 'Rainbow chain'); chime(Math.min(10, 2 + chain), 0.13); floatText(w, `${year}${chain > 2 ? ` · x${chain}` : ''}`); }
      else { chain = 0; scoreBase(10, 'Year'); play('pop', 0.6); floatText(w, `${year}`); }
      if (year === 56) { done = true; later(winGame, 400); floatText(gameRoot.position.clone().add(new THREE.Vector3(0, 5, 0)), 'FIFTY-SIX'); }
      paint();
    }
  };
}
GAMES.desert = (isl) => rainbowGame(isl);

window.__hop.musicClock = () => musicClock(); window.__hop.screenOf = (o) => { const v = o.getWorldPosition(new THREE.Vector3()).project(camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }; window.__hop.root = gameRoot;
