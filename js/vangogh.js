/* ==========================================================
   致敬梵高 Elimar — WebGL 点云粒子（原生 WebGL，零外部依赖）
   参考 elimar.lmigroupintl.com 的三层架构：
     渲染核心 = WebGL 点云 + 自定义 GLSL 着色器
     动画控制 = 滚动进度(0~1) 同步粒子聚散 / 章节切换
     质感增强 = 软粒子(羽化) + 半透明混合 + 胶片颗粒叠加

   人物刻画三层细节优化（对应原站"图像转点云"原理）：
     1) 密度分级：粒子生成概率 ∝ 明暗强度（素描排线逻辑）
     2) 大小分级：强明暗处粒子大、弱处小，边缘柔化
     3) 半透明混合：叠加处自然形成高光/重墨层次

   章节 01：梵高 background-1 —— 左白右黑分界屏，人物骑分界线：
     左半(白底)用黑粒子、右半(黑底)用白粒子，按各自明暗分级采样
   章节 02：RDR2 版画 —— 黑/白/红 三蒙版三层彩色粒子，纸色底
   动态：Perlin 呼吸微位移 + 鼠标斥力(按下更强) + 滚动聚散
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

  /* ---------------- 粒子着色器 ---------------- */
  var VSH = [
    'attribute vec2 aPos;',      // uv 0..1
    'attribute float aSize;',
    'attribute float aAlpha;',
    'attribute float aSeed;',
    'uniform float uTime;',
    'uniform float uProgress;',  // 本章聚散进度 0聚合 1散开
    'uniform float uKX;',        // cover 映射系数
    'uniform float uKY;',
    'uniform float uPointSize;',
    'uniform float uMouseRadius;',
    'uniform float uMouseStrength;',
    'uniform float uAlphaScale;',// 章节可见度
    'uniform vec2 uMouse;',
    'varying float vAlpha;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
    'float vnoise(vec2 p){',
    '  vec2 i = floor(p); vec2 f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  float a = hash(i);',
    '  float b = hash(i + vec2(1.0, 0.0));',
    '  float c = hash(i + vec2(0.0, 1.0));',
    '  float d = hash(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
    '}',
    'void main(){',
    '  vec2 base = vec2((aPos.x - 0.5) * 2.0 * uKX, (0.5 - aPos.y) * 2.0 * uKY);',
    // 每个粒子稳定的随机散射方向与半径
    '  float r = hash(aPos * vec2(143.7, 211.3) + aSeed);',
    '  float ang = r * 6.2831853;',
    '  float rad = 0.6 + 1.8 * hash(aPos * vec2(97.3, 51.1) + aSeed);',
    '  vec2 scattered = vec2(cos(ang), sin(ang)) * rad;',
    // 聚合原图 <-> 散开 插值
    '  vec2 target = mix(base, scattered, uProgress);',
    // 呼吸感：Perlin 噪声微位移
    '  vec2 np = aPos * 4.0 + vec2(uTime * 0.12, uTime * 0.16);',
    '  vec2 breathe = vec2(vnoise(np) - 0.5, vnoise(np + vec2(11.3, 5.7)) - 0.5) * 0.05;',
    // 鼠标斥力，松开弹性回归
    '  vec2 delta = target - uMouse;',
    '  float len = max(length(delta), 0.0001);',
    '  float fo = 1.0 - clamp(len / uMouseRadius, 0.0, 1.0);',
    '  vec2 push = (delta / len) * (fo * fo * 0.35 * uMouseStrength);',
    '  vec2 finalPos = target + breathe + push;',
    '  gl_Position = vec4(finalPos, 0.0, 1.0);',
    '  gl_PointSize = aSize * uPointSize;',
    '  vAlpha = aAlpha * uAlphaScale;',
    '}'
  ].join('\n');

  var FSH = [
    'precision mediump float;',
    'uniform vec3 uColor;',
    'varying float vAlpha;',
    'void main(){',
    // 软粒子：羽化边缘，接近炭笔素描质感
    '  vec2 c = gl_PointCoord - vec2(0.5);',
    '  float d = length(c);',
    '  float a = smoothstep(0.5, 0.15, d) * vAlpha;',
    '  if (a < 0.01) discard;',
    '  gl_FragColor = vec4(uColor, a);',
    '}'
  ].join('\n');

  /* ---------------- 分界背景着色器（左白右黑 / 章节02纸色） ---------------- */
  var BG_VSH = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
  var BG_FSH = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform float uW2;',
    'uniform float uEdge;',
    'void main(){',
    '  float x = (vUv.x - 0.5) * 2.0;',
    '  float sb = smoothstep(uEdge - 0.24, uEdge + 0.24, x);',
    '  vec3 split = mix(vec3(0.96, 0.96, 0.95), vec3(0.02, 0.02, 0.02), sb);',
    '  vec3 paper = vec3(0.95, 0.93, 0.88);',
    '  gl_FragColor = vec4(mix(split, paper, uW2), 1.0);',
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

  var prog = makeProgram(VSH, FSH);
  var bgProg = makeProgram(BG_VSH, BG_FSH);

  var LOC = {
    aPos: gl.getAttribLocation(prog, 'aPos'),
    aSize: gl.getAttribLocation(prog, 'aSize'),
    aAlpha: gl.getAttribLocation(prog, 'aAlpha'),
    aSeed: gl.getAttribLocation(prog, 'aSeed')
  };
  var U = {};
  ['uTime', 'uProgress', 'uKX', 'uKY', 'uPointSize', 'uMouseRadius',
   'uMouseStrength', 'uAlphaScale', 'uMouse', 'uColor'].forEach(function (n) {
    U[n] = gl.getUniformLocation(prog, n);
  });
  var BG = {
    aPos: gl.getAttribLocation(bgProg, 'aPos'),
    uW2: gl.getUniformLocation(bgProg, 'uW2'),
    uEdge: gl.getUniformLocation(bgProg, 'uEdge')
  };

  var bgBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bgBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  gl.enable(gl.BLEND);
  gl.depthMask(false);
  gl.disable(gl.DEPTH_TEST);

  /* ---------------- 状态 ---------------- */
  var W = 0, H = 0, DPR = 1;
  var imageAspect = 1440 / 760;
  var mouse = { x: 0, y: 0, strength: 0, target: 0 };
  var progress = 0, targetProgress = 0;
  var time = 0;

  /* 图层顺序即绘制顺序：
     章节01：黑粒子(左半白底上) -> 白粒子(右半黑底上)
     章节02：黑 -> 白 -> 红 */
  var layers = [
    { url: '/img/vangogh/background-1.png', mode: 'dark',  x0: 0,    x1: 0.62, color: [0.07, 0.07, 0.07], chapter: 1, sampleW: 900 },
    { url: '/img/vangogh/background-1.png', mode: 'light', x0: 0.38, x1: 1,    color: [0.93, 0.93, 0.92], chapter: 1, sampleW: 900 },
    { url: '/img/rdr2/mask_black.png',      mode: 'white', x0: 0, x1: 1, color: [0.07, 0.06, 0.05], chapter: 2, sampleW: 360 },
    { url: '/img/rdr2/mask_white.png',      mode: 'white', x0: 0, x1: 1, color: [0.97, 0.95, 0.90], chapter: 2, sampleW: 360 },
    { url: '/img/rdr2/mask_red.png',        mode: 'white', x0: 0, x1: 1, color: [0.78, 0.10, 0.10], chapter: 2, sampleW: 360 }
  ];

  /* ---------------- 采样：图像 -> 点云（三层细节优化） ---------------- */
  function sampleLayer(layer, img) {
    var sw = Math.min(layer.sampleW, img.width);
    var sh = Math.round(sw * img.height / img.width);
    var sc = document.createElement('canvas');
    sc.width = sw; sc.height = sh;
    var sctx = sc.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(img, 0, 0, sw, sh);
    var data = sctx.getImageData(0, 0, sw, sh).data;

    var xa = Math.floor(layer.x0 * sw);
    var xb = Math.min(sw, Math.ceil(layer.x1 * sw));
    var arr = []; // x, y, size, alpha, seed
    for (var y = 0; y < sh; y++) {
      for (var x = xa; x < xb; x++) {
        var i = (y * sw + x) * 4;
        var gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        var w = 0;
        if (layer.mode === 'light') {
          // 亮部粒子（黑底上）：越亮概率/大小/透明度越高
          if (gray < 90) continue;
          w = Math.pow(gray / 255, 1.15);
        } else if (layer.mode === 'dark') {
          // 暗部粒子（白底上）：越暗概率/大小/透明度越高
          if (gray > 160) continue;
          w = Math.pow(1 - gray / 255, 1.15);
        } else {
          if (gray <= 128) continue;
          w = 1;
        }
        // 密度分级：按明暗强度概率生成
        if (Math.random() > w) continue;
        arr.push(
          (x + 0.5) / sw, (y + 0.5) / sh,
          0.7 + w * 1.7 + Math.random() * 0.6,   // 大小分级
          0.35 + w * 0.65,                        // 透明分级
          Math.random()
        );
      }
    }

    var n = arr.length / 5;
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    layer.buffer = buf;
    layer.count = n;
  }

  function loadLayer(layer) {
    var img = new Image();
    img.onload = function () {
      try {
        sampleLayer(layer, img);
        if (layer.chapter === 1) {
          imageAspect = img.width / img.height;
          applyCover();
        }
      } catch (e) { /* 采样失败静默降级 */ }
    };
    img.src = layer.url;
  }
  layers.forEach(loadLayer);

  /* ---------------- 尺寸 / cover 映射 ---------------- */
  function applyCover() {
    var va = W / H;
    var kx = Math.max(1, imageAspect / va);
    var ky = Math.max(1, va / imageAspect);
    gl.useProgram(prog);
    gl.uniform1f(U.uKX, kx);
    gl.uniform1f(U.uKY, ky);
    // 分界线在图像 42% 宽度处，映射到 NDC
    gl.useProgram(bgProg);
    gl.uniform1f(BG.uEdge, (0.42 - 0.5) * 2 * kx);
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    gl.uniform1f(U.uPointSize, 1.4 * DPR);
    if (grainCanvas) {
      grainCanvas.width = W; grainCanvas.height = H;
      grainCanvas.style.width = W + 'px'; grainCanvas.style.height = H + 'px';
    }
    applyCover();
  }

  /* ---------------- 胶片颗粒叠加（2D canvas 噪点层） ---------------- */
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
      id.data[i + 3] = Math.random() < 0.5 ? 0 : 26;
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

  /* ---------------- 章节窗口 / 缓动 ---------------- */
  function smoothstep(a, b, x) {
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /* ---------------- 绘制 ---------------- */
  function drawBg(w2) {
    gl.useProgram(bgProg);
    gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, bgBuf);
    gl.enableVertexAttribArray(BG.aPos);
    gl.vertexAttribPointer(BG.aPos, 2, gl.FLOAT, false, 8, 0);
    gl.uniform1f(BG.uW2, w2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
    gl.useProgram(prog);
  }

  function drawLayer(layer, scatter, alphaScale) {
    if (!layer.buffer || layer.count === 0 || alphaScale <= 0.01) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
    gl.enableVertexAttribArray(LOC.aPos);
    gl.vertexAttribPointer(LOC.aPos, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(LOC.aSize);
    gl.vertexAttribPointer(LOC.aSize, 1, gl.FLOAT, false, 20, 8);
    gl.enableVertexAttribArray(LOC.aAlpha);
    gl.vertexAttribPointer(LOC.aAlpha, 1, gl.FLOAT, false, 20, 12);
    gl.enableVertexAttribArray(LOC.aSeed);
    gl.vertexAttribPointer(LOC.aSeed, 1, gl.FLOAT, false, 20, 16);

    gl.uniform1f(U.uProgress, scatter);
    gl.uniform1f(U.uAlphaScale, alphaScale);
    gl.uniform3f(U.uColor, layer.color[0], layer.color[1], layer.color[2]);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, layer.count);
  }

  function frame(dt) {
    time += dt;

    progress += (targetProgress - progress) * 0.08;
    mouse.strength += (mouse.target - mouse.strength) * 0.15;

    var p = progress;
    var w1 = 1 - smoothstep(0.40, 0.52, p);   // 章节01 可见度
    var w2 = smoothstep(0.46, 0.58, p);       // 章节02 可见度
    var scatter1 = smoothstep(0.06, 0.42, p); // 章节01 聚散
    var scatter2 = smoothstep(0.60, 0.95, p); // 章节02 聚散

    drawBg(w2);

    gl.uniform1f(U.uTime, time);
    gl.uniform2f(U.uMouse, mouse.x, mouse.y);
    gl.uniform1f(U.uMouseRadius, 0.30);
    gl.uniform1f(U.uMouseStrength, mouse.strength);

    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (L.chapter === 1) drawLayer(L, scatter1, w1);
      else drawLayer(L, scatter2, w2);
    }

    drawGrain();
    updateDom(p, w2);
  }

  /* ---------------- DOM 文字层 ---------------- */
  var titleEl = document.getElementById('vg-title');
  var wordEl = document.getElementById('vg-word');
  var wordTextEl = document.getElementById('vg-word-text');
  var ch2El = document.getElementById('vg-ch2');
  var chapterEl = document.getElementById('vg-chapter');
  var WORDS = ['Elimar', 'regret', 'darkness', 'redemption', 'van Gogh'];
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

  function updateDom(p, w2) {
    if (titleEl) titleEl.classList.toggle('is-hidden', p > 0.05);
    if (chapterEl) chapterEl.textContent = w2 > 0.5 ? 'CHAPTER 02/' : 'CHAPTER 01/';
    if (ch2El) ch2El.classList.toggle('is-visible', w2 > 0.5);
  }

  /* ---------------- 交互 ---------------- */
  window.addEventListener('pointermove', function (e) {
    mouse.x = (e.clientX / W) * 2 - 1;
    mouse.y = 1 - (e.clientY / H) * 2;
    mouse.target = 1;
    if (!wordStarted) { wordStarted = true; cycleWords(); }
  });
  window.addEventListener('pointerdown', function () { mouse.target = 2.2; });
  window.addEventListener('pointerup', function () { mouse.target = 1; });
  document.addEventListener('pointerleave', function () { mouse.target = 0; });

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
    onScroll();
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 60);
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 60); });
  }
})();
