// ═══════════════════════════════════════════════════════════
//  GAME.JS  —  WarFront Echtzeit-Engine
// ═══════════════════════════════════════════════════════════

const PLAYER_COLORS = ['#c0392b','#2471a3','#27ae60','#8e44ad','#d35400','#16a085','#b7950b','#884ea0'];
const SEA_COLOR = '#0e1a26';
const NEUTRAL_COLOR = '#2a3a28';
const BORDER_COLOR = 'rgba(0,0,0,0.55)';

// ── TECH ────────────────────────────────────────────────────
const TECHS = [
  { id:'inf2',  em:'⚔️',  name:'Eliteinfanterie',   desc:'+60% Inf-Kampfkraft',      cost:25, req:null,  apply: p => { p.ub.infantry = (p.ub.infantry||1)*1.6; } },
  { id:'tank1', em:'🛡️',  name:'Panzer I',           desc:'Panzer freischalten',      cost:35, req:null,  apply: p => { if(!p.ul.includes('tank')) p.ul.push('tank'); } },
  { id:'arty1', em:'💥',  name:'Artillerie',          desc:'Artillerie freischalten',  cost:30, req:null,  apply: p => { if(!p.ul.includes('arty')) p.ul.push('arty'); } },
  { id:'ind1',  em:'🏭',  name:'Kriegsindustrie',     desc:'+5 Industrie permanent',   cost:28, req:null,  apply: p => { p.ib = (p.ib||0)+5; } },
  { id:'para',  em:'🪂',  name:'Fallschirmjäger',     desc:'Überall absetzen',         cost:42, req:'inf2',apply: p => { p.para = true; } },
  { id:'tank2', em:'⚙️',  name:'Panzer II',            desc:'+80% Panzer-Stärke',      cost:55, req:'tank1',apply: p => { p.ub.tank = (p.ub.tank||1)*1.8; } },
  { id:'arty2', em:'🔥',  name:'Schw. Artillerie',    desc:'+100% Artillerie-Stärke', cost:55, req:'arty1',apply: p => { p.ub.arty = (p.ub.arty||1)*2.0; } },
  { id:'log1',  em:'📦',  name:'Logistik',             desc:'Truppen 40% schneller',   cost:35, req:null,  apply: p => { p.spd = (p.spd||1)*1.4; } },
  { id:'spy1',  em:'🕵️', name:'Geheimdienst',         desc:'Feindtruppen sichtbar',   cost:30, req:null,  apply: p => { p.spy = true; } },
  { id:'ind2',  em:'🔧',  name:'Rüstungsindustrie',   desc:'+8 Industrie permanent',   cost:50, req:'ind1',apply: p => { p.ib = (p.ib||0)+8; } },
];

// ── UNIT TYPES ─────────────────────────────────────────────
const UDEFS = {
  infantry: { name:'Infanterie', em:'⚔️', gold:6,  prod:0, hp:80,  atk:10, def:8,  spd:36, r:5, col:'#f0e68c' },
  tank:     { name:'Panzer',     em:'🛡️', gold:22, prod:3, hp:200, atk:26, def:14, spd:55, r:7, col:'#cd853f' },
  arty:     { name:'Artillerie', em:'💥', gold:18, prod:2, hp:60,  atk:32, def:3,  spd:28, r:9, col:'#ff6347' },
};

// ── GAME STATE ──────────────────────────────────────────────
let G = {
  players: [],
  // cells: Map cellId -> { owner: playerIdx|-1 }  (ownership only)
  cellOwners: {},
  units: [],
  elapsed: 0,
};

let myIdx = -1, myName = 'General', myNation = 'DE', totalP = 2;
let peer = null, isHost = false, conns = {}, lobbyP = [];
let aiOn = false;
let unitIdCtr = 0;

// ── VIEW ────────────────────────────────────────────────────
let vx = 0, vy = 0, vz = 1.0;
let panning = false, panMoved = false, panSX = 0, panSY = 0;
let spawnType = null;    // active spawn mode
let selCell = null;      // selected cell id
let sbOpen = false;

// ── CANVAS ──────────────────────────────────────────────────
let cv, ctx, miniCv, miniCtx, W, H;
let animId = null, lastFrame = 0;
let lastIncome = 0;
const INCOME_MS = 8000;

// ════════════════════════════════════════════════════════════
// PEER / LOBBY
// ════════════════════════════════════════════════════════════
function makePeer(cb) {
  peer = new Peer(undefined, { debug: 0 });
  peer.on('open', id => cb(id));
  peer.on('connection', c => wireConn(c));
  peer.on('error', e => setLM('Verbindungsfehler: ' + e.message, true));
}
function wireConn(c) {
  c.on('open', () => {
    conns[c.peer] = c;
    if (isHost) {
      lobbyP.push({ peerId: c.peer, name: '...', nation: '?' });
      c.send({ t: 'assign', idx: lobbyP.length, total: totalP });
      broadL(); updateSlots(); checkStart();
    }
  });
  c.on('data', d => onMsg(d, c.peer));
  c.on('close', () => delete conns[c.peer]);
}
function bcast(m) { Object.values(conns).forEach(c => { try { c.send(m); } catch(e) {} }); }
function broadL() { bcast({ t: 'lobby', peers: lobbyP }); }

function onMsg(d, from) {
  if      (d.t === 'assign') { myIdx = d.idx; totalP = d.total; }
  else if (d.t === 'lobby')  { lobbyP = d.peers; updateSlots(); }
  else if (d.t === 'info')   { const p = lobbyP.find(x=>x.peerId===from); if(p){p.name=d.name;p.nation=d.nation;} broadL(); updateSlots(); checkStart(); }
  else if (d.t === 'start')  { launch(d.state); }
  else if (d.t === 'net')    { netApply(d); }
}

function doHost() {
  myName = val('i-name') || 'General'; myNation = val('i-nation'); totalP = +val('i-total');
  isHost = true; myIdx = 0;
  show('card-main', false); show('card-wait', true);
  makePeer(id => {
    el('code-box').textContent = id;
    lobbyP = [{ peerId: id, name: myName, nation: myNation }];
    updateSlots(); checkStart();
  });
}
function doJoin() {
  myName = val('i-name') || 'General'; myNation = val('i-nation');
  const hid = val('i-join').trim();
  if (!hid) { setLM('Host-Code eingeben!'); return; }
  isHost = false; show('card-main', false); show('card-wait', true);
  el('btn-start').style.display = 'none';
  makePeer(() => {
    const c = peer.connect(hid); wireConn(c);
    c.on('open', () => { c.send({ t: 'info', name: myName, nation: myNation }); setLM2('Verbunden! Warte auf Host...'); });
  });
}
function doSolo() {
  myName = val('i-name') || 'General'; myNation = val('i-nation');
  myIdx = 0; isHost = true; aiOn = true; totalP = 2;
  launch(buildState([
    { name: myName,       nation: myNation, color: PLAYER_COLORS[0] },
    { name: 'KI — FR',   nation: 'FR',     color: PLAYER_COLORS[1] },
  ]));
}
function doStart() {
  if (!isHost) return;
  const defs = [{ name: myName, nation: myNation }, ...lobbyP.slice(1).map(p => ({ name: p.name, nation: p.nation }))]
    .slice(0, totalP).map((d, i) => ({ name: d.name, nation: d.nation, color: PLAYER_COLORS[i] }));
  const state = buildState(defs);
  launch(state); bcast({ t: 'start', state });
}
function updateSlots() {
  const all = [{ peerId: peer?.id, name: myName, nation: myNation }, ...lobbyP.slice(1)];
  el('slot-list').innerHTML = Array.from({ length: totalP }, (_, i) => {
    const p = all[i];
    return `<div class="slot"><div class="dot" style="background:${PLAYER_COLORS[i]}"></div>
      <span>${p ? p.name : '—'}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--muted)">${p ? p.nation : ''}</span></div>`;
  }).join('');
}
function checkStart() {
  const n = Object.keys(conns).length;
  el('btn-start').disabled = n < totalP - 1;
  setLM2(`${n+1}/${totalP} verbunden`);
}
function copyCode() { navigator.clipboard.writeText(el('code-box').textContent).then(() => toast('Code kopiert!')); }
function setLM(m, e=false) { el('lmsg').textContent = m; el('lmsg').style.color = e ? 'var(--red)' : 'var(--muted)'; }
function setLM2(m) { el('lmsg2').textContent = m; }

// ════════════════════════════════════════════════════════════
// STATE BUILDER
// ════════════════════════════════════════════════════════════
function buildState(playerDefs) {
  const players = playerDefs.map(pd => ({
    name: pd.name, nation: pd.nation, color: pd.color,
    gold: 30, prod: 0, res: [], ub: {}, ul: ['infantry'],
    ib: 0, para: false, spd: 1, spy: false,
  }));

  const cellOwners = {};
  CELLS.forEach(c => { cellOwners[c.id] = -1; });

  players.forEach((pl, idx) => {
    const starts = NATION_STARTS[pl.nation] || [REGIONS[idx].id];
    starts.forEach(rid => {
      const cells = REGION_CELLS[rid] || [];
      cells.forEach(c => { cellOwners[c.id] = idx; });
    });
  });

  return { players, cellOwners, units: [], elapsed: 0 };
}

// ════════════════════════════════════════════════════════════
// LAUNCH
// ════════════════════════════════════════════════════════════
function launch(state) {
  G = { ...state, units: state.units || [] };
  el('lobby').style.display = 'none';
  el('game').classList.add('on');

  cv = el('cv'); ctx = cv.getContext('2d');
  miniCv = el('mini-cv'); miniCtx = miniCv.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  cv.addEventListener('mousedown', onMD);
  cv.addEventListener('mousemove', onMM);
  cv.addEventListener('mouseup',   onMU);
  cv.addEventListener('wheel',     onWheel, { passive: false });
  cv.addEventListener('click',     onClick);
  cv.addEventListener('contextmenu', e => { e.preventDefault(); cancelSpawn(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cancelSpawn(); });

  // Center map
  vx = (W - 1000*vz) / 2;
  vy = (H - 900*vz) / 2;

  lastIncome = Date.now();
  lastFrame = performance.now();
  animId = requestAnimationFrame(loop);
  addLog('Das Spiel beginnt! Echtzeit-Modus aktiv.', 'hi');
  renderTech();
}

function resize() {
  W = cv.width  = cv.offsetWidth;
  H = cv.height = cv.offsetHeight;
  miniCv.width  = miniCv.offsetWidth;
  miniCv.height = miniCv.offsetHeight;
}

// ════════════════════════════════════════════════════════════
// GAME LOOP
// ════════════════════════════════════════════════════════════
function loop(ts) {
  animId = requestAnimationFrame(loop);
  const dt = Math.min(ts - lastFrame, 50); lastFrame = ts;
  G.elapsed += dt;

  if (Date.now() - lastIncome >= INCOME_MS) {
    lastIncome = Date.now();
    collectIncome();
  }

  updateUnits(dt);
  draw();
  drawMini();
  updateHUD();
  if (aiOn) aiTick();
}

// ════════════════════════════════════════════════════════════
// INCOME
// ════════════════════════════════════════════════════════════
function collectIncome() {
  G.players.forEach((p, i) => {
    let gold = 0, prod = 0;
    REGIONS.forEach(r => {
      const cells = REGION_CELLS[r.id] || [];
      const owned = cells.filter(c => G.cellOwners[c.id] === i).length;
      const frac = owned / Math.max(cells.length, 1);
      if (frac > 0) {
        gold += r.income * frac;
        prod += Math.ceil(r.income * 0.4 * frac);
      }
    });
    p.gold += Math.round(gold);
    p.prod += Math.round(prod) + (p.ib || 0);
    if (i === myIdx) addLog(`Einnahmen: +${Math.round(gold)}🪙 +${Math.round(prod)+(p.ib||0)}⚙️`);
  });
  if (isHost) bcast({ t: 'net', a: 'income', players: G.players.map(p => ({ gold: p.gold, prod: p.prod })) });
}

// ════════════════════════════════════════════════════════════
// UNIT MOVEMENT & COMBAT
// ════════════════════════════════════════════════════════════
function updateUnits(dt) {
  G.units.forEach(u => {
    if (!u.moving) return;
    const dx = u.tx - u.x, dy = u.ty - u.y;
    const dist = Math.hypot(dx, dy);
    const speed = (u.defSpd || u.spd) * (G.players[u.owner]?.spd || 1);
    if (dist < 1.5) {
      u.x = u.tx; u.y = u.ty; u.moving = false;
      if (u.targetCell != null) arriveAt(u, u.targetCell);
      u.targetCell = null;
    } else {
      const step = speed * dt / 1000;
      u.x += (dx/dist) * step;
      u.y += (dy/dist) * step;
    }
  });
  G.units = G.units.filter(u => u.hp > 0);
}

function arriveAt(unit, cellId) {
  const owner = G.cellOwners[cellId];
  if (owner === unit.owner) return; // friendly — reinforce

  const cell = CELLS.find(c => c.id === cellId);
  const region = REGIONS.find(r => r.id === cell?.regionId);

  // Defenders: units on that cell
  const defenders = G.units.filter(u =>
    u !== unit && !u.moving && Math.hypot(u.x - cell.cx, u.y - cell.cy) < 20 && u.owner !== unit.owner
  );
  const defStr = defenders.reduce((s, u) => s + combatStr(u, 'def'), 0) + (owner >= 0 ? 5 : 2);
  const atkStr = combatStr(unit, 'atk');
  const winChance = atkStr / (atkStr + defStr);

  if (Math.random() < winChance) {
    G.cellOwners[cellId] = unit.owner;
    // Damage defenders
    defenders.forEach(d => { d.hp -= atkStr * 0.3; });
    addLog(`${G.players[unit.owner].name} nimmt ${cell?.regionId} Zelle!`, 'ok');
    checkVictory();
    if (isHost) bcast({ t: 'net', a: 'capture', cellId, owner: unit.owner });
  } else {
    unit.hp -= defStr * 0.25;
    addLog(`Zelle verteidigt!`, 'bad');
  }
}

function combatStr(unit, mode) {
  const p = G.players[unit.owner];
  const base = mode === 'atk' ? unit.atk : unit.def;
  return base * (p?.ub?.[unit.type] || 1);
}

// ════════════════════════════════════════════════════════════
// SPAWN UNITS
// ════════════════════════════════════════════════════════════
function setSpawn(type) {
  spawnType = type;
  el('banner').classList.add('on');
  el('banner').textContent = `🏃 Klicke eine Zelle — ${UDEFS[type].name} spawnen (ESC abbr.)`;
  renderSidebar(selCell);
}
function cancelSpawn() {
  spawnType = null;
  el('banner').classList.remove('on');
  renderSidebar(selCell);
}

function spawnUnit(cellId, type, ownerIdx, fromNet = false) {
  const cell = CELLS.find(c => c.id === cellId);
  if (!cell) return;
  const p = G.players[ownerIdx];
  const ud = UDEFS[type];
  if (!fromNet) {
    if (p.gold < ud.gold || p.prod < ud.prod) { toast('Zu wenig Ressourcen!'); return; }
    p.gold -= ud.gold; p.prod = Math.max(0, p.prod - ud.prod);
  }
  const uid = unitIdCtr++;
  const jitter = () => (Math.random()-0.5)*6;
  G.units.push({
    id: uid, owner: ownerIdx, type,
    x: cell.cx + jitter(), y: cell.cy + jitter(),
    tx: cell.cx, ty: cell.cy,
    hp: ud.hp, maxhp: ud.hp, atk: ud.atk, def: ud.def,
    defSpd: ud.spd, spd: ud.spd, r: ud.r, moving: false, targetCell: null,
  });
  addLog(`${p.name}: ${ud.em} ${ud.name} in ${cell.regionId}`);
  if (isHost && !fromNet) bcast({ t: 'net', a: 'spawn', cellId, type, owner: ownerIdx, uid });
  renderTech(); renderSidebar(selCell);
}

// Send a unit toward a target cell
function moveUnitToCell(unit, targetCellId) {
  const cell = CELLS.find(c => c.id === targetCellId);
  if (!cell) return;
  const jitter = () => (Math.random()-0.5)*8;
  unit.tx = cell.cx + jitter(); unit.ty = cell.cy + jitter();
  unit.moving = true; unit.targetCell = targetCellId;
  if (isHost) bcast({ t: 'net', a: 'move', uid: unit.id, tx: unit.tx, ty: unit.ty, targetCell: targetCellId });
}

function doResearch(techId) {
  const me = G.players[myIdx];
  const tc = TECHS.find(t => t.id === techId);
  if (!tc || me.res.includes(techId)) return;
  if (tc.req && !me.res.includes(tc.req)) { toast('Voraussetzung fehlt!'); return; }
  if (me.prod < tc.cost) { toast('Zu wenig Industrie!'); return; }
  me.prod -= tc.cost; me.res.push(techId); tc.apply(me);
  addLog(`${me.name} erforscht: ${tc.em} ${tc.name}`, 'hi');
  bcast({ t: 'net', a: 'res', owner: myIdx, tech: techId });
  renderTech();
}

// Net apply
function netApply(d) {
  if (d.a === 'income') {
    d.players.forEach((p, i) => { if (i !== myIdx) { G.players[i].gold = p.gold; G.players[i].prod = p.prod; } });
  } else if (d.a === 'spawn') {
    spawnUnit(d.cellId, d.type, d.owner, true);
  } else if (d.a === 'move') {
    const u = G.units.find(u => u.id === d.uid);
    if (u) { u.tx = d.tx; u.ty = d.ty; u.moving = true; u.targetCell = d.targetCell; }
  } else if (d.a === 'capture') {
    G.cellOwners[d.cellId] = d.owner;
  } else if (d.a === 'res') {
    const p = G.players[d.owner]; const tc = TECHS.find(t => t.id === d.tech);
    if (p && tc && !p.res.includes(d.tech)) { p.prod -= tc.cost; p.res.push(d.tech); tc.apply(p); }
  }
}

// ════════════════════════════════════════════════════════════
// DRAW
// ════════════════════════════════════════════════════════════
function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = SEA_COLOR; ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(vx, vy); ctx.scale(vz, vz);

  // Draw cells
  CELLS.forEach(cell => {
    const owner = G.cellOwners[cell.id];
    const col = owner >= 0 ? G.players[owner]?.color : NEUTRAL_COLOR;

    ctx.beginPath();
    cell.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();

    // Selected highlight
    if (cell.id === selCell) {
      ctx.fillStyle = lighten(col, 40);
    } else {
      ctx.fillStyle = col;
    }
    ctx.fill();

    // Borders — thicker between different owners
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 0.8 / vz;
    ctx.stroke();

    // Spawn-mode highlight
    if (spawnType && owner === myIdx) {
      ctx.strokeStyle = 'rgba(30,200,80,0.7)';
      ctx.lineWidth = 2 / vz;
      ctx.stroke();
    }
  });

  // Region labels — only at reasonable zoom
  if (vz > 0.5) {
    REGIONS.forEach(r => {
      const cells = REGION_CELLS[r.id];
      if (!cells || cells.length === 0) return;
      const cx = cells.reduce((s,c)=>s+c.cx,0)/cells.length;
      const cy = cells.reduce((s,c)=>s+c.cy,0)/cells.length;
      ctx.font = `bold ${Math.max(6, 9/vz)}px Cinzel, serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = '#000'; ctx.shadowBlur = 4/vz;
      ctx.fillText(r.name.substring(0,9).toUpperCase(), cx, cy - 5);
      ctx.font = `${Math.max(5, 7/vz)}px Crimson Text, serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText(r.income + '🪙', cx, cy + 7);
      ctx.shadowBlur = 0;
    });
  }

  // Units
  const me = G.players[myIdx];
  G.units.forEach(u => {
    const p = G.players[u.owner];
    const col = p?.color || '#fff';
    const visible = u.owner === myIdx || !me?.spy || me.spy;

    if (!visible) return;

    // Shadow
    ctx.beginPath(); ctx.arc(u.x, u.y+2, u.r, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();

    // Body gradient-ish
    ctx.beginPath(); ctx.arc(u.x, u.y, u.r, 0, Math.PI*2);
    ctx.fillStyle = u.type === 'infantry' ? '#f0e68c' : u.type === 'tank' ? '#cd853f' : '#ff6347';
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5 / vz;
    ctx.stroke();

    // HP bar
    const bw = u.r * 2.4, bh = 2/vz;
    const bx = u.x - bw/2, by = u.y - u.r - 4/vz;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = (u.hp/u.maxhp) > 0.5 ? '#27ae60' : '#c0392b';
    ctx.fillRect(bx, by, bw*(u.hp/u.maxhp), bh);

    // Moving indicator
    if (u.moving) {
      ctx.beginPath();
      ctx.moveTo(u.x, u.y); ctx.lineTo(u.tx, u.ty);
      ctx.strokeStyle = col + '55';
      ctx.lineWidth = 0.8/vz;
      ctx.setLineDash([3/vz, 3/vz]);
      ctx.stroke(); ctx.setLineDash([]);
    }
  });

  ctx.restore();
}

function drawMini() {
  const mw = miniCv.width, mh = miniCv.height;
  miniCtx.clearRect(0, 0, mw, mh);
  miniCtx.fillStyle = SEA_COLOR; miniCtx.fillRect(0, 0, mw, mh);
  const sx = mw/1000, sy = mh/900;
  CELLS.forEach(cell => {
    const owner = G.cellOwners[cell.id];
    miniCtx.fillStyle = owner >= 0 ? G.players[owner]?.color : NEUTRAL_COLOR;
    miniCtx.beginPath();
    cell.pts.forEach(([x,y],i) => i ? miniCtx.lineTo(x*sx, y*sy) : miniCtx.moveTo(x*sx, y*sy));
    miniCtx.closePath(); miniCtx.fill();
    miniCtx.strokeStyle = 'rgba(0,0,0,0.3)'; miniCtx.lineWidth = 0.4; miniCtx.stroke();
  });
  // Viewport
  miniCtx.strokeStyle = 'rgba(255,255,255,0.4)'; miniCtx.lineWidth = 1;
  miniCtx.strokeRect(-vx/vz*sx, -vy/vz*sy, W/vz*sx, H/vz*sy);
}

function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255,(n>>16)+amt), g = Math.min(255,((n>>8)&0xff)+amt), b = Math.min(255,(n&0xff)+amt);
  return `rgb(${r},${g},${b})`;
}

// ════════════════════════════════════════════════════════════
// HUD & SIDEBAR
// ════════════════════════════════════════════════════════════
function updateHUD() {
  const me = G.players[myIdx]; if (!me) return;
  el('h-gold').textContent = Math.floor(me.gold);
  el('h-prod').textContent = Math.floor(me.prod);
  const owned = CELLS.filter(c => G.cellOwners[c.id] === myIdx).length;
  el('h-cells').textContent = owned;
  const sec = Math.floor(G.elapsed/1000);
  el('h-time').textContent = `⏱ ${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
}

function renderSidebar(cellId) {
  if (!cellId && cellId !== 0) {
    el('sb-name').textContent = 'Keine Zelle gewählt'; el('sb-name').style.color = 'var(--muted)';
    el('sb-info').textContent = ''; el('sb-actions').style.display = 'none'; return;
  }
  const cell = CELLS.find(c => c.id === cellId);
  const region = REGIONS.find(r => r.id === cell?.regionId);
  const owner = G.cellOwners[cellId];
  const ownerP = owner >= 0 ? G.players[owner] : null;
  el('sb-name').textContent = region?.name || cell?.regionId || '?';
  el('sb-name').style.color = ownerP?.color || 'var(--muted)';
  const myUnits = G.units.filter(u => u.owner === myIdx && Math.hypot(u.x-cell.cx, u.y-cell.cy) < 20);
  el('sb-info').innerHTML = `
    <b>Besitzer:</b> ${ownerP ? `<span style="color:${ownerP.color}">${ownerP.name}</span>` : 'Neutral'}<br>
    <b>Region:</b> ${region?.name||'?'} (${region?.income||0}🪙)<br>
    <b>Eigene Truppen:</b> ${myUnits.length}`;

  if (owner === myIdx) {
    el('sb-actions').style.display = 'block';
    const me = G.players[myIdx];
    el('act-grid').innerHTML = me.ul.map(ut => {
      const ud = UDEFS[ut];
      const ok = me.gold >= ud.gold && me.prod >= ud.prod;
      return `<button class="ab${spawnType===ut?' active':''}" onclick="setSpawn('${ut}')" ${ok?'':'disabled'}>
        ${ud.em} ${ud.name}<span class="s">${ud.gold}🪙 ${ud.prod?ud.prod+'⚙️':''}</span></button>`;
    }).join('');
  } else {
    el('sb-actions').style.display = 'none';
  }
}

function renderTech() {
  const me = G.players[myIdx]; if (!me) return;
  el('tech-list').innerHTML = TECHS.map(tc => {
    const done   = me.res.includes(tc.id);
    const locked = tc.req && !me.res.includes(tc.req);
    const ok     = !done && !locked && me.prod >= tc.cost;
    return `<div class="tc${done?' done':locked?' locked':''}" onclick="${(!done&&!locked)?`doResearch('${tc.id}')`:''}" style="cursor:${(!done&&!locked)?'pointer':'default'}">
      <div class="tc-em">${tc.em}</div>
      <div class="tc-body">
        <div class="tc-name">${tc.name}${done?' ✓':''}</div>
        <div class="tc-desc">${tc.desc}</div>
        ${!done?`<div class="tc-cost">${tc.cost}⚙️${ok?' ✅':''}${locked?' 🔒':''}</div>`:''}
      </div></div>`;
  }).join('');
}

function toggleSB() {
  sbOpen = !sbOpen;
  el('sb').classList.toggle('open', sbOpen);
  el('sb-tab').textContent = sbOpen ? '▶' : '◀';
}
function openSB() { if (!sbOpen) toggleSB(); }

// ════════════════════════════════════════════════════════════
// INPUT
// ════════════════════════════════════════════════════════════
function onMD(e) {
  panning = true; panMoved = false;
  panSX = e.clientX - vx; panSY = e.clientY - vy;
  cv.classList.add('panning');
}
function onMM(e) {
  if (!panning) return;
  const nx = e.clientX - panSX, ny = e.clientY - panSY;
  if (Math.abs(nx-vx) > 3 || Math.abs(ny-vy) > 3) panMoved = true;
  vx = nx; vy = ny;
}
function onMU() { panning = false; cv.classList.remove('panning'); }
function onWheel(e) {
  e.preventDefault();
  const oz = vz, mx = e.offsetX, my = e.offsetY;
  vz = Math.max(0.3, Math.min(6, vz - e.deltaY * 0.0012));
  vx = mx - (mx - vx) * (vz/oz);
  vy = my - (my - vy) * (vz/oz);
}

function onClick(e) {
  if (panMoved) return;
  const mx = (e.offsetX - vx) / vz, my = (e.offsetY - vy) / vz;
  const hit = cellAt(mx, my);

  if (spawnType) {
    if (hit) {
      const owner = G.cellOwners[hit.id];
      const me = G.players[myIdx];
      if (owner === myIdx || me.para) {
        spawnUnit(hit.id, spawnType, myIdx);
      } else {
        toast('Nur eigene Zellen!');
      }
    }
    cancelSpawn();
    return;
  }

  if (hit) {
    // Right-click / shift: send nearby units to this cell
    if (e.shiftKey) {
      // Move all my selected-region units to this cell
      const myUnits = G.units.filter(u => u.owner === myIdx && !u.moving);
      if (myUnits.length > 0) {
        myUnits.slice(0, 5).forEach(u => moveUnitToCell(u, hit.id));
        addLog(`${myUnits.length} Einheiten Richtung ${hit.regionId}`);
      } else {
        toast('Keine eigenen Truppen verfügbar! (Shift+Klick zum Bewegen)');
      }
      return;
    }
    selCell = hit.id;
    renderSidebar(hit.id);
    openSB();
  }
}

// ════════════════════════════════════════════════════════════
// AI
// ════════════════════════════════════════════════════════════
let aiLastTick = 0;
function aiTick() {
  const now = Date.now();
  if (now - aiLastTick < 2500) return;
  aiLastTick = now;

  const aiIdx = myIdx === 0 ? 1 : 0;
  const ai = G.players[aiIdx]; if (!ai) return;

  // Spawn infantry in random owned cell
  if (ai.gold >= UDEFS.infantry.gold) {
    const owned = CELLS.filter(c => G.cellOwners[c.id] === aiIdx);
    if (owned.length > 0) {
      const c = owned[Math.floor(Math.random() * owned.length)];
      spawnUnit(c.id, 'infantry', aiIdx, true);
      ai.gold -= UDEFS.infantry.gold;
    }
  }

  // Move idle AI units toward nearest enemy cell
  const aiUnits = G.units.filter(u => u.owner === aiIdx && !u.moving);
  aiUnits.slice(0, 4).forEach(u => {
    let best = null, bd = Infinity;
    CELLS.forEach(c => {
      if (G.cellOwners[c.id] === aiIdx) return;
      const d = Math.hypot(c.cx - u.x, c.cy - u.y);
      if (d < bd) { bd = d; best = c; }
    });
    if (best) moveUnitToCell(u, best.id);
  });
}

// ════════════════════════════════════════════════════════════
// VICTORY
// ════════════════════════════════════════════════════════════
function checkVictory() {
  const owners = new Set(Object.values(G.cellOwners).filter(o => o >= 0));
  if (owners.size === 1) {
    const w = G.players[[...owners][0]];
    el('vic').classList.add('on');
    el('vic-s').textContent = `${w.name} hat Europa vereint!`;
  }
}

// ════════════════════════════════════════════════════════════
// UTIL
// ════════════════════════════════════════════════════════════
function addLog(m, cls='') {
  const d = el('log-i');
  const e = document.createElement('div');
  e.className = 'll ' + cls; e.textContent = m; d.appendChild(e);
  el('log').scrollTop = 9999;
}
let _tt = null;
function toast(m) {
  el('toast').textContent = m; el('toast').classList.add('on');
  clearTimeout(_tt); _tt = setTimeout(() => el('toast').classList.remove('on'), 2200);
}
function el(id)  { return document.getElementById(id); }
function val(id) { return document.getElementById(id).value; }
function show(id, s) { document.getElementById(id).style.display = s ? 'block' : 'none'; }
