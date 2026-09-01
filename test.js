/* Headless test of the merge simulation. node test.js */
const fs = require('fs'), path = require('path');
global.window = {};
eval(fs.readFileSync(path.join(__dirname, 'src', 'merge.js'), 'utf8'));
const M = window.MERGE;

let fail = 0;
function check(name, cond, extra) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra === undefined ? '' : '  ' + extra));
  if (!cond) fail++;
}
const DT = 1 / 60;
const run = n => { for (let i = 0; i < n; i++) M.step(DT); };

// ---------------------------------------------------------------- tiers
M.newGame(1);
check('eleven tiers', M.TIERS.length === 11);
check('radius grows monotonically',
      M.TIERS.every((t, i) => i === 0 || t.r > M.TIERS[i - 1].r));
check('biggest tier fits the container', M.TIERS[10].r * 2 < M.W,
      (M.TIERS[10].r * 2).toFixed(2) + ' vs ' + M.W);

let onlySmall = true;
for (let i = 0; i < 400; i++) if (M.rollTier() > 4) onlySmall = false;
check('only the first five tiers ever drop', onlySmall);

// ---------------------------------------------------------------- difficulty ramp
M.newGame(50);
check('the opening pool is just two pieces', M.poolSize() === 2, M.poolSize());
let seen = new Set();
for (let i = 0; i < 300; i++) seen.add(M.rollTier());
check('early drops never exceed tier 1', Math.max(...seen) <= 1, [...seen].join(','));

M.s.biggest = 3; check('reaching tier 3 widens the pool to 3', M.poolSize() === 3);
M.s.biggest = 5; check('tier 5 widens it to 4', M.poolSize() === 4);
M.s.biggest = 7; check('tier 7 opens the full pool', M.poolSize() === 5);
seen = new Set();
for (let i = 0; i < 400; i++) seen.add(M.rollTier());
check('the late pool really reaches tier 4', seen.has(4), [...seen].sort().join(','));

// fill pressure shortens the grace window
M.newGame(51);
check('an empty box reads as 0 fill', M.fill() === 0, M.fill());
const graceEmpty = M.grace();
for (let i = 0; i < 44; i++) { M.s.cur = 4; M.s.dropCd = 0; M.moveTo(-3.4 + (i % 5) * 1.7); M.drop(); run(16); }
run(60);
const f = M.fill(), graceFull = M.grace();
check('a stacked box reads as high fill', f > 0.5, f.toFixed(2));
check('grace shrinks as it fills', graceFull < graceEmpty * 0.75,
      graceEmpty.toFixed(2) + 's -> ' + graceFull.toFixed(2) + 's');
check('grace is short even on an empty box', graceEmpty < 0.9, graceEmpty.toFixed(2) + 's');

// Once the pile is genuinely over the line, the run must end almost at once.
// Measuring from when danger STARTS is the real property - a lone piece in an
// empty box simply falls, it cannot rest up there at all.
M.newGame(52);
/* Danger is allowed to trigger and then RESOLVE - a merge can clear the top and
   you survive, which is good play, not a bug. So the property is not "dies soon
   after the first danger"; it is "sustained danger never outlives the grace
   window". Track the longest unbroken danger that did not kill. */
let longestSurvived = 0, overT = -1, fr = 0;
while (fr < 4000 && overT < 0) {
  if (M.s.dropCd <= 0 && !M.s.over) { M.s.cur = 4; M.moveTo(((fr / 37) % 5) * 1.7 - 3.4); M.drop(); }
  M.step(DT); fr++;
  if (!M.s.over) longestSurvived = Math.max(longestSurvived, M.s.overT);
  else overT = M.s.overT;
}
check('a careless fill does end the run', overT >= 0, 'after ' + (fr / 60).toFixed(1) + 's');
check('no run survives more than the grace window of danger',
      longestSurvived <= M.grace() + 0.05,
      longestSurvived.toFixed(2) + 's vs grace ' + M.grace().toFixed(2) + 's');
check('and it ends right at the window, not later',
      overT <= M.grace() + 0.05, overT.toFixed(2) + 's');

// but merely passing through the top must NOT kill
M.newGame(53);
M.s.cur = 0; M.moveTo(0); M.drop();
run(20);
check('a piece still falling does not end the run', M.s.over === false);

// ---------------------------------------------------------------- settling
M.newGame(2);
M.moveTo(0); M.drop();
run(180);
const b0 = M.s.bodies[0];
check('a dropped piece rests on the floor',
      Math.abs(b0.y - (M.H - b0.r)) < 0.05, b0.y.toFixed(3));
check('it stopped moving', Math.abs(b0.vy) < 0.6, b0.vy.toFixed(3));

// ---------------------------------------------------------------- merging
M.newGame(3);
M.s.cur = 0; M.moveTo(-0.2); M.drop();
run(120);
M.s.cur = 0; M.s.dropCd = 0; M.moveTo(0.2); M.drop();
run(180);
check('two tier-0 pieces became one tier-1', M.s.bodies.length === 1, M.s.bodies.length);
check('the survivor is tier 1', M.s.bodies[0] && M.s.bodies[0].t === 1,
      M.s.bodies[0] && M.s.bodies[0].t);
check('merging scored', M.s.score > 0, M.s.score);
check('merge counter moved', M.s.merges === 1, M.s.merges);

// different tiers must NOT merge
M.newGame(4);
M.s.cur = 0; M.moveTo(-0.3); M.drop(); run(120);
M.s.cur = 2; M.s.dropCd = 0; M.moveTo(0.3); M.drop(); run(180);
check('different tiers do not merge', M.s.bodies.length === 2, M.s.bodies.length);

// ---------------------------------------------------------------- no tunnelling / overlap
M.newGame(5);
for (let i = 0; i < 14; i++) {
  M.s.cur = (i % 2) ? 3 : 4;           // alternate so nothing merges
  M.s.dropCd = 0;
  M.moveTo(-3 + (i % 5) * 1.5);
  M.drop();
  run(26);
}
run(420);
let inside = true, worst = 0;
for (const b of M.s.bodies) {
  if (b.x < -M.W / 2 - 0.01 || b.x > M.W / 2 + 0.01 || b.y > M.H + 0.01) inside = false;
}
for (let i = 0; i < M.s.bodies.length; i++) {
  for (let j = i + 1; j < M.s.bodies.length; j++) {
    const a = M.s.bodies[i], b = M.s.bodies[j];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    worst = Math.max(worst, (a.r + b.r) - d);
  }
}
check('nothing escaped the container', inside);
check('a settled pile barely overlaps', worst < 0.10, 'worst overlap ' + worst.toFixed(3));

// ---------------------------------------------------------------- combo
/* These systems are deliberately short-lived (1.25s combo window, shake decays
   at 2.2/s), so settling the pile first would always let them lapse. Place
   bodies touching and step a single frame instead. */
function place(tier, x, y) {
  const r = M.TIERS[tier].r;
  M.s.bodies.push({ x: x, y: y === undefined ? M.H - r : y, vx: 0, vy: 0,
                    t: tier, r: r, rot: 0, vrot: 0, age: 1, merged: false });
}
function pairAt(tier, x) {
  const r = M.TIERS[tier].r;
  place(tier, x - r + 0.02); place(tier, x + r - 0.02);
}

M.newGame(30);
pairAt(0, -3);
M.step(DT);
check('a merge starts the combo at 1', M.s.combo === 1, M.s.combo);
const s1 = M.s.score;
check('first merge scores the base value', s1 === M.TIERS[0].score, s1);

pairAt(0, 2);
M.step(DT);
check('a merge inside the window extends the combo', M.s.combo === 2, M.s.combo);
const s2 = M.s.score - s1;
check('the second merge pays more', s2 > s1, s1 + ' then ' + s2);
check('best combo is tracked', M.s.comboBest === 2, M.s.comboBest);

check('the merge emitted particles', M.s.fx.length > 0, M.s.fx.length);
check('the merge kicked the camera', M.s.shakeMag > 0, M.s.shakeMag.toFixed(3));

run(120);                                   // let everything lapse
check('the combo expires', M.s.combo === 0, M.s.combo);
check('particles expire', M.s.fx.length === 0, M.s.fx.length);
check('the kick decays to zero', M.s.shakeMag === 0);

// combo multiplier is capped
M.newGame(34);
for (let i = 0; i < 30; i++) { pairAt(0, -3 + (i % 5) * 1.6); M.step(DT); }
check('combo keeps climbing while chained', M.s.comboBest > 5, M.s.comboBest);

// ---------------------------------------------------------------- merge slop
M.newGame(31);
const r0 = M.TIERS[0].r;
place(0, -r0 - 0.04); place(0, r0 + 0.04);   // a hair apart, not overlapping
run(3);
check('near-touching same tiers still merge', M.s.bodies.length === 1, M.s.bodies.length);

M.newGame(32);
M.s.cur = 0; M.moveTo(-0.4); M.drop(); run(90);
M.s.cur = 3; M.s.dropCd = 0; M.moveTo(0.6); M.drop(); run(160);
let over = 0;
for (let i = 0; i < M.s.bodies.length; i++)
  for (let j = i + 1; j < M.s.bodies.length; j++) {
    const a2 = M.s.bodies[i], b2 = M.s.bodies[j];
    over = Math.max(over, (a2.r + b2.r) - Math.hypot(b2.x - a2.x, b2.y - a2.y));
  }
check('slop never lets unlike tiers sink together', over < 0.10, over.toFixed(3));

// ---------------------------------------------------------------- rotation
M.newGame(40);
for (let i = 0; i < 12; i++) {
  M.s.cur = (i % 2) ? 3 : 4;            // alternate so nothing merges away
  M.s.dropCd = 0; M.moveTo(-3 + (i % 5) * 1.5); M.drop(); run(24);
}
// bigger, heavier pieces shuffle for ~10s before coming fully to rest, so
// sample after that rather than mid-creep
run(760);
function worstSpin() {
  let sp = 0, ro = 0;
  for (const b of M.s.bodies) { sp = Math.max(sp, Math.abs(b.vrot)); ro = Math.max(ro, Math.abs(b.rot)); }
  return { sp: sp, ro: ro };
}
/* Pieces are now meant to HOLD a lean rather than spring back to level, so a
   settled tilt is no longer a defect and is not asserted against. What still
   matters: the pile stops MOVING, the residue does not accumulate, and nothing
   ever inverts. Contact resolution runs after the integrator's sleep clamp, so
   a tiny residue always survives the final step. */
const w1 = worstSpin();
check('a settled pile is visually still',
      w1.sp < 0.02,
      w1.sp.toExponential(2) + ' rad/s, ' + (w1.ro * 180 / Math.PI).toFixed(3) + ' deg');
run(3000);
const w2 = worstSpin();
// the property is that it never GROWS; with contact friction it now decays,
// which is strictly better than the steady state it used to reach
check('and the residue never accumulates',
      w2.sp <= w1.sp + 1e-6 && w2.ro <= w1.ro + 1e-6,
      'after 50s: ' + w2.sp.toExponential(2) + ', ' + (w2.ro * 180 / Math.PI).toFixed(3) + ' deg');
check('nothing ends up on its head', w2.ro <= 1.06,
      'worst tilt ' + (w2.ro * 180 / Math.PI).toFixed(1) + ' deg');

// a violent shake may leave pieces leaning hard, but must stop moving
M.s.shakes = 1; M.shake();
run(700);
const w3 = worstSpin();
check('it settles again after a shake', w3.sp < 0.02, w3.sp.toExponential(2));
check('and never inverts', w3.ro < 1.06, (w3.ro * 180 / Math.PI).toFixed(1) + ' deg');

// ---------------------------------------------------------------- game over
M.newGame(6);
for (let i = 0; i < 60 && !M.s.over; i++) {
  M.s.cur = 4; M.s.dropCd = 0; M.moveTo(0); M.drop();
  run(30);
}
run(200);
check('filling the container ends the run', M.s.over === true);
check('best score recorded', M.s.best === M.s.score, M.s.best + '/' + M.s.score);

// dropping is refused once it is over
const n0 = M.s.bodies.length;
M.s.dropCd = 0;
check('no dropping after game over', M.drop() === false && M.s.bodies.length === n0);

// ---------------------------------------------------------------- shake
M.newGame(7);
M.moveTo(0); M.drop(); run(150);
const before = M.s.bodies[0].vx;
check('shake is available once', M.s.shakes === 1);
M.shake();
check('shake jostles the pile', M.s.bodies[0].vx !== before);
check('shake is consumed', M.s.shakes === 0);
check('shake refuses when empty', M.shake() === false);

// ---------------------------------------------------------------- drop clamp
M.newGame(8);
M.s.cur = 4;
M.moveTo(999);
check('drop position clamps inside the wall',
      M.s.dropX <= M.W / 2 - M.TIERS[4].r + 1e-6, M.s.dropX.toFixed(3));
M.moveTo(-999);
check('and on the other side',
      M.s.dropX >= -M.W / 2 + M.TIERS[4].r - 1e-6, M.s.dropX.toFixed(3));

console.log(fail ? '\n  ' + fail + ' FAILURES\n' : '\n  all checks passed\n');
process.exit(fail ? 1 : 0);
