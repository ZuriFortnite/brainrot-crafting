/* BRAINROT DROP - boot, input, render loop. */
(function () {
  const X = window.GFX, M = window.MERGE, UI = window.UI;
  const canvas = document.getElementById('gl');
  let R = null, paused = false, best = 0;
  let mergeSeen = 0, revivedThisRun = false;

  /* ---------------- view fit ----------------
     World Y grows downward; the container spans y 0..M.H and x -W/2..W/2, with
     head-room above the rim for the piece being aimed. */
  /* The box art is a DOM image; the canvas sits on top of it full-screen. The
     camera is derived from where the box's FRONT OPENING lands on screen, so
     the physics rectangle and the drawn opening are the same pixels. */
  /* assets/box.json - the mid-depth play plane of the perspective box art. */
  const BOX = { l: 0.08298, r: 0.92024, t: 0.09534, b: 0.91451 };
  const TOP_UI = 84, BOT_UI = 62;          // room for score/next and the chain strip
  let view = { cx: 0, cy: 0, hw: 1, hh: 1 };
  const boxEl = document.getElementById('box');
  const DBG = location.search.indexOf('dbg') >= 0;

  const ART_ASPECT = 934 / 965;               // the trimmed box image

  /* Biome palettes, applied as CSS custom properties. */
  /* Pink family across all three worlds - each biome shifts the hue rather than
     leaving the set, so the game reads as one place at different times of day
     instead of three unrelated colour schemes. */
  const PALETTE = [
    // MEADOW: soft blossom pink
    { sky:'#ffd3e4', top:'#ff9ec4', bot:'#fff2f7', checker:'rgba(255,255,255,.46)',
      a:'#f2a3c4', b:'#dd7da8', e:'#c25e8e' },
    // DESERT: warm coral, pushed toward sunset
    { sky:'#ffc7bd', top:'#ff8e86', bot:'#fff0ea', checker:'rgba(255,255,255,.32)',
      a:'#f0a58f', b:'#d87f68', e:'#b8624c' },
    // TUNDRA: pale rose, almost white
    { sky:'#ffe4ef', top:'#ffb9d5', bot:'#fffafc', checker:'rgba(255,255,255,.62)',
      a:'#fbe0ea', b:'#e8c2d3', e:'#cfa2b8' }
  ];
  const propsL = document.getElementById('propsL');
  const propsR = document.getElementById('propsR');
  const PROPS_AR = 1.8095;        // cluster w/h, from the generator

  function applyBiome(i) {
    const p = PALETTE[i % PALETTE.length], r = document.documentElement.style;
    r.setProperty('--sky', p.sky);
    r.setProperty('--skyTop', p.top);
    r.setProperty('--skyBot', p.bot);
    r.setProperty('--checker', p.checker);
    r.setProperty('--floorA', p.a);
    r.setProperty('--floorB', p.b);
    r.setProperty('--floorEdge', p.e);
    const art = M.BIOMES[i % M.BIOMES.length].art;
    boxEl.src = 'assets/biome/box_' + art + '.png';
    propsL.style.backgroundImage = 'url(assets/biome/propsL_' + art + '.png)';
    propsR.style.backgroundImage = 'url(assets/biome/propsR_' + art + '.png)';
  }

  const FLOOR_FRAC = 0.86;                 // ceiling only; see layout()
  const chainEl = document.getElementById('chain');
  const floorEl = document.getElementById('floor');

  function layout() {
    const vw = window.innerWidth, vh = window.innerHeight;

    /* Size the evolution strip to what is ACTUALLY available before anything
       else is placed: 11 chips must fit between the paddings, gaps and border,
       or overflow:hidden slices the tail off on a narrow viewport. */
    const availW = vw * 0.94 - 33 - 6 - 10 * 3;
    const chip = Math.max(15, Math.min(46, availW / 11));
    chainEl.style.setProperty('--chip', chip.toFixed(1) + 'px');

    /* The floor line must clear the strip. A flat 14% is fine on a phone but on
       a 32:9 window the strip is proportionally huge and swallowed the bottom
       of the box along with any pieces resting in it. */
    const chainH = chainEl.offsetHeight || 60;
    const floorTop = Math.min(vh * FLOOR_FRAC, vh - chainH - 14);
    floorEl.style.height = Math.max(0, vh - floorTop) + 'px';
    // keep the death screen's bottom row clear of the evolution strip
    document.getElementById('over').style.paddingBottom = (chainH + 26) + 'px';

    /* The box SITS ON the floor. Centring it in the free space left it hovering
       in mid-air on tall screens, because the spare height was split evenly
       above and below. */
    /* The box gives up width so there is real GROUND either side of it for the
       scenery to stand on. At 0.995 the props had nowhere to be but the sky. */
    const maxW = vw * 0.78;
    const maxH = Math.max(80, floorTop - TOP_UI);
    let artW = maxW, artH = artW / ART_ASPECT;
    if (artH > maxH) { artH = maxH; artW = artH * ART_ASPECT; }

    const artLeft = (vw - artW) / 2;
    // seat it very slightly into the floor so there is no hairline gap
    let artTop = floorTop - artH + artH * 0.015;
    if (artTop < TOP_UI) artTop = TOP_UI;

    /* Scenery STANDS ON THE GROUND, one cluster per side. Each is sized from
       the ground band - the strip that is actually visible beside the box - and
       allowed to run a little behind the box edge for depth. Sunk slightly below
       the floor line so the bases are planted, not balanced on the line. */
    const floorLine = floorTop;
    /* Scale off the BOX height, which is the scene's size reference. Scaling off
       the ground band instead gave 400px trees on a short wide window, where the
       box is height-limited and the band is consequently huge. Whatever does not
       fit the band simply tucks behind the box - the clusters are anchored to
       their outer edge, so the outermost prop is always the one on show. */
    const clusterH = Math.max(46, Math.min(artH * 0.21, vh * 0.17));
    const clusterW = clusterH * PROPS_AR;
    const sink = clusterH * 0.20;   // overlap the box BASE only, not the play area
    for (const el of [propsL, propsR]) {
      el.style.width = clusterW + 'px';
      el.style.height = clusterH + 'px';
      el.style.bottom = (vh - floorLine - sink) + 'px';
    }
    propsL.style.left = '0px';
    propsR.style.right = '0px';

    boxEl.style.left = artLeft + 'px';
    boxEl.style.top = artTop + 'px';
    boxEl.style.width = artW + 'px';
    boxEl.style.height = artH + 'px';

    const openLeft = artLeft + BOX.l * artW;
    const openTop = artTop + BOX.t * artH;
    const openW = (BOX.r - BOX.l) * artW;

    // map world (-W/2..W/2, 0..H) onto the opening, in CSS pixels
    const perPx = M.W / openW;
    view.pxPerWorld = openW / M.W;   // for DOM overlays that must track the sim
    view.boxCx = artLeft + artW / 2;
    view.boxCy = artTop + artH * 0.92;   // pivot near the base: it is picked UP
    view.hw = (vw * perPx) / 2;
    view.hh = (vh * perPx) / 2;
    view.cx = -M.W / 2 + (vw / 2 - openLeft) * perPx;
    view.cy = view.hh * (1 - 2 * openTop / vh);
    // reveal only once it has been positioned: before the first layout the
    // <img> paints at its intrinsic 934x965 and visibly jumps
    if (!boxEl.style.opacity) boxEl.style.opacity = '1';
  }

  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      R.gl.viewport(0, 0, w, h);
    }
    layout();
  }

  function screenToWorldX(clientX) {
    const r = canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    return view.cx + nx * view.hw;
  }

  // inverse of screenToWorld*, for placing DOM overlays on world positions
  function worldToScreen(wx, wy) {
    const r = canvas.getBoundingClientRect();
    return {
      x: r.left + ((wx - view.cx) / view.hw + 1) / 2 * r.width,
      y: r.top + ((wy - view.cy) / view.hh + 1) / 2 * r.height
    };
  }

  function floatScore(p) {
    const host = document.getElementById('pops');
    if (!host || !p.val) return;
    const sc = worldToScreen(p.x, p.y);
    const el = document.createElement('div');
    el.className = 'pt' + (p.gold ? ' gold' : '');
    if (p.gold) el.innerHTML = '<span class="coin"></span> ' + p.val;
    else el.textContent = '+' + p.val;
    el.style.left = sc.x + 'px';
    el.style.top = sc.y + 'px';
    host.appendChild(el);
    setTimeout(() => el.remove(), 820);
  }

  /* World Y increases DOWNWARD, the same direction as screen Y, so this is
     cy + ny*hh. It was cy - ny*hh, which mirrored the aim point about the box
     centre - the hammer looked in the wrong place and hit nothing. */
  function screenToWorldY(clientY) {
    const r = canvas.getBoundingClientRect();
    const ny = ((clientY - r.top) / r.height) * 2 - 1;
    return view.cy + ny * view.hh;
  }

  /* ---------------- input ---------------- */
  let aiming = false, hammerArmed = false;
  function disarmHammer() {
    hammerArmed = false;
    document.getElementById('btnHammer').classList.remove('armed');
  }

  function down(e) {
    if (paused || M.s.over) return;
    window.SFX && SFX.resume();
    /* Armed hammer swallows the gesture entirely - it must NOT also drop the
       held piece, which is what a plain click-through would do. */
    if (hammerArmed) {
      const t = M.hammer(screenToWorldX(e.clientX), screenToWorldY(e.clientY));
      if (t >= 0) { UI.spend(UI.COST.hammer); SFX.shake(); disarmHammer(); }
      else UI.toast('TAP A CHARACTER');
      return;
    }
    aiming = true;
    M.moveTo(screenToWorldX(e.clientX));
  }
  function move(e) {
    if (!aiming) return;
    M.moveTo(screenToWorldX(e.clientX));
  }
  function up() {
    if (!aiming) return;
    aiming = false;
    if (M.drop()) SFX.drop();
  }

  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); down(e); });
  canvas.addEventListener('pointermove', move);
  // on window, not the canvas: releasing over a HUD button must still drop
  addEventListener('pointerup', up);
  addEventListener('pointercancel', () => { aiming = false; });
  addEventListener('blur', () => { aiming = false; });

  addEventListener('keydown', e => {
    /* Esc closes the topmost modal. Never preventDefault()ed - cert forbids
       swallowing Esc. */
    if (e.key === 'Escape') {
      const has = id => document.getElementById(id).classList.contains('on');
      if (has('dex')) { UI.hideDex(); return; }
      if (has('worlds')) { UI.hideWorlds(); paused = UI.anyModalOpen(); last = 0; return; }
      if (has('pause')) { UI.hidePause(); paused = UI.anyModalOpen(); last = 0; return; }
      if (hammerArmed) { disarmHammer(); return; }
      return;
    }
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.isContentEditable)) return;
    if (M.s.over) return;
    const k = e.key.toLowerCase();
    const step = 0.6;
    if (k === 'arrowleft' || k === 'a') M.moveTo(M.s.dropX - step);
    if (k === 'arrowright' || k === 'd') M.moveTo(M.s.dropX + step);
    if (k === ' ' || k === 'arrowdown' || k === 's') {
      e.preventDefault();
      window.SFX && SFX.resume();
      if (M.drop()) SFX.drop();
    }
  });

  /* ---------------- drawing ---------------- */
  const WALL = 0.34;

  function drawFrame(t) {
    // the container itself is the box image behind the canvas; only the
    // in-play guides are drawn here
    R.sprite(0, M.H / 2, 0.05, M.H - 0.4, X.T.BLANK, 1, 1, 1, 0.18);
    if (DBG) {
      const e = 0.06;
      R.sprite(0, 0, M.W, e, X.T.BLANK, 1, 0.2, 0.2, 1);
      R.sprite(0, M.H, M.W, e, X.T.BLANK, 1, 0.2, 0.2, 1);
      R.sprite(-M.W / 2, M.H / 2, e, M.H, X.T.BLANK, 1, 0.2, 0.2, 1);
      R.sprite(M.W / 2, M.H / 2, e, M.H, X.T.BLANK, 1, 0.2, 0.2, 1);
    }
    // the danger line grows more urgent as the grace window runs down
    const d = M.s.danger || 0;
    const puls = d > 0 ? 0.55 + Math.abs(Math.sin(t * (5 + d * 12))) * 0.45 : 0.30;
    R.sprite(0, M.DANGER_Y, M.W - 0.2, 0.07 + d * 0.10, X.T.BLANK,
             1, 0.85 - d * 0.62, 0.55 - d * 0.42, puls);
  }

  function drawPiece(b, t) {
    const c = M.TIERS[b.t];
    let pop = b.pop > 0 ? 1 + b.pop * 1.6 : 1;
    const bs = M.s.boss;
    if (bs && bs.phase === 'roar' && b.t === M.TIERS.length - 1) {
      pop *= 1 + bs.t * 0.9 + Math.sin(bs.t * 30) * 0.10;   // swelling roar
    }
    const d = c.r * 2 * 1.14 * pop;      // art tracks the collider, slight spill
    if (b.gold) {
      // halo behind, then a warm tint on the sprite itself
      const pulse = 0.55 + Math.sin(t * 7 + b.x) * 0.25;
      R.sprite(b.x, b.y, d * 1.5, d * 1.5, X.T.RING, 1, 0.86, 0.25, pulse * 0.7);
      R.sprite(b.x, b.y, d, d, b.t, 1, 0.93, 0.55, 1, b.rot);
      return;
    }
    R.sprite(b.x, b.y, d, d, b.t, 1, 1, 1, 1, b.rot);
  }

  /* ---------------- death sequence ----------------
     A beat of silence, then the camera pulls back to reveal the whole board,
     and only then does the UI arrive. Snapping straight to the panel gave the
     player no moment to register how they lost. */
  const DEATH_HOLD = 0.45, DEATH_ZOOM = 0.55, DEATH_SCALE = 0.80;
  let deathT = -1;                 // <0 = not dying

  function deathScale() {
    if (deathT < 0) return 1;
    const z = Math.max(0, deathT - DEATH_HOLD) / DEATH_ZOOM;
    if (z <= 0) return 1;
    const e = 1 - Math.pow(1 - Math.min(1, z), 3);      // ease-out cubic
    return 1 - (1 - DEATH_SCALE) * e;
  }

  /* Mirror the camera offset onto the box image. Camera +sy makes world content
     rise on screen, so the element moves by -sy in pixels. */
  let lastBoxT = '';
  /* The canvas is transformed with the box, about the SAME origin, so the
     pieces stay inside the container while it is hoisted and rocked. Rotating
     only the box would tear the two apart visually. */
  function boxShake(sx, sy, rot, scale) {
    const ppw = view.pxPerWorld || 0;
    const sc = scale === undefined ? 1 : scale;
    const tr = (sx || sy || rot || sc !== 1)
      ? 'translate(' + (-sx * ppw).toFixed(2) + 'px,' + (-sy * ppw).toFixed(2) + 'px)' +
        ' rotate(' + rot.toFixed(3) + 'deg) scale(' + sc.toFixed(4) + ')'
      : '';
    if (tr === lastBoxT) return;
    lastBoxT = tr;
    const ox = view.boxCx + 'px', oy = view.boxCy + 'px';
    boxEl.style.transformOrigin = ox + ' ' + oy;
    canvas.style.transformOrigin = ox + ' ' + oy;
    boxEl.style.transform = tr;
    canvas.style.transform = tr;
  }

  function draw(t) {
    const gl = R.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // merge kick, decayed in the sim so pausing cannot freeze a shaking camera
    /* SHAKE MOVES THE WHOLE BOX. The camera kick alone rattled the pieces while
       the container sat still, which read as the pieces being shaken rather than
       the box. The same offset is applied to the #box image below, and `lift`
       hoists it off the ground first so it reads as being picked up. */
    const k = M.s.shakeMag, lf = M.s.lift || 0;
    const wob = lf > 0 ? lf * 0.85 : 0;
    const sx = (k ? Math.sin(t * 61) * k * 0.5 : 0) + (wob ? Math.sin(t * 26) * wob : 0);
    const sy = (k ? Math.sin(t * 47) * k * 0.5 : 0) + lf * 1.7;      // hoisted higher
    const rot = lf > 0 ? Math.sin(t * 21) * lf * 9 : 0;              // rocked, in degrees
    boxShake(sx, sy, rot, deathScale());
    const camX = view.cx + sx, camY = view.cy + sy;
    const s = M.s;

    R.begin(camX, camY, view.hw, view.hh);
    drawFrame(t);

    for (const b of s.bodies) drawPiece(b, t);

    // the piece being aimed
    if (!s.over) {
      const rr = M.TIERS[s.cur].r;
      const bob = Math.sin(t * 4) * 0.05;
      R.sprite(s.dropX, M.DROP_Y + bob, rr * 2 * 1.14, rr * 2 * 1.14, s.cur, 1, 1, 1, 1);
    }

    // the drop line under the aimed piece
    if (!s.over) {
      for (let y = M.DROP_Y + 0.9; y < M.H; y += 0.72) {
        R.sprite(s.dropX, y, 0.10, 0.34, X.T.BLANK, 1, 1, 1, 0.22);
      }
    }

    // spark particles
    for (const f of s.fx) {
      const a = Math.max(0, f.life / f.max);
      R.sprite(f.x, f.y, f.size * (0.6 + a), f.size * (0.6 + a), X.T.SPARK,
               1, 0.86 + a * 0.14, 0.35 + a * 0.4, a);
    }

    // cartoon smoke
    for (const f of s.smoke) {
      const a = Math.max(0, Math.min(1, f.life / f.max));
      R.sprite(f.x, f.y, f.size, f.size, X.T.SMOKE, 1, 1, 1, a * 0.85, f.rot);
    }

    // merge popups
    for (const p of s.pops) {
      const a = Math.max(0, Math.min(1, p.life / 0.6));
      const sz = M.TIERS[p.tier].r * 2 * (p.top ? 3.2 : 2.0) * (1.4 - a * 0.4);
      R.sprite(p.x, p.y, sz, sz, X.T.RING, 1, 0.95, 0.6, a * 0.75);
    }

    R.flush();
  }

  /* ---------------- loop ---------------- */
  let last = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000 || 0));
    last = now;

    if (!paused) M.step(dt);
    fit();
    draw(now / 1000);

    // merge audio is driven off the counter so it never double-fires
    if (M.s.merges > mergeSeen) {
      const n = M.s.merges - mergeSeen;
      mergeSeen = M.s.merges;
      // the n newest pops are this frame's merges
      for (const p of M.s.pops.slice(-n)) floatScore(p);
      SFX.merge(Math.min(10, M.s.biggest));
      if (n > 1) SFX.merge(Math.min(10, M.s.biggest + 1));
    }

    // boss sequence presentation
    const bs = M.s.boss;
    const fl = document.getElementById('flash');
    if (bs) {
      fl.style.opacity = (bs.flash || 0) * 0.92;
      if (bs.needSwap) {
        bs.needSwap = false;
        const bi = M.s.biome, set = M.BIOMES[bi].set;
        applyBiome(bi);
        UI.banner(M.BIOMES[bi].name);
        // the next cast is fetched here; the swap phase gives it ~0.85s
        X.loadSet(set).then(() => {
        R.refreshAtlas(); UI.rebuildChain();
      });
      }
    } else if (fl.style.opacity !== '0') {
      fl.style.opacity = 0;
    }

    UI.frame(dt);

    if (M.s.over && deathT < 0 && !UI.anyModalOpen()) {
      deathT = 0;                                   // begin the pull-back
      disarmHammer();
      SFX.over();
    }
    if (deathT >= 0 && !M.s.over) deathT = -1;      // revived: cancel it

    if (deathT >= 0 && !document.getElementById('over').classList.contains('on')) {
      deathT += dt;
      if (deathT < DEATH_HOLD + DEATH_ZOOM) return; // still pulling back
      const prevBest = best;
      if (M.s.score > best) { best = M.s.score; UI.saveBest(best); }
      // bank the run: score payout plus a one-off bounty per new character
      const fresh = UI.recordDex(M.s.biome % UI.NSETS, M.s.made);
      const earned = UI.coinsFor(M.s.score) + fresh * UI.DEX_BONUS;
      if (earned > 0) UI.addCoins(earned);
      YTP.sendScore(M.s.score);   // best score must match the save
      UI.flushSave();
      // the board stays visible behind the offer, so no interstitial here - it
      // runs once the player has actually declined
      UI.showOver(best, earned, prevBest, !revivedThisRun, () => UI.showResults());
    }
  }

  /* ---------------- buttons ---------------- */
  let startBiome = 0;

  /* Starting in a chosen biome means starting on that biome's CAST, so the set
     has to be swapped before play resumes - otherwise the board shows meadow
     characters in a tundra box. */
  function newGame() {
    M.newGame((Date.now() & 0x7fffffff) || 1);
    revivedThisRun = false;
    deathT = -1;
    M.s.biome = startBiome;
    mergeSeen = 0;
    disarmHammer();
    UI.resetChain();
    UI.hideOver();
    const b = M.BIOMES[startBiome];
    applyBiome(startBiome);
    if (X.setName !== b.set) {          // gfx already tracks the loaded cast
      X.loadSet(b.set).then(() => {
        R.refreshAtlas(); UI.rebuildChain();
      });
    }
  }

  function bind() {
    const $b = id => document.getElementById(id);

    $b('btnAgain').onclick = () => { SFX.resume(); newGame(); };

    /* --- pause menu --- */
    function openPause() { paused = true; UI.flushSave(); UI.showPause(); }
    function closePause() { UI.hidePause(); paused = UI.anyModalOpen(); last = 0; }
    $b('btnPause').onclick = openPause;
    $b('btnResume').onclick = closePause;
    $b('btnRestart').onclick = () => { UI.hidePause(); newGame(); paused = false; last = 0; };
    $b('btnDex2').onclick = () => UI.showDex();

    /* --- worlds --- */
    function openWorlds() {
      UI.buildWorlds(startBiome, i => {
        startBiome = i;
        UI.hideWorlds(); UI.hidePause(); UI.hideOver();
        newGame(); paused = false; last = 0;
      });
      UI.showWorlds();
    }
    $b('btnWorlds').onclick = openWorlds;
    $b('btnWorlds2').onclick = openWorlds;
    $b('btnWorldsBack').onclick = () => { UI.hideWorlds(); paused = UI.anyModalOpen(); last = 0; };

    /* --- death screen --- */
    $b('btnNoThanks').onclick = () => { SFX.resume(); UI.showResults(); };
    $b('btnRevive').onclick = () => {
      const b2 = $b('btnRevive');
      b2.style.opacity = '.6';
      YTP.rewarded(() => {
        b2.style.opacity = '';
        revivedThisRun = true;
        // clear the top third so there is somewhere to land, and carry on
        const st = M.s;
        st.bodies = st.bodies.filter(x => x.y > M.H * 0.34);
        st.over = false; st.overT = 0; st.shakes = Math.max(st.shakes, 1);
        deathT = -1;
        UI.hideOver();
        UI.toast('REVIVED');
      }, () => { b2.style.opacity = ''; UI.showResults(); });
    };

    document.getElementById('btnSwap').onclick = () => {
      SFX.resume();
      if (M.s.over || M.s.boss) return;
      if (UI.coins() < UI.COST.swap) { UI.toast('NEED ' + (UI.COST.swap - UI.coins()) + ' MORE'); return; }
      if (M.swapNext()) { UI.spend(UI.COST.swap); UI.setNext(-1); SFX.drop(); }
    };

    document.getElementById('btnHammer').onclick = () => {
      SFX.resume();
      if (M.s.over || M.s.boss) return;
      if (hammerArmed) { disarmHammer(); return; }
      if (UI.coins() < UI.COST.hammer) { UI.toast('NEED ' + (UI.COST.hammer - UI.coins()) + ' MORE'); return; }
      // charged on the SWING, not on arming, so cancelling costs nothing
      hammerArmed = true;
      document.getElementById('btnHammer').classList.add('armed');
      UI.toast('TAP A CHARACTER TO SMASH');
    };

    $b('btnDex').onclick = () => UI.showDex();
    $b('btnDexClose').onclick = () => { UI.hideDex(); paused = UI.anyModalOpen(); last = 0; };

    document.getElementById('btnRevive').onclick = () => {
      const b = document.getElementById('btnRevive');
      b.style.opacity = '.6';
      YTP.rewarded(() => {
        b.style.opacity = '';
        // clear the top third so there is somewhere to land, and carry on
        const s = M.s;
        s.bodies = s.bodies.filter(x => x.y > M.H * 0.34);
        s.over = false; s.overT = 0; s.shakes = Math.max(s.shakes, 1);
        UI.hideOver();
        UI.toast('REVIVED');
      }, () => { b.style.opacity = ''; });
    };

    document.getElementById('shake').onclick = () => {
      SFX.resume();
      if (M.s.shakes > 0) { if (M.shake()) SFX.shake(); return; }
      YTP.rewarded(() => { M.s.shakes++; if (M.shake()) SFX.shake(); });
    };

    /* The old bare toggle used to live here and silently OVERWROTE the pause
       menu handler assigned above, so the button just froze the game instead
       of opening the menu. One handler only. */

  }

  /* ---------------- boot ---------------- */
  async function boot() {
    const qs = new URLSearchParams(location.search);
    window.YTP && YTP.init();
    await X.loadChars();
    try {
      R = X.init(canvas);
    } catch (err) {
      document.body.innerHTML = '<div style="color:#fff;padding:24px;font:16px sans-serif">' +
        'WebGL unavailable: ' + err.message + '</div>';
      return;
    }
    applyBiome(0);
    YTP.firstFrame();                 // frames are on screen from here
    /* MUST await loadData before any saveData, so nothing may read or write
       progress until this resolves. */
    await UI.initSave();
    best = UI.loadBest();
    M.newGame((Date.now() & 0x7fffffff) || 1);
    UI.build();
    bind();
    fit();

    /* Audio follows the YouTube setting; cert forbids our own mute control. */
    YTP.initAudio(on => SFX.mute(!on));
    /* MUST pause on onPause and resume only on onResume - never the Page
       Visibility API. Progress is flushed on pause, as recommended. */
    YTP.onLifecycle(
      () => { paused = true; UI.flushSave(); },
      () => { paused = false; last = 0; }      // reset `last` or dt spikes
    );
    YTP.ready();                      // interactable
    // dev: ?biome=N starts in a biome, ?boss=1 triggers the sequence at once
    if (qs.has('biome')) {
      const bi = Math.max(0, Math.min(M.BIOMES.length - 1, parseInt(qs.get('biome'), 10) || 0));
      M.s.biome = bi;
      applyBiome(bi);
      await X.loadSet(M.BIOMES[bi].set);
      R.refreshAtlas(); UI.rebuildChain();
    }
    if (qs.has('boss')) {
      const r9 = M.TIERS[9].r;
      const mk = x => ({ x: x, y: M.H - r9, vx: 0, vy: 0, t: 9, r: r9,
                         rot: 0, vrot: 0, age: 1, merged: false });
      M.s.bodies.push(mk(-r9 + 0.02), mk(r9 - 0.02));
      for (let k = 0; k < (parseInt(qs.get('boss'), 10) || 30); k++) M.step(1 / 60);
    }

    // dev: ?demo=N plays N scripted drops so a screenshot shows a real board
    if (qs.has('demo')) {
      const n = parseInt(qs.get('demo'), 10) || 14;
      for (let i = 0; i < n; i++) {
        M.s.dropCd = 0;
        M.moveTo(-3.6 + ((i * 2.9) % 7.4));
        M.drop();
        for (let k = 0; k < 26; k++) M.step(1 / 60);
      }
      for (let k = 0; k < 200; k++) M.step(1 / 60);
    }

    // debug, INDEPENDENT of ?demo - these were nested inside the demo branch,
    // so ?coins / ?pop silently did nothing unless a demo was also requested
    const c = parseInt(qs.get('coins'), 10);
    if (!isNaN(c)) UI.addCoins(c - UI.coins());
    if (qs.get('over')) { M.s.over = true; }
    if (qs.get('dex')) setTimeout(() => UI.showDex(), 60);
    if (qs.get('pause')) setTimeout(() => UI.showPause(), 60);
    if (qs.get('worlds')) setTimeout(() => {
      UI.buildWorlds(0, () => {});
      UI.showWorlds();
    }, 60);
    if (qs.get('results')) setTimeout(() => UI.showResults(), 60);
    if (qs.get('font')) setTimeout(() => {
      const el = document.getElementById('score');
      document.title = 'loaded=' + document.fonts.check('700 56px Fredoka') +
        ' family=' + getComputedStyle(el).fontFamily.split(',')[0] +
        ' weight=' + getComputedStyle(el).fontWeight +
        ' n=' + document.fonts.size;
    }, 400);
    if (qs.get('pop')) setTimeout(() => {
      floatScore({ x: 0, y: M.H * 0.5, val: 1234 });
      floatScore({ x: -2, y: M.H * 0.35, val: 900, gold: true });
      // stamped into the title: the elements remove themselves after 820ms, so
      // a DOM dump races them
      document.title = 'PT=' + document.querySelectorAll('.pt').length;
    }, 120);

    last = performance.now();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
  else boot();
})();
