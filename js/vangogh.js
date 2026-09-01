/* ==========================================================
   致敬梵高 Elimar — WebGL 点云粒子（原生 WebGL，零外部依赖）
   参考 elimar.lmigroupintl.com 的三层架构：
     渲染核心 = WebGL 点云 + 自定义 GLSL 着色器
     动画控制 = 滚动进度(0~1) 同步粒子聚散 / 章节切换
     质感增强 = 软粒子(羽化) + 半透明混合 + 胶片颗粒叠加

   人物刻画三层细节优化（图像转点云）：
     1) 密度分级：生成概率 ∝ 明暗强度 × 局部纹理（素描排线逻辑）
     2) 大小分级：强明暗/强纹理处粒子大、弱处小，边缘柔化
     3) 半透明混合：叠加处自然形成高光/重墨层次

   章节 01：梵高肖像照 young-vincent —— 左白右黑分界屏：
     人物骑分界线（中心在屏62%宽）；左半白底黑粒子(暗部)、
     右半黑底白粒子(亮部×纹理)，面部细节清晰
   章节 02：RDR2 版画 —— 黑/白/红 三蒙版三层彩色粒子，
     contain 等比适配（不拉伸），纸色底
   动态：Perlin 呼吸 + 鼠标斥力(按住爆散) + 滚动聚散
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
    'attribute float aAmbient;', // 1=环境尘埃：永不聚合，始终自由漂浮
    'uniform float uTime;',
    'uniform float uProgress;',  // 本章聚散进度 0聚合 1散开（vangogh模式）
    'uniform float uFocus;',     // 0=全屏自由散落 1=聚合主体（电影模式，原网页图1→4）
    'uniform float uKX;',        // 该层等比映射系数
    'uniform float uKY;',
    'uniform vec2 uOff;',        // 该层 NDC 偏移
    'uniform float uPointSize;',
    'uniform float uMouseRadius;',
    'uniform float uMouseStrength;',
    'uniform float uAlphaScale;',// 章节可见度
    'uniform float uClipL;',     // 左右裁剪
    'uniform float uClipR;',
    'uniform vec2 uMouse;',
    'uniform vec2 uView;',       // 相机视差（鼠标移动=摄影机偏移，原网页交互）
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
    '  vec2 base = vec2((aPos.x - 0.5) * 2.0 * uKX + uOff.x, (0.5 - aPos.y) * 2.0 * uKY + uOff.y);',
    // 左右裁剪
    '  float clip = step(uClipL, base.x) * step(base.x, uClipR);',
    // 自由散落位置：全屏随机（电影模式起始态，如原网页图1的星空/灰尘）
    '  vec2 free = vec2(hash(vec2(aSeed, 1.7)) * 2.0 - 1.0, hash(vec2(aSeed, 3.1)) * 2.0 - 1.0);',
    // 错峰聚合：按 seed 陆续归位（滚动时尘埃渐次聚焦出主体）
    '  float local = smoothstep(aSeed * 0.75, aSeed * 0.75 + 0.25, uFocus) * (1.0 - aAmbient);',
    '  vec2 pos = mix(free, base, local);',
    // 章节散射（vangogh模式滚动散开，绕原位）
    '  float r = hash(aPos * vec2(143.7, 211.3) + aSeed);',
    '  float ang = r * 6.2831853;',
    '  float rad = 0.6 + 1.8 * hash(aPos * vec2(97.3, 51.1) + aSeed);',
    '  vec2 scattered = pos + vec2(cos(ang), sin(ang)) * rad * (1.0 - aAmbient);',
    '  pos = mix(pos, scattered, uProgress);',
    // 呼吸/漂浮：散落时漂移大、聚合后微动；尘埃始终自由漂浮
    '  float amp = mix(0.085, 0.012, local) * (1.0 + aAmbient * 0.9);',
    '  vec2 np = aPos * 4.0 + vec2(uTime * 0.12, uTime * 0.16) + aSeed * 17.0;',
    '  vec2 breathe = vec2(vnoise(np) - 0.5, vnoise(np + vec2(11.3, 5.7)) - 0.5) * 2.0 * amp;',
    // 鼠标斥力（vangogh模式；电影模式强度为0）
    '  vec2 delta = pos - uMouse;',
    '  float len = max(length(delta), 0.0001);',
    '  float fo = 1.0 - clamp(len / uMouseRadius, 0.0, 1.0);',
    '  vec2 push = (delta / len) * (fo * fo * uMouseStrength);',
    // 相机视差：鼠标移动=摄影机偏移，近处粒子位移大（原网页交互方式）
    '  vec2 par = uView * (0.25 + aSeed * 0.75);',
    '  vec2 finalPos = pos + breathe + push + par;',
    '  gl_Position = vec4(finalPos, 0.0, 1.0);',
    '  gl_PointSize = aSize * uPointSize * clip;',
    '  vAlpha = aAlpha * uAlphaScale * clip;',
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

  /* ---------------- 分界背景着色器（常驻左白右黑） ---------------- */
  var BG_VSH = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
  var BG_FSH = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform float uEdge;',
    'uniform float uSoft;',     // 渐变宽度（原网页：超宽柔和，无分界线感）
    'uniform float uContrast;', // 0=均匀浅灰 1=完整左亮右暗（滚动渐显）
    'void main(){',
    '  float x = (vUv.x - 0.5) * 2.0;',
    '  float sb = smoothstep(uEdge - uSoft, uEdge + uSoft, x);',
    '  vec3 mid = vec3(0.90, 0.90, 0.89);',
    '  vec3 lc = mix(mid, vec3(0.96, 0.96, 0.95), uContrast);',
    '  vec3 rc = mix(mid, vec3(0.02, 0.02, 0.02), uContrast);',
    '  gl_FragColor = vec4(mix(lc, rc, sb), 1.0);',
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
    aSeed: gl.getAttribLocation(prog, 'aSeed'),
    aAmbient: gl.getAttribLocation(prog, 'aAmbient')
  };
  var U = {};
  ['uTime', 'uProgress', 'uFocus', 'uKX', 'uKY', 'uOff', 'uPointSize', 'uMouseRadius',
   'uMouseStrength', 'uAlphaScale', 'uClipL', 'uClipR', 'uMouse', 'uView', 'uColor'].forEach(function (n) {
    U[n] = gl.getUniformLocation(prog, n);
  });
  var BG = {
    aPos: gl.getAttribLocation(bgProg, 'aPos'),
    uEdge: gl.getUniformLocation(bgProg, 'uEdge'),
    uSoft: gl.getUniformLocation(bgProg, 'uSoft'),
    uContrast: gl.getUniformLocation(bgProg, 'uContrast')
  };

  var bgBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bgBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  gl.enable(gl.BLEND);
  gl.depthMask(false);
  gl.disable(gl.DEPTH_TEST);

  /* ---------------- 状态 ---------------- */
  var W = 0, H = 0, DPR = 1;
  var mouse = { x: 0, y: 0, strength: 0, target: 0 };
  var view = { x: 0, y: 0 };                 // 相机视差（平滑跟随鼠标）
  var progress = 0, targetProgress = 0;
  var time = 0;

  /* 页面配置：/vangogh/ 用默认（双章节），/cat/ 通过 window.VANGOGH_CONFIG 覆盖 */
  var CFG = window.VANGOGH_CONFIG || {};
  var SINGLE = !!CFG.single;                 // 单章节页面（猫）
  var CINEMATIC = !!CFG.cinematic;           // 电影模式（原网页图1→4：尘埃→聚合）
  var EDGE_NDC = CFG.edge != null ? CFG.edge : 0.24; // 渐变中心 NDC x
  var BG_SOFT = CINEMATIC ? 0.85 : 0.22;     // 电影模式：超宽柔和渐变，无分界线感

  /* 图层顺序即绘制顺序。fit: contain 等比完整。
     分界屏常驻左白右黑（分界线 NDC 0.24），人物骑分界线：
     章节01：肖像 黑粒子层(左半,暗部) + 白粒子层(右半,亮部×纹理)
     章节02：RDR2 黑粒子层(左半) + 白粒子层(右半) + 红粒子层(骑全线)
     透明底PNG：alpha<128 的像素不生成粒子（抠图干净） */
  var layers = CFG.layers || [
    { url: '/img/vangogh/young-vincent.png', mode: 'dark',  fit: 'contain', ox: 0.24, oy: -0.08, clipL: -2, clipR: 0.24, color: [0.08, 0.08, 0.08], chapter: 1 },
    { url: '/img/vangogh/young-vincent.png', mode: 'light', fit: 'contain', ox: 0.24, oy: -0.08, clipL: 0.24, clipR: 2, color: [0.93, 0.93, 0.92], chapter: 1 },
    { url: '/img/rdr2/mask_black.png', mode: 'lightFlat', fit: 'contain', ox: 0.24, oy: 0, clipL: -2, clipR: 0.24, color: [0.07, 0.06, 0.05], chapter: 2 },
    { url: '/img/rdr2/mask_white.png', mode: 'lightFlat', fit: 'contain', ox: 0.24, oy: 0, clipL: 0.24, clipR: 2, color: [0.97, 0.95, 0.90], chapter: 2 },
    { url: '/img/rdr2/mask_red.png',   mode: 'white',     fit: 'contain', ox: 0.24, oy: 0, clipL: -2, clipR: 2, color: [0.78, 0.10, 0.10], chapter: 2 }
  ];

  /* ---------------- 等比映射系数（不拉伸） ---------------- */
  function fitK(ia, va, fit) {
    if (fit === 'cover') {
      return ia <= va ? { kx: 1, ky: 1 / ia } : { kx: ia, ky: 1 };
    }
    return ia <= va ? { kx: ia, ky: 1 } : { kx: 1, ky: 1 / ia };
  }

  function applyFits() {
    var va = W / H;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (!L.aspect) continue;
      var k = fitK(L.aspect, va, L.fit);
      L.kx = k.kx; L.ky = k.ky;
    }
    gl.useProgram(bgProg);
    gl.uniform1f(BG.uEdge, EDGE_NDC);
    gl.uniform1f(BG.uSoft, BG_SOFT);
  }

  /* ---------------- 盒式模糊（局部纹理基线） ---------------- */
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

  /* ---------------- 采样：图像 -> 点云（三层细节优化） ---------------- */
  function sampleLayer(layer, img) {
    var sw = Math.min(img.width, 720);
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
    // 局部纹理 = 与模糊基线的差（五官/胡须/衣纹/版画笔触）
    var base = boxBlur(luma, sw, sh, 3);

    var arr = []; // x, y, size, alpha, seed
    for (var y = 0; y < sh; y++) {
      for (var x = 0; x < sw; x++) {
        p = y * sw + x;
        // 透明底PNG：alpha<128 不生成粒子（抠图区域干净）
        if (data[p * 4 + 3] < 128) continue;
        var gray = luma[p];
        var tex = Math.min(1, Math.abs(gray - base[p]) / 45);
        var w = 0;
        if (layer.mode === 'dark') {
          // 黑粒子（白底上）：越暗越密，纹理处更实
          var darkness = (150 - gray) / 150;
          if (darkness <= 0.02) continue;
          w = darkness * (0.45 + 0.55 * tex);
        } else if (layer.mode === 'light') {
          // 白粒子（黑底上）：亮部×纹理；均匀浅底(背景)纹理≈0被剔除
          if (tex < 0.10) continue;
          w = (gray / 255) * (0.25 + 0.75 * tex);
        } else if (layer.mode === 'lightCat') {
          // 白粒子（黑底上，深色主体）：靠毛发纹理负像，淡化对亮度的依赖
          if (tex < 0.05) continue;
          var lw = (gray / 255) * 0.55 + 0.45;
          w = lw * (0.2 + 0.8 * tex);
        } else if (layer.mode === 'lightFlat') {
          // 白粒子（蒙版白区，版画亮部整块）
          if (gray <= 128) continue;
          w = 0.9;
        } else {
          if (gray <= 128) continue;
          w = 1;
        }
        // 密度分级
        if (Math.random() > w) continue;
        arr.push(
          (x + 0.5) / sw, (y + 0.5) / sh,
          0.6 + w * 1.7 + Math.random() * 0.5,  // 大小分级
          0.4 + w * 0.6,                         // 透明分级
          Math.random(),
          0                                      // ambient=0（主体粒子）
        );
      }
    }

    var n = arr.length / 6;
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    layer.buffer = buf;
    layer.count = n;
    layer.aspect = img.width / img.height;
    applyFits();
  }

  /* ---------------- 环境尘埃层（原网页图1：全屏自由漂浮的星空/灰尘） ---------------- */
  function makeAmbient(layer) {
    var arr = [];
    for (var i = 0; i < layer.dust; i++) {
      arr.push(
        Math.random(), Math.random(),            // 全屏随机位置
        0.4 + Math.random() * 2.6,               // 大小不一（含少数大点）
        0.22 + Math.random() * 0.5,
        Math.random(),
        1                                        // ambient=1（永不聚合）
      );
    }
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    layer.buffer = buf;
    layer.count = layer.dust;
    layer.kx = 1; layer.ky = 1; layer.ox = 0; layer.oy = 0;
    layer.clipL = -2; layer.clipR = 2;
    layer.chapter = 1;
  }

  function loadLayer(layer) {
    if (layer.dust) { makeAmbient(layer); return; }
    var img = new Image();
    img.onload = function () {
      try { sampleLayer(layer, img); } catch (e) { /* 采样失败静默降级 */ }
    };
    img.src = layer.url;
  }
  layers.forEach(loadLayer);

  /* ---------------- 尺寸 ---------------- */
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    gl.uniform1f(U.uPointSize, 1.5 * DPR);
    if (grainCanvas) {
      grainCanvas.width = W; grainCanvas.height = H;
      grainCanvas.style.width = W + 'px'; grainCanvas.style.height = H + 'px';
    }
    applyFits();
  }

  /* ---------------- 胶片颗粒叠加 ---------------- */
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

  function smoothstep(a, b, x) {
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /* ---------------- 绘制 ---------------- */
  function drawBg(contrast) {
    gl.useProgram(bgProg);
    gl.uniform1f(BG.uContrast, contrast);
    gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, bgBuf);
    gl.enableVertexAttribArray(BG.aPos);
    gl.vertexAttribPointer(BG.aPos, 2, gl.FLOAT, false, 8, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
    gl.useProgram(prog);
  }

  function drawLayer(layer, scatter, alphaScale) {
    if (!layer.buffer || layer.count === 0 || alphaScale <= 0.01) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
    gl.enableVertexAttribArray(LOC.aPos);
    gl.vertexAttribPointer(LOC.aPos, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(LOC.aSize);
    gl.vertexAttribPointer(LOC.aSize, 1, gl.FLOAT, false, 24, 8);
    gl.enableVertexAttribArray(LOC.aAlpha);
    gl.vertexAttribPointer(LOC.aAlpha, 1, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(LOC.aSeed);
    gl.vertexAttribPointer(LOC.aSeed, 1, gl.FLOAT, false, 24, 16);
    gl.enableVertexAttribArray(LOC.aAmbient);
    gl.vertexAttribPointer(LOC.aAmbient, 1, gl.FLOAT, false, 24, 20);

    gl.uniform1f(U.uProgress, scatter);
    gl.uniform1f(U.uAlphaScale, alphaScale);
    gl.uniform1f(U.uKX, layer.kx || 1);
    gl.uniform1f(U.uKY, layer.ky || 1);
    gl.uniform2f(U.uOff, layer.ox, layer.oy);
    gl.uniform1f(U.uClipL, layer.clipL);
    gl.uniform1f(U.uClipR, layer.clipR);
    gl.uniform3f(U.uColor, layer.color[0], layer.color[1], layer.color[2]);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, layer.count);
  }

  function frame(dt) {
    time += dt;

    progress += (targetProgress - progress) * 0.08;
    mouse.strength += (mouse.target - mouse.strength) * 0.15;

    var p = progress;
    var w1, w2, scatter1, scatter2, focus, contrast;
    if (CINEMATIC) {
      // 电影模式（原网页图1→4）：尘埃→背景渐显→错峰聚合主体，标题常驻
      w1 = 1; w2 = 0;
      scatter1 = 0; scatter2 = 0;
      focus = smoothstep(0.10, 0.62, p);
      contrast = smoothstep(0.02, 0.42, p);
    } else if (SINGLE) {
      w1 = 1; w2 = 0;
      scatter1 = smoothstep(0.55, 0.95, p);
      scatter2 = 0;
      focus = 1; contrast = 1;
    } else {
      w1 = 1 - smoothstep(0.40, 0.52, p);
      w2 = smoothstep(0.46, 0.58, p);
      scatter1 = smoothstep(0.06, 0.42, p);
      scatter2 = smoothstep(0.60, 0.95, p);
      focus = 1; contrast = 1;
    }

    // 相机视差：电影模式下鼠标移动=摄影机偏移（画面随鼠标同向轻移）
    var vx = 0, vy = 0;
    if (CINEMATIC && mouse.target > 0) { vx = mouse.x * 0.05; vy = mouse.y * 0.035; }
    view.x += (vx - view.x) * 0.04;
    view.y += (vy - view.y) * 0.04;

    drawBg(contrast);

    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uFocus, focus);
    gl.uniform2f(U.uMouse, mouse.x, mouse.y);
    gl.uniform2f(U.uView, view.x, view.y);
    gl.uniform1f(U.uMouseRadius, 0.16);
    // 电影模式：鼠标只控制视角，无斥力；vangogh模式：小半径轻柔斥力
    gl.uniform1f(U.uMouseStrength, CINEMATIC ? 0 : mouse.strength * 0.06);

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
    if (SINGLE) return; // 单章节页面（猫）：标题常驻，无章节切换
    if (titleEl) titleEl.classList.toggle('is-hidden', p > 0.05);
    if (wordEl) wordEl.classList.toggle('is-hidden', w2 > 0.5);
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
  window.addEventListener('pointerdown', function () { mouse.target = 2.5; });
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
