export const PILOT_KEY = 'islandhop-pilots-v1';
export const THEMES = Object.freeze({
  afterglow: {name:'Hill Country Afterglow', short:'Afterglow', colors:['#174d3b','#ef762d','#f2ce78'], ink:'#11352c', story:'Forest green, an orange sun, and the warmth after a good set.', sound:'Warm plucks · a small sunset fanfare', notes:[57,64,69,76], type:'triangle', pace:.15, badge:'sun'},
  bassline: {name:'Bassline Bloom', short:'Bassline', colors:['#263061','#ef6998','#79e2d2'], ink:'#212c58', story:'Midnight fabric, coral flashes, and a mint-colored pulse.', sound:'Soft sub-bass · bright syncopated notes', notes:[45,57,60,64,69], type:'sawtooth', pace:.105, badge:'pulse'},
  stargazer: {name:'Stargazer', short:'Stargazer', colors:['#243a61','#b9d3e8','#f4e9c6'], ink:'#233451', story:'Deep blue, moonlit panels, and a constellation to follow.', sound:'Airy bells · a rising constellation', notes:[69,76,81,88], type:'sine', pace:.22, badge:'star'},
  sunrise: {name:'Sunrise Postcard', short:'Sunrise', colors:['#dd745e','#f6d5a0','#8ecdc1'], ink:'#643d33', story:'Peach, sea glass, and the promise of a first flight.', sound:'Round marimba-like notes · a friendly lift', notes:[60,64,67,72], type:'triangle', pace:.12, badge:'ray'}
});
export const FRIENDS = Object.freeze({
  cale: {name:'Cale', theme:'afterglow', subtitle:'From SXSW to a Hill Country sky.', note:'A flight inspired by the experiences you and Gordon have shared.', discoveries:[
    {id:'lift', title:'It started with a live moment.', text:'You and Gordon met at SXSW, when you executive produced the WAVE XR launch. The first lift is for that first connection.', label:'SXSW · Where your paths crossed'},
    {id:'land', title:'There is a place for you here.', text:'Gryphus brought the friendship into the Texas Hill Country. Here is a little of the joy you and Gordon shared there.', label:'Gryphus · Good company', image:'art/pilots/cale-and-gordon.webp', alt:'Gordon and Cale smiling together at Gryphus.'},
    {id:'win', title:'The afterglow comes with you.', text:'Your sunset pennant is aboard. A small tribute to making a place where people can gather, play, and leave with a story.', label:'An original gift for your flight'}]},
  gordon: {name:'Gordon',theme:'bassline',subtitle:'A little lift for the person bringing everyone together.',note:'Your world is already full of places to play. This balloon gets your own name, too.',discoveries:[
    {id:'lift',title:'Your turn to play.',text:'You make room for other people to belong. This first lift is a little room for your own curiosity.',label:'An original welcome from Astra & Darby'},
    {id:'land',title:'A new point of view.',text:'A landing is a chance to look more closely. Choose a toy, read a story, or take another route.',label:'The world is yours to explore'},
    {id:'win',title:'Keep the joy in circulation.',text:'Your flight pennant is aboard, and another breeze is ready for the way home.',label:'A gift for a good flight'}]}
});
export function cleanName(value) { return [...String(value||'').normalize('NFKC').replace(/\s+/g,' ').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>]/g,'').trim()].slice(0,24).join(''); }
export function friendFromName(value) { const n=cleanName(value).toLowerCase(); if(['cale','cale yarborough','cale yarbrough','cale yaborough'].includes(n))return 'cale';if(['gordon','gordon bellamy'].includes(n))return 'gordon';return null; }
export function identity(name,theme,friend) { const n=cleanName(name)||'New friend', f=Object.hasOwn(FRIENDS,friend)?friend:friendFromName(n); return {name:n,friend:f||null,theme:Object.hasOwn(THEMES,theme)?theme:(FRIENDS[f]?.theme||'sunrise'),key:f||'guest:'+n.toLocaleLowerCase('en-US')}; }
export function cleanCollection(value) { return {found:['lift','land','win'].filter(k=>Array.isArray(value?.found)&&value.found.includes(k)),fuel:Math.min(3,Math.max(0,Math.trunc(Number.isFinite(value?.fuel)?value.fuel:1)))}; }
export function loadPilots(raw) { let v;try{v=JSON.parse(raw||'null')}catch{} const active=v?.active&&typeof v.active==='object'?identity(v.active.name,v.active.theme,v.active.friend):null;const profiles=Object.create(null);if(v?.profiles&&typeof v.profiles==='object')Object.entries(v.profiles).slice(-24).forEach(([k,val])=>{if(k.length<64&&k!=='__proto__'&&k!=='constructor')profiles[k]=cleanCollection(val)});return {version:1,active,profiles}; }
export function discover(collection,id) { const p=cleanCollection(collection);if(!['lift','land','win'].includes(id)||p.found.includes(id))return {collection:p,fresh:false};p.found.push(id);if(id==='win')p.fuel=Math.min(3,p.fuel+1);return {collection:p,fresh:true}; }
export function useBreeze(collection,state) { const p=cleanCollection(collection);if(!state?.started||state.circuit||state.paused||state.mode!=='fly'||p.fuel<1)return {collection:p,used:false};p.fuel--;return {collection:p,used:true}; }
export function storiesFor(pilot) {return FRIENDS[pilot?.friend]?.discoveries||[
  {id:'lift',title:'A new friend, a new beginning.',text:`${cleanName(pilot?.name)||'Friend'}, there is room for your story here. Your first lift is the start of it.`,label:'A welcome from Gordon’s world'},
  {id:'land',title:'Your first place in this little world.',text:'You picked a place and made it here. Play its toy, read its story, or keep following your curiosity.',label:'A landing worth keeping'},
  {id:'win',title:'You brought a little joy home.',text:'Your flight pennant is aboard. Another breeze is ready when you take off again.',label:'Your first-flight gift'}
];}
