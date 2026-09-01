/* BRAINROT CRAFT - drag two things together and discover a brainrot.

   DOM, not canvas. Every item on the board is an absolutely positioned element,
   so hit-testing, dragging, z-order and the CSS animation work are all free; a
   canvas would mean reimplementing every one of them. There are only ever a few
   dozen elements on screen, so the cost is irrelevant.

   TWO kinds of item, and the distinction is the whole design:
     * INGREDIENTS - emoji. All 54 are available from the start; they are the
       palette, not a reward.
     * BRAINROTS   - the illustrated characters, 33 of them. These are the
       discoveries, and a few are themselves ingredients in later recipes.

   Recipes are SEMANTIC - a brainrot is made of the things its name is made of.
   Banana + Monkey = Banana Monkey. That is guessable, which is the point of the
   genre; an arbitrary tree would be solvable only by brute force. The tree is
   authored and proven reachable offline (scratchpad/recipes2.py), so no
   discovery can be stranded behind a recipe you cannot make.

   Input is TAP-to-spawn from the sidebar, DRAG between pieces on the board.
   Dragging out of a natively-scrolling sidebar fights the scroll on touch, and
   there is no way to have both without a gesture threshold that misfires; the
   split keeps the sidebar scrollable and the board direct. */
(function () {
  const C = {};
  window.CRAFT = C;
  const $ = id => document.getElementById(id);

  let DATA = null;
  let ING = [];                    // ingredient ids, in palette order
  let BR = [];                     // brainrot ids, in set/tier order
  let store = null;
  let discovered = new Set();      // brainrot ids found
  let hints = {};                  // brainrot id -> how many ingredients revealed
  const placed = [];               // {id, el, x, y}
  let dragging = null;
  let zTop = 10;
  let spawnN = 0;

  /* ---------------- YouTube Playables SDK ----------------
     Cert names these exactly. Nothing here may touch the network, and we MUST
     NOT ship our own mute button or use the Page Visibility API. */
  const YT = { present: false };

  YT.init = function () {
    YT.present = !!(window.ytgame && window.ytgame.game);
  };
  YT.firstFrame = function () {
    if (!YT.present) return;
    try { window.ytgame.game.firstFrameReady(); } catch (e) {}
  };
  YT.ready = function () {
    if (!YT.present) return;
    try { window.ytgame.game.gameReady(); } catch (e) {}
  };
  YT.sendScore = function (v) {
    if (!YT.present) return;
    try { window.ytgame.engagement.sendScore({ value: v }); } catch (e) {}
  };

  /* ---------------- sound ----------------
     Follows YouTube's setting, never our own control. The context is built on
     the first gesture because browsers refuse to start one before that. */
  let actx = null, audioOn = true;

  function initAudio() {
    if (!YT.present) { audioOn = true; return; }
    try {
      audioOn = window.ytgame.system.isAudioEnabled();
      window.ytgame.system.onAudioEnabledChange(on => { audioOn = !!on; });
    } catch (e) { audioOn = true; }
  }

  function tone(freq, dur, type, gain, to) {
    if (!audioOn) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const o = actx.createOscillator(), g = actx.createGain();
      const t = actx.currentTime;
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }

  const SFX = {
    pick:  () => tone(430, 0.06, 'sine', 0.05, 620),
    merge: () => tone(520, 0.16, 'triangle', 0.09, 900),
    nope:  () => tone(190, 0.13, 'square', 0.05, 120),
    find:  () => [523, 659, 784, 1047].forEach(
                   (f, i) => setTimeout(() => tone(f, 0.22, 'triangle', 0.10), i * 85))
  };

  /* ---------------- save ----------------
     ONE versioned record, written through this pair only. Inside YouTube the
     SDK is the store and localStorage is never touched; outside it, the reverse.
     saveData MUST NOT run before loadData resolves. */
  const KEY = 'brcraft_v1';
  let loaded = false, saveTimer = 0;

  function blank() { return { v: 1, d: [], h: {} }; }

  function adopt(dst, o) {
    if (o && o.v === 1) {
      if (Array.isArray(o.d)) dst.d = o.d.filter(n => typeof n === 'number');
      if (o.h && typeof o.h === 'object') dst.h = o.h;
    }
    return dst;
  }

  function initSave() {
    store = blank();
    if (!YT.present) {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) adopt(store, JSON.parse(raw));
      } catch (e) {}
      loaded = true;
      return Promise.resolve(store);
    }
    return window.ytgame.game.loadData().then(raw => {
      if (raw) { try { adopt(store, JSON.parse(raw)); } catch (e) {} }
      loaded = true; return store;
    }, () => { loaded = true; return store; });
  }

  function save() {
    if (!loaded) return;
    store.d = [...discovered];
    store.h = hints;
    const json = JSON.stringify(store);
    if (YT.present) {
      // coalesced: cert allows 64KiB a flush, but writing on every tap is waste
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try { window.ytgame.game.saveData(json); } catch (e) {}
      }, 500);
      return;
    }
    try { localStorage.setItem(KEY, json); } catch (e) {}
  }

  function flushSave() {
    if (!loaded || !YT.present) return;
    clearTimeout(saveTimer);
    store.d = [...discovered]; store.h = hints;
    try { window.ytgame.game.saveData(JSON.stringify(store)); } catch (e) {}
  }

  /* ---------------- item rendering ---------------- */
  function art(id) {
    const it = DATA.items[id];
    if (it.kind === 'br') {
      return '<img src="assets/' + it.set + '/tier' + it.tier +
             '.png" alt="" draggable="false">';
    }
    return '<span class="art">' + it.emoji + '</span>';
  }

  /* Everything the player can currently use, ingredients first so the palette
     stays in a stable place while discoveries accumulate below it. */
  function palette() {
    return ING.concat(BR.filter(id => discovered.has(id)));
  }

  /* ---------------- sidebar ---------------- */
  function buildSide() {
    const grid = $('grid');
    grid.innerHTML = '';
    for (const id of palette()) {
      const it = DATA.items[id];
      const el = document.createElement('div');
      el.className = 'cell' + (it.kind === 'br' ? ' br' : '');
      el.dataset.id = id;
      el.innerHTML = art(id) + '<span class="nm">' + it.name + '</span>';
      grid.appendChild(el);
    }
    refreshCounts();
  }

  function refreshCounts() {
    const n = discovered.size, total = BR.length;
    $('count').textContent = n + '/' + total;
    $('badgeSearch').textContent = palette().length;
    const left = total - n;
    const bd = $('badgeDex');
    bd.textContent = left;
    bd.classList.toggle('hidden', left === 0);
  }

  /* ---------------- board ---------------- */
  function boardRect() { return $('board').getBoundingClientRect(); }

  function spawn(id, x, y, fresh) {
    const it = DATA.items[id];
    const el = document.createElement('div');
    el.className = 'piece' + (fresh ? ' fresh' : '');
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.zIndex = ++zTop;
    el.innerHTML = art(id) + '<span class="nm">' + it.name + '</span>';
    $('board').appendChild(el);
    const p = { id: id, el: el, x: x, y: y };
    placed.push(p);
    if (fresh) setTimeout(() => el.classList.remove('fresh'), 500);
    return p;
  }

  /* Tapped items land near the middle on a widening spiral, so repeated taps
     never stack exactly on top of one another and become one unclickable pile. */
  function spawnCentre(id) {
    const b = boardRect();
    const w = pieceW();
    const a = spawnN * 2.399963, r = 16 + spawnN * 13;      // golden-angle spiral
    spawnN++;
    let x = b.width * 0.5 - w / 2 + Math.cos(a) * r;
    let y = b.height * 0.5 - w / 2 + Math.sin(a) * r;
    x = Math.min(Math.max(6, x), Math.max(6, b.width - w - 6));
    y = Math.min(Math.max(96, y), Math.max(96, b.height - w - 40));
    hideTip();
    return spawn(id, x, y, true);
  }

  function hideTip() {
    const t = $('tip');
    if (t && !t.classList.contains('off')) t.classList.add('off');
  }

  /* An empty board explains nothing, so the first session opens with a handful
     of ingredients already scattered - including one pair that combines, so the
     very first thing the player tries can succeed. */
  const OPENING = ['Banana', 'Monkey', 'Cat', 'Fish', 'Ice', 'Cow'];

  function dealOpening() {
    const b = boardRect(), w = pieceW();
    const byName = {};
    for (const id of ING) byName[DATA.items[id].name] = id;
    const n = OPENING.length;
    const top = 132, bot = 150;                       // header, bottom bar + tip
    const cy = top + Math.max(0, b.height - top - bot) / 2;
    const rx = Math.min(b.width * 0.30, 210);
    const ry = Math.min(Math.max(0, b.height - top - bot) * 0.36, 150);
    OPENING.forEach((nm, i) => {
      const id = byName[nm];
      if (id === undefined) return;
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const x = b.width * 0.5 - w / 2 + Math.cos(a) * rx;
      const y = cy - w / 2 + Math.sin(a) * ry;
      spawn(id,
            Math.min(Math.max(6, x), Math.max(6, b.width - w - 6)),
            Math.min(Math.max(top - 40, y), Math.max(top - 40, b.height - w - 40)),
            false);
    });
  }

  let pwCache = 0;
  function pieceW() {
    if (!pwCache) {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--pw');
      pwCache = parseFloat(v) || 104;
    }
    return pwCache;
  }

  function removePiece(p) {
    const i = placed.indexOf(p);
    if (i >= 0) placed.splice(i, 1);
    p.el.remove();
  }

  function clearBoard() {
    while (placed.length) removePiece(placed[0]);
    spawnN = 0;
  }

  /* Two pieces combine when their CENTRES are close, not when their boxes merely
     touch. Box overlap fires constantly while dragging past things, which reads
     as the board grabbing at you. */
  function targetUnder(drag) {
    const r = drag.el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bestD = 1e9;
    for (const p of placed) {
      if (p === drag) continue;
      const q = p.el.getBoundingClientRect();
      const d = Math.hypot(q.left + q.width / 2 - cx, q.top + q.height / 2 - cy);
      if (d < Math.max(r.width, q.width) * 0.62 && d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  function tryCombine(a, b) {
    const key = Math.min(a.id, b.id) + '+' + Math.max(a.id, b.id);
    const res = DATA.recipes[key];
    if (res === undefined) {
      // a clear "no", so the player knows the pair really was considered
      a.el.classList.remove('nope'); void a.el.offsetWidth;
      a.el.classList.add('nope');
      SFX.nope();
      return false;
    }
    const r = b.el.getBoundingClientRect(), bd = boardRect();
    const x = r.left - bd.left, y = r.top - bd.top;
    const isNew = !discovered.has(res);

    removePiece(a);
    removePiece(b);
    const p = spawn(res, x, y, true);

    if (isNew) {
      discovered.add(res);
      save();
      buildSide();
      buildDex();
      announce(DATA.items[res].name);
      SFX.find();
      YT.sendScore(discovered.size);
    } else {
      SFX.merge();
    }
    burst(x + pieceW() / 2, y + pieceW() * 0.42, isNew);
    return true;
  }

  function announce(name) {
    const el = $('toast');
    $('toastName').textContent = name;
    el.classList.remove('on'); void el.offsetWidth;
    el.classList.add('on');
    setTimeout(() => el.classList.remove('on'), 1900);
  }

  function burst(x, y, big) {
    const host = $('fx'), bd = boardRect();
    const n = big ? 18 : 8;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      const a = (i / n) * Math.PI * 2 + (big ? 0.2 : 0);
      const d = (big ? 78 : 44) + Math.random() * 34;
      s.className = 'spark' + (big ? ' big' : '');
      s.style.left = (bd.left + x) + 'px';
      s.style.top = (bd.top + y) + 'px';
      s.style.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + 'px');
      s.style.setProperty('--dy', (Math.sin(a) * d).toFixed(1) + 'px');
      host.appendChild(s);
      setTimeout(() => s.remove(), 700);
    }
  }

  /* ---------------- dragging ---------------- */
  function startDrag(p, ev) {
    const r = p.el.getBoundingClientRect();
    dragging = { p: p, ox: ev.clientX - r.left, oy: ev.clientY - r.top, moved: false };
    p.el.classList.add('drag');
    p.el.style.zIndex = ++zTop;
  }

  function onDown(ev) {
    if (ev.button !== undefined && ev.button !== 0) return;
    hideTip();
    const pe = ev.target.closest && ev.target.closest('.piece');
    if (!pe) return;
    const p = placed.find(q => q.el === pe);
    if (!p) return;
    startDrag(p, ev);
    SFX.pick();
    ev.preventDefault();
  }

  function onMove(ev) {
    if (!dragging) return;
    const bd = boardRect(), p = dragging.p, w = pieceW();
    dragging.moved = true;
    p.x = Math.max(-w * 0.25,
          Math.min(bd.width - w * 0.75, ev.clientX - bd.left - dragging.ox));
    p.y = Math.max(-w * 0.1,
          Math.min(bd.height - w * 0.4, ev.clientY - bd.top - dragging.oy));
    p.el.style.left = p.x + 'px';
    p.el.style.top = p.y + 'px';

    const t = targetUnder(p);
    for (const q of placed) q.el.classList.toggle('hot', q === t);
  }

  function onUp(ev) {
    if (!dragging) return;
    const p = dragging.p;
    p.el.classList.remove('drag');
    for (const q of placed) q.el.classList.remove('hot');

    // dropped over the sidebar: put it back, which is how you tidy the board
    const overSide = ev && ev.clientX !== undefined &&
                     ev.clientX > boardRect().right;
    const t = overSide ? null : targetUnder(p);
    dragging = null;
    if (overSide) { removePiece(p); SFX.pick(); return; }
    if (t) tryCombine(p, t);
  }

  /* ---------------- collection ---------------- */
  function buildDex() {
    const g = $('dexGrid');
    g.innerHTML = '';
    for (const id of BR) {
      const it = DATA.items[id];
      const got = discovered.has(id);
      const el = document.createElement('div');
      el.className = 'dcell' + (got ? '' : ' lock');
      el.dataset.id = id;
      const nm = got ? it.name : '???';
      el.innerHTML = '<img src="assets/' + it.set + '/tier' + it.tier +
                     '.png" alt="" draggable="false">' +
                     '<div class="nm">' + nm + '</div>' +
                     '<div class="hint">' + hintText(id) + '</div>';
      g.appendChild(el);
    }
  }

  /* Tapping a locked entry reveals one ingredient, then the other. Free, but
     deliberate - the valve for being stuck, without a currency to balance. */
  function hintText(id) {
    if (discovered.has(id)) return '';
    const n = hints[id] | 0;
    if (!n) return 'TAP FOR HINT';
    const pair = DATA.madeBy[id];
    if (!pair) return '';
    const shown = pair.slice(0, n).map(i => {
      const it = DATA.items[i];
      return it.kind === 'ing' ? it.emoji : it.name;
    });
    return shown.join(' + ') + (n < 2 ? ' + ?' : '');
  }

  function onDexTap(ev) {
    const cell = ev.target.closest && ev.target.closest('.dcell');
    if (!cell) return;
    const id = +cell.dataset.id;
    if (discovered.has(id)) { spawnCentre(id); closeSheets(); return; }
    hints[id] = Math.min(2, (hints[id] | 0) + 1);
    save();
    cell.querySelector('.hint').textContent = hintText(id);
    SFX.pick();
  }

  /* ---------------- search ---------------- */
  function buildQuery() {
    const term = $('q').value.trim().toLowerCase();
    const list = $('qList');
    list.innerHTML = '';
    const ids = palette().filter(
      id => !term || DATA.items[id].name.toLowerCase().indexOf(term) >= 0);
    for (const id of ids.slice(0, 120)) {
      const it = DATA.items[id];
      const el = document.createElement('div');
      el.className = 'cell' + (it.kind === 'br' ? ' br' : '');
      el.dataset.id = id;
      el.innerHTML = art(id) + '<span class="nm">' + it.name + '</span>';
      list.appendChild(el);
    }
  }

  /* ---------------- sheets ---------------- */
  function openSheet(id) {
    closeSheets();
    $(id).classList.add('on');
  }

  function closeSheets() {
    $('dex').classList.remove('on');
    $('search').classList.remove('on');
  }

  /* ---------------- boot ---------------- */
  C.boot = function () {
    YT.init();
    initAudio();

    fetch('assets/recipes.json')
      .then(r => r.json())
      .then(d => {
        DATA = d;
        ING = d.items.filter(i => i.kind === 'ing').map(i => i.id);
        BR = d.items.filter(i => i.kind === 'br').map(i => i.id);
        return initSave();
      })
      .then(() => {
        discovered = new Set(store.d.filter(id => DATA.items[id] &&
                                                  DATA.items[id].kind === 'br'));
        hints = store.h || {};
        buildSide();
        buildDex();
        bind();
        if (!discovered.size) dealOpening();
        else hideTip();
        YT.firstFrame();
        YT.ready();
      })
      .catch(err => {
        document.body.innerHTML =
          '<div style="padding:24px;font:16px sans-serif;color:#5a3620">' +
          'Could not load the recipe list: ' + err.message + '</div>';
      });
  };

  function bind() {
    addEventListener('pointerdown', onDown);
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onUp);

    $('grid').addEventListener('click', ev => {
      const cell = ev.target.closest('.cell');
      if (!cell) return;
      spawnCentre(+cell.dataset.id);
      SFX.pick();
    });

    const grid = $('grid');
    const page = dir => grid.scrollBy({ top: dir * grid.clientHeight * 0.8,
                                        behavior: 'smooth' });
    $('sideUp').onclick = () => page(-1);
    $('sideDown').onclick = () => page(1);

    $('btnClear').onclick = clearBoard;
    $('btnDex').onclick = () => { buildDex(); openSheet('dex'); };
    $('btnSearch').onclick = () => {
      $('q').value = '';
      buildQuery();
      openSheet('search');
      setTimeout(() => $('q').focus(), 30);
    };

    $('dexGrid').addEventListener('click', onDexTap);
    $('q').addEventListener('input', buildQuery);
    $('qList').addEventListener('click', ev => {
      const cell = ev.target.closest('.cell');
      if (!cell) return;
      spawnCentre(+cell.dataset.id);
      closeSheets();
    });

    for (const b of document.querySelectorAll('.btn.close')) b.onclick = closeSheets;
    for (const s of document.querySelectorAll('.sheet')) {
      s.addEventListener('pointerdown', ev => {
        if (ev.target === s) closeSheets();          // tap the scrim to dismiss
      });
    }

    // MUST use the SDK lifecycle, never the Page Visibility API
    if (YT.present) {
      try {
        window.ytgame.system.onPause(() => {
          flushSave();
          if (actx && actx.state === 'running') actx.suspend();
        });
        window.ytgame.system.onResume(() => {
          if (actx && actx.state === 'suspended') actx.resume();
        });
      } catch (e) {}
    }

    addEventListener('resize', () => { pwCache = 0; });
  }
})();
