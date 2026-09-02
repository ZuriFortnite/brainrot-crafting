/* BRAINROT CRAFTING - a 3x3 table, a plot, and an economy.

   THE LOOP
     1. Coins buy ingredients straight into a 3x3 crafting table; taking one
        back out refunds it, so a misclick never costs anything.
     2. ONE of each of the right ingredients yields a brainrot, which walks onto
        your plot. Harder brainrots want more distinct ingredients - two at the
        bottom of a set, five at the top.
     3. Brainrots earn coins forever, and pay a lump sum when you tap them.
     4. DRAG one onto another to merge: identical ones level up, different ones
        fuse into a mutant with its own palette and a rate above either parent.
     5. REBIRTH resets the plot and the purse for a permanent income multiplier,
        the next band of ingredients, and ANOTHER CRAFTING TABLE. That is what
        paces the 33 discoveries into acts instead of one flat list, and the
        extra table makes a late act feel different to play, not just bigger.

   Recipes are SHAPELESS and ONE OF EACH: what is in the grid matters, not which
   cell it sits in, and never how many copies. Counting out duplicates was
   busywork with no decision in it; a WIDER recipe is the real difficulty knob.

   THE TABLE FILTERS ITSELF. Once one ingredient is down, anything that cannot
   pair with it greys out, so you are always choosing between things that could
   actually work.

   NOTHING IS NAMED except the ingredients. The generated character art was made
   separately from any name list, so every name we invented eventually disagreed
   with its picture; a wrong name is worse than none. The art identifies the
   creature and the recipe line says what makes it.

   DOM, not canvas: a few dozen elements, and hit-testing, z-order and the whole
   animation pass come free. */
(function () {
  /* Bumped with every deploy and appended to the data fetch. index.html already
     cache-busts this script, but craft.json did not - so a balance change could
     ship while every returning player kept the old numbers from cache, which is
     exactly what happened the first time the curve was retuned. */
  const VER = 'p51';

  const P = {};
  window.PLOT = P;
  const $ = id => document.getElementById(id);

  let D = null;                    // assets/craft.json
  let B = null;                    // D.balance
  let S = null;                    // the save record
  let ING = [], BRS = [];
  let seen = new Set();
  let RECIPES = [];                // [{need:{id:count}, total, out}]

  const grid = new Array(9).fill(null);   // {id} - always a bought ingredient
  let lastT = 0, acc = 0, mAcc = 0;
  const cool = {};                 // plot slot -> time its tap bonus recharges
  let meters = [];                 // per-slot recharge bar elements

  /* ---------------- YouTube Playables SDK ----------------
     Cert names these exactly. No network calls, no Page Visibility API, and we
     MUST NOT ship our own mute button. */
  /* `raw` - the SDK object is on the page at all.
     `present` - it has been PROVEN to persist, i.e. we really are on YouTube.
     Everything user-facing keys off `present`, so the public demo build grants
     rewards locally and saves locally instead of silently losing both. */
  const YT = { present: false, raw: false };

  YT.init = () => { YT.raw = !!(window.ytgame && window.ytgame.game); };
  YT.firstFrame = () => {
    if (YT.present) try { window.ytgame.game.firstFrameReady(); } catch (e) {}
  };
  YT.ready = () => {
    if (YT.present) try { window.ytgame.game.gameReady(); } catch (e) {}
  };
  YT.score = v => {
    if (YT.present) try { window.ytgame.engagement.sendScore({ value: v }); } catch (e) {}
  };
  /* Outside YouTube the reward is granted locally, so every ad-gated path stays
     playable and testable in development. */
  YT.rewarded = (ok, no) => {
    if (!YT.present) { ok && ok(); return; }
    try {
      window.ytgame.ads.requestRewardedAd('reward').then(
        got => (got === false ? (no && no()) : (ok && ok())), () => no && no());
    } catch (e) { no && no(); }
  };
  YT.interstitial = done => {
    if (!YT.present) { done && done(); return; }
    try {
      window.ytgame.ads.requestInterstitialAd()
        .then(() => done && done(), () => done && done());
    } catch (e) { done && done(); }
  };

  /* ---------------- sound ----------------
     Follows YouTube's setting, never a control of ours. The context is built on
     the first gesture because browsers refuse to start one before that. */
  let actx = null, audioOn = true;

  function initAudio() {
    if (!YT.present) return;
    try {
      audioOn = window.ytgame.system.isAudioEnabled();
      window.ytgame.system.onAudioEnabledChange(on => {
        audioOn = !!on;
        if (audioOn) musicStart(); else musicStop();
      });
    } catch (e) { audioOn = true; }
  }

  /* A small synth rather than a bare oscillator per event. Three ingredients:
     an ADSR envelope, an optional detuned twin for body, and an optional
     filtered noise layer for the transient. That is the whole difference
     between "a tone played" and "a thing happened". */
  function ctx() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }

  let noiseBuf = null;
  function noise() {
    const c = ctx();
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate * 0.4, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  /* o: {f, to, type, dur, gain, detune, atk, filt, q} */
  function voice(o) {
    if (!audioOn) return;
    try {
      const c = ctx(), t = c.currentTime;
      const g = c.createGain();
      const dur = o.dur || 0.15, peak = o.gain || 0.06, atk = o.atk || 0.008;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let out = g;
      if (o.filt) {
        const f = c.createBiquadFilter();
        f.type = 'lowpass';
        f.Q.value = o.q || 1;
        f.frequency.setValueAtTime(o.filt[0], t);
        f.frequency.exponentialRampToValueAtTime(o.filt[1], t + dur);
        g.connect(f); out = f;
      }
      out.connect(c.destination);
      const mk = det => {
        const os = c.createOscillator();
        os.type = o.type || 'triangle';
        os.frequency.setValueAtTime(o.f, t);
        if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + dur);
        if (det) os.detune.value = det;
        os.connect(g); os.start(t); os.stop(t + dur + 0.03);
      };
      mk(0);
      if (o.detune) mk(o.detune);
    } catch (e) {}
  }

  function hit(dur, f0, f1, gain, q) {
    if (!audioOn) return;
    try {
      const c = ctx(), t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = noise();
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = q || 1;
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(c.destination);
      src.start(t); src.stop(t + dur + 0.02);
    } catch (e) {}
  }

  function seq(notes, step, o) {
    notes.forEach((f, i) => setTimeout(
      () => voice(Object.assign({ f: f }, o)), i * step));
  }

  /* ---------------- samples ----------------
     Kenney Interface Sounds, CC0. Loaded once on the first gesture, because an
     AudioContext cannot exist before one and 80 KB has no business in the path
     to first frame. Every event keeps its synthesised version as a fallback, so
     one failed decode costs one sound and not all of them. */
  const CLIPS = ['lift', 'place', 'buy', 'coin1', 'coin2', 'craft',
                 'merge', 'find', 'sparkle', 'rb', 'nope'];
  const buf = {};
  let loading = false;

  function loadClips() {
    if (loading || !audioOn) return;
    loading = true;
    for (const name of CLIPS) {
      fetch('assets/sfx/' + name + '.ogg')
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then(ab => ctx().decodeAudioData(ab))
        .then(b => { buf[name] = b; })
        .catch(() => {});               // this one event stays synthesised
    }
  }

  /* Play a sample if we have it, otherwise the synth stand-in. `gain` and
     `rate` let one clip cover several moments without shipping more files. */
  function play(name, gain, rate, fallback) {
    if (!audioOn) return;
    const b = buf[name];
    if (!b) { fallback && fallback(); return; }
    try {
      const c = ctx(), src = c.createBufferSource(), g = c.createGain();
      src.buffer = b;
      src.playbackRate.value = rate || 1;
      g.gain.value = gain === undefined ? 0.55 : gain;
      src.connect(g); g.connect(c.destination);
      src.start();
    } catch (e) { fallback && fallback(); }
  }

  const SFX = {
    lift:  () => play('lift', 0.5, 1,
             () => voice({ f: 460, to: 700, dur: 0.09, gain: 0.05, type: 'sine' })),
    place: () => play('place', 0.6, 1,
             () => { hit(0.06, 2400, 500, 0.13, 3);
                     voice({ f: 220, to: 150, dur: 0.09, gain: 0.05 }); }),
    buy:   () => play('buy', 0.5, 1.12,
             () => seq([784, 1175], 55, { dur: 0.1, gain: 0.05, type: 'square' })),
    /* Coins, not casino chips. The chip clink was plastic - it read as putting
       a counter down, not as being paid. Two real coin jingles, picked at random
       and pitched +/-7%, because tapping is the most repeated action in the game
       and one sample forty times a minute becomes a drill. */
    coin:  () => play('coin' + (1 + Math.floor(Math.random() * 2)),
             0.55, 0.94 + Math.random() * 0.14,
             () => seq([1047, 1568], 48, { dur: 0.13, gain: 0.055 })),
    craft: () => play('craft', 0.6, 0.9,
             () => { hit(0.11, 3200, 700, 0.15, 4);
                     voice({ f: 330, to: 196, dur: 0.24, gain: 0.07,
                             type: 'sawtooth' }); }),
    merge: () => play('merge', 0.6, 1,
             () => { hit(0.3, 400, 5000, 0.09, 3);
                     voice({ f: 180, to: 720, dur: 0.32, gain: 0.08 }); }),
    // a discovery is worth two layers; one clip alone reads as a menu confirm
    find:  () => { play('find', 0.65, 1,
                     () => seq([523, 659, 784, 1047, 1319], 88,
                               { dur: 0.34, gain: 0.075 }));
                   setTimeout(() => play('sparkle', 0.4, 1.2), 170); },
    rb:    () => { play('rb', 0.65, 0.85,
                     () => seq([392, 523, 659, 784, 1047, 1319, 1568], 105,
                               { dur: 0.5, gain: 0.08, type: 'sine' }));
                   setTimeout(() => play('sparkle', 0.45, 0.8), 220);
                   setTimeout(() => play('find', 0.5, 1.1), 380); },
    nope:  () => play('nope', 0.45, 1,
             () => voice({ f: 150, to: 96, dur: 0.17, gain: 0.06, type: 'square' }))
  };

  /* ---------------- music ----------------
     GENERATED, not downloaded. A licence-clean loop is a megabyte or two - more
     than this whole bundle - and repeats audibly within a minute. Four chords, a
     soft arpeggio, a bass note and a brushed hat, scheduled a beat ahead of the
     clock so it never stutters. Zero bytes, and it changes key during an event
     so the world sounds different as well as looking different. */
  const CHORDS = [[0, 4, 7, 11], [-3, 0, 4, 9], [-5, -1, 2, 7], [2, 5, 9, 12]];
  const ARP = [0, 2, 1, 3, 2, 1, 3, 0];
  let musicOn = false, mGain = null, mBeat = 0, mNext = 0, mTimer = 0;

  function note(semi, at, dur, gain, type, root) {
    const c = ctx();
    const f = 440 * Math.pow(2, (root + semi - 9) / 12);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'triangle';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(mGain);
    o.start(at); o.stop(at + dur + 0.02);
  }

  function hat(at) {
    const c = ctx();
    const s = c.createBufferSource();
    s.buffer = noise();
    const f = c.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 7000;
    const g = c.createGain();
    g.gain.setValueAtTime(0.035, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    s.connect(f); f.connect(g); g.connect(mGain);
    s.start(at); s.stop(at + 0.07);
  }

  /* Scheduled a beat ahead: setTimeout alone is far too jittery for music, so
     the timer only decides WHAT to queue and the audio clock decides when. */
  function musicTick() {
    if (!musicOn || !audioOn) return;
    const c = ctx(), spb = 60 / 92 / 2;          // 92bpm, eighth notes
    while (mNext < c.currentTime + 0.4) {
      const bar = Math.floor(mBeat / 8) % CHORDS.length;
      const ch = CHORDS[bar];
      const ev = evCycle();
      const root = ev.on ? [3, -2, 5, 0][D.events.list.indexOf(ev.def) % 4] : 0;
      const step = mBeat % 8;
      note(ch[ARP[step]] + 12, mNext, spb * 1.6, 0.05, 'triangle', root);
      if (step === 0) note(ch[0] - 12, mNext, spb * 5, 0.07, 'sine', root);
      if (step % 2 === 1) hat(mNext);
      mNext += spb;
      mBeat++;
    }
  }

  function musicStart() {
    if (musicOn || !audioOn) return;
    try {
      const c = ctx();
      mGain = c.createGain();
      mGain.gain.value = 0.5;            // sits under the effects
      mGain.connect(c.destination);
      mNext = c.currentTime + 0.1;
      musicOn = true;
      mTimer = setInterval(musicTick, 120);
      musicTick();
    } catch (e) {}
  }

  function musicStop() {
    musicOn = false;
    clearInterval(mTimer);
    if (mGain) { try { mGain.disconnect(); } catch (e) {} mGain = null; }
  }

  /* ---------------- save ----------------
     ONE versioned record. Inside YouTube the SDK is the store and localStorage
     is never touched; outside it, the reverse. saveData MUST NOT run before
     loadData resolves. */
  const KEY = 'brplot_v2';
  let loaded = false, saveTimer = 0;

  function blank() {
    return { v: 2, coins: 0, ts: 0, slots: [], unlocked: 0, seen: [],
             rb: 0, tut: 0, jobs: [], boost: 0, adRb: 0,
             up: {}, tl: {}, tp: {} };
  }

  function adopt(dst, o) {
    if (!o || o.v !== 2) return dst;
    if (typeof o.coins === 'number' && isFinite(o.coins)) dst.coins = o.coins;
    if (typeof o.ts === 'number') dst.ts = o.ts;
    if (typeof o.unlocked === 'number') dst.unlocked = o.unlocked | 0;
    if (typeof o.rb === 'number') dst.rb = o.rb | 0;
    if (Array.isArray(o.seen)) dst.seen = o.seen.filter(n => typeof n === 'number');
    if (Array.isArray(o.slots)) dst.slots = o.slots;
    if (typeof o.tut === 'number') dst.tut = o.tut | 0;
    if (Array.isArray(o.jobs)) {
      dst.jobs = o.jobs.filter(j => j && typeof j.out === 'number');
    } else if (o.job && typeof o.job.out === 'number') {
      dst.jobs = [o.job];                // saves from the single-forge build
    }
    if (typeof o.boost === 'number') dst.boost = o.boost;
    if (typeof o.adRb === 'number') dst.adRb = o.adRb | 0;
    // slots carry ev/rare through adopt untouched - they are stored, not derived
    if (o.up && typeof o.up === 'object') dst.up = o.up;   // survives rebirth
    if (o.tl && typeof o.tl === 'object') dst.tl = o.tl;
    if (o.tp && typeof o.tp === 'object') dst.tp = o.tp;
    return dst;
  }

  function localRead() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) adopt(S, JSON.parse(raw));
    } catch (e) {}
  }

  /* WHO IS FRAMING US, not what the SDK claims.

     Two checks failed before this one. Testing for the object failed because
     the SDK exists everywhere the script tag does. Testing a save/load ROUND
     TRIP failed too, and more insidiously: off-YouTube the SDK keeps data in
     memory for the session, so the probe read its own sentinel back, declared
     itself live, and still lost everything on reload.

     The host is the only thing that actually settles it. A Playable always runs
     framed by youtube.com; a demo build on Pages is top-level. */
  function inYouTube() {
    try {
      const ao = location.ancestorOrigins;
      if (ao && ao.length) {
        for (let i = 0; i < ao.length; i++) {
          if (/(^|\.)youtube\.com$/i.test(new URL(ao[i]).hostname)) return true;
        }
        return false;                  // framed, but not by YouTube
      }
    } catch (e) {}
    // no ancestorOrigins (Firefox): fall back to whether we are framed at all,
    // and treat a cross-origin throw as "framed", which on YouTube is correct
    try { return window.top !== window.self; } catch (e) { return true; }
  }

  function initSave() {
    S = blank();
    YT.present = YT.raw && inYouTube();
    if (!YT.present) { localRead(); loaded = true; return Promise.resolve(S); }
    return window.ytgame.game.loadData().then(raw => {
      if (raw) { try { adopt(S, JSON.parse(raw)); } catch (e) {} }
      loaded = true; return S;
    }, () => { loaded = true; return S; });
  }

  function save() {
    if (!loaded) return;
    S.ts = Date.now();
    S.seen = [...seen];
    const json = JSON.stringify(S);
    if (YT.present) {
      // coalesced: cert allows 64KiB a flush, but writing on every tap is waste
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try { window.ytgame.game.saveData(json); } catch (e) {}
      }, 900);
      return;
    }
    try { localStorage.setItem(KEY, json); } catch (e) {}
  }

  function flushSave() {
    if (!loaded || !YT.present) return;
    clearTimeout(saveTimer);
    S.ts = Date.now(); S.seen = [...seen];
    try { window.ytgame.game.saveData(JSON.stringify(S)); } catch (e) {}
  }

  /* ---------------- numbers ---------------- */
  const SUF = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];

  function fmt(n) {
    n = Math.floor(n);
    if (n < 1000) return '' + n;
    let i = 0, v = n;
    while (v >= 1000 && i < SUF.length - 1) { v /= 1000; i++; }
    return (v < 10 ? v.toFixed(1) : Math.floor(v)) + SUF[i];
  }

  /* A craft can now run for hours, so seconds stopped being a readable unit
     everywhere the countdown appears. */
  function clock(s) {
    s = Math.max(0, Math.ceil(s));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
    return Math.floor(s / 3600) + 'h' + ('0' + Math.floor((s % 3600) / 60)).slice(-2);
  }

  function fmtRate(r) {
    return r < 10 ? (Math.round(r * 10) / 10).toString() : fmt(r);
  }

  /* ---------------- rebirth ---------------- */
  function rbNow() { return D.rebirth[Math.min(S.rb, D.rebirth.length - 1)]; }
  function rbNext() { return D.rebirth[S.rb + 1] || null; }
  function mult() { return rbNow().mult; }
  function ingMax() { return rbNow().ing; }
  function tables() { return rbNow().tables || 1; }
  function adsNeeded() { const n = rbNext(); return n ? (n.ads || 0) : 0; }

  /* Either path alone is enough: pay the coins, or watch the ads. */
  function canRebirth() {
    const n = rbNext();
    if (!n) return false;
    return S.coins >= n.need || (adsNeeded() > 0 && S.adRb >= adsNeeded());
  }

  function doRebirth() {
    const n = rbNext();
    // ONE gate, shared with the button's enabled state - they drifted apart
    // once the ad path existed, so the button lit up and the action refused
    if (!canRebirth()) {
      refuse($('rbGo'), n ? 'NOT READY YET' : 'ALREADY AT MAX'); return;
    }
    if (S.coins < n.need) S.adRb = 0;      // the ads were spent on this one
    S.rb++;
    S.coins = D.start.coins;
    S.unlocked = D.start.slots;
    S.slots = new Array(S.unlocked).fill(null);
    S.jobs = [];
    S.adRb = 0;
    ingOrder = null;
    liveAt = -1;                       // a rebirth changes what can be finished
    /* A wiped plot earning nothing is the right cost but a bleak first five
       seconds, so the new act starts with one creature already working. The
       rebirth multiplier applies to it like anything else, so it never stops
       being worth having. */
    if (BRS.length) S.slots[0] = { k: 'br', id: BRS[0], lvl: 1 };
    for (let i = 0; i < 9; i++) grid[i] = null;
    SFX.rb();
    $('rb').classList.remove('on');
    YT.interstitial();                 // the one natural break in the loop
    toast('REBIRTH ' + S.rb + '   x' + mult() + ' INCOME');
    const r = { left: innerWidth / 2, top: innerHeight / 2 };
    burst(r.left, r.top, 26, true);
    drawAll();
    save();
  }

  /* ---------------- entries on the plot ----------------
     'br'  a crafted brainrot, levelled by merging identical ones
     'mut' a fusion of two different ones: its own name, rate and hue */
  /* One helper for every place an item is drawn, so the table, the palette,
     the collection and the rebirth preview can never drift apart. */
  function iconOf(it) {
    return it.kind === 'ing'
      ? '<img src="' + it.icon + '" alt="" draggable="false">'
      : '<img src="' + it.art + '" alt="" draggable="false">';
  }

  /* A mutant stores the ITEM ID of the parent whose sprite it wears, in its own
     `art` field; an item's `art` is the path. Same word, two levels - the save
     format predates the path field and renaming it would strand every mutant
     already standing on a plot. */
  function artOf(e) {
    return D.items[e.k === 'mut' ? e.art : e.id].art;
  }

  /* Base rate, before the rebirth multiplier - stored rates stay comparable
     across acts, so a mutant made before a rebirth is not silently rebalanced. */
  function baseRate(e) {
    if (e.k === 'mut') return e.rate;
    return D.items[e.id].rate * Math.pow(B.lvlMult, (e.lvl || 1) - 1);
  }

  /* ---------------- timed events ----------------
     Read straight off the wall clock: no stored start time to drift, nothing to
     pause by closing the tab, and every player in the same event at once. */
  /* PRISMATIC takes the slot once every twelve hours rather than joining the
     rotation, so it stays rare enough to be worth catching. */
  function evFor(slot) {
    const E = D.events;
    if (E.rare && E.rareEvery && slot % E.rareEvery === 0) return E.rare;
    return E.list[slot % E.list.length];
  }

  function evCycle() {
    const E = D.events;
    const now = Date.now() / 1000;
    const slot = Math.floor(now / E.period);
    const into = now - slot * E.period;
    if (into < E.window) {
      return { on: true, def: evFor(slot), left: E.window - into };
    }
    return { on: false, def: evFor(slot + 1), left: E.period - into };
  }

  function evDef(k) {
    if (!k) return null;
    if (D.events.rare && D.events.rare.k === k) return D.events.rare;
    for (const e of D.events.list) if (e.k === k) return e;
    return null;
  }

  let evPainted = '';

  /* Recolouring is one variable assignment because every themed surface reads
     the same custom properties. */
  /* The status stack grows and shrinks - a boost pill, an event banner - so the
     board is positioned from its MEASURED height rather than a constant that
     silently goes stale the next time a row is added. */
  /* Re-measured only when the stack could actually have changed - reading
     offsetHeight every frame forced a reflow for a number that moves perhaps
     twice a session. */
  let topH = 0;
  function fitTop() {
    const h = $('top').offsetHeight;
    if (h === topH) return;
    topH = h;
    document.documentElement.style.setProperty('--topH', h + 'px');
    fitPlot();
  }

  function paintEvent() {
    const c = evCycle();
    const el = $('evt');
    const wasLive = el.classList.contains('live');
    el.classList.toggle('live', c.on);
    if (wasLive !== c.on) fitTop();
    $('evtName').textContent = c.on ? c.def.name : 'NEXT: ' + c.def.name;
    const t = Math.max(0, Math.ceil(c.left));
    $('evtTime').textContent =
      Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2);

    const key = c.on ? c.def.k : '';
    if (key === evPainted) return;
    evPainted = key;
    const r = document.documentElement.style;
    if (!key) {
      r.removeProperty('--peachTop'); r.removeProperty('--peach');
      r.removeProperty('--peachBot'); r.removeProperty('--grass');
      r.removeProperty('--evA'); r.removeProperty('--evB');
      return;
    }
    r.setProperty('--peachTop', c.def.sky[0]);
    r.setProperty('--peach', c.def.sky[1]);
    r.setProperty('--peachBot', c.def.sky[2]);
    r.setProperty('--grass', c.def.grass);
    r.setProperty('--evA', c.def.sky[1]);
    r.setProperty('--evB', c.def.sky[2]);
    drawPlot();
  }

  /* ---------------- permanent upgrades ----------------
     Kept across a rebirth on purpose - they are the only thing that is, which
     is what makes a reset read as progress instead of loss. */
  function upLvl(k) { return S.up[k] | 0; }

  function upDef(k) {
    for (const u of D.upgrades) if (u.k === k) return u;
    return null;
  }

  function upCost(k) {
    const u = upDef(k);
    return Math.round(u.cost * Math.pow(u.step, upLvl(k)));
  }

  function upMaxed(k) { return upLvl(k) >= upDef(k).max; }

  function buyUp(k, el) {
    if (upMaxed(k)) return;
    const c = upCost(k);
    if (S.coins < c) { refuse(el, 'NOT ENOUGH COINS'); return; }
    S.coins -= c;
    S.up[k] = upLvl(k) + 1;
    SFX.buy();
    drawShop(); drawPal(); paint(); save();
  }

  function boostOn() { return S.boost > Date.now(); }

  function rateOf(e) {
    return baseRate(e) * mult() *
           (boostOn() ? B.boostMult : 1) *
           (1 + 0.15 * upLvl('idle')) *
           (e.gold ? B.goldMult : 1) *
           (evDef(e.ev) ? evDef(e.ev).mult : 1) *
           (e.rare ? D.events.rareMult : 1);
  }

  function tapMult() { return B.tapMult + 2 * upLvl('tap'); }

  function priceOf(id) {
    return Math.max(1, Math.round(
      D.items[id].cost * Math.pow(0.95, upLvl('cheap'))));
  }

  function totalRate() {
    let r = 0;
    for (const e of S.slots) if (e) r += rateOf(e);
    return r;
  }

  /* A mutant's palette is derived from its parents, so the same pair always
     produces the same creature - a random hue would make fusions feel arbitrary
     and would not survive a reload. */
  function hueOf(a, b) {
    const h = (a * 73856093) ^ (b * 19349663);
    return 40 + (Math.abs(h) % 280);
  }

  function fuse(x, y) {
    const rx = baseRate(x), ry = baseRate(y);
    const big = rx >= ry ? x : y;
    const art = big.k === 'mut' ? big.art : big.id;
    const seed = (x.k === 'mut' ? x.art : x.id) + 1000 * (y.k === 'mut' ? y.art : y.id);
    return {
      k: 'mut', art: art,
      rate: Math.round((rx + ry) * B.mutMult * 100) / 100,
      hue: hueOf(seed % 9973, (seed * 7) % 9973),
      lvl: Math.max(x.lvl || 1, y.lvl || 1),
      gold: !!(x.gold || y.gold),
      ev: x.ev || y.ev || null,
      rare: !!(x.rare || y.rare)
    };
  }

  /* ---------------- the plot ---------------- */
  function slotCost() {
    const extra = S.unlocked - D.start.slots;
    return Math.round(B.slotCost * Math.pow(B.slotStep, Math.max(0, extra)));
  }

  function freeSlot() {
    for (let i = 0; i < S.unlocked; i++) if (!S.slots[i]) return i;
    return -1;
  }

  /* Solve the column count instead of letting CSS guess it from width alone.
     Every count is tried; the winner is whichever makes the cell biggest while
     still fitting both axes. Below MIN the plot scrolls rather than shrink to
     unreadable. */
  function fitPlot() {
    const box = $('plot'), host = $('slots');
    const n = S.unlocked + 1;                    // + the locked slot on the end
    if (!n || !box.clientWidth) return;
    const PADX = 24, PADY = 24, GAP = 9, MIN = 62, MAX = 150;
    const W = box.clientWidth - PADX, H = box.clientHeight - PADY;
    let best = 0, cols = 1;
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      const size = Math.min((W - GAP * (c - 1)) / c, (H - GAP * (r - 1)) / r);
      if (size > best) { best = size; cols = c; }
    }
    // too small to read: settle for the widest row that still fits and scroll
    if (best < MIN) {
      cols = Math.max(1, Math.floor((W + GAP) / (MIN + GAP)));
      best = Math.min(MAX, (W - GAP * (cols - 1)) / cols);
    }
    best = Math.min(best, MAX);
    host.style.gap = GAP + 'px';
    host.style.gridTemplateColumns = 'repeat(' + cols + ',' + best.toFixed(1) + 'px)';
  }

  function drawPlot() {
    const host = $('slots');
    host.innerHTML = '';
    meters = [];
    for (let i = 0; i < S.unlocked; i++) {
      const e = S.slots[i];
      const sl = document.createElement('div');
      sl.className = 'slot' + (e ? '' : ' empty');
      sl.dataset.slot = i;
      if (e) {
        const m = document.createElement('div');
        m.className = 'mob' + (e.k === 'mut' ? ' mut' : '') +
                      (e.gold ? ' gold' : '') + (e.ev ? ' ev' : '') +
                      (e.rare ? ' rare' : '');
        const badge = (e.lvl || 1) > 1 || e.k === 'mut' || e.gold || e.ev
          ? '<span class="lv">' + (e.ev ? (e.rare ? '\u2605 ' : '') +
                evDef(e.ev).name.split(' ')[0]
              : e.k === 'mut' ? 'MUT'
              : e.gold && (e.lvl || 1) === 1 ? 'GOLD' : 'Lv' + e.lvl) + '</span>' : '';
        const ed = evDef(e.ev);
        const filt = ed ? ed.tint
          : (e.k === 'mut'
             ? 'hue-rotate(' + e.hue + 'deg) saturate(1.35) contrast(1.05)' : '');
        const hue = filt
          ? ' style="filter:' + filt +
            ' drop-shadow(0 6px 5px rgba(30,60,20,.42))"' : '';
        m.innerHTML = badge + '<img src="' + artOf(e) + '"' + hue +
                      ' alt="" draggable="false">' +
                      '<span class="rc"><i></i></span>';
        if (ed) m.style.setProperty('--evA', ed.sky[1]);
        sl.appendChild(m);
        meters[i] = m;
      }
      host.appendChild(sl);
    }
    // the next locked slot is always visible, so the upgrade is never hidden
    const lk = document.createElement('div');
    lk.className = 'slot locked';
    lk.id = 'lockSlot';
    lk.innerHTML = '<img src="assets/icon/lock.png" alt=""><span class="px">' +
                   fmt(slotCost()) + '</span>';
    host.appendChild(lk);
    fitPlot();
    paintMeters(true);
  }

  /* The bar under each creature fills as its tap bonus recharges, so tapping
     has a visible rhythm instead of a silent dead zone. */
  function paintMeters(force) {
    const now = performance.now();
    for (let i = 0; i < meters.length; i++) {
      const m = meters[i];
      if (!m) continue;
      const till = cool[i] || 0;
      const f = till <= now ? 1
        : 1 - (till - now) / (B.tapCool * 1000);
      const bar = m.firstElementChild && m.querySelector('.rc i');
      if (bar) bar.style.width = (f * 100).toFixed(0) + '%';
      const ready = f >= 1;
      if (force || m.classList.contains('ready') !== ready) {
        m.classList.toggle('ready', ready);
      }
    }
  }

  function popAt(el, text) {
    const r = el.getBoundingClientRect();
    const s = document.createElement('div');
    s.className = 'pop';
    s.textContent = text;
    s.style.left = (r.left + r.width / 2) + 'px';
    s.style.top = (r.top + r.height * 0.35) + 'px';
    $('fx').appendChild(s);
    setTimeout(() => s.remove(), 820);
  }

  function burst(x, y, n, big) {
    const host = $('fx');
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      const a = (i / n) * Math.PI * 2;
      const d = (big ? 82 : 46) + Math.random() * 34;
      s.className = 'spark';
      s.style.left = x + 'px';
      s.style.top = y + 'px';
      s.style.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + 'px');
      s.style.setProperty('--dy', (Math.sin(a) * d).toFixed(1) + 'px');
      host.appendChild(s);
      setTimeout(() => s.remove(), 700);
    }
  }

  /* A coin thrown from the purse to whatever was just bought - the only signal
     that says WHERE the money went, which a number ticking down does not. */
  function flyCoin(toEl) {
    const a = $('purse').getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    const s = document.createElement('div');
    s.className = 'fly';
    s.innerHTML = '<img src="assets/icon/coin.png" alt="">';
    s.style.left = (a.left + a.width * 0.16) + 'px';
    s.style.top = (a.top + a.height / 2) + 'px';
    $('fx').appendChild(s);
    requestAnimationFrame(() => {
      s.style.left = (b.left + b.width / 2) + 'px';
      s.style.top = (b.top + b.height / 2) + 'px';
      s.style.opacity = '0';
    });
    setTimeout(() => s.remove(), 460);
    const p = $('purse');
    p.classList.add('bump');
    setTimeout(() => p.classList.remove('bump'), 110);
  }

  function collect(i, el) {
    const e = S.slots[i];
    if (!e) return;
    const now = performance.now();
    if ((cool[i] || 0) > now) return;
    cool[i] = now + B.tapCool * 1000;
    tapped = true;
    // a small chance per tap, so an event rewards playing through it rather
    // than just being logged in for it
    const ec = evCycle();
    if (ec.on && !e.ev && Math.random() < D.events.tapChance) {
      e.ev = ec.def.k;
      e.rare = Math.random() < D.events.rareChance;
      toast((e.rare ? 'RARE ' : '') + ec.def.name + ' MUTATION!');
      SFX.find();
      drawPlot();
      save();
    }
    const pay = rateOf(e) * tapMult();
    S.tp.tap = (S.tp.tap | 0) + 1;
    S.coins += pay;
    popAt(el, '+' + fmt(pay));
    el.classList.add('tap');
    setTimeout(() => el.classList.remove('tap'), 100);
    SFX.coin();
    paintMeters(true);
    paint();
  }

  function merge(from, to) {
    const a = S.slots[from], b = S.slots[to];
    if (!a || !b || from === to) return;
    let out;
    if (a.k === 'br' && b.k === 'br' && a.id === b.id && a.lvl === b.lvl) {
      out = { k: 'br', id: a.id, lvl: a.lvl + 1, gold: !!(a.gold || b.gold),
              ev: a.ev || b.ev || null, rare: !!(a.rare || b.rare) };
      toast('LEVEL ' + out.lvl + (out.gold ? '  GOLD' : ''));
    } else {
      out = fuse(a, b);
      toast('MUTANT');
    }
    S.slots[from] = null;
    S.slots[to] = out;
    S.tp.merge = (S.tp.merge | 0) + 1;
    delete cool[from];
    SFX.merge();
    drawPlot();
    const el = $('slots').children[to];
    if (el) {
      const m = el.querySelector('.mob');
      if (m) m.classList.add('fresh');
      const r = el.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, 16, true);
    }
    paint();
    save();
  }

  /* ---------------- selling ----------------
     Priced from what a thing COST, never from what it earns. Paying out a
     minute of income would be an infinite loop - a Ninja Cup costs 24, makes
     0.6/s and crafts in a second, so ninety seconds of income would mint money
     forever. Two fifths of the build cost is always a loss, which makes selling
     a cleanup tool rather than a strategy. */
  function recipeCost(id) {
    let c = 0;
    for (const p of D.madeBy[id] || []) c += priceOf(p[0]) * p[1];
    return c;
  }

  function sellValue(e) {
    // a level N took 2^(N-1) crafts to build; a mutant took two creatures
    const id = e.k === 'mut' ? e.art : e.id;
    const base = recipeCost(id) * (e.k === 'mut' ? 2 : 1);
    return Math.max(1, Math.round(base * Math.pow(2, (e.lvl || 1) - 1) * 0.4));
  }

  /* Gold, mutated or levelled means hours of play, so those ask first. A plain
     level one does not - making every sale modal would just train people to
     dismiss the dialog. */
  function sellPrecious(e) {
    return !!(e.gold || e.ev || (e.lvl || 1) > 2);
  }

  let sellAt = -1;

  function doSell(i) {
    const e = S.slots[i];
    if (!e) return;
    const v = sellValue(e);
    S.coins += v;
    S.slots[i] = null;
    delete cool[i];
    sellArmed = false;
    armTrash(false);
    SFX.coin();
    drawPlot(); paint(); save();
    const el = $('slots').children[i];
    if (el) popAt(el, '+' + fmt(v));
    toast('SOLD FOR ' + fmt(v));
  }

  function askSell(i) {
    const e = S.slots[i];
    if (!e) return;
    if (!sellPrecious(e)) { doSell(i); return; }
    sellAt = i;
    $('sellArt').src = artOf(e);
    $('sellAmt').textContent = '+' + fmt(sellValue(e));
    $('sellWarn').textContent = (e.ev ? 'This one is mutated. ' : '') +
      (e.gold ? 'This one is golden. ' : '') +
      ((e.lvl || 1) > 1 ? 'Level ' + e.lvl + '. ' : '') + 'This cannot be undone.';
    $('sell').classList.add('on');
    drawTut();
  }

  function armTrash(on) {
    const t = $('trash');
    if (!t) return;
    t.classList.toggle('armed', !!on);
    $('trashV').textContent = on ? 'TAP ONE' : 'SELL';
  }

  /* ---------------- the crafting table ---------------- */
  function drawGrid() {
    const host = $('g3');
    host.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const c = grid[i];
      const el = document.createElement('div');
      el.className = 'gc' + (c ? ' full' : '');
      el.dataset.cell = i;
      if (c) el.innerHTML = iconOf(D.items[c.id]);
      host.appendChild(el);
    }
    drawResult();
  }

  /* The recipe key must be built exactly as the generator built it: entries
     sorted by (id, count), joined "id*count". */
  function gridKey() {
    const c = {};
    for (const g of grid) if (g) c[g.id] = (c[g.id] || 0) + 1;
    const e = Object.keys(c).map(k => [+k, c[k]]);
    e.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return e.map(p => p[0] + '*' + p[1]).join(',');
  }

  /* How far along the shortest recipe the table could still complete. Without
     this the slot showed "?" whether you were one ingredient short or had
     something nonsensical, so a half-built four-ingredient recipe looked
     exactly like a mistake - and since the filter keeps the right ingredients
     lit, players placed what was lit and then wondered why nothing crafted. */
  function partial() {
    const have = {};
    let n = 0;
    for (const g of grid) if (g) { have[g.id] = (have[g.id] || 0) + 1; n++; }
    if (!n) return null;
    let best = null;
    for (const r of liveRecipes()) {
      if (r.total <= n) continue;
      let ok = true;
      for (const id in have) {
        if (!(r.need[id] >= have[id])) { ok = false; break; }
      }
      if (ok && (best === null || r.total < best)) best = r.total;
    }
    return best === null ? null : { at: n, of: best };
  }

  function drawResult() {
    const res = $('res');
    const out = D.recipes[gridKey()];
    if (out === undefined) {
      const p = partial();
      res.className = p ? 'part' : '';
      res.innerHTML = p
        ? '<span class="q">' + p.at + '/' + p.of + '</span>'
        : '<span class="q">?</span>';
      res.dataset.out = '';
      return;
    }
    const it = D.items[out];
    res.className = 'ready';
    res.dataset.out = out;
    res.innerHTML = '<img src="' + it.art + '" alt="">';
  }

  /* Which items could still lead somewhere from here. null means "everything".
     A recipe is still live if what is on the table is a sub-multiset of it and
     it is not already complete; the answer is every ingredient those live
     recipes are still short of. Anything else greys out, so you are always
     choosing among options that could actually finish something. */
  /* Only recipes you can actually FINISH at this rebirth. Without this the
     filter cheerfully lit a path into a recipe whose last ingredient is locked
     behind a future rebirth - at rebirth 0 that was 28 of the 53 recipes, so
     more than half of what the table offered was a dead end you could not see
     coming. Cached per rebirth, since that is the only thing that changes it. */
  let liveAt = -1, liveList = null;

  function liveRecipes() {
    if (liveAt === S.rb && liveList) return liveList;
    const max = ingMax();
    liveList = RECIPES.filter(r => {
      for (const id in r.need) if (D.items[id].tier > max) return false;
      return true;
    });
    liveAt = S.rb;
    return liveList;
  }

  function usable() {
    const have = {};
    let n = 0;
    for (const g of grid) if (g) { have[g.id] = (have[g.id] || 0) + 1; n++; }
    if (!n) return null;
    const out = new Set();
    for (const r of liveRecipes()) {
      if (r.total <= n) continue;                 // full, or already overshot
      let ok = true;
      for (const id in have) {
        if (!(r.need[id] >= have[id])) { ok = false; break; }
      }
      if (!ok) continue;
      for (const id in r.need) {
        if (r.need[id] - (have[id] || 0) > 0) out.add(+id);
      }
    }
    return out;
  }

  function placeInGrid(id) {
    const at = grid.indexOf(null);
    if (at < 0) { toast('TABLE IS FULL'); SFX.nope(); return -1; }
    grid[at] = { id: id };
    return at;
  }

  function useIngredient(id, card) {
    const it = D.items[id];
    if (it.tier > ingMax()) {
      refuse(card, 'NEEDS REBIRTH ' + bandOfTier(it.tier)); return;
    }
    const u = usable();
    if (u && !u.has(id)) { refuse(card, it.name + ' WONT PAIR WITH THAT'); return; }

    /* Short of coins is a dead end otherwise: the recipe is right there, lit
       up, and you cannot touch it. An ad buys this one ingredient outright,
       which unblocks the craft without handing over a coin balance. */
    const price = priceOf(id);
    if (S.coins < price) {
      toast('WATCH AN AD FOR THIS ONE');
      SFX.nope();
      YT.rewarded(() => {
        S.coins += price;                // exactly this ingredient, nothing more
        if (card) flyCoin(card);
        useIngredient(id, card);
      }, () => toast('NO AD AVAILABLE'));
      return;
    }
    const at = placeInGrid(id);
    if (at < 0) return;
    S.coins -= price;
    if (card) flyCoin(card);
    SFX.buy();
    drawGrid(); drawPal(); paint(); save();
    const cell = $('g3').children[at];
    if (cell) { cell.classList.add('pop'); setTimeout(() => cell.classList.remove('pop'), 300); }
  }

  /* Taking a cell back refunds exactly what it cost to put there, so
     experimenting with the table is free. */
  function takeBack(i) {
    const c = grid[i];
    if (!c) return;
    S.coins += priceOf(c.id);
    grid[i] = null;
    SFX.place();
    drawGrid(); drawPal(); paint(); save();
  }

  /* Crafting takes real time, scaled by tier, and each table runs its own job.
     Jobs are persisted, so closing the tab mid-craft loses nothing, and any
     whose timer elapsed while you were away complete on load. */
  /* Each forge carries its own skip, so it is never ambiguous which job an ad
     applies to - the one shared button could not express that. */
  function skipJob(f) {
    if (!S.jobs[f]) return;
    YT.rewarded(() => { S.jobs[f].ends = Date.now(); SFX.craft(); paintForges(); },
                () => toast('NO AD AVAILABLE'));
  }

  function jobSecs(id) {
    return B.craftBase * Math.pow(B.craftGrow, D.items[id].tier) *
           Math.pow(0.92, upLvl('speed'));
  }

  function freeForge() {
    for (let i = 0; i < tables(); i++) if (!S.jobs[i]) return i;
    return -1;
  }

  function craft() {
    const out = $('res').dataset.out;
    if (!out) return;
    const f = freeForge();
    if (f < 0) { toast('ALL TABLES ARE BUSY'); SFX.nope(); return; }
    const id = +out;
    if (freeSlot() < 0) { toast('PLOT IS FULL - BUY A SLOT'); SFX.nope(); return; }
    const secs = jobSecs(id);
    for (let i = 0; i < 9; i++) grid[i] = null;
    S.jobs[f] = { out: id, ends: Date.now() + secs * 1000, dur: secs };
    SFX.craft();
    drawGrid(); drawPal(); drawForges(); paint(); save();
  }

  function finishJob(f, silent) {
    const job = S.jobs[f];
    if (!job) return;
    const id = job.out;
    S.jobs[f] = null;
    const at = freeSlot();
    if (at < 0) {
      // the plot filled up while it was forging - hand back the ingredients
      let refund = 0;
      for (const p of D.madeBy[id] || []) refund += priceOf(p[0]) * p[1];
      S.coins += refund;
      toast('PLOT WAS FULL - REFUNDED ' + fmt(refund));
      SFX.nope();
      drawForges(); paint(); save();
      return;
    }
    // one craft in twenty comes out golden and earns triple, forever
    const gold = Math.random() < B.goldChance;
    // an event mutation is rolled at the moment of crafting and kept forever
    const c = evCycle();
    const chance = c.on ? (c.def.chance || D.events.craftChance) : 0;
    const ev = (c.on && Math.random() < chance) ? c.def.k : null;
    // rarity is decided here and stored, never recomputed - a rare creature
    // stays rare whatever the balance does later
    const rare = !!ev && Math.random() < D.events.rareChance;
    S.slots[at] = { k: 'br', id: id, lvl: 1, gold: gold, ev: ev, rare: rare };
    if (ev) {
      toast((rare ? 'RARE ' : '') + c.def.name + ' MUTATION!');
      if (rare) setTimeout(() => SFX.rb(), 120);
    }
    S.tp.craft = (S.tp.craft | 0) + 1;
    const fresh = !seen.has(id);
    if (fresh) { seen.add(id); YT.score(seen.size); }
    drawForges(); drawPlot(); dexBadge(); paint(); save();

    if (fresh && !silent) { reveal(id); SFX.find(); }
    else if (!silent) {
      SFX.coin();
      toast('BRAINROT READY');
      const el = $('slots').children[at];
      if (el) {
        const m2 = el.querySelector('.mob');
        if (m2) m2.classList.add('fresh');
      }
    }
  }

  function drawForges() {
    const host = $('forges');
    host.innerHTML = '';
    const n = tables();
    for (let i = 0; i < n; i++) {
      const j = S.jobs[i];
      const el = document.createElement('div');
      el.className = 'forge' + (j ? ' busy' : ' free');
      el.dataset.forge = i;
      if (j) {
        const it = D.items[j.out];
        el.innerHTML = '<img src="' + it.art + '" alt="">' +
          '<div class="fill"></div><div class="t"></div>' +
          '<div class="tv"><img src="assets/icon/clapboard.png" alt=""></div>';
      }
      host.appendChild(el);
    }
    // the next table you will earn, so the reward is visible before you get it
    if (n < D.rebirth[D.rebirth.length - 1].tables) {
      const lk = document.createElement('div');
      lk.className = 'forge lock';
      lk.innerHTML = '<img src="assets/icon/rebirth.png" alt="">' +
                     '<span>' + (S.rb + 1) + '</span>';
      host.appendChild(lk);
    }
    paintForges();
  }

  /* Countdowns tick here rather than in a rebuild, so the tiles are not
     recreated sixty times a second. */
  function paintForges() {
    const host = $('forges');
    const now = Date.now();
    let soonest = Infinity;
    for (const el of host.children) {
      const i = el.dataset.forge;
      if (i === undefined) continue;
      const j = S.jobs[+i];
      if (!j) continue;
      const left = Math.max(0, j.ends - now) / 1000;
      if (left <= 0) { finishJob(+i, false); return; }
      soonest = Math.min(soonest, left);
      const fill = el.querySelector('.fill');
      const t = el.querySelector('.t');
      if (fill) fill.style.setProperty('--p',
        ((1 - left / j.dur) * 360).toFixed(1) + 'deg');
      if (t) t.textContent = clock(left);
    }
    const b = $('badgeCraft');
    b.classList.toggle('hidden', soonest === Infinity);
    if (soonest !== Infinity) b.textContent = clock(soonest);
  }

  /* ---------------- palette ---------------- */
  function bandOfTier(t) {
    for (let i = 0; i < D.rebirth.length; i++) if (t <= D.rebirth[i].ing) return i;
    return D.rebirth.length - 1;
  }

  /* Buyable first, then GROUPED BY THE REBIRTH that opened them - newest group
     at the top, because what a rebirth just unlocked is the whole point of
     having rebirthed, and a flat cheapest-first buried it under fifty cards.
     Inside a group it is cheapest first, so the group still reads like a
     shopping list. Locked groups follow in the order you will reach them.
     Sorted on UNLOCK state only: the pair filter dims cards without reordering
     them, because cards that jump under a thumb mid-tap are how you mis-tap. */
  let ingOrder = null, ingOrderAt = -1;

  function sortedIng() {
    if (ingOrder && ingOrderAt === S.rb) return ingOrder;
    const max = ingMax();
    ingOrder = ING.slice().sort((a, b) => {
      const A = D.items[a], Bi = D.items[b];
      const la = A.tier > max ? 1 : 0, lb = Bi.tier > max ? 1 : 0;
      if (la !== lb) return la - lb;
      const ba = bandOfTier(A.tier), bb = bandOfTier(Bi.tier);
      // grouped by the rebirth that opened them - newest group first when
      // unlocked, nearest group first when still locked
      if (ba !== bb) return la ? ba - bb : bb - ba;
      return A.tier - Bi.tier || a - b;      // cheapest first inside a group
    });
    ingOrderAt = S.rb;
    return ingOrder;
  }

  function drawPal() {
    const host = $('pal');
    const keep = host.scrollTop;        // rebuilding wipes it, hiding live cards
    host.innerHTML = '';
    const u = usable();
    for (const id of sortedIng()) {
      const it = D.items[id];
      const locked = it.tier > ingMax();
      const muted = !locked && u && !u.has(id);
      const el = document.createElement('div');
      el.className = 'pc r' + bandOfTier(it.tier) +
                     (locked || muted ? ' locked' : '') +
                     (!locked && !muted && u ? ' hot' : '') +
                     (!locked && !muted && S.coins < priceOf(id) ? ' poor' : '');
      el.dataset.buy = id;
      el.innerHTML =
        '<img class="art" loading="lazy" src="' + it.icon +
        '" alt="" draggable="false">' +
        '<span class="px"><img src="assets/icon/coin.png" alt="">' +
        fmt(priceOf(id)) + '</span>' +
        (locked ? '<span class="lk"><img src="assets/icon/rebirth.png" alt="">' +
          bandOfTier(it.tier) + '</span>' : '');
      host.appendChild(el);
    }
    host.scrollTop = keep;
    palFocus();
  }

  /* ---------------- keeping usable ingredients findable ---------------- */
  function palLive() {
    return [].slice.call($('pal').querySelectorAll('.pc:not(.locked)'));
  }

  /* Scroll ONLY when nothing usable is on screen. Moving the list under someone
     who can already see a valid choice is worse than not moving it at all - it
     slides the card out from under the thumb reaching for it.

     Positions are measured with getBoundingClientRect, NOT offsetTop: #palWrap
     is positioned (it anchors the arrows), so it is the cards' offsetParent and
     offsetTop is relative to the WRAPPER, not to the scroller. That mismatch
     silently broke every comparison against scrollTop. */
  function palRows() {
    const host = $('pal');
    const base = host.getBoundingClientRect();
    return palLive().map(el => {
      const r = el.getBoundingClientRect();
      return { el: el, t: r.top - base.top, b: r.bottom - base.top, h: r.height };
    });
  }

  function palScrollTo(row) {
    const host = $('pal');
    host.scrollTo({
      top: Math.max(0, host.scrollTop + row.t - host.clientHeight / 2 + row.h / 2),
      behavior: 'smooth'
    });
  }

  function palFocus() {
    const host = $('pal');
    if (usable() === null) { palArrows(); return; }   // nothing placed yet
    const rows = palRows();
    if (!rows.length) { palArrows(); return; }
    const H = host.clientHeight;
    if (!rows.some(r => r.b > 8 && r.t < H - 8)) palScrollTo(rows[0]);
    palArrows();
  }

  function palArrows() {
    const host = $('pal');
    const rows = usable() === null ? [] : palRows();
    const H = host.clientHeight;
    $('palUp').classList.toggle('on', rows.some(r => r.b <= 8));
    $('palDown').classList.toggle('on', rows.some(r => r.t >= H - 8));
  }

  function palJump(dir) {
    const rows = palRows();
    const H = $('pal').clientHeight;
    const pick = dir < 0 ? rows.filter(r => r.b <= 8).pop()
                         : rows.filter(r => r.t >= H - 8)[0];
    if (!pick) return;
    palScrollTo(pick);
    SFX.lift();
  }

  /* ---------------- endless tasks ----------------
     Three counters that never run out. Each shows its next target, and the
     reward scales with the act so it never decays into pocket change. */
  function taskDef(k) {
    for (const t of D.tasks) if (t.k === k) return t;
    return null;
  }

  function taskNeed(k) { return taskDef(k).per * ((S.tl[k] | 0) + 1); }

  function taskReward(k) {
    const t = taskDef(k);
    const base = t.reward * ((S.tl[k] | 0) + 1) * Math.pow(4, S.rb);
    // never worth less than a minute of current income, so a late task is
    // still worth crossing the room for
    return Math.round(Math.max(base, totalRate() * 60));
  }

  function taskDone(k) { return (S.tp[k] | 0) >= taskNeed(k); }

  function claimTask(k) {
    if (!taskDone(k)) return;
    const r = taskReward(k);
    S.coins += r;
    S.tp[k] = (S.tp[k] | 0) - taskNeed(k);
    S.tl[k] = (S.tl[k] | 0) + 1;
    SFX.find();
    toast('+' + fmt(r));
    drawShop(); paint(); save();
  }

  function anyClaim() {
    for (const t of D.tasks) if (taskDone(t.k)) return true;
    return false;
  }

  /* ---------------- the workshop ---------------- */
  function drawShop() {
    const tl = $('taskList');
    tl.innerHTML = '';
    for (const t of D.tasks) {
      const have = S.tp[t.k] | 0, need = taskNeed(t.k), ok = have >= need;
      const el = document.createElement('div');
      el.className = 'row';
      el.innerHTML =
        '<div class="ic"><img src="assets/icon/' + t.icon + '.png" alt="">' +
        '<span class="lvl">' + ((S.tl[t.k] | 0) + 1) + '</span></div>' +
        '<div class="mid"><div class="nm">' + t.name + '</div>' +
        '<div class="bar"><i style="width:' +
        Math.min(100, 100 * have / need).toFixed(0) + '%"></i>' +
        '<b>' + Math.min(have, need) + ' / ' + need + '</b></div></div>' +
        '<div class="go' + (ok ? ' claim' : ' dim') + '" data-task="' + t.k + '">' +
        '<img src="assets/icon/coin.png" alt="">' +
        '<span class="v">' + (ok ? 'CLAIM' : fmt(taskReward(t.k))) + '</span>' +
        '</div>';
      tl.appendChild(el);
    }

    const ul = $('upList');
    ul.innerHTML = '';
    for (const u of D.upgrades) {
      const lv = upLvl(u.k), maxed = upMaxed(u.k), cost = maxed ? 0 : upCost(u.k);
      const el = document.createElement('div');
      el.className = 'row' + (maxed ? ' maxed' : '');
      el.innerHTML =
        '<div class="ic"><img src="assets/icon/' + u.icon + '.png" alt="">' +
        '<span class="lvl">' + lv + '/' + u.max + '</span></div>' +
        '<div class="mid"><div class="nm">' + u.name + '</div>' +
        '<div class="sub">' + u.note + '</div></div>' +
        (maxed
          ? '<div class="go max">MAX</div>'
          : '<div class="go' + (S.coins < cost ? ' dim' : '') +
            '" data-up="' + u.k + '"><img src="assets/icon/coin.png" alt="">' +
            '<span class="v">' + fmt(cost) + '</span></div>');
      ul.appendChild(el);
    }
    $('badgeShop').classList.toggle('hidden', !anyClaim());
  }

  /* Same story as the workshop: only the numbers move each frame, so only the
     numbers are written. Rebuilding restarted the reel's pan animation and made
     the REBIRTH button as hard to press as the upgrade rows were. */
  function refreshRb() {
    const nx = rbNext();
    if (!nx) return;
    const bar = $('rbBar').firstElementChild;
    if (bar) bar.style.width = Math.min(100, 100 * S.coins / nx.need).toFixed(1) + '%';
    put('rbNeed', fmt(S.coins) + ' / ' + fmt(nx.need) + ' coins');
    $('rbGo').classList.toggle('dim', !canRebirth());
    const need = adsNeeded();
    if (need) {
      put('rbAdT', S.adRb >= need ? 'ADS WATCHED - REBIRTH READY'
                                  : 'WATCH ADS  ' + S.adRb + '/' + need);
    }
  }

  /* The per-frame path. Writes text and toggles classes on rows that already
     exist - it must never replace a node, because the player may be pressing
     one. drawShop() rebuilds, and is reserved for real structural changes. */
  function refreshShop() {
    for (const el of $('taskList').children) {
      const go = el.querySelector('[data-task]');
      if (!go) continue;
      const k = go.dataset.task;
      const have = S.tp[k] | 0, need = taskNeed(k), ok = have >= need;
      const bar = el.querySelector('.bar i'), lab = el.querySelector('.bar b');
      if (bar) bar.style.width = Math.min(100, 100 * have / need).toFixed(0) + '%';
      if (lab) lab.textContent = Math.min(have, need) + ' / ' + need;
      const v = go.querySelector('.v');
      if (v) {
        const txt = ok ? 'CLAIM' : fmt(taskReward(k));
        if (v.textContent !== txt) v.textContent = txt;
      }
      go.classList.toggle('claim', ok);
      go.classList.toggle('dim', !ok);
      const img = go.querySelector('img');
      if (img) img.style.display = ok ? 'none' : '';
    }
    for (const el of $('upList').children) {
      const go = el.querySelector('[data-up]');
      if (!go) continue;
      go.classList.toggle('dim', S.coins < upCost(go.dataset.up));
    }
  }

  /* ---------------- collection ---------------- */
  /* Just the number, no DOM and no images - what boot actually needs. */
  function dexBadge() {
    const left = BRS.length - seen.size;
    const bd = $('badgeDex');
    bd.textContent = left;
    bd.classList.toggle('hidden', left === 0);
  }

  function drawDex() {
    const host = $('dexGrid');
    host.innerHTML = '';
    const order = BRS.slice().sort((a, b) => {
      const A = D.items[a], Bi = D.items[b];
      const ga = seen.has(a) ? 0 : 1, gb = seen.has(b) ? 0 : 1;
      return ga - gb || A.band - Bi.band || A.tier - Bi.tier || a - b;
    });
    for (const id of order) {
      const it = D.items[id];
      const got = seen.has(id);
      const el = document.createElement('div');
      el.className = 'dcell' + (got ? '' : ' lock');
      el.dataset.id = id;
      el.innerHTML = '<img loading="lazy" src="' + it.art +
        '" alt="" draggable="false">' +
        '<div class="rc">' + (got ? recipeText(id) : '?') + '</div>' +
        '<div class="act"><img src="assets/icon/rebirth.png" alt="">' +
        it.band + '</div>';
      host.appendChild(el);
    }
    dexBadge();
  }

  function recipeText(id) {
    const r = D.madeBy[id];
    if (!r) return '';
    return r.map(p => iconOf(D.items[p[0]])).join('');
  }

  /* ---------------- rebirth sheet ---------------- */
  function drawRb() {
    const nx = rbNext();
    $('rbCur').textContent = 'x' + mult();
    $('rbNow').textContent = 'Ingredients up to tier ' + ingMax();
    const bar = $('rbBar').firstElementChild;
    const go = $('rbGo');
    const track = $('rbTrack');
    track.innerHTML = '';
    if (!nx) {
      $('rbNextM').textContent = 'MAX';
      $('rbAd').style.display = 'none';
      $('rbOr').style.display = 'none';
      bar.style.width = '100%';
      $('rbNeed').textContent = 'You have reached the final rebirth.';
      $('rbNext').textContent = '';
      go.classList.add('dim');
      return;
    }
    $('rbNextM').textContent = 'x' + nx.mult;
    const need = adsNeeded();
    const adBtn = $('rbAd');
    adBtn.style.display = need ? '' : 'none';
    $('rbOr').style.display = need ? '' : 'none';
    if (need) {
      $('rbAdT').textContent = S.adRb >= need
        ? 'ADS WATCHED - REBIRTH READY'
        : 'WATCH ADS  ' + S.adRb + '/' + need;
    }
    bar.style.width = Math.min(100, 100 * S.coins / nx.need).toFixed(1) + '%';
    $('rbNeed').textContent = fmt(S.coins) + ' / ' + fmt(nx.need) + ' coins';
    $('rbNext').textContent = 'Resets the plot and purse, keeps discoveries. ' +
      'You start with one brainrot and ' + nx.tables + ' crafting tables.';
    go.classList.toggle('dim', !canRebirth());

    /* What the next act actually hands you: the ingredients that go on sale and
       the brainrots they make possible. Duplicated once so the pan can loop by
       exactly -50% without measuring anything. */
    const reel = [];
    for (const id of ING) {
      const it = D.items[id];
      if (it.tier > ingMax() && it.tier <= nx.ing) {
        reel.push('<div class="rw">' + iconOf(it) + '</div>');
      }
    }
    for (const id of BRS) {
      if (D.items[id].band === S.rb + 1) {
        reel.push('<div class="rw br">' + iconOf(D.items[id]) + '</div>');
      }
    }
    // what you are handed on arrival, not just what goes on sale
    if (BRS.length) reel.push('<div class="rw br">' + iconOf(D.items[BRS[0]]) + '</div>');
    if (nx.tables > tables()) {
      reel.push('<div class="rw"><img src="assets/icon/anvil.png" alt=""></div>');
    }
    if (!reel.length) {
      track.innerHTML = '<div id="rbNone">A bigger multiplier, same ingredients.</div>';
      track.style.animation = 'none';
      return;
    }
    track.style.animation = '';
    track.innerHTML = reel.join('') + reel.join('');
  }

  /* ---------------- the discovery moment ---------------- */
  function reveal(id) {
    const it = D.items[id];
    $('revImg').src = it.art;
    $('revRate').textContent = '+' + fmtRate(it.rate * mult()) + ' / sec';
    $('reveal').classList.add('on');
    drawTut();
    const card = $('revCard');
    card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
    setTimeout(() => {
      const r = card.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, 22, true);
    }, 240);
  }

  /* Say no AT the thing that was tapped, not only in a toast forty percent of
     the way up the screen. */
  function refuse(el, text) {
    toast(text);
    SFX.nope();
    if (!el) return;
    el.classList.remove('refuse');
    void el.offsetWidth;                 // restart the animation
    el.classList.add('refuse');
    setTimeout(() => el.classList.remove('refuse'), 340);
  }

  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('on'); void el.offsetWidth;
    el.classList.add('on');
  }

  /* ---------------- onboarding ----------------
     Each step is a target to ring and a condition that retires it. The layer
     never takes input, so this guides without gating: do the step, or ignore it
     and do something else, and it moves on when the condition is met. */
  let tapped = false;

  /* Point at something the player can actually pay for. The palette leads with
     the priciest unlocked ingredient, so the first card is the wrong card to
     tell a new player to buy. */
  function affordable() {
    return document.querySelector('#pal .pc:not(.locked):not(.poor)') ||
           document.querySelector('#pal .pc:not(.locked)');
  }

  const TUT = [
    { t: 'TAP THE ANVIL TO START CRAFTING',
      at: () => $('navCraft'),
      ok: () => $('viewCraft').classList.contains('on') },
    { t: 'BUY AN INGREDIENT TO PUT IT ON THE TABLE',
      at: () => affordable(),
      ok: () => grid.some(Boolean) || S.jobs.some(Boolean) || seen.size > 0 },
    { t: 'ONLY THINGS THAT COULD FINISH A RECIPE STAY LIT',
      at: () => affordable(),
      ok: () => !!$('res').dataset.out || S.jobs.some(Boolean) || seen.size > 0 },
    { t: 'A MATCH! TAP IT TO START FORGING',
      at: () => $('res'),
      ok: () => S.jobs.some(Boolean) || seen.size > 0 },
    /* The wait is the longest pause in the game and it did not exist when this
       tutorial was written, so it went unexplained. It is also where the skip
       lives, which nobody would find on their own. */
    { t: 'IT TAKES TIME. TAP THE FORGE TO FINISH IT NOW',
      at: () => document.querySelector('.forge.busy'),
      ok: () => seen.size > 0 },
    { t: 'YOUR BRAINROT IS ON THE PLOT',
      at: () => $('navPlot'),
      ok: () => $('viewPlot').classList.contains('on') },
    { t: 'TAP IT FOR COINS. IT ALSO EARNS ON ITS OWN',
      at: () => document.querySelector('.mob'),
      ok: () => tapped },
    /* Split in two. As one step it waited for a second brainrot ON THE PLOT,
       but the moment you tap craft it goes into the FORGE - so the count had
       not moved yet and the tip repeated "craft a second" at someone who just
       had. The second half now points at the wait it caused. */
    { t: 'NOW CRAFT A SECOND BRAINROT',
      at: () => $('viewCraft').classList.contains('on') ? affordable() : $('navCraft'),
      ok: () => S.slots.filter(Boolean).length > 1 || S.jobs.some(Boolean) },
    { t: 'WAIT FOR IT, OR TAP THE FORGE TO FINISH NOW',
      at: () => document.querySelector('.forge.busy') ||
                ($('viewCraft').classList.contains('on') ? $('res') : $('navCraft')),
      ok: () => S.slots.filter(Boolean).length > 1 },
    { t: 'DRAG ONE ONTO THE OTHER TO MERGE THEM',
      at: () => $('viewPlot').classList.contains('on')
        ? document.querySelector('.mob') : $('navPlot'),
      ok: () => merged() },
    /* The workshop is where every coin eventually goes, and nothing else on
       screen points at it. */
    { t: 'TASKS AND PERMANENT UPGRADES LIVE HERE',
      at: () => $('navShop'),
      ok: () => $('shop').classList.contains('on') }
  ];

  /* Read off the plot rather than a flag, so reloading mid-tutorial cannot
     un-teach a merge the player already did. */
  function merged() {
    return S.slots.some(e => e && (e.k === 'mut' || (e.lvl || 1) > 1));
  }

  function tutStep() {
    if (S.tut >= TUT.length) return null;
    // skip anything already satisfied, so a returning player is not re-taught
    while (S.tut < TUT.length && TUT[S.tut].ok()) { S.tut++; save(); }
    return TUT[S.tut] || null;
  }

  function drawTut() {
    const layer = $('tut');
    /* ADVANCE FIRST, then decide whether to draw. Checking tutBlocked() before
       tutStep() meant a step whose completion condition IS "this overlay is
       open" could never be satisfied - the overlay opened, the check never ran,
       and closing it brought the same tip back forever. */
    const step = tutStep();
    if (tutBlocked() || !step) { layer.classList.remove('on'); return; }
    const el = step.at();
    if (!el) { layer.classList.remove('on'); return; }
    const r = el.getBoundingClientRect();
    if (!r.width) { layer.classList.remove('on'); return; }
    layer.classList.add('on');
    const pad = 8;
    const ring = $('tutRing');
    ring.style.left = (r.left - pad) + 'px';
    ring.style.top = (r.top - pad) + 'px';
    ring.style.width = (r.width + pad * 2) + 'px';
    ring.style.height = (r.height + pad * 2) + 'px';
    const hand = $('tutHand');
    hand.style.left = (r.left + r.width / 2) + 'px';
    hand.style.top = (r.top + r.height / 2) + 'px';
    const tip = $('tutTip');
    tip.textContent = step.t;
    // above the target, unless it is too near the top to fit
    const below = r.top < innerHeight * 0.42;
    tip.style.top = below ? (r.bottom + 26) + 'px' : '';
    tip.style.bottom = below ? '' : (innerHeight - r.top + 26) + 'px';
  }

  /* ---------------- the frame ---------------- */
  /* Writing a text node that has not changed still dirties layout, and reading
     offsetHeight right afterwards forces a synchronous reflow. At 10Hz that was
     most of the frame budget for a game that is otherwise nearly idle. */
  const shown = {};
  function put(id, text) {
    if (shown[id] === text) return;
    shown[id] = text;
    $(id).textContent = text;
  }

  let tutAt = 0;
  function paint() {
    put('coins', fmt(S.coins));
    paintForges();
    paintBoost();
    paintEvent();
    put('rate', '+' + fmtRate(totalRate()) + '/s');
    put('act', 'REBIRTH ' + S.rb);
    $('buySlot').classList.toggle('dim', S.coins < slotCost());
    put('slotPx', fmt(slotCost()));
    const lk = $('lockSlot');
    if (lk) {
      const px = lk.querySelector('.px'), t = fmt(slotCost());
      if (px && px.textContent !== t) px.textContent = t;
    }
    $('badgeRb').classList.toggle('hidden', !canRebirth());
    $('badgeShop').classList.toggle('hidden', !anyClaim());
    // refresh, NOT rebuild: drawShop() here replaced the row under the cursor
    // ten times a second, which ate clicks and made hover flicker
    if ($('shop').classList.contains('on')) refreshShop();
    // drawRb() rebuilds the reward reel; refreshing keeps the REBIRTH button
    // pressable and the reel from restarting its pan every frame
    if ($('rb').classList.contains('on')) refreshRb();
    // the ring only needs 4Hz, and nothing at all once the tutorial is done
    const now = performance.now();
    if (S.tut < TUT.length && now - tutAt > 250) { tutAt = now; drawTut(); }
  }

  /* The boost pill doubles as the timer, so there is no separate countdown to
     keep in sync with the multiplier that actually applies. */
  function paintBoost() {
    const el = $('boost');
    const on = boostOn();
    const was = el.classList.contains('on');
    el.classList.toggle('on', on);
    if (was !== on) fitTop();
    if (on) {
      const left = Math.ceil((S.boost - Date.now()) / 1000);
      $('boostT').textContent = 'x' + B.boostMult + '  ' +
        Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2);
    }
    $('boostAd').style.display = on ? 'none' : '';
    $('slotAd').style.display = S.coins < slotCost() ? '' : 'none';
  }

  function drawAll() {
    /* drawDex() is NOT here on purpose. It builds 33 <img> tags, and having it
       run at boot made the browser fetch every character sprite - 3.6 MB - for
       a sheet the player had not opened. The badge is all that is needed until
       they actually open it. */
    drawPlot(); drawGrid(); drawPal(); drawForges(); dexBadge(); drawShop(); paint();
  }

  /* Reveal and sheet overlays sit above the tutorial ring, so hide it while one
     is open rather than ringing a control the player cannot reach. */
  function tutBlocked() {
    return $('reveal').classList.contains('on') ||
           $('dex').classList.contains('on') || $('rb').classList.contains('on') ||
           $('away').classList.contains('on') || $('shop').classList.contains('on') ||
           $('sell').classList.contains('on');
  }

  function tick(t) {
    requestAnimationFrame(tick);
    if (!lastT) { lastT = t; return; }
    const dt = Math.min(0.25, (t - lastT) / 1000);
    lastT = t;
    S.coins += totalRate() * dt;
    acc += dt; mAcc += dt;
    if (acc > 0.1) { acc = 0; paint(); }
    if (mAcc > 0.06) { mAcc = 0; paintMeters(false); }
  }

  /* ---------------- input ----------------
     A press on a creature is a tap until it travels SLOP pixels; past that it
     becomes a drag, and the creature rides a fixed-position layer above
     everything. `.mob` sets touch-action:none so the browser hands us the
     gesture; the grass around it keeps pan-y, so the plot still scrolls. */
  const SLOP = 9;
  let press = null, dragging = null, sellArmed = false;

  function onDown(ev) {
    loadClips();                       // needs a gesture; this is the earliest
    musicStart();                      // same reason: no context before a gesture
    const t = ev.target;
    if (!t.closest) return;

    if ($('reveal').classList.contains('on')) {
      $('reveal').classList.remove('on');
      drawTut();
      return;
    }
    const sheet = t.closest('.sheet');
    if (sheet && t === sheet) { sheet.classList.remove('on'); drawTut(); return; }

    const mob = t.closest('.mob');
    if (mob && mob.parentNode.dataset.slot !== undefined) {
      press = { slot: +mob.parentNode.dataset.slot, x: ev.clientX, y: ev.clientY,
                el: mob };
      if (mob.setPointerCapture && ev.pointerId !== undefined) {
        try { mob.setPointerCapture(ev.pointerId); } catch (e) {}
      }
      ev.preventDefault();
    }
  }

  function beginDrag() {
    const r = press.el.getBoundingClientRect();
    const layer = $('dragLayer');
    layer.style.width = r.width + 'px';
    layer.style.height = r.height + 'px';
    layer.innerHTML = press.el.querySelector('img').outerHTML;
    layer.classList.add('on');
    press.el.classList.add('ghost');
    dragging = { slot: press.slot, w: r.width, h: r.height, target: -1 };
    SFX.lift();
  }

  function dragTo(x, y) {
    const layer = $('dragLayer');
    layer.style.transform = 'translate(' + (x - dragging.w / 2) + 'px,' +
                            (y - dragging.h * 0.62) + 'px)';
    const under = document.elementFromPoint(x, y);
    const bin = under && under.closest ? under.closest('#trash') : null;
    const slot = under && under.closest ? under.closest('.slot') : null;
    const idx = bin ? -2
      : (slot && slot.dataset.slot !== undefined ? +slot.dataset.slot : -1);
    if (idx === dragging.target) return;
    for (const s of $('slots').children) s.classList.remove('drop', 'dropMerge');
    dragging.target = idx;
    $('trash').classList.toggle('over', idx === -2);
    // show what it is worth BEFORE letting go, not after
    $('trashV').textContent = idx === -2
      ? '+' + fmt(sellValue(S.slots[dragging.slot])) : 'SELL';
  }

  function onMove(ev) {
    if (!press) return;
    if (!dragging) {
      if (Math.abs(ev.clientX - press.x) < SLOP &&
          Math.abs(ev.clientY - press.y) < SLOP) return;
      beginDrag();
    }
    dragTo(ev.clientX, ev.clientY);
    ev.preventDefault();
  }

  function endDrag(ok) {
    const layer = $('dragLayer');
    layer.classList.remove('on');
    layer.innerHTML = '';
    for (const s of $('slots').children) s.classList.remove('drop', 'dropMerge');
    const d = dragging;
    dragging = null;
    $('trash').classList.remove('over');
    $('trashV').textContent = 'SELL';
    if (!ok || !d) { drawPlot(); return; }
    if (d.target === -2) { askSell(d.slot); return; }
    const to = d.target;
    if (to < 0 || to === d.slot) { drawPlot(); return; }
    if (S.slots[to]) { merge(d.slot, to); return; }
    S.slots[to] = S.slots[d.slot];
    S.slots[d.slot] = null;
    cool[to] = cool[d.slot] || 0;
    delete cool[d.slot];
    SFX.place();
    drawPlot(); save();
  }

  function onUp(ev) {
    if (!press) return;
    const p = press;
    press = null;
    if (dragging) { endDrag(true); return; }
    if (sellArmed) { askSell(p.slot); return; }
    collect(p.slot, p.el);
  }

  function onCancel() {
    if (dragging) endDrag(false);
    press = null;
  }

  function onClick(ev) {
    const t = ev.target;
    if (!t.closest) return;

    if (t.closest('#trash')) {
      sellArmed = !sellArmed;
      armTrash(sellArmed);
      if (sellArmed) toast('TAP A BRAINROT TO SELL IT');
      return;
    }
    if (t.closest('#sellGo')) {
      $('sell').classList.remove('on');
      if (sellAt >= 0) doSell(sellAt);
      sellAt = -1;
      return;
    }
    const sl = t.closest('#lockSlot') || t.closest('#buySlot');
    if (sl) { buySlot(sl); return; }

    const tk = t.closest('[data-task]');
    if (tk) { claimTask(tk.dataset.task); return; }
    const up = t.closest('[data-up]');
    if (up) { buyUp(up.dataset.up, up); return; }

    if (t.closest('#palUp')) { palJump(-1); return; }
    if (t.closest('#palDown')) { palJump(1); return; }

    const pc = t.closest('.pc');
    if (pc) { useIngredient(+pc.dataset.buy, pc); return; }

    const cell = t.closest('.gc');
    if (cell) { takeBack(+cell.dataset.cell); return; }

    const fg = t.closest('.forge.busy');
    if (fg) { skipJob(+fg.dataset.forge); return; }
    if (t.closest('#res')) { craft(); return; }
    if (t.closest('#rbGo')) { doRebirth(); return; }

    const dc = t.closest('.dcell');
    if (dc) {
      const id = +dc.dataset.id;
      if (!seen.has(id)) { dc.querySelector('.rc').innerHTML = recipeText(id); SFX.lift(); }
      return;
    }
  }

  function buySlot(el) {
    const c = slotCost();
    if (S.coins < c) { refuse(el || $('buySlot'), 'NOT ENOUGH COINS'); return; }
    S.coins -= c;
    S.unlocked++;
    SFX.craft();
    drawPlot(); paint(); save();
    flyCoin($('lockSlot') || $('buySlot'));
  }

  function view(name) {
    $('viewPlot').classList.toggle('on', name === 'plot');
    $('viewCraft').classList.toggle('on', name === 'craft');
    $('navPlot').classList.toggle('on', name === 'plot');
    $('navCraft').classList.toggle('on', name === 'craft');
    if (name === 'craft') { drawGrid(); drawPal(); drawForges(); }
    paint();
  }

  /* ---------------- boot ---------------- */
  /* The bar tracks real milestones rather than a timer, so it cannot sit at 90%
     while something is genuinely stuck. */
  function bootAt(pct, label) {
    const f = $('bootFill'), t = $('bootTip');
    if (f) f.style.width = pct + '%';
    if (t && label) t.textContent = label;
  }

  function bootDone() {
    const b = $('boot');
    if (!b) return;
    bootAt(100, 'READY');
    b.classList.add('gone');
    setTimeout(() => b.remove(), 500);
  }

  P.boot = function () {
    YT.init();
    /* firstFrameReady means "frames are on screen", and the loading screen IS a
       frame - it is in the markup and has already painted. Calling it after the
       data loaded described the game as visible some time after it was. */
    YT.firstFrame();
    bootAt(15, 'LOADING');

    /* ?reset=1 wipes the save. GATED TO LOCALHOST rather than removed: it stays
       useful while developing and cannot be stumbled into on the public build,
       where a stray link would silently destroy someone's progress. */
    const dev = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if (dev && /[?&]reset=1/.test(location.search)) {
      try { localStorage.removeItem(KEY); } catch (e) {}
      if (YT.present) { try { window.ytgame.game.saveData('{}'); } catch (e) {} }
    }

    fetch('assets/craft.json?v=' + VER)
      .then(r => r.json())
      .then(d => {
        bootAt(55, 'RECIPES');
        D = d;
        B = d.balance;
        ING = d.ingredients.slice();
        BRS = d.brainrots.slice();
        // parsed once: the filter walks this on every placement
        RECIPES = Object.keys(d.recipes).map(key => {
          const need = {};
          let total = 0;
          for (const p of key.split(',')) {
            const kv = p.split('*');
            need[+kv[0]] = +kv[1];
            total += +kv[1];
          }
          return { need: need, total: total, out: d.recipes[key] };
        });
        return initSave();
      })
      .then(v => { bootAt(80, 'SAVE'); return v; })
      .then(() => {
        initAudio();                   // after the probe: it keys off YT.present
        if (!S.unlocked) {
          S.unlocked = D.start.slots;
          S.coins = D.start.coins;
          S.slots = new Array(S.unlocked).fill(null);
        }
        while (S.slots.length < S.unlocked) S.slots.push(null);
        seen = new Set(S.seen.filter(id => D.items[id] && D.items[id].kind === 'br'));

        for (let i = 0; i < (S.jobs || []).length; i++) {
          if (S.jobs[i] && S.jobs[i].ends <= Date.now()) finishJob(i, true);
        }
        bankOffline();
        drawAll();
        bind();
        bootDone();
        YT.ready();                    // interactive, not merely visible
        requestAnimationFrame(tick);
      })
      .catch(err => {
        // fail visibly on the loading screen rather than replacing the page
        bootAt(100, 'COULD NOT LOAD');
        const t = $('bootTip');
        if (t) t.textContent = 'COULD NOT LOAD - ' + (err && err.message || 'error');
      });
  };

  /* Idle pay while the tab was closed, capped so leaving for a week is not a
     shortcut past the whole economy. */
  let awayPay = 0;

  function bankOffline() {
    if (!S.ts) return;
    const secs = Math.max(0, (Date.now() - S.ts) / 1000);
    const r = totalRate();
    if (secs < 30 || r <= 0) return;
    awayPay = r * Math.min(secs, B.offlineCap);
    S.coins += awayPay;
    // a sheet rather than a toast, because the doubling offer needs somewhere
    // to live and a toast cannot hold a button
    setTimeout(() => {
      $('awayAmt').textContent = '+' + fmt(awayPay);
      $('away').classList.add('on');
      drawTut();
    }, 400);
  }

  function bind() {
    addEventListener('pointerdown', onDown);
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onCancel);
    addEventListener('click', onClick);

    /* Every one of these is optional and user-initiated: they shorten a wait or
       add a bonus, and nothing is gated behind watching one. */
    /* The forge itself is the skip: it is already the thing you watch and the
       thing you tap to claim, so the wait and the way out live together. */

    $('boostAd').onclick = () => {
      YT.rewarded(() => {
        S.boost = Math.max(S.boost, Date.now()) + B.boostSecs * 1000;
        toast('x' + B.boostMult + ' INCOME FOR ' + (B.boostSecs / 60) + ' MIN');
        SFX.find(); paint(); save();
      }, () => toast('NO AD AVAILABLE'));
    };
    $('slotAd').onclick = () => {
      YT.rewarded(() => {
        S.unlocked++;
        toast('FREE PLOT SLOT');
        SFX.craft(); drawPlot(); paint(); save();
      }, () => toast('NO AD AVAILABLE'));
    };
    $('rbAd').onclick = () => {
      const need = adsNeeded();
      if (!need || S.adRb >= need) return;
      YT.rewarded(() => {
        S.adRb++;
        SFX.buy();
        if (S.adRb >= need) { toast('REBIRTH UNLOCKED'); SFX.find(); }
        paint(); drawRb(); save();
      }, () => toast('NO AD AVAILABLE'));
    };
    $('awayAd').onclick = () => {
      YT.rewarded(() => {
        S.coins += awayPay;
        $('awayAmt').textContent = '+' + fmt(awayPay * 2);
        $('awayAd').style.display = 'none';
        SFX.coin(); paint(); save();
      }, () => toast('NO AD AVAILABLE'));
    };

    armTrash(false);
    $('navPlot').onclick = () => view('plot');
    $('navCraft').onclick = () => view('craft');
    $('navRb').onclick = () => { drawRb(); $('rb').classList.add('on'); drawTut(); };
    $('navShop').onclick = () => { drawShop(); $('shop').classList.add('on'); drawTut(); };
    $('navDex').onclick = () => { drawDex(); $('dex').classList.add('on'); drawTut(); };
    for (const b of document.querySelectorAll('.btn.close')) {
      b.onclick = () => {
        $('dex').classList.remove('on'); $('rb').classList.remove('on');
        $('away').classList.remove('on'); $('shop').classList.remove('on');
        $('sell').classList.remove('on'); sellAt = -1;
        drawTut();
      };
    }

    // MUST use the SDK lifecycle, never the Page Visibility API
    if (YT.present) {
      try {
        window.ytgame.system.onPause(() => {
          flushSave();
          musicStop();
          if (actx && actx.state === 'running') actx.suspend();
        });
        window.ytgame.system.onResume(() => {
          lastT = 0;                     // do not bank the paused wall-clock twice
          if (actx && actx.state === 'suspended') actx.resume();
          musicStart();
        });
      } catch (e) {}
    }
    addEventListener('resize', () => { topH = 0; fitTop(); fitPlot(); drawTut(); palArrows(); });
    $('pal').addEventListener('scroll', palArrows, { passive: true });
    setInterval(save, 15000);
  }
})();
