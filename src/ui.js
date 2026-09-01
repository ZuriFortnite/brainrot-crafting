/* BRAINROT DROP - audio, Playables SDK shim, HUD. */
(function () {
  const M = window.MERGE, X = window.GFX;
  const UI = {};
  window.UI = UI;
  const $ = id => document.getElementById(id);

  /* ---------------- audio: synthesised, no asset files ---------------- */
  let ac = null, muted = false;
  const SFX = {};
  window.SFX = SFX;

  SFX.resume = function () {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
    if (ac.state === 'suspended') ac.resume();
  };
  SFX.mute = function (m) { muted = m; };

  function tone(f, dur, type, vol, to) {
    if (!ac || muted) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, ac.currentTime);
    if (to) o.frequency.exponentialRampToValueAtTime(to, ac.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.07, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + dur + 0.02);
  }
  SFX.drop = () => tone(240, 0.09, 'sine', 0.06, 150);
  // merge pitch climbs with tier, so the chain audibly escalates
  SFX.merge = t => tone(300 + t * 62, 0.16, 'triangle', 0.10, 520 + t * 90);
  SFX.big   = () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.20, 'triangle', 0.11), i * 80)); };
  SFX.over  = () => tone(300, 0.5, 'sawtooth', 0.10, 70);
  SFX.shake = () => tone(120, 0.3, 'square', 0.07, 300);

  /* ---------------- YouTube Playables SDK shim ---------------- */
  const YT = { present: false };
  window.YTP = YT;
  YT.init = function () {
    YT.present = !!(window.ytgame && window.ytgame.game);
  };
  /* Cert names these exactly: firstFrameReady once frames are on screen,
     gameReady only when the game is actually interactable. */
  YT.firstFrame = function () {
    if (!YT.present) return;
    try { window.ytgame.game.firstFrameReady(); } catch (e) {}
  };
  YT.ready = function () {
    if (!YT.present) return;
    try { window.ytgame.game.gameReady(); } catch (e) {}
  };
  YT.rewarded = function (ok, no) {
    // Outside YouTube the reward is granted locally so the flow stays testable.
    if (!YT.present) { ok && ok(); return; }
    try {
      window.ytgame.ads.requestRewardedAd('reward')
        .then(got => (got === false ? (no && no()) : (ok && ok())), () => no && no());
    } catch (e) { no && no(); }
  };
  YT.interstitial = function (done) {
    if (!YT.present) { done && done(); return; }
    try { window.ytgame.ads.requestInterstitialAd().then(() => done && done(), () => done && done()); }
    catch (e) { done && done(); }
  };
  YT.sendScore = function (v) {
    if (!YT.present) return;
    try { window.ytgame.engagement.sendScore({ value: v }); } catch (e) {}
  };
  /* Audio follows YOUTUBE's setting. Cert forbids shipping our own mute button
     and requires honouring isAudioEnabled / onAudioEnabledChange. */
  YT.initAudio = function (apply) {
    if (!YT.present) { apply(true); return; }
    try {
      apply(window.ytgame.system.isAudioEnabled());
      window.ytgame.system.onAudioEnabledChange(on => apply(on));
    } catch (e) { apply(true); }
  };
  YT.onLifecycle = function (pause, resume) {
    if (!YT.present) return;
    // MUST use these, never the Page Visibility API
    try { window.ytgame.system.onPause(pause); window.ytgame.system.onResume(resume); } catch (e) {}
  };

  /* ---------------- save ----------------
     ONE versioned record. The old build wrote two bare integers under separate
     keys; those are migrated in on first load so nobody loses a best score.
     Everything reads and writes through this store - scattered localStorage
     calls are how save formats drift apart. */
  const SAVE_KEY = 'brdrop_save_v2';
  const OLD_BEST = 'brdrop_v1', OLD_SEEN = 'brdrop_seen_v1';
  const LOCK_FROM = 7;                 // tiers 7..10 start hidden on the chain
  const NSETS = 3, NCHARS = 11;

  function blank() {
    return { v: 2, best: 0, coins: 0, seen: LOCK_FROM - 1, dex: [0, 0, 0], biomes: 1 };
  }

  let store = null, loaded = false, saveTimer = 0;

  function localRead() {
    const d = blank();
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) return adopt(d, JSON.parse(raw));
      const b2 = parseInt(localStorage.getItem(OLD_BEST) || '', 10);
      if (!isNaN(b2)) d.best = b2;
      const sn = parseInt(localStorage.getItem(OLD_SEEN) || '', 10);
      if (!isNaN(sn)) d.seen = Math.max(LOCK_FROM - 1, sn);
    } catch (e) {}
    return d;
  }

  function adopt(d, o) {
    if (o && o.v === 2) {
      d.best = o.best | 0; d.coins = o.coins | 0;
      d.seen = Math.max(LOCK_FROM - 1, o.seen | 0);
      d.biomes = (o.biomes | 0) || 1;
      if (Array.isArray(o.dex)) for (let i = 0; i < NSETS; i++) d.dex[i] = o.dex[i] | 0;
    }
    return d;
  }

  /* MUST await loadData before the first saveData, and MUST NOT use any other
     mechanism for progress when running inside YouTube. localStorage remains
     the store only for local development, where there is no SDK. */
  UI.initSave = function () {
    if (!window.YTP || !YTP.present) {
      store = localRead(); loaded = true; return Promise.resolve(store);
    }
    store = blank();
    return window.ytgame.game.loadData().then(raw => {
      if (raw) { try { adopt(store, JSON.parse(raw)); } catch (e) {} }
      loaded = true; return store;
    }, () => { loaded = true; return store; });
  };

  function load() { return store || (store = localRead(), loaded = true, store); }

  function save() {
    if (!loaded) return;                       // never write before the load lands
    const json = JSON.stringify(store);
    if (window.YTP && YTP.present) {
      // coalesce: cert allows 64KiB per flush but frequent writes are wasteful
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try { window.ytgame.game.saveData(json); } catch (e) {}
      }, 400);
      return;
    }
    try { localStorage.setItem(SAVE_KEY, json); } catch (e) {}
  }
  UI.flushSave = function () {
    if (!loaded) return;
    clearTimeout(saveTimer);
    if (window.YTP && YTP.present) {
      try { window.ytgame.game.saveData(JSON.stringify(store)); } catch (e) {}
    }
  };

  UI.data = load;
  UI.NSETS = NSETS;
  UI.NCHARS = NCHARS;

  UI.loadBest = function () { return load().best; };
  UI.saveBest = function (v) { load().best = v | 0; save(); };
  UI.loadSeen = function () { return load().seen; };
  UI.saveSeen = function (v) { load().seen = Math.max(LOCK_FROM - 1, v | 0); save(); };

  UI.coins = function () { return load().coins; };
  UI.addCoins = function (n) { load().coins += n | 0; save(); return store.coins; };
  UI.spend = function (n) {
    const d = load();
    if (d.coins < n) return false;
    d.coins -= n; save(); return true;
  };

  /* Dex: one 11-bit mask per cast. Returns how many were newly recorded, so the
     caller can pay a first-time bonus without tracking it separately. */
  UI.recordDex = function (setIdx, madeMask) {
    const d = load();
    const before = d.dex[setIdx] | 0;
    const after = before | (madeMask & ((1 << NCHARS) - 1));
    let fresh = 0;
    for (let i = 0; i < NCHARS; i++) if ((after & (1 << i)) && !(before & (1 << i))) fresh++;
    d.dex[setIdx] = after;
    if (fresh) save();
    return fresh;
  };
  UI.dexMask = function (setIdx) { return load().dex[setIdx] | 0; };
  UI.dexCount = function () {
    const d = load(); let n = 0;
    for (let s2 = 0; s2 < NSETS; s2++)
      for (let i = 0; i < NCHARS; i++) if (d.dex[s2] & (1 << i)) n++;
    return n;
  };

  UI.biomeUnlocked = function (i) { return !!(load().biomes & (1 << i)); };
  UI.unlockBiome = function (i) {
    const d = load();
    if (d.biomes & (1 << i)) return false;
    d.biomes |= (1 << i); save(); return true;
  };

  /* ---------------- economy tuning ----------------
     Opening values only - these need a balance pass against real runs. SWAP is
     priced to be usable most runs; HAMMER to be a genuine decision. */
  UI.COST = { swap: 60, hammer: 150 };
  UI.BIOME_COST = [0, 1200, 3000];
  UI.coinsFor = function (score) { return Math.floor(score / 100); };
  UI.DEX_BONUS = 25;              // per character recorded for the first time

  /* ---------------- collection ---------------- */
  UI.buildDex = function () {
    const rows = $('dexRows');
    if (!rows) return;
    rows.innerHTML = '';
    const setKeys = ['set0', 'set1', 'set2'];
    const labels = ['MEADOW', 'DESERT', 'TUNDRA'];
    for (let si = 0; si < UI.NSETS; si++) {
      const mask = UI.dexMask(si);
      const row = document.createElement('div');
      row.className = 'dexRow';
      const nm = document.createElement('div');
      nm.className = 'rowName';
      nm.textContent = labels[si];
      row.appendChild(nm);
      const names = X.SET_NAMES[setKeys[si]] || [];
      for (let i = 0; i < UI.NCHARS; i++) {
        const got = !!(mask & (1 << i));
        const cell = document.createElement('div');
        cell.className = 'dc' + (got ? '' : ' locked');
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = 'assets/' + setKeys[si] + '/tier' + i + '.png';
        img.alt = '';
        cell.appendChild(img);
        cell.title = got ? (names[i] || '') : '???';
        row.appendChild(cell);
      }
      rows.appendChild(row);
    }
    $('dexSub').textContent = UI.dexCount() + ' / ' + (UI.NSETS * UI.NCHARS);
  };
  UI.showDex = function () { UI.buildDex(); $('dex').classList.add('on'); };
  UI.hideDex = function () { $('dex').classList.remove('on'); };

  /* ---------------- worlds ----------------
     A world IS a cast: picking one is the only way to reach the other two sets
     on demand, since the boss route almost nobody sees. */
  const WORLDS = [
    { name: 'MEADOW', set: 'set0', icon: 9 },
    { name: 'DESERT', set: 'set1', icon: 9 },
    { name: 'TUNDRA', set: 'set2', icon: 9 }
  ];

  UI.buildWorlds = function (sel, onPick) {
    const host = $('worldGrid');
    if (!host) return;
    host.innerHTML = '';
    WORLDS.forEach((w, i) => {
      const open = UI.biomeUnlocked(i);
      const el = document.createElement('div');
      el.className = 'wpill' + (i === sel ? ' sel' : '') + (open ? '' : ' locked');
      const txt = document.createElement('div');
      if (open) {
        txt.textContent = w.name;
      } else {
        txt.innerHTML = w.name + '<div class="cost"><span class="coin"></span>' +
                        UI.BIOME_COST[i] + '</div>';
      }
      el.appendChild(txt);
      const img = document.createElement('img');
      img.src = 'assets/' + w.set + '/tier' + w.icon + '.png';
      img.alt = '';
      el.appendChild(img);
      if (i === sel) {
        const tag = document.createElement('div');
        tag.className = 'tag'; tag.textContent = 'PLAYING';
        el.appendChild(tag);
      }
      el.onclick = function () {
        if (open) { onPick(i); return; }
        if (UI.spend(UI.BIOME_COST[i])) {
          UI.unlockBiome(i);
          UI.toast('UNLOCKED ' + w.name + '!');
          onPick(i);
        } else {
          UI.toast('NEED ' + (UI.BIOME_COST[i] - UI.coins()) + ' MORE');
          UI.buildWorlds(sel, onPick);
        }
      };
      host.appendChild(el);
    });
  };
  UI.showWorlds = function () { $('worlds').classList.add('on'); };
  UI.hideWorlds = function () { $('worlds').classList.remove('on'); };
  UI.showPause = function () { $('pause').classList.add('on'); };
  UI.hidePause = function () { $('pause').classList.remove('on'); };
  UI.anyModalOpen = function () {
    return ['pause', 'worlds', 'dex', 'results'].some(id => $(id).classList.contains('on'));
  };

  /* ---------------- HUD ---------------- */
  let nextShown = -1, chainEls = [], lastBiggest = 0, toastT = 0;
  let seenMax = 0, lastCombo = 0, shownCoins = -1;

  UI.build = function () {
    const chain = $('chain');
    chain.innerHTML = '';
    chainEls = [];
    seenMax = UI.loadSeen();
    for (let i = 0; i < X.CAST.length; i++) {
      const w = document.createElement('div');
      w.className = 'cw' + (i > seenMax ? ' lock' : '') +
                    (i === X.CAST.length - 1 ? ' boss' : '');
      w.appendChild(X.charCanvas(i, 68));
      w.title = i > seenMax ? '???' : X.NAMES[i];
      chain.appendChild(w);
      chainEls.push(w);
    }
  };

  UI.setNext = function (t) {
    if (t < 0) { nextShown = -1; return; }     // force a redraw after a swap
    if (t === nextShown) return;
    nextShown = t;
    const b = $('nextBox');
    b.innerHTML = '';
    const cv = X.charCanvas(t, 104);
    cv.className = 'swap';              // triggers the pop-in
    b.appendChild(cv);
  };

  UI.toast = function (msg) {
    const el = $('toast');
    el.textContent = msg;
    el.style.opacity = 1;
    el.classList.remove('show');
    void el.offsetWidth;                // restart the animation
    el.classList.add('show');
    toastT = 1.1;
  };

  /* Numbers COUNT toward their target instead of snapping. A score that jumps
     from 300 to 900 reads as a number changing; one that rolls up reads as a
     reward, and it gives the punch animation something to punctuate. */
  let shownScore = 0;

  UI.frame = function (dt) {
    const s = M.s;
    if (shownScore !== s.score) {
      const gap = s.score - shownScore;
      if (Math.abs(gap) < 2) shownScore = s.score;
      else shownScore += gap * Math.min(1, dt * 9) + Math.sign(gap);
      const el = $('score');
      el.textContent = Math.round(shownScore);
      if (gap > 0 && !el.classList.contains('pop')) {
        el.classList.add('pop');
        setTimeout(() => el.classList.remove('pop'), 300);
      }
    }
    UI.setNext(s.next);

    const sk = $('shake');
    sk.classList.toggle('off', s.shakes <= 0 || s.over);

    const c = UI.coins();
    if (c !== shownCoins) {
      shownCoins = c;
      $('coinN').textContent = c;
      const pr = $('purse');
      pr.classList.remove('bump'); void pr.offsetWidth; pr.classList.add('bump');
    }
    $('btnSwap').classList.toggle('broke', c < UI.COST.swap || s.over);
    $('btnHammer').classList.toggle('broke', c < UI.COST.hammer || s.over);

    if (s.biggest > lastBiggest) {
      lastBiggest = s.biggest;
      const idx = Math.min(s.biggest, chainEls.length - 1);
      const el = chainEls[idx];
      const firstTime = s.biggest > seenMax;
      if (el) {
        if (firstTime) {
          el.classList.remove('lock');
          el.title = X.NAMES[idx];
          el.classList.add('reveal');
          setTimeout(() => el.classList.remove('reveal'), 720);
        }
        el.classList.remove('hit');
        void el.offsetWidth;              // restart the animation
        el.classList.add('hit');
      }
      if (firstTime) {
        seenMax = s.biggest;
        UI.saveSeen(seenMax);
        UI.toast('NEW! ' + X.NAMES[idx]);
      } else if (s.biggest >= 5) {
        UI.toast(X.NAMES[idx] + '!');
      }
      SFX.big();
    }

    // combo readout - the multiplier is worthless if it is invisible
    const cb = $('combo');
    if (s.combo >= 2 && !s.over) {
      const mult = Math.min(4, 1 + 0.30 * (s.combo - 1));
      cb.textContent = 'COMBO x' + s.combo + '  ' + mult.toFixed(2) + 'x';
      cb.classList.add('on');
      if (s.combo !== lastCombo) {
        cb.classList.add('pop');
        setTimeout(() => cb.classList.remove('pop'), 130);
      }
    } else {
      cb.classList.remove('on');
    }
    lastCombo = s.combo;

    UI.tickOver(dt);

    if (toastT > 0) {
      toastT -= dt;
      if (toastT <= 0) $('toast').style.opacity = 0;
    }
  };

  /* The revive offer is time limited - an offer that sits there forever is
     ignored, and the countdown is what makes it a decision. */
  const REVIVE_SECS = 15;
  let overT = 0, overPending = null, onExpire = null;

  UI.showOver = function (best, earned, prevBest, canRevive, expire) {
    $('overScore').textContent = M.s.score;
    $('overBestN').textContent = best;
    $('overTitle').textContent = M.s.score > prevBest ? 'NEW BEST!' : 'OH NO!';
    const gap = prevBest - M.s.score;
    overPending = { best: best, earned: earned, prevBest: prevBest, gap: gap };
    onExpire = expire;
    const rv = $('btnRevive');
    rv.classList.toggle('gone', !canRevive);
    overT = canRevive ? REVIVE_SECS : 0;
    $('reviveRing').textContent = Math.ceil(overT);
    $('earn').innerHTML = earned > 0
      ? '+' + earned + ' <span class="coin"></span> earned' : '';
    $('over').classList.add('on');
    if (!canRevive) UI.showResults();
  };

  UI.tickOver = function (dt) {
    if (overT <= 0) return;
    overT -= dt;
    $('reviveRing').textContent = Math.max(0, Math.ceil(overT));
    // the offer starts pulsing once it is nearly gone
    $('btnRevive').classList.toggle('hurry', overT < 5);
    if (overT <= 0) { overT = 0; onExpire && onExpire(); }
  };

  UI.showResults = function () {
    const o = overPending || { best: 0, earned: 0, prevBest: 0, gap: 0 };
    overT = 0;
    $('over').classList.remove('on');
    $('resScore').textContent = M.s.score;
    /* Near miss: "340 from your best" pulls another run far harder than a bare
       best line does. */
    if (M.s.score > o.prevBest) $('resSub').textContent = 'NEW BEST!';
    else if (o.gap > 0 && o.gap <= o.prevBest * 0.15)
      $('resSub').textContent = 'only ' + o.gap + ' from your best!';
    else $('resSub').textContent = 'best ' + o.best;
    $('resEarn').innerHTML = o.earned > 0
      ? '+' + o.earned + ' <span class="coin"></span> earned' : '';
    $('results').classList.add('on');
  };

  UI.hideOver = function () {
    overT = 0;
    $('over').classList.remove('on');
    $('results').classList.remove('on');
  };
  UI.rebuildChain = function () { lastBiggest = 0; UI.build(); UI.setNext(-1); };
  UI.banner = function (text) {
    const el = $('banner');
    el.textContent = text;
    el.classList.remove('on'); void el.offsetWidth;
    el.classList.add('on');
    setTimeout(() => el.classList.remove('on'), 1500);
  };
  UI.resetChain = function () { lastBiggest = 0; lastCombo = 0; shownScore = 0; };
})();
