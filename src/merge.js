/* BRAINROT DROP - the merge simulation.

   Circles in a box under gravity. Two touching circles of the same tier fuse
   into one of the next tier. No DOM, no WebGL, so the whole sim can be stepped
   headlessly in node.

   Impulse-based solver with positional correction, iterated a few times per
   substep - a single pass leaves stacks visibly sinking into each other. */
(function () {
  const M = {};
  window.MERGE = M;

  /* Container is measured in world units; the renderer scales to fit. */
  /* Sized to the box art's front opening (assets/box.json) so the physics
     bounds and the drawn container are the same rectangle. */
  M.W = 10.0;
  M.H = +(10.0 / 0.9892).toFixed(4);
  M.DROP_Y = -1.5;             // pieces are held above the rim
  M.DANGER_Y = 0.30;           // above this for too long ends the run

  /* Eleven tiers, radius growing about 1.22x a step so merges feel like a jump
     without the last few becoming unmanageable. */
  M.TIERS = [];
  (function () {
    const NAMES = ['Ninja Cup', 'Goldfish Cat', 'Tire Frog', 'Banana Monkey',
                   'Capybara', 'Fridge Camel', 'Saturn Cow', 'Sneaker Shark',
                   'Cactus Elephant', 'Croco Plane', 'Final Stack'];
    /* ACCELERATING growth. A flat ratio made the middle of the chain feel
       flat - merging into the Saturn Cow barely looked different from the tier
       below it. Early steps stay small so the opening is forgiving; later ones
       jump hard, so the back half of the chain eats the box fast.
       Constraint: two tier-9s must still fit side by side (4*r9 <= W) or the
       top tier would be unreachable. */
    /* The ceiling here is hard: two tier-9s must fit side by side (4*r9 <= W)
       or the boss can never be created. That pins the LARGEST piece at half the
       container width, so the only way to make everything bigger is a gentler
       ramp. Jumps drop from ~+21% to ~+15%, and every piece grows ~56%. */
    const GROWTH = [1.13, 1.14, 1.145, 1.15, 1.155, 1.16, 1.165, 1.17, 1.175, 1.18];
    let r = 0.68;
    for (let i = 0; i < 11; i++) {
      M.TIERS.push({ i: i, name: NAMES[i], r: r, score: (i + 1) * (i + 2) * 3 });
      if (i < GROWTH.length) r *= GROWTH[i];
    }
  })();

  /* Reaching the top tier is the run's big beat: it triggers the boss sequence,
     which clears the board and moves you to the next biome. */
  // Three biomes, each with its own cast, looping. A fourth would have had to
  // reuse a cast, so it was cut rather than repeat characters.
  M.BIOMES = [
    { name: 'MEADOW', set: 'set0', art: 'meadow' },
    { name: 'DESERT', set: 'set1', art: 'desert' },
    { name: 'TUNDRA', set: 'set2', art: 'tundra' }
  ];

  M.GRAV = 140;                  // full-height drop lands in ~0.32s
  /* These are CHARACTERS, not fruit: free tumbling leaves a shark resting
     upside down, which reads as a bug. Spin is kept small, heavily damped, and
     sprung back upright, so pieces lean on impact and then settle. */
  const MAX_TILT = 1.05;          // ~60 degrees: they really lay over, still never invert
  const SPIN_CAP = 6.0;
  const SPIN_DAMP = 0.93;         // per substep - spins carry much further
  /* Minimum speed that may impart spin. This MUST stay above the per-substep
     gravity floor (GRAV/SUB/60, currently 0.875) - a resting piece has that
     much vy re-added every substep, so a lower gate feeds it back as torque
     every frame and the pile never sleeps. Raising GRAV means raising this. */
  const SPIN_GATE = 2.0;

  /* JELLY. Each piece carries a squash spring: sq > 0 is squat-and-wide,
     sq < 0 is tall-and-thin. Impacts inject it, the spring rings it out. ~2.2Hz
     so it reads as a wobble rather than a twitch. */
  const SQ_STIFF = 190, SQ_DAMP = 13, SQ_MAX = 0.42;
  /* Where a body is being pressed, not just how hard. Up to 3 contacts, each a
     unit direction from the centre plus a strength, so the renderer can push
     that PART of the mesh in instead of scaling the whole thing. */
  /* SIX FIXED ANGULAR BUCKETS, not a list of the N strongest contacts.

     With a replacement list, a piece touching more neighbours than there are
     slots had different contacts win on different frames, so its dents
     flickered - the more crowded the pile, the worse it looked. A contact now
     always lands in the same bucket for the same direction, so nothing can
     thrash, and several neighbours pressing from the same side simply reinforce
     one dent instead of fighting for a slot. */
  const PRESS_BUCKETS = 6;
  const PRESS_DECAY = 5.5;        // per second; dents relax when contact ends
  const PRESS_EASE = 6;           // how fast a dent reaches its target depth
  const PRESS_GAIN = 0.11;        // impact speed -> dent depth
  const SQ_FROM_HIT = 0.019;      // squash per unit of impact speed
  const SPIN_SLEEP = 0.15;        // below this, stop entirely
  /* Linear sleep threshold. Gated on actually being in CONTACT (see b.touch),
     which is what lets it sit above the per-substep gravity floor - an
     ungated clamp has to stay under 0.583 or it freezes pieces mid-air. */
  const LIN_SLEEP = 0.30;
  /* A body must be slow for this long CONTINUOUSLY before it sleeps. Sleeping
     on a single slow frame froze pieces mid-slide, so a piece perched on
     another's shoulder stuck there instead of rolling off - 0 of 7 test
     offsets rolled, including ones barely touching. */
  const SLEEP_TIME = 0.22;
  const PEN_SLOP = 0.014;         // overlap left uncorrected, to stop the pump
  const REST_TILT = 0.46;        // ~26 deg of lean is kept, never corrected
  const UPRIGHT = 2.2;           // how fast anything BEYOND that eases back            // barely rights them, so a lean holds for seconds
  /* Merges fire slightly before the circles truly overlap. Exact-touch merging
     reads as "why didn't that combine?" and is the single biggest feel problem
     in a game like this. */
  const MERGE_SLOP = 0.10;
  const COMBO_WINDOW = 1.25;      // seconds to keep a chain alive
  const COMBO_STEP = 0.30;        // +30% per link
  const COMBO_MAX = 4.0;
  const REST = 0.02;              // almost no bounce, so pieces settle flat
  const FRICTION = 0.86;          // floor drag
  /* Friction COEFFICIENTS now, not velocity fractions - the tangential impulse
     is capped at mu * normal impulse. mu 0.55 means a piece holds on a slope
     up to ~29 degrees and slides past it, which is what stacking should feel like. */
  const PAIR_MU = 0.35;           // measured: only pieces landing within ~0.35 of
                                  // the base radius stack; the rest roll off
  const FLOOR_MU = 0.70;
  const ITER = 8;                 // more passes: taller stacks stay rigid
  /* 4, not 2. Peak fall speed is now ~70 u/s; at SUB 2 that is 0.58 units of
     travel per substep against a smallest radius of 0.68, which is close
     enough to tunnelling to matter. */
  const SUB = 4;

  M.newGame = function (seed) {
    M.s = {
      bodies: [], score: 0, best: 0, over: false,
      next: 0, cur: 0, dropX: 0, dropCd: 0,
      overT: 0, danger: 0, t: 0, merges: 0, biggest: 0,
      shakes: 1, seed: (seed | 0) || 987654321,
      pops: [],                 // {x,y,tier,life} for merge popups
      fx: [],                   // spark particles
      combo: 0, comboT: 0, comboBest: 0,
      made: 0,                  // bitmask of tiers CREATED this run, for the dex
      golds: 0,                 // golden pieces cashed in, for the run summary
      used: { swap: 0, hammer: 0 },
      biome: 0, bossesBeaten: 0,
      boss: null,               // {phase, t, x, y} while the sequence plays
      smoke: [],
      shakeMag: 0,              // camera kick, drained by the renderer
      lift: 0                   // box hoisted off the ground during a shake
    };
    M.s.cur = rollTier();
    M.s.next = rollTier();
    return M.s;
  };

  function rnd() {
    const s = M.s;
    s.seed = (s.seed * 1664525 + 1013904223) >>> 0;
    return s.seed / 4294967296;
  }
  M.rnd = rnd;

  /* The drop pool WIDENS as you progress. Early on only the two smallest ever
     appear, so the opening is forgiving; once you are deep into the chain the
     bigger pieces start arriving and the box fills far faster. The difficulty
     comes from sizing, which is the whole point of the format. */
  const POOL_W = [40, 30, 16, 9, 5];

  /* A golden piece pays GOLD_MULT on the merge it takes part in. It is the only
     random upside in the game - everything else is deterministic - so it is the
     one moment a bad board can still pay out. */
  M.GOLD_CHANCE = 0.04;
  M.GOLD_MULT = 3;

  M.poolSize = function () {
    const b = M.s ? M.s.biggest : 0;
    if (b >= 7) return 5;
    if (b >= 5) return 4;
    if (b >= 3) return 3;
    return 2;
  };

  function rollTier() {
    const n = M.poolSize();
    let total = 0;
    for (let i = 0; i < n; i++) total += POOL_W[i];
    let p = rnd() * total;
    for (let i = 0; i < n; i++) { p -= POOL_W[i]; if (p <= 0) return i; }
    return 0;
  }
  M.rollTier = rollTier;

  /* How close the pile is to the rim, 0 empty .. 1 at the danger line. Drives
     how much grace you get before a run ends. */
  M.fill = function () {
    const s = M.s;
    if (!s || !s.bodies.length) return 0;
    let top = M.H;
    for (const b of s.bodies) {
      const t = b.y - b.r;
      if (t < top) top = t;
    }
    const span = M.H - M.DANGER_Y;
    return Math.max(0, Math.min(1, 1 - (top - M.DANGER_Y) / span));
  };

  /* Cross the line and you are basically finished. The window only exists so a
     piece falling or bouncing THROUGH the top does not kill you - anything that
     comes to rest above the line ends the run almost at once. */
  const GRACE_MAX = 0.70, GRACE_MIN = 0.18;
  M.grace = function () {
    return GRACE_MAX - (GRACE_MAX - GRACE_MIN) * M.fill();
  };

  M.canDrop = function () {
    return !M.s.over && !M.s.boss && M.s.dropCd <= 0;
  };

  M.moveTo = function (x) {
    const s = M.s, r = M.TIERS[s.cur].r;
    s.dropX = Math.max(-M.W / 2 + r, Math.min(M.W / 2 - r, x));
  };

  M.drop = function () {
    const s = M.s;
    if (!M.canDrop()) return false;
    s.bodies.push({
      // launched, not released: starting from rest made short falls onto a
      // tall stack drift down instead of dropping
      x: s.dropX, y: M.DROP_Y, vx: 0, vy: 12, sleep: false,
      gold: rnd() < M.GOLD_CHANCE, still: 0, sq: 0, sqv: 0,
      pt: [0, 0, 0, 0, 0, 0], pf: [0, 0, 0, 0, 0, 0],
      t: s.cur, r: M.TIERS[s.cur].r,
      rot: (rnd() - 0.5) * 0.85, vrot: (rnd() - 0.5) * 3.0,
      age: 0, merged: false
    });
    s.made |= (1 << s.cur);
    s.cur = s.next;
    s.next = rollTier();
    s.dropCd = 0.22;
    return true;
  };

  /* Rewarded-ad powerup: jostle everything so a stuck stack can settle. */
  /* ---------------- powerups ----------------
     Both are deliberately surgical. A merge board dies from ONE badly placed
     piece, so the fix has to be precise; a radius clear would take out the
     pieces you were trying to save. */

  // Reroll the piece you are holding. Cheap, used often.
  M.swapNext = function () {
    const s = M.s;
    if (!s || s.over || s.boss) return false;
    let t = rollTier(), guard = 0;
    while (t === s.cur && guard++ < 8) t = rollTier();
    s.cur = t;
    s.made |= (1 << t);
    s.used.swap++;
    return true;
  };

  // Delete one piece by world position. Returns the tier removed, or -1.
  M.hammer = function (wx, wy) {
    const s = M.s;
    if (!s || s.over || s.boss) return -1;
    let hit = -1, bestD = Infinity;
    for (let i = 0; i < s.bodies.length; i++) {
      const b = s.bodies[i];
      const d = Math.hypot(b.x - wx, b.y - wy);
      if (d <= b.r && d < bestD) { bestD = d; hit = i; }
    }
    if (hit < 0) return -1;
    const b = s.bodies[hit];
    burst(s, b.x, b.y, 14, b.t);
    puff(s, b.x, b.y, 14, 4.5, 1.6);   // (s,x,y,count,spread,rise)
    s.bodies.splice(hit, 1);
    wakeAll(s);                  // the pile above it has lost its support
    s.used.hammer++;
    return b.t;
  };

  M.shake = function () {
    const s = M.s;
    if (s.shakes <= 0 || s.over) return false;
    s.shakes--;
    // a sleeping body is skipped by the integrator, so kicking its velocity
    // without waking it just parks a stale impulse on it forever
    wakeAll(s);
    s.lift = 1;                 // grabbed off the ground, then rattled
    s.shakeMag = Math.max(s.shakeMag, 0.9);
    for (const b of s.bodies) {
      b.vx += (rnd() - 0.5) * 34;
      b.vy -= 8 + rnd() * 14;          // thrown up, not just nudged
      b.vrot += (rnd() - 0.5) * 26;    // enough to actually flip over
    }
    return true;
  };

  function puff(s, x, y, n, spread, rise) {
    for (let i = 0; i < n; i++) {
      const ang = rnd() * 6.2832, sp = rnd() * spread;
      s.smoke.push({
        x: x + Math.cos(ang) * rnd() * 0.6,
        y: y + Math.sin(ang) * rnd() * 0.6,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - rise,
        life: 0.7 + rnd() * 0.8, max: 1.5,
        size: 0.8 + rnd() * 1.5, spin: (rnd() - 0.5) * 1.6, rot: rnd() * 6.28
      });
    }
  }
  M.puff = puff;

  function burst(s, x, y, n, tier) {
    for (let i = 0; i < n; i++) {
      const ang = rnd() * 6.2832, sp = 2.5 + rnd() * (5 + tier * 1.2);
      s.fx.push({
        x: x, y: y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 2,
        life: 0.32 + rnd() * 0.30, max: 0.62,
        size: 0.12 + rnd() * 0.10 + tier * 0.012
      });
    }
  }

  /* Record a press. Contacts in the same direction merge rather than stacking,
     so a body resting on the floor keeps one steady dent instead of three. */
  function pressArrays(b) {
    if (!b.pt) { b.pt = [0, 0, 0, 0, 0, 0]; b.pf = [0, 0, 0, 0, 0, 0]; }
    return b;
  }

  /* Route a contact into its angular bucket. Bodies are built in several places
     (tests, the boss helper), so the arrays are created lazily. */
  function addPress(b, dx, dy, f) {
    if (!(f > 0.004)) return;
    pressArrays(b);
    const ang = Math.atan2(dy, dx);                       // -PI..PI
    let i = Math.round(ang / (Math.PI * 2) * PRESS_BUCKETS) % PRESS_BUCKETS;
    if (i < 0) i += PRESS_BUCKETS;
    if (f > b.pt[i]) b.pt[i] = f > 1 ? 1 : f;
  }

  function wakeAll(s) { for (const b of s.bodies) b.sleep = false; }

  function merge(a, b, s) {
    // whatever these two were supporting must fall; a sleeper cannot notice
    wakeAll(s);
    const nt = a.t + 1;
    a.merged = b.merged = true;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;

    // chain: merges landing inside the window escalate the payout
    s.combo = s.comboT > 0 ? s.combo + 1 : 1;
    s.comboT = COMBO_WINDOW;
    if (s.combo > s.comboBest) s.comboBest = s.combo;
    let mult = Math.min(COMBO_MAX, 1 + COMBO_STEP * (s.combo - 1));
    const gold = a.gold || b.gold;
    if (gold) { mult *= M.GOLD_MULT; s.golds++; }

    const gain = Math.round(M.TIERS[a.t].score * mult);
    s.score += gain;
    s.made |= (1 << nt);          // this character has now been created
    s.merges++;
    burst(s, mx, my, 10 + a.t * 3, a.t);
    s.shakeMag = Math.min(0.55, s.shakeMag + 0.06 + a.t * 0.035);
    if (nt > s.biggest) s.biggest = nt;
    if (nt < M.TIERS.length) {
      s.bodies.push({
        x: mx, y: my, vx: (a.vx + b.vx) * 0.5, vy: (a.vy + b.vy) * 0.5 - 2.0,
        t: nt, r: M.TIERS[nt].r,
        rot: (rnd() - 0.5) * 0.6, vrot: (rnd() - 0.5) * 3.4, age: 0, merged: false, pop: 0.22,
        still: 0, sq: 0.34, sqv: 0, pt: [0, 0, 0, 0, 0, 0], pf: [0, 0, 0, 0, 0, 0]
      });
      s.pops.push({ x: mx, y: my, tier: nt, life: 0.75, val: gain, gold: gold });
    } else {
      // two bosses merging is pure bonus; the sequence fires on CREATING one
      s.score += 1500;
      s.pops.push({ x: mx, y: my, tier: nt - 1, life: 1.1, top: true, val: gain + 1500, gold: gold });
    }
    if (nt === M.TIERS.length - 1 && !s.boss) startBoss(s, mx, my);
  }

  /* Boss sequence. Phases run on a clock; the renderer reads s.boss to drive
     the flash, zoom and banner. Input is locked for the duration. */
  const BOSS_PHASES = { roar: 0.95, blast: 0.55, swap: 0.85 };

  function startBoss(s, x, y) {
    s.boss = { phase: 'roar', t: 0, x: x, y: y, flash: 0, done: false };
    s.shakeMag = 0.6;
    puff(s, x, y, 26, 5, 1.5);
  }

  function stepBoss(s, dt) {
    const b = s.boss;
    b.t += dt;
    if (b.phase === 'roar') {
      s.shakeMag = Math.max(s.shakeMag, 0.35 + Math.sin(b.t * 26) * 0.2);
      if (Math.random() < 0.55) puff(s, b.x, b.y, 2, 6, 2.0);
      if (b.t >= BOSS_PHASES.roar) { b.phase = 'blast'; b.t = 0; b.flash = 1; blast(s, b); }
    } else if (b.phase === 'blast') {
      b.flash = Math.max(0, 1 - b.t / 0.35);
      if (b.t >= BOSS_PHASES.blast) {
        b.phase = 'swap'; b.t = 0;
        s.bodies.length = 0;                 // board is cleared by the blast
        s.biome = (s.biome + 1) % M.BIOMES.length;
        s.bossesBeaten++;
        b.needSwap = true;                   // renderer swaps the cast here
      }
    } else if (b.phase === 'swap') {
      if (b.t >= BOSS_PHASES.swap) { s.boss = null; s.combo = 0; s.comboT = 0; }
    }
  }

  function blast(s, b) {
    // fling everything outward, then the board is wiped
    for (const o of s.bodies) {
      const dx = o.x - b.x, dy = o.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      o.vx += (dx / d) * 34; o.vy += (dy / d) * 34 - 10;
      o.vrot += (rnd() - 0.5) * 8;
    }
    puff(s, b.x, b.y, 40, 12, 2.5);
    s.shakeMag = 0.75;
  }

  M.bossActive = () => !!(M.s && M.s.boss);

  M.step = function (dt) {
    const s = M.s;
    if (!s) return;
    s.t += dt;
    if (s.dropCd > 0) s.dropCd -= dt;

    for (let i = s.pops.length - 1; i >= 0; i--) {
      s.pops[i].life -= dt;
      s.pops[i].y -= dt * 1.2;
      if (s.pops[i].life <= 0) s.pops.splice(i, 1);
    }
    for (let i = s.fx.length - 1; i >= 0; i--) {
      const f = s.fx[i];
      f.life -= dt;
      if (f.life <= 0) { s.fx.splice(i, 1); continue; }
      f.vy += 26 * dt;
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.vx *= 0.94;
    }
    for (let i = s.smoke.length - 1; i >= 0; i--) {
      const f = s.smoke[i];
      f.life -= dt;
      if (f.life <= 0) { s.smoke.splice(i, 1); continue; }
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.vx *= 0.95; f.vy = f.vy * 0.95 - 1.4 * dt;   // smoke rises
      f.rot += f.spin * dt;
      f.size += dt * 1.4;
    }
    if (s.boss) stepBoss(s, dt);
    if (s.comboT > 0) {
      s.comboT -= dt;
      if (s.comboT <= 0) s.combo = 0;
    }
    if (s.shakeMag > 0) s.shakeMag = Math.max(0, s.shakeMag - dt * 2.2);
    if (s.lift > 0) {
      s.lift = Math.max(0, s.lift - dt * 1.5);                  // ~0.65s hoist
      /* When the hoist ends every piece must be awake: the tilt clamp and the
         upright spring live in the integrator, which sleeping bodies skip, so a
         piece that dozed off mid-tumble would keep a 70-degree lean forever. */
      if (s.lift === 0) wakeAll(s);
    }
    if (s.over) return;

    const h = dt / SUB;
    for (let sub = 0; sub < SUB; sub++) {
      const B = s.bodies;

      for (let i = 0; i < B.length; i++) {
        const b = B[i];
        b.age += h;
        b.touch = false;
        /* A sleeping body is not integrated at all. Leaving gravity on meant it
           re-penetrated every substep and the position solver pushed it back out
           again forever - bodies with ZERO velocity still slid ~0.26 units per
           second each. That treadmill was the visible 'adjusting'. */
        if (b.sleep) {
          if (b.pop > 0) b.pop -= h;
          b.sqv += (-SQ_STIFF * b.sq - SQ_DAMP * b.sqv) * h;
          b.sq += b.sqv * h;
          /* A sleeping body does NOT decay its dents. It skips contact
             resolution, so nothing would re-add them - and a bun resting on the
             floor should stay dented where it sits, not slowly puff back up. */
          pressArrays(b);
          continue;
        }
        b.vy += M.GRAV * h;
        b.x += b.vx * h; b.y += b.vy * h;
        b.rot += b.vrot * h;
        b.vrot *= SPIN_DAMP;
        /* While the box is being shaken the pieces are allowed to spin far
           faster and to turn right over - the usual caps are what make a
           settled pile calm, and they also made a shake look like a nudge. */
        const tumbling = s.lift > 0.02;
        const cap = tumbling ? 22 : SPIN_CAP;
        if (b.vrot > cap) b.vrot = cap;
        else if (b.vrot < -cap) b.vrot = -cap;
        if (Math.abs(b.vrot) < SPIN_SLEEP) b.vrot = 0;
        /* Deadbanded upright spring. Pulling every piece back to dead level
           made a settled pile look stiff and threw away all the rotation; now
           a lean up to REST_TILT is KEPT permanently, and only what goes past
           it eases back. So pieces come to rest at varied angles and stay there. */
        if (!tumbling) {
          if (b.rot > REST_TILT) b.rot -= (b.rot - REST_TILT) * Math.min(1, UPRIGHT * h);
          else if (b.rot < -REST_TILT) b.rot += (-b.rot - REST_TILT) * Math.min(1, UPRIGHT * h);
        }
        if (!tumbling) {
          if (b.rot > MAX_TILT) { b.rot = MAX_TILT; if (b.vrot > 0) b.vrot = 0; }
          else if (b.rot < -MAX_TILT) { b.rot = -MAX_TILT; if (b.vrot < 0) b.vrot = 0; }
        }
        if (b.pop > 0) b.pop -= h;
        b.touch = false;
        // jelly spring runs even while asleep, so a settling wobble finishes
        b.sqv += (-SQ_STIFF * b.sq - SQ_DAMP * b.sqv) * h;
        b.sq += b.sqv * h;
        pressArrays(b);
        const ez = Math.min(1, PRESS_EASE * h);
        for (let k = 0; k < PRESS_BUCKETS; k++) {
          b.pt[k] -= PRESS_DECAY * h;               // released contacts fade
          if (b.pt[k] < 0) b.pt[k] = 0;
          b.pf[k] += (b.pt[k] - b.pf[k]) * ez;
        }
        if (b.sq > SQ_MAX) { b.sq = SQ_MAX; b.sqv = 0; }
        else if (b.sq < -SQ_MAX) { b.sq = -SQ_MAX; b.sqv = 0; }
      }

      for (let it = 0; it < ITER; it++) {
        // walls
        for (const b of B) {
          if (b.sleep) continue;
          const L = -M.W / 2 + b.r, R = M.W / 2 - b.r, F = M.H - b.r;
          /* Same deadzone as the pair contacts. A piece merely RESTING against
             a wall still has gravity re-added every substep, and this coupling
             fires once per solver iteration - without the gate that is a
             feedback loop that parks the piece on a permanent 30-degree lean
             with a stale spin it never sheds. Only real impacts impart torque. */
          if (b.x < L) {
            b.touch = true;
            if (b.vx < -2) b.sqv -= (-b.vx) * SQ_FROM_HIT * 8;   // squeezed sideways
            addPress(b, -1, 0, Math.min(0.8, 0.22 + Math.abs(b.vx) * PRESS_GAIN));
            b.x = L; if (b.vx < 0) b.vx = -b.vx * REST;
            if (b.vy > SPIN_GATE || b.vy < -SPIN_GATE) b.vrot += b.vy * 0.045;
          }
          if (b.x > R) {
            b.touch = true;
            if (b.vx > 2) b.sqv -= b.vx * SQ_FROM_HIT * 8;
            addPress(b, 1, 0, Math.min(0.8, 0.22 + Math.abs(b.vx) * PRESS_GAIN));
            b.x = R; if (b.vx > 0) b.vx = -b.vx * REST;
            if (b.vy > SPIN_GATE || b.vy < -SPIN_GATE) b.vrot -= b.vy * 0.045;
          }
          if (b.y > F) {
            b.touch = true;
            b.y = F;
            const vn = b.vy;
            if (vn > 2) b.sqv += vn * SQ_FROM_HIT * 10;   // splat on landing
            // resting weight still dents; +y is DOWN in sim coords
            addPress(b, 0, 1, Math.min(0.85, 0.30 + vn * PRESS_GAIN));
            if (b.vy > 0) b.vy = -b.vy * REST;
            // same Coulomb cap on the floor, for the same reason
            const maxF = Math.abs(vn) * FLOOR_MU;
            let dv = b.vx;
            if (dv > maxF) dv = maxF; else if (dv < -maxF) dv = -maxF;
            b.vx -= dv;
            b.vrot = b.vrot * 0.93 - b.vx * 0.10;
          }
        }
        // pairs
        for (let i = 0; i < B.length; i++) {
          const a = B[i];
          if (a.merged) continue;
          for (let j = i + 1; j < B.length; j++) {
            const b = B[j];
            if (b.merged) continue;
            let dx = b.x - a.x, dy = b.y - a.y;
            const rr = a.r + b.r;
            const mrr = rr + MERGE_SLOP;
            let d2 = dx * dx + dy * dy;
            const same = a.t === b.t && a.age > 0.02 && b.age > 0.02;
            // slop applies only to merging, never to physical separation
            if (d2 >= (same ? mrr * mrr : rr * rr)) continue;
            let d = Math.sqrt(d2);
            if (d < 1e-5) { dx = 0; dy = 1; d = 1e-5; }
            const nx = dx / d, ny = dy / d;

            if (same) { merge(a, b, s); continue; }
            // two sleepers never push on each other; any live contact wakes both
            if (a.sleep && b.sleep) continue;
            a.sleep = false; b.sleep = false;
            if (d2 >= rr * rr) continue;      // only overlapping pairs resolve

            /* Penetration slop. Positional correction moves bodies without
               touching velocity, so it ADDS energy; run 32x a frame (ITER*SUB)
               with no deadzone it pumped the pile until it drifted apart -
               measured shifting 0.02 units/half-second at 1.5s and 0.51 by 8s.
               Leaving a sliver of overlap uncorrected is what makes it stop. */
            const pen = rr - d - PEN_SLOP;
            if (pen <= 0) continue;
            a.touch = true; b.touch = true;

            /* Squish is driven by CONTACT, not by collision events. A piece that
               was nudged, tumbled or simply settled against a neighbour has no
               approach velocity at all, so anything gated on an impact never
               fires for it and its dent decays away. Depth is the honest
               measure: if they overlap, they are pressing on each other,
               whatever their velocity happens to be doing. */
            const depth = Math.min(1, pen / (Math.min(a.r, b.r) * 0.55));
            const pf0 = 0.22 + depth * 0.55;
            addPress(a, nx, ny, pf0);
            addPress(b, -nx, -ny, pf0);

            const corr = pen * 0.5 * 0.60;
            a.x -= nx * corr; a.y -= ny * corr;
            b.x += nx * corr; b.y += ny * corr;

            const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
            const vn = rvx * nx + rvy * ny;
            if (vn < 0) {
              const jimp = -(1 + REST) * vn * 0.5;
              if (vn < -2) {                       // they wobble off each other
                const hit = -vn * SQ_FROM_HIT * 5;
                a.sqv += hit; b.sqv += hit;
              }
              // a real impact deepens the dent already registered above
              const pf = Math.min(0.92, 0.30 + Math.abs(vn) * PRESS_GAIN);
              addPress(a, nx, ny, pf);
              addPress(b, -nx, -ny, pf);
              a.vx -= nx * jimp; a.vy -= ny * jimp;
              b.vx += nx * jimp; b.vy += ny * jimp;
              /* Contact friction. Without a tangential impulse the pieces only
                 ever push apart along the normal, so piles slide around like
                 wet soap and never lock together. */
              const tx = -ny, ty = nx;
              const vt = rvx * tx + rvy * ty;
              /* COULOMB-LIMITED. This used to be a flat fraction of tangential
                 velocity, applied ITER*SUB = 32 times a frame: (1-0.34)^32 is
                 4e-7, so any two touching pieces were effectively welded and a
                 piece dropped on a shoulder slid at 0.1 u/s under gravity 140.
                 Capping the tangential impulse by the NORMAL impulse means a
                 light contact grips lightly and a steep slope lets go. */
              const maxF = Math.abs(jimp) * PAIR_MU;
              let jt = vt * 0.5;
              if (jt > maxF) jt = maxF; else if (jt < -maxF) jt = -maxF;
              a.vx += tx * jt; a.vy += ty * jt;
              b.vx -= tx * jt; b.vy -= ty * jt;
              /* Deadzone. This runs AFTER the integrator's sleep clamp, so
                 without a gate the micro-jitter of a resting stack is fed back
                 as spin every frame and the pile wobbles forever. Real rubs and
                 impacts are far above this; resting contact is far below. */
              if (vt > SPIN_GATE || vt < -SPIN_GATE) {
                a.vrot += vt * 0.075; b.vrot -= vt * 0.075;
              }
            }
          }
        }
      }

      /* Second sleep clamp, at the END of the substep. The one inside the
         integrator runs before contacts, so whatever contact resolution injects
         survives to the next frame and a resting pile never actually stops. */
      for (let i = 0; i < B.length; i++) {
        const bb = B[i];
        if (bb.vrot < SPIN_SLEEP && bb.vrot > -SPIN_SLEEP) bb.vrot = 0;
        /* Linear sleep, contact-gated: a piece with no contact this substep is
           never slept, so nothing can freeze in mid-air however high the
           threshold goes. Without this the pile took 7s to stop shuffling. */
        if (bb.touch && bb.vrot === 0 &&
            bb.vx * bb.vx + bb.vy * bb.vy < LIN_SLEEP * LIN_SLEEP) {
          bb.still = (bb.still || 0) + h;
          if (bb.still >= SLEEP_TIME) { bb.vx = 0; bb.vy = 0; bb.sleep = true; }
        } else bb.still = 0;
      }

      for (let i = B.length - 1; i >= 0; i--) if (B[i].merged) B.splice(i, 1);
    }

    if (s.boss) { s.overT = 0; s.danger = 0; return; }

    // loss check: something resting above the rim for long enough. The window
    // tightens as the box fills, so a careless late stack ends things quickly.
    let over = false;
    for (const b of s.bodies) {
      if (b.age > 0.45 && b.y - b.r < M.DANGER_Y && Math.abs(b.vy) < 2.6) { over = true; break; }
    }
    s.overT = over ? s.overT + dt : 0;
    s.danger = over ? Math.min(1, s.overT / M.grace()) : 0;
    if (s.overT > M.grace()) {
      s.over = true;
      if (s.score > s.best) s.best = s.score;
    }
  };
})();
