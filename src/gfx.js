/* BRAINROT DROP - sprite batcher + procedurally drawn cast.

   One WebGL program, one dynamic buffer, one atlas generated at boot so the
   download stays tiny. Characters are drawn in code as chunky stickers: thick
   white outline, bold fill, dumb face. They are original designs, not the
   named meme characters. */
(function () {
  const X = {};
  window.GFX = X;

  /* 4x4 grid of 256px tiles = 1024px. MUST be a power of two: WebGL1 refuses
     generateMipmap on NPOT and then samples solid black. */
  const N = 4, TP = 256, PX = N * TP;
  X.N = N; X.TP = TP;

  X.T = { SPARK: 11, RING: 12, BLANK: 13, ARROW: 14, SMOKE: 15 };
  X.CHARS = 11;

  let _s = 424242;
  function rnd() { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; }

  /* ---------------- the cast ----------------
     Loaded from assets/tierN.png (the player's own generated art, already cut
     and alpha-trimmed). Nothing is drawn procedurally any more. */
  /* Names travel with the cast. Previously X.NAMES was a single hard-coded
     set0 list, so DESERT and TUNDRA showed set0's names on set1/set2 art. */
  X.SET_NAMES = {
    dumpling: ['Sleepy Bun', 'Plain Bun', 'Peach Bun', 'Golden Bun', 'Matcha Bun',
               'Peachy Puff', 'Taro Bun', 'Mint Bun', 'Chilli Bun', 'Custard Bun',
               'BOSS BAO'],
    set0: ["Ninja Cup", "Goldfish Cat", "Tire Frog", "Banana Monkey", "Capybara", "Fridge Camel", "Saturn Cow", "Sneaker Shark", "Cactus Elephant", "Croco Plane", "MEGA STACK"],
    set1: ["Seagull", "Fish Cat", "Crow Lady", "Teapot Bot", "Cactus Berry", "Straw Frog", "Belly Fish", "Horse Bench", "Leaf Croc", "Mammoth", "BIRD KING"],
    set2: ["Blue Octo", "Cool Penguin", "Ballerina Cup", "Camera Blob", "Coat Capy", "Earth Cow", "Melon Croc", "Spy Bear", "Swole Orange", "Bomb Pig", "TOURIST BOSS"]
  };
  X.NAMES = X.SET_NAMES.set0.slice();
  X.CAST = X.NAMES.map(n => ({ name: n }));

  const imgs = [];
  X.images = imgs;        // shared with the 3D scene, which builds its own textures
  X.setName = 'set0';

  /* Only the current biome's cast is resident. The next set is fetched during
     the boss transition, which gives it ~1.9s to arrive and keeps the initial
     download at one set instead of three. */
  X.loadSet = function (set) {
    return Promise.all(X.NAMES.map((_, i) => new Promise(res => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = 'assets/' + set + '/tier' + i + '.png';
    }))).then(list => {
      for (let i = 0; i < list.length; i++) imgs[i] = list[i];
      X.setName = set;
      const nm = X.SET_NAMES[set];
      if (nm) {
        X.NAMES.length = 0;
        for (const n of nm) X.NAMES.push(n);
        X.CAST = X.NAMES.map(n => ({ name: n }));
      }
      return list;
    });
  };
  X.loadChars = () => X.loadSet('set0');

  X.buildAtlas = function () {
    const cv = document.createElement('canvas');
    cv.width = cv.height = PX;
    const c = cv.getContext('2d');
    c.clearRect(0, 0, PX, PX);
    const at = i => [(i % N) * TP, ((i / N) | 0) * TP];

    for (let i = 0; i < X.CHARS; i++) {
      const p = at(i);
      if (imgs[i]) c.drawImage(imgs[i], p[0], p[1], TP, TP);
      else {                                   // visible placeholder if a file is missing
        c.fillStyle = '#ff00ff';
        c.fillRect(p[0] + 8, p[1] + 8, TP - 16, TP - 16);
      }
    }

    let p = at(X.T.SPARK);
    (function () {
      const cx = p[0] + TP / 2, cy = p[1] + TP / 2;
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, TP * 0.42);
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, TP * 0.42, 0, 7); c.fill();
    })();

    p = at(X.T.RING);
    (function () {
      const cx = p[0] + TP / 2, cy = p[1] + TP / 2;
      const g = c.createRadialGradient(cx, cy, TP * 0.26, cx, cy, TP * 0.48);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(p[0], p[1], TP, TP);
    })();

    p = at(X.T.BLANK);
    c.fillStyle = '#ffffff'; c.fillRect(p[0] + 2, p[1] + 2, TP - 4, TP - 4);

    p = at(X.T.SMOKE);
    (function () {
      /* Cartoon smoke: overlapping lobes with a hard-ish rim and a soft core,
         drawn white so it can be tinted per biome. */
      const cx = p[0] + TP / 2, cy = p[1] + TP / 2, R = TP * 0.30;
      const lobes = [[0, -0.34, 0.62], [-0.42, -0.10, 0.54], [0.42, -0.10, 0.54],
                     [-0.24, 0.30, 0.48], [0.26, 0.30, 0.48], [0, 0.06, 0.74]];
      c.save();
      c.globalAlpha = 0.30;
      c.fillStyle = '#ffffff';
      for (const [lx, ly, lr] of lobes) {
        c.beginPath();
        c.arc(cx + lx * R * 1.55, cy + ly * R * 1.55, R * lr * 1.85, 0, 7);
        c.fill();
      }
      c.globalAlpha = 1;
      for (const [lx, ly, lr] of lobes) {
        const gx = cx + lx * R * 1.55, gy = cy + ly * R * 1.55;
        const g2 = c.createRadialGradient(gx, gy - lr * R * 0.4, lr * R * 0.15,
                                          gx, gy, lr * R * 1.5);
        g2.addColorStop(0, 'rgba(255,255,255,0.98)');
        g2.addColorStop(0.62, 'rgba(255,255,255,0.80)');
        g2.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g2;
        c.beginPath(); c.arc(gx, gy, lr * R * 1.5, 0, 7); c.fill();
      }
      c.restore();
    })();

    p = at(X.T.ARROW);
    (function () {
      const cx = p[0] + TP / 2, cy = p[1] + TP / 2, s2 = TP * 0.26;
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.moveTo(cx, cy + s2); c.lineTo(cx + s2 * 0.85, cy - s2 * 0.5);
      c.lineTo(cx, cy - s2 * 0.12); c.lineTo(cx - s2 * 0.85, cy - s2 * 0.5);
      c.closePath(); c.fill();
    })();

    return cv;
  };

  X.uv = function (id) {
    const ins = 1.5 / PX, s = 1 / N;
    const u0 = (id % N) * s + ins, v0 = ((id / N) | 0) * s + ins;
    return [u0, v0, u0 + s - ins * 2, v0 + s - ins * 2];
  };

  /* One cast member into its own canvas, for the DOM bits (next-up, chain). */
  X.charCanvas = function (i, size) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size || 96;
    const c = cv.getContext('2d');
    if (imgs[i]) c.drawImage(imgs[i], 0, 0, cv.width, cv.height);
    return cv;
  };

  /* ---------------- GL ---------------- */
  const VS = [
    'attribute vec2 aPos; attribute vec2 aUV; attribute vec4 aCol;',
    'uniform vec4 uCam;',
    'varying vec2 vUV; varying vec4 vCol;',
    'void main(){',
    '  gl_Position = vec4((aPos - uCam.xy) * uCam.zw, 0.0, 1.0);',
    '  vUV = aUV; vCol = aCol;',
    '}'
  ].join('\n');

  const FS = [
    'precision mediump float;',
    'varying vec2 vUV; varying vec4 vCol;',
    'uniform sampler2D uTex;',
    'void main(){',
    '  vec4 c = texture2D(uTex, vUV) * vCol;',
    '  if (c.a < 0.01) discard;',
    '  gl_FragColor = c;',
    '}'
  ].join('\n');

  function sh(gl, t, src) {
    const s = gl.createShader(t);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  const F = 8, MAXQ = 3000;

  X.init = function (canvas) {
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL unavailable');

    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    const loc = {
      aPos: gl.getAttribLocation(prog, 'aPos'),
      aUV: gl.getAttribLocation(prog, 'aUV'),
      aCol: gl.getAttribLocation(prog, 'aCol'),
      uCam: gl.getUniformLocation(prog, 'uCam'),
      uTex: gl.getUniformLocation(prog, 'uTex')
    };

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, X.buildAtlas());
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(loc.uTex, 0);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const data = new Float32Array(MAXQ * 6 * F);
    const buf = gl.createBuffer();
    const R = { gl, loc, tex, data, buf, n: 0, cam: [0, 0, 1, 1] };

    // re-upload the atlas after a biome swap brings in a new cast
    R.refreshAtlas = function () {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, X.buildAtlas());
      gl.generateMipmap(gl.TEXTURE_2D);
    };

    R.begin = function (cx, cy, halfW, halfH) {
      R.n = 0;
      R.cam = [cx, cy, 1 / halfW, -1 / halfH];   // y flipped: world Y grows downward
    };

    R.sprite = function (x, y, w, h, tile, r, g, b, a, rot) {
      if (R.n >= MAXQ) return;
      const uv = X.uv(tile), hw = w / 2, hh = h / 2;
      let ax, ay, bx, by, cx2, cy2, dx, dy;
      if (rot) {
        const co = Math.cos(rot), si = Math.sin(rot);
        const px = (u, v) => x + u * co - v * si;
        const py = (u, v) => y + u * si + v * co;
        ax = px(-hw, -hh); ay = py(-hw, -hh);
        bx = px(hw, -hh);  by = py(hw, -hh);
        cx2 = px(hw, hh);  cy2 = py(hw, hh);
        dx = px(-hw, hh);  dy = py(-hw, hh);
      } else {
        ax = x - hw; ay = y - hh; bx = x + hw; by = ay;
        cx2 = bx;    cy2 = y + hh; dx = ax;    dy = cy2;
      }
      const d = R.data;
      let o = R.n * 6 * F;
      const put = (px, py, u, v) => {
        d[o] = px; d[o + 1] = py; d[o + 2] = u; d[o + 3] = v;
        d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = a;
        o += F;
      };
      put(ax, ay, uv[0], uv[1]); put(bx, by, uv[2], uv[1]); put(cx2, cy2, uv[2], uv[3]);
      put(ax, ay, uv[0], uv[1]); put(cx2, cy2, uv[2], uv[3]); put(dx, dy, uv[0], uv[3]);
      R.n++;
    };

    R.flush = function () {
      if (!R.n) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, R.data.subarray(0, R.n * 6 * F), gl.DYNAMIC_DRAW);
      const S = F * 4;
      gl.enableVertexAttribArray(loc.aPos);
      gl.vertexAttribPointer(loc.aPos, 2, gl.FLOAT, false, S, 0);
      gl.enableVertexAttribArray(loc.aUV);
      gl.vertexAttribPointer(loc.aUV, 2, gl.FLOAT, false, S, 8);
      gl.enableVertexAttribArray(loc.aCol);
      gl.vertexAttribPointer(loc.aCol, 4, gl.FLOAT, false, S, 16);
      gl.uniform4fv(loc.uCam, R.cam);
      gl.drawArrays(gl.TRIANGLES, 0, R.n * 6);
      R.n = 0;
    };

    return R;
  };
})();
