/* ==========================================================
   黑洞粒子开场（原生 WebGL，零外部依赖）— 复刻 elimar.lmigroupintl.com
   开场（0~5秒，图1）：
     中央纯黑洞（约屏1/3），外扩灰白晕圈（约屏高15%），
     晕圈内大量细小光点粒子做【逆时针螺旋】运动，
     内圈粒子快、外圈慢，层次分明的吸积旋涡。
   滚动驱动：
     黑洞慢慢"坍缩/收拢" → 中心显现主体人像（部分螺旋粒子聚焦成像），
     外围螺旋粒子仍缓慢旋转漂浮；滚到底再散开。
   交互：鼠标 = 视角平移（parallax）。
   质感：软粒子羽化 + 半透明混合 + 胶片颗粒叠加。
   ========================================================== */
(function () {
  'use strict';

  if (window.__vangoghInited) return;
  window.__vangoghInited = true;

  var canvas = document.getElementById('vangogh-canvas');
  var grainCanvas = document.getElementById('grain-canvas');
  if (!canvas) return;

  var gl = canvas.getContext('webgl', { antialias: true, alpha: false }) ||
           canvas.getContext('experimental-webgl');
  if (!gl) {
    var hint = document.querySelector('.vg-hint');
    if (hint) hint.textContent = '当前浏览器不支持 WebGL';
    return;
  }

  /* ---------------- 背景着色器：中央黑洞 + 灰白晕圈 ---------------- */
  var BG_VSH = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
  var BG_FSH = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform float uAspect;',     // 屏宽/高
    'uniform float uHoleR;',      // 黑洞半径（随滚动缩小/扩大）
    'uniform float uHaloW;',      // 晕圈宽度
    'uniform float uTime;',
    'void main(){',
    '  vec2 p = (vUv - 0.5) * 2.0;',
    '  p.x *= uAspect;',
    // 给黑洞边缘加轻微不规则扰动（更像原网页的不规则黑洞）
    '  float ang = atan(p.y, p.x);',
    '  float wob = sin(ang*7.0 + uTime*0.2)*0.02 + sin(ang*13.0)*0.012;',
    '  float r = length(p) + wob;',
    '  float hole = uHoleR;',
    '  float halo = uHoleR + uHaloW;',
    // 黑洞内部纯黑；晕圈内向外由黑渐变到白
    '  vec3 col = vec3(0.0);',
    '  float t = smoothstep(hole, halo, r);',          // 0黑洞内 → 1晕圈外
    '  col = mix(vec3(0.0), vec3(0.93,0.93,0.92), t);',
    // 晕圈带加轻微径向明暗波动，增强"吸积流"质感
    '  col += (sin(r*28.0 - uTime*0.5) * 0.03) * (t*(1.0-t)*4.0);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ---------------- 螺旋光点粒子（晕圈区，逆时针，内快外慢） ----------------
     属性：aRadius(轨道半径) aAngle(初始角) aSize aAlpha aSpeed aSeed */
  var SP_VSH = [
    'attribute float aRadius;',
    'attribute float aAngle;',
    'attribute float aSize;',
    'attribute float aAlpha;',
    'attribute float aSpeed;',
    'attribute float aSeed;',
    'uniform float uTime;',
    'uniform float uAspect;',
    'uniform float uHoleR;',
    'uniform float uFade;',       // 滚动时整体螺旋淡出（让位给人像）
    'uniform vec2 uPar;',
    'varying float vAlpha;',
    'varying float vBright;',
    'void main(){',
    // 逆时针螺旋：角度随时间增加；内圈快外圈慢（aSpeed已按半径分级）
    '  float ang = aAngle + uTime * aSpeed;',
    '  float r = aRadius;',
    '  vec2 pos = vec2(cos(ang), sin(ang)) * r;',
    '  pos.x /= uAspect;',
    '  pos += uPar * (0.02 + aSeed * 0.04);',
    '  gl_Position = vec4(pos, 0.0, 1.0);',
    '  gl_PointSize = aSize;',
    '  vBright = 0.75 + 0.25 * sin(uTime * 2.0 + aSeed * 50.0);',
    '  vAlpha = aAlpha * uFade;',
    '}'
  ].join('\n');
  var SP_FSH = [
    'precision mediump float;',
    'varying float vAlpha;',
    'varying float vBright;',
    'void main(){',
    '  vec2 c = gl_PointCoord - vec2(0.5);',
    '  float d = length(c);',
    '  float a = smoothstep(0.5, 0.1, d) * vAlpha;',
    '  if (a < 0.012) discard;',
    '  gl_FragColor = vec4(vec3(vBright), a);',
    '}'
  ].join('\n');

  /* ---------------- 主体人像粒子（滚动聚焦成像） ---------------- */
  var IM_VSH = [
    'attribute vec2 aPos;',
    'attribute float aSize;',
    'attribute float aAlpha;',
    'attribute float aSeed;',
    'attribute vec3 aColor;',
    'uniform float uTime;',
    'uniform float uProgress;',   // 0=散在螺旋里 1=聚焦成像
    'uniform float uDisperse;',
    'uniform float uKX;',
    'uniform float uKY;',
    'uniform vec2 uOff;',
    'uniform float uPointSize;',
    'uniform float uAlphaScale;',
    'uniform float uAspect;',
    'uniform float uHoleR;',
    'uniform vec2 uPar;',
    'varying float vAlpha;',
    'varying vec3 vColor;',
    'float hash(float n){ return fract(sin(n) * 43758.5453123); }',
    'void main(){',
    '  vec2 img = vec2((aPos.x - 0.5) * 2.0 * uKX + uOff.x, (0.5 - aPos.y) * 2.0 * uKY + uOff.y);',
    // 自由状态：散在黑洞/晕圈轨道上做螺旋漂浮
    '  float ang = aSeed * 6.2831853 + uTime * (0.05 + hash(aSeed * 7.7) * 0.15);',
    '  float rad = uHoleR * 0.6 + hash(aSeed * 3.3) * uHoleR * 1.3;',
    '  vec2 freePos = vec2(cos(ang), sin(ang)) * rad;',
    '  freePos.x /= uAspect;',
    '  float ph = smoothstep(0.0, 0.4, uProgress * (1.0 + 0.3 * hash(aSeed * 5.7)) - 0.15 * hash(aSeed * 9.1));',
    '  ph = ph * (1.0 - uDisperse);',
    '  vec2 base = mix(freePos, img, ph);',
    '  base += uPar * 0.015;',
    '  gl_Position = vec4(base, 0.0, 1.0);',
    '  gl_PointSize = aSize * uPointSize;',
    '  vAlpha = aAlpha * uAlphaScale * (0.25 + 0.75 * ph);',   // 未聚焦时淡、聚焦后实
    '  vColor = aColor;',
    '}'
  ].join('\n');
  var IM_FSH = [
    'precision mediump float;',
    'varying float vAlpha;',
    'varying vec3 vColor;',
    'void main(){',
    '  vec2 c = gl_PointCoord - vec2(0.5);',
    '  float d = length(c);',
    '  float a = smoothstep(0.5, 0.12, d) * vAlpha;',
    '  if (a < 0.01) discard;',
    '  gl_FragColor = vec4(vColor, a);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }
  function makeProgram(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    return p;
  }

  var bgProg = makeProgram(BG_VSH, BG_FSH);
  var spProg = makeProgram(SP_VSH, SP_FSH);
  var imProg = makeProgram(IM_VSH, IM_FSH);

  var BGL = {
    aPos: gl.getAttribLocation(bgProg, 'aPos'),
    uAspect: gl.getUniformLocation(bgProg, 'uAspect'),
    uHoleR: gl.getUniformLocation(bgProg, 'uHoleR'),
    uHaloW: gl.getUniformLocation(bgProg, 'uHaloW'),
    uTime: gl.getUniformLocation(bgProg, 'uTime')
  };
  var SPL = {
    aRadius: gl.getAttribLocation(spProg, 'aRadius'),
    aAngle: gl.getAttribLocation(spProg, 'aAngle'),
    aSize: gl.getAttribLocation(spProg, 'aSize'),
    aAlpha: gl.getAttribLocation(spProg, 'aAlpha'),
    aSpeed: gl.getAttribLocation(spProg, 'aSpeed'),
    aSeed: gl.getAttribLocation(spProg, 'aSeed'),
    uTime: gl.getUniformLocation(spProg, 'uTime'),
    uAspect: gl.getUniformLocation(spProg, 'uAspect'),
    uHoleR: gl.getUniformLocation(spProg, 'uHoleR'),
    uFade: gl.getUniformLocation(spProg, 'uFade'),
    uPar: gl.getUniformLocation(spProg, 'uPar')
  };
  var IML = {
    aPos: gl.getAttribLocation(imProg, 'aPos'),
    aSize: gl.getAttribLocation(imProg, 'aSize'),
    aAlpha: gl.getAttribLocation(imProg, 'aAlpha'),
    aSeed: gl.getAttribLocation(imProg, 'aSeed'),
    aColor: gl.getAttribLocation(imProg, 'aColor'),
    uTime: gl.getUniformLocation(imProg, 'uTime'),
    uProgress: gl.getUniformLocation(imProg, 'uProgress'),
    uDisperse: gl.getUniformLocation(imProg, 'uDisperse'),
    uKX: gl.getUniformLocation(imProg, 'uKX'),
    uKY: gl.getUniformLocation(imProg, 'uKY'),
    uOff: gl.getUniformLocation(imProg, 'uOff'),
    uPointSize: gl.getUniformLocation(imProg, 'uPointSize'),
    uAlphaScale: gl.getUniformLocation(imProg, 'uAlphaScale'),
    uAspect: gl.getUniformLocation(imProg, 'uAspect'),
    uHoleR: gl.getUniformLocation(imProg, 'uHoleR'),
    uPar: gl.getUniformLocation(imProg, 'uPar')
  };

  var quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  gl.enable(gl.BLEND);
  gl.depthMask(false);
  gl.disable(gl.DEPTH_TEST);

  /* ---------------- 状态 ---------------- */
  var W = 0, H = 0, DPR = 1, ASPECT = 1;
  var mouse = { x: 0, y: 0 };
  var par = { x: 0, y: 0 };
  var progress = 0, targetProgress = 0;
  var time = 0;
  var intro = 0; // 开场动画进度（0~1，前几秒黑洞渐显）

  var CFG = window.VANGOGH_CONFIG || {};
  var SINGLE = !!CFG.single;

  var layers = CFG.layers || [
    { url: '/img/vangogh/young-vincent.png', mode: 'dark',  fit: 'contain', ox: 0, oy: 0, color: [0.10, 0.10, 0.10], chapter: 1 },
    { url: '/img/vangogh/young-vincent.png', mode: 'light', fit: 'contain', ox: 0, oy: 0, color: [0.95, 0.95, 0.94], chapter: 1 },
    { url: '/img/rdr2/mask_black.png', mode: 'darkflat',  fit: 'contain', ox: 0, oy: 0, color: [0.08, 0.07, 0.06], chapter: 2 },
    { url: '/img/rdr2/mask_white.png', mode: 'lightflat', fit: 'contain', ox: 0, oy: 0, color: [0.95, 0.93, 0.88], chapter: 2 },
    { url: '/img/rdr2/mask_red.png',   mode: 'redflat',   fit: 'contain', ox: 0, oy: 0, color: [0.78, 0.10, 0.10], chapter: 2 }
  ];

  /* ---------------- 等比映射 ---------------- */
  function fitK(ia, va, fit) {
    return ia >= va ? { kx: 1, ky: va / ia } : { kx: ia / va, ky: 1 };
  }
  function applyFits() {
    var va = W / H;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (!L.aspect) continue;
      var k = fitK(L.aspect, va, L.fit);
      L.kx = k.kx; L.ky = k.ky;
    }
  }

  /* ---------------- 盒式模糊 ---------------- */
  function boxBlur(src, w, h, r) {
    var tmp = new Float32Array(w * h);
    var out = new Float32Array(w * h);
    var win = r * 2 + 1;
    var x, y, sum, row, x0, x1, y0, y1;
    for (y = 0; y < h; y++) {
      sum = 0; row = y * w;
      for (x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
      for (x = 0; x < w; x++) {
        tmp[row + x] = sum / win;
        x1 = Math.min(w - 1, x + r + 1); x0 = Math.max(0, x - r);
        sum += src[row + x1] - src[row + x0];
      }
    }
    for (x = 0; x < w; x++) {
      sum = 0;
      for (y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (y = 0; y < h; y++) {
        out[y * w + x] = sum / win;
        y1 = Math.min(h - 1, y + r + 1); y0 = Math.max(0, y - r);
        sum += tmp[y1 * w + x] - tmp[y0 * w + x];
      }
    }
    return out;
  }

  /* ---------------- 采样：图像 -> 点云 ---------------- */
  function sampleLayer(layer, img) {
    var sw = Math.min(img.width, layer.sampleW || 620);
    var sh = Math.round(sw * img.height / img.width);
    var sc = document.createElement('canvas');
    sc.width = sw; sc.height = sh;
    var sctx = sc.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(img, 0, 0, sw, sh);
    var data = sctx.getImageData(0, 0, sw, sh).data;

    var luma = new Float32Array(sw * sh);
    var p, i;
    for (i = 0, p = 0; i < data.length; i += 4, p++) {
      luma[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    var base = boxBlur(luma, sw, sh, 3);

    var arr = [];
    for (var y = 0; y < sh; y++) {
      for (var x = 0; x < sw; x++) {
        p = y * sw + x;
        if (data[p * 4 + 3] < 128) continue;
        var gray = luma[p];
        var tex = Math.min(1, Math.abs(gray - base[p]) / 45);
        var w = 0;
        if (layer.mode === 'dark') {
          var darkness = (150 - gray) / 150;
          if (darkness <= 0.02) continue;
          w = darkness * (0.45 + 0.55 * tex);
        } else if (layer.mode === 'light') {
          if (tex < 0.10) continue;
          w = (gray / 255) * (0.25 + 0.75 * tex);
        } else if (layer.mode === 'lightCat') {
          if (tex < 0.05) continue;
          w = ((gray / 255) * 0.55 + 0.45) * (0.2 + 0.8 * tex);
        } else if (layer.mode === 'darkflat') {
          if (gray > 128) continue;
          w = 0.9;
        } else if (layer.mode === 'lightflat') {
          if (gray <= 128) continue;
          w = 0.9;
        } else {
          if (gray <= 128) continue;
          w = 0.95;
        }
        if (Math.random() > w) continue;
        arr.push(
          (x + 0.5) / sw, (y + 0.5) / sh,
          0.6 + w * 1.6 + Math.random() * 0.5,
          0.35 + w * 0.6,
          Math.random(),
          layer.color[0], layer.color[1], layer.color[2]
        );
      }
    }
    var n = arr.length / 8;
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    layer.buffer = buf;
    layer.count = n;
    layer.aspect = img.width / img.height;
    applyFits();
  }

  function loadLayer(layer) {
    var img = new Image();
    img.onload = function () {
      try { sampleLayer(layer, img); } catch (e) { /* 静默降级 */ }
    };
    img.src = layer.url;
  }
  layers.forEach(loadLayer);

  /* ---------------- 螺旋光点粒子（晕圈吸积盘，逆时针，内快外慢） ---------------- */
  var spiral = { buffer: null, count: 0 };
  function buildSpiral() {
    var N = 1500;
    var arr = [];
    // 黑洞半径 NDC≈0.55（约屏1/3），晕圈到外约 1.4
    for (var i = 0; i < N; i++) {
      // 半径分布：从黑洞边缘(0.56)到外围(1.5)，偏向内圈更密
      var rr = 0.56 + Math.pow(Math.random(), 1.4) * 0.95;
      var angle = Math.random() * 6.2831853;
      // 大小：大部分 0.5~2px 微小，约20%稍大（~2~3px）
      var size = Math.random() < 0.20 ? (1.8 + Math.random() * 1.2) : (0.6 + Math.random() * 1.2);
      var alpha = 0.5 + Math.random() * 0.5;
      // 角速度：内快外慢（越靠近黑洞转得越快）
      var t = (rr - 0.56) / 0.95;               // 0内 1外
      var speed = 0.30 + (1 - t) * 0.65;         // 内 ~0.95 rad/s, 外 ~0.30
      var seed = Math.random();
      arr.push(rr, angle, size, alpha, speed, seed);
    }
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    spiral.buffer = buf;
    spiral.count = N;
  }

  /* ---------------- 尺寸 ---------------- */
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    ASPECT = W / H;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (grainCanvas) {
      grainCanvas.width = W; grainCanvas.height = H;
      grainCanvas.style.width = W + 'px'; grainCanvas.style.height = H + 'px';
    }
    applyFits();
  }

  /* ---------------- 胶片颗粒 ---------------- */
  var grainCtx = grainCanvas ? grainCanvas.getContext('2d') : null;
  var grainTile = null;
  (function makeGrain() {
    if (!grainCtx) return;
    var t = document.createElement('canvas');
    t.width = 160; t.height = 160;
    var tc = t.getContext('2d');
    var id = tc.createImageData(160, 160);
    for (var i = 0; i < id.data.length; i += 4) {
      var v = Math.random() * 255;
      id.data[i] = v; id.data[i + 1] = v; id.data[i + 2] = v;
      id.data[i + 3] = Math.random() < 0.5 ? 0 : 22;
    }
    tc.putImageData(id, 0, 0);
    grainTile = t;
  })();
  function drawGrain() {
    if (!grainCtx || !grainTile) return;
    grainCtx.clearRect(0, 0, W, H);
    var ox = (Math.random() * 160) | 0, oy = (Math.random() * 160) | 0;
    for (var y = -oy; y < H; y += 160) {
      for (var x = -ox; x < W; x += 160) {
        grainCtx.drawImage(grainTile, x, y);
      }
    }
  }

  function smoothstep(a, b, x) {
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /* ---------------- 绘制 ---------------- */
  function drawBg(holeR, haloW) {
    gl.useProgram(bgProg);
    gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(BGL.aPos);
    gl.vertexAttribPointer(BGL.aPos, 2, gl.FLOAT, false, 8, 0);
    gl.uniform1f(BGL.uAspect, ASPECT);
    gl.uniform1f(BGL.uHoleR, holeR);
    gl.uniform1f(BGL.uHaloW, haloW);
    gl.uniform1f(BGL.uTime, time);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
  }

  function drawSpiral(holeR, fade) {
    if (!spiral.buffer || fade <= 0.01) return;
    gl.useProgram(spProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, spiral.buffer);
    var STR = 24; // 6 floats
    gl.enableVertexAttribArray(SPL.aRadius);
    gl.vertexAttribPointer(SPL.aRadius, 1, gl.FLOAT, false, STR, 0);
    gl.enableVertexAttribArray(SPL.aAngle);
    gl.vertexAttribPointer(SPL.aAngle, 1, gl.FLOAT, false, STR, 4);
    gl.enableVertexAttribArray(SPL.aSize);
    gl.vertexAttribPointer(SPL.aSize, 1, gl.FLOAT, false, STR, 8);
    gl.enableVertexAttribArray(SPL.aAlpha);
    gl.vertexAttribPointer(SPL.aAlpha, 1, gl.FLOAT, false, STR, 12);
    gl.enableVertexAttribArray(SPL.aSpeed);
    gl.vertexAttribPointer(SPL.aSpeed, 1, gl.FLOAT, false, STR, 16);
    gl.enableVertexAttribArray(SPL.aSeed);
    gl.vertexAttribPointer(SPL.aSeed, 1, gl.FLOAT, false, STR, 20);
    gl.uniform1f(SPL.uTime, time);
    gl.uniform1f(SPL.uAspect, ASPECT);
    gl.uniform1f(SPL.uHoleR, holeR);
    gl.uniform1f(SPL.uFade, fade);
    gl.uniform2f(SPL.uPar, par.x, par.y);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, spiral.count);
  }

  function drawImage(holeR, focus, disperse, alphaCh) {
    if (alphaCh <= 0.01) return;
    gl.useProgram(imProg);
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (L.chapter !== currentChapter) continue;
      if (!L.buffer || L.count === 0) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, L.buffer);
      var STR = 32;
      gl.enableVertexAttribArray(IML.aPos);
      gl.vertexAttribPointer(IML.aPos, 2, gl.FLOAT, false, STR, 0);
      gl.enableVertexAttribArray(IML.aSize);
      gl.vertexAttribPointer(IML.aSize, 1, gl.FLOAT, false, STR, 8);
      gl.enableVertexAttribArray(IML.aAlpha);
      gl.vertexAttribPointer(IML.aAlpha, 1, gl.FLOAT, false, STR, 12);
      gl.enableVertexAttribArray(IML.aSeed);
      gl.vertexAttribPointer(IML.aSeed, 1, gl.FLOAT, false, STR, 16);
      gl.enableVertexAttribArray(IML.aColor);
      gl.vertexAttribPointer(IML.aColor, 3, gl.FLOAT, false, STR, 20);
      gl.uniform1f(IML.uTime, time);
      gl.uniform1f(IML.uProgress, focus);
      gl.uniform1f(IML.uDisperse, disperse);
      gl.uniform1f(IML.uKX, L.kx || 1);
      gl.uniform1f(IML.uKY, L.ky || 1);
      gl.uniform2f(IML.uOff, L.ox || 0, L.oy || 0);
      gl.uniform1f(IML.uPointSize, 1.6 * DPR);
      gl.uniform1f(IML.uAlphaScale, alphaCh);
      gl.uniform1f(IML.uAspect, ASPECT);
      gl.uniform1f(IML.uHoleR, holeR);
      gl.uniform2f(IML.uPar, par.x, par.y);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, L.count);
    }
  }

  var currentChapter = 1;

  function frame(dt) {
    time += dt;
    // 开场动画：前约2.5秒黑洞渐显
    intro += (1 - intro) * 0.03;
    progress += (targetProgress - progress) * 0.07;
    par.x += (mouse.x - par.x) * 0.05;
    par.y += (mouse.y - par.y) * 0.05;

    var p = progress;

    // 章节与聚焦窗口
    var focus, disperse, alphaCh, holeR, haloW, spiralFade;
    if (SINGLE) {
      currentChapter = 1;
      focus = smoothstep(0.08, 0.55, p);
      disperse = smoothstep(0.75, 0.98, p);
      alphaCh = 1;
      // 黑洞：初始0.55（屏1/3），滚动成像时略收缩到0.5，滚到底扩散
      holeR = 0.55 - 0.05 * smoothstep(0.05, 0.5, p) + 0.3 * smoothstep(0.78, 1.0, p);
      haloW = 0.5 + 0.15 * smoothstep(0.0, 0.4, p);
      // 聚焦后螺旋粒子淡出（让位给清晰人像），但仍留一部分外围漂浮
      spiralFade = 1.0 - 0.6 * smoothstep(0.3, 0.6, p);
    } else {
      var w1 = 1 - smoothstep(0.42, 0.54, p);
      var w2 = smoothstep(0.46, 0.58, p);
      currentChapter = w2 > 0.5 ? 2 : 1;
      focus = currentChapter === 1
        ? smoothstep(0.08, 0.45, p) * (1 - smoothstep(0.32, 0.46, p))
        : smoothstep(0.52, 0.82, p) * (1 - smoothstep(0.88, 0.99, p));
      disperse = currentChapter === 2 ? smoothstep(0.88, 0.99, p) : 0;
      alphaCh = currentChapter === 1 ? w1 : w2;
      holeR = 0.55 - 0.05 * smoothstep(0.05, 0.5, p);
      haloW = 0.5;
      spiralFade = 1.0 - 0.5 * smoothstep(0.3, 0.6, p);
    }

    holeR *= (0.3 + 0.7 * intro);   // 开场从小渐显到全尺寸
    drawBg(holeR, haloW);
    drawSpiral(holeR, spiralFade * intro);
    drawImage(holeR, focus, disperse, alphaCh);
    drawGrain();
    updateDom(p, currentChapter);
  }

  /* ---------------- DOM 文字层 ---------------- */
  var titleEl = document.getElementById('vg-title');
  var wordEl = document.getElementById('vg-word');
  var wordTextEl = document.getElementById('vg-word-text');
  var ch2El = document.getElementById('vg-ch2');
  var chapterEl = document.getElementById('vg-chapter');
  var introEl = document.getElementById('vg-intro');
  var WORDS = (window.VANGOGH_CONFIG && window.VANGOGH_CONFIG.words) ||
              ['Elimar', 'regret', 'darkness', 'redemption', 'van Gogh'];
  var wordIdx = 0, wordStarted = false;

  function cycleWords() {
    if (!wordEl || !wordTextEl) return;
    function showNext() {
      wordEl.classList.remove('is-visible');
      setTimeout(function () {
        wordIdx = (wordIdx + 1) % WORDS.length;
        wordTextEl.textContent = WORDS[wordIdx];
        wordEl.classList.add('is-visible');
        setTimeout(showNext, 3200);
      }, 900);
    }
    setTimeout(showNext, 1600);
  }

  function updateDom(p, chapter) {
    // 开场黑洞文案：滚动后淡出
    if (introEl) introEl.classList.toggle('is-hidden', p > 0.04);
    if (SINGLE) return;
    if (titleEl) titleEl.classList.toggle('is-hidden', p > 0.05 && chapter === 1);
    if (wordEl) wordEl.classList.toggle('is-hidden', chapter === 2);
    if (chapterEl) chapterEl.textContent = chapter === 2 ? 'CHAPTER 02/' : 'CHAPTER 01/';
    if (ch2El) ch2El.classList.toggle('is-visible', chapter === 2);
  }

  /* ---------------- 交互：鼠标=视角平移 ---------------- */
  window.addEventListener('pointermove', function (e) {
    mouse.x = (e.clientX / W) * 2 - 1;
    mouse.y = 1 - (e.clientY / H) * 2;
    if (!wordStarted) { wordStarted = true; cycleWords(); }
  });

  function onScroll() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    targetProgress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 200);
  });

  /* ---------------- 主循环 ---------------- */
  var last = 0;
  function loop(ts) {
    var dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    frame(dt);
    requestAnimationFrame(loop);
  }

  function init() {
    resize();
    buildSpiral();
    onScroll();
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 60);
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 60); });
  }
})();
