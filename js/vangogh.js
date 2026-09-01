/* ==========================================================
   粒子点云（原生 WebGL，零外部依赖）— 复刻 elimar.lmigroupintl.com
   视觉与交互（按图1~4）：
     1) 背景 = 左白右黑的【柔和宽渐变】（无硬分界线），滚动时渐变渐强
     2) 满屏常驻自由漂浮的"灰尘/星尘"粒子（大小不一、黑/白/灰都有），
        始终在画面各处漂浮，像星空与浮尘
     3) 滚动：部分粒子从漂浮状态【聚焦】成主体人像（图2→3→4），
        其余粒子继续自由漂浮；滚到底再散开
     4) 鼠标移动 = 摄影机视角平移（parallax），画面随鼠标轻微移动，
        非斥力；远近层粒子位移幅度不同，有景深
     渲染：软粒子(羽化) + 半透明混合 + 胶片颗粒叠加
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

  /* ---------------- 粒子着色器 ----------------
     aPos: 人像采样粒子为 uv(0..1)；灰尘粒子为 NDC 自由坐标
     aDrift: 漂移相位/幅度； aMix: 0=纯人像层(聚焦) 1=纯灰尘(始终漂浮) */
  var VSH = [
    'attribute vec2 aPos;',
    'attribute float aSize;',
    'attribute float aAlpha;',
    'attribute float aSeed;',
    'attribute vec3 aColor;',
    'uniform float uTime;',
    'uniform float uProgress;',   // 0=漂浮灰尘 1=聚焦成像
    'uniform float uDisperse;',   // 1=滚到底散开
    'uniform float uKX;',
    'uniform float uKY;',
    'uniform vec2 uOff;',
    'uniform float uPointSize;',
    'uniform float uAlphaScale;',
    'uniform vec2 uPar;',         // 摄影机视差（鼠标）
    'uniform int uFree;',         // 1=自由灰尘粒子
    'uniform int uVortex;',       // 1=开场黑洞涡旋粒子
    'uniform float uAspect;',     // 屏幕宽高比（圆形修正）
    'uniform float uBurst;',      // 爆发：流速加快
    'varying float vAlpha;',
    'varying vec3 vColor;',
    'float hash(float n){ return fract(sin(n) * 43758.5453123); }',
    'float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }',
    'void main(){',
    '  vec2 base;',
    '  vec2 drift;',
    '  float parAmt;',
    '  float twinkle = 1.0;',
    '  if (uVortex == 1) {',
    // 涡旋粒子：aPos.x = 半径归一(0..1, 晕圈内), aPos.y = 初始角
    '    float rn = aPos.x;',
    '    float holeR = 0.30;',
    '    float haloW = 0.42;',
    '    float r = holeR + 0.03 + rn * haloW;',
    // 逆时针螺旋：内快外慢；爆发时加速
    '    float spd = mix(1.1, 0.28, rn) * (1.0 + uBurst * 1.8);',
    '    float ang = aPos.y - uTime * spd;',
    // 缓慢径向呼吸（吸积盘涨落）
    '    r += 0.02 * sin(uTime * 0.6 + aSeed * 20.0);',
    '    vec2 cpos = vec2(cos(ang) * r / uAspect, sin(ang) * r) + vec2(0.0, -0.04);',
    // 布朗扰动：5% 粒子每帧随机偏移（用高频噪声近似）
    '    vec2 br = vec2(hash2(vec2(aSeed*7.0, floor(uTime*8.0))),',
    '                 hash2(vec2(aSeed*13.0, floor(uTime*8.0)))) - 0.5;',
    '    base = cpos + br * 0.012;',
    '    drift = vec2(0.0);',
    '    parAmt = 0.01;',
    // 呼吸闪烁：亮度周期涨落；边缘粒子更闪
    '    twinkle = 0.55 + 0.45 * sin(uTime * (1.2 + aSeed) + aSeed * 30.0);',
    '  } else if (uFree == 1) {',
    '    base = aPos;',                                  // 灰尘：已是 NDC
    // 漂浮灰尘：多频正弦漂移，方向各异，流动感强
    '    drift = vec2(sin(uTime*0.15 + aSeed*40.0) + 0.6*sin(uTime*0.06 + aSeed*17.0),',
    '                  cos(uTime*0.12 + aSeed*31.0) + 0.6*sin(uTime*0.08 + aSeed*23.0)) * 0.075;',
    '    drift += vec2(uTime * 0.004 * (hash(aSeed*3.0)-0.5), uTime * 0.003 * (hash(aSeed*5.0)-0.5));',
    '    parAmt = 0.02 + hash(aSeed*7.1) * 0.05;',       // 远/近层视差不同（景深）
    // 呼吸闪烁
    '    twinkle = 0.6 + 0.4 * sin(uTime * (0.7 + hash(aSeed*9.0)) + aSeed * 40.0);',
    '  } else {',
    '    vec2 img = vec2((aPos.x - 0.5) * 2.0 * uKX + uOff.x, (0.5 - aPos.y) * 2.0 * uKY + uOff.y);',
    // 人像粒子的自由漂浮位置：稳定的大半径散布
    '    float ang = aSeed * 6.2831853;',
    '    float rad = 0.7 + hash(aSeed * 3.3) * 1.9;',
    '    vec2 freePos = vec2(cos(ang), sin(ang)) * rad;',
    // 聚焦进度：粒子级小相位（收紧抖动 → 成像更清晰）；滚到底再散开
    '    float ph = smoothstep(0.0, 0.25, uProgress * (1.0 + 0.12 * hash(aSeed * 5.7)) - 0.05 * hash(aSeed * 9.1));',
    '    ph = ph * (1.0 - uDisperse);',
    // 呼吸漂移仅在未聚焦时存在，聚焦后归位（成像锐利）
    '    drift = vec2(sin(uTime*0.10 + aSeed*50.0), cos(uTime*0.12 + aSeed*38.0)) * 0.03 * (1.0 - ph);',
    '    parAmt = 0.015;',
    '    base = mix(freePos, img, ph);',
    '  }',
    '  vec2 finalPos = base + drift + uPar * parAmt;',
    '  gl_Position = vec4(finalPos, 0.0, 1.0);',
    '  gl_PointSize = aSize * uPointSize;',
    '  vAlpha = aAlpha * uAlphaScale * twinkle;',
    '  vColor = aColor;',
    '}'
  ].join('\n');

  var FSH = [
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

  /* ---------------- 背景着色器：开场宇宙黑洞漩涡 → 柔和左白右黑渐变 ----------------
     uIntro=1：中心纯黑圆(黑洞) + 外围灰白晕 + 极光式裙边涟漪(流动/呼吸/卷曲)
     uIntro=0：柔和宽渐变（无硬分界） */
  var BG_VSH = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
  var BG_FSH = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform float uIntensity;',   // 渐变页：黑白对比强度
    'uniform float uIntro;',       // 1=开场黑洞, 0=渐变
    'uniform float uTime;',
    'uniform float uBurst;',       // 爆发：流光加速扫过
    'uniform float uAspect;',      // 屏幕宽高比（圆形修正）
    // 噪声（极光卷曲/涟漪）
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }',
    'float noise(vec2 p){',
    '  vec2 i=floor(p); vec2 f=fract(p);',
    '  f=f*f*(3.0-2.0*f);',
    '  float a=hash(i), b=hash(i+vec2(1.0,0.0)), c=hash(i+vec2(0.0,1.0)), d=hash(i+vec2(1.0,1.0));',
    '  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);',
    '}',
    'float fbm(vec2 p){',
    '  float v=0.0, a=0.5;',
    '  for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=0.5; }',
    '  return v;',
    '}',
    'void main(){',
    '  vec2 uv = vUv;',
    // ---- 渐变背景 ----
    '  float x = (uv.x - 0.5) * 2.0;',
    '  float gb = smoothstep(-0.95, 0.95, (x + 0.15) * 1.05);',
    '  vec3 gcol = mix(vec3(0.97,0.97,0.96), vec3(0.02,0.02,0.02), gb);',
    '  gcol = mix(vec3(0.86), gcol, uIntensity);',
    // ---- 开场黑洞漩涡 ----
    // 非对称纵横比修正：用屏幕宽高比缩放 y
    '  vec2 p = uv - vec2(0.5, 0.52);',
    '  p.x *= uAspect;',
    '  float r = length(p);',
    '  float a = atan(p.y, p.x);',
    // 呼吸：半径缓慢涨落
    '  float breathe = 0.035 * sin(uTime * 0.55) + 0.02 * sin(uTime * 0.31);',
    // 裙边涟漪：多条沿角度旋转的同心波，被 fbm 扭曲（卷曲/折叠/拉扯）
    '  float t = uTime * (0.12 + uBurst * 0.35);',
    '  float warp = fbm(vec2(a * 1.7, r * 3.5 - t * 1.2));',
    '  float ripple = sin((r - t * 0.22) * 26.0 + a * 3.0 + warp * 5.0);',
    '  ripple += 0.5 * sin((r - t * 0.15) * 47.0 - a * 2.0 + warp * 7.0);',
    '  ripple = ripple * 0.5 + 0.5;',
    // 黑洞半径（约屏幕1/3，纵向因aspect修正）
    '  float holeR = 0.30 + breathe;',
    // 纯黑洞
    '  float hole = 1.0 - smoothstep(holeR - 0.015, holeR + 0.03, r);',
    // 外围灰白晕圈（宽度约15%屏高）
    '  float halo = smoothstep(holeR + 0.02, holeR + 0.22, r);',
    '  halo *= 1.0 - smoothstep(holeR + 0.30, holeR + 0.75, r);',
    // 晕圈基底亮度（外白向内暗，像图1/2）
    '  float base = smoothstep(holeR, holeR + 0.6, r);',
    // 涟漪只存在于晕圈，形成一圈圈裙边
    '  float skirt = halo * pow(ripple, 2.2) * 0.85;',
    // 呼吸闪烁：亮度周期性涨落
    '  float tw = 0.75 + 0.25 * sin(uTime * 0.9 + ripple * 4.0);',
    // 极光光带在晕圈内外缘最亮
    '  float veil = halo * (0.5 + 0.5 * warp) * (0.6 + 0.4 * tw);',
    // 黑洞内部全黑；晕圈为灰白光带；最外为白底
    '  vec3 vcol = vec3(base) ;',
    '  vcol += vec3(skirt * tw) * 0.9 + vec3(veil) * 0.10;',
    '  vcol = clamp(vcol, 0.0, 1.0);',
    // 黑洞纯黑
    '  vcol = mix(vcol, vec3(0.0), hole);',
    // 混合：intro=1 用漩涡，0 用渐变
    '  vec3 col = mix(gcol, vcol, uIntro);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(s));
    }
    return s;
  }
  function makeProgram(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(p));
    }
    return p;
  }

  var prog = makeProgram(VSH, FSH);
  var bgProg = makeProgram(BG_VSH, BG_FSH);

  var LOC = {
    aPos: gl.getAttribLocation(prog, 'aPos'),
    aSize: gl.getAttribLocation(prog, 'aSize'),
    aAlpha: gl.getAttribLocation(prog, 'aAlpha'),
    aSeed: gl.getAttribLocation(prog, 'aSeed'),
    aColor: gl.getAttribLocation(prog, 'aColor')
  };
  var U = {};
  ['uTime', 'uProgress', 'uDisperse', 'uKX', 'uKY', 'uOff', 'uPointSize',
   'uAlphaScale', 'uPar', 'uFree', 'uVortex', 'uAspect', 'uBurst'].forEach(function (n) {
    U[n] = gl.getUniformLocation(prog, n);
  });
  var BG = {
    aPos: gl.getAttribLocation(bgProg, 'aPos'),
    uIntensity: gl.getUniformLocation(bgProg, 'uIntensity'),
    uIntro: gl.getUniformLocation(bgProg, 'uIntro'),
    uTime: gl.getUniformLocation(bgProg, 'uTime'),
    uBurst: gl.getUniformLocation(bgProg, 'uBurst'),
    uAspect: gl.getUniformLocation(bgProg, 'uAspect')
  };

  var bgBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bgBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  gl.enable(gl.BLEND);
  gl.depthMask(false);
  gl.disable(gl.DEPTH_TEST);

  /* ---------------- 状态 ---------------- */
  var W = 0, H = 0, DPR = 1;
  var mouse = { x: 0, y: 0, px: 0, py: 0 };
  var par = { x: 0, y: 0 };
  var progress = 0, targetProgress = 0;
  var time = 0;
  var currentBurst = 0;          // 爆发强度（开场后周期性流光）

  /* 页面配置：/cat/ 单主体；/vangogh/ 双章节（梵高 + RDR2） */
  var CFG = window.VANGOGH_CONFIG || {};
  var SINGLE = !!CFG.single;

  /* 人像图层：mode=dark 黑粒子(暗部) / light 白粒子(亮部×纹理) /
     lightCat 白粒子(深色主体靠毛发纹理) / flat 蒙版整块 */
  var layers = CFG.layers || [
    { url: '/img/vangogh/young-vincent.png', mode: 'dark',  fit: 'contain', ox: -0.05, oy: -0.05, color: [0.07, 0.07, 0.07], chapter: 1 },
    { url: '/img/vangogh/young-vincent.png', mode: 'light', fit: 'contain', ox: -0.05, oy: -0.05, color: [0.95, 0.95, 0.94], chapter: 1 },
    { url: '/img/rdr2/mask_black.png', mode: 'darkflat', fit: 'contain', ox: 0.10, oy: 0, color: [0.06, 0.05, 0.05], chapter: 2 },
    { url: '/img/rdr2/mask_white.png', mode: 'lightflat', fit: 'contain', ox: 0.10, oy: 0, color: [0.96, 0.94, 0.89], chapter: 2 },
    { url: '/img/rdr2/mask_red.png',   mode: 'redflat',   fit: 'contain', ox: 0.10, oy: 0, color: [0.78, 0.10, 0.10], chapter: 2 }
  ];

  /* ---------------- 等比映射（正确的 contain/cover） ----------------
     uv 居中矩形半宽=kx、半高=ky（NDC）。图片高宽比 ia，视口 va。
     contain：整张图完整落在视口内；cover：铺满视口。 */
  function fitK(ia, va, fit) {
    if (fit === 'cover') {
      // 铺满：让较短方向填满
      return ia >= va ? { kx: 1, ky: va / ia } : { kx: ia / va, ky: 1 };
    }
    // contain：整张完整，留边
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

  /* ---------------- 采样：图像 -> 点云（密度/大小/透明度分级） ---------------- */
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

    var arr = []; // x(uv), y(uv), size, alpha, seed
    for (var y = 0; y < sh; y++) {
      for (var x = 0; x < sw; x++) {
        p = y * sw + x;
        if (data[p * 4 + 3] < 128) continue;   // 透明底抠图
        var gray = luma[p];
        var tex = Math.min(1, Math.abs(gray - base[p]) / 45);
        var w = 0;
        if (layer.mode === 'dark') {
          // 黑粒子：暗部（放宽阈值，毛发/轮廓细节更密）
          var darkness = (165 - gray) / 165;
          if (darkness <= 0.02) continue;
          w = darkness * (0.55 + 0.45 * tex);
        } else if (layer.mode === 'light') {
          if (tex < 0.08) continue;
          w = (gray / 255) * (0.30 + 0.70 * tex);
        } else if (layer.mode === 'lightCat') {
          // 深色主体：靠毛发纹理负像，纹理阈值放宽、权重提高 → 成像更密更清晰
          if (tex < 0.035) continue;
          w = ((gray / 255) * 0.45 + 0.55) * (0.35 + 0.65 * tex);
        } else if (layer.mode === 'darkflat') {
          if (gray > 128) continue;
          w = 0.9;
        } else if (layer.mode === 'lightflat') {
          if (gray <= 128) continue;
          w = 0.9;
        } else { // redflat
          if (gray <= 128) continue;
          w = 0.95;
        }
        if (Math.random() > w) continue;
        arr.push(
          (x + 0.5) / sw, (y + 0.5) / sh,
          0.5 + w * 1.3 + Math.random() * 0.4,
          0.45 + w * 0.55,
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

  /* ---------------- 满屏自由漂浮灰尘粒子（黑/白/灰，大小不一） ---------------- */
  function buildDust() {
    var N = 560;
    var arr = [];
    for (var i = 0; i < N; i++) {
      // 颜色：黑、深灰、浅灰、白 随机（黑在白区可见、白在黑区可见，自然形成星尘）
      var t = Math.random();
      var g = t < 0.30 ? 0.10 + Math.random() * 0.12      // 黑/深灰
            : t < 0.62 ? 0.30 + Math.random() * 0.30      // 中灰
            : 0.78 + Math.random() * 0.20;                 // 浅灰/白
      arr.push(
        (Math.random() * 2.6 - 1.3), (Math.random() * 2.6 - 1.3),
        // 大小：多数细小，少数大圆点（如图1的大灰点）
        Math.random() < 0.10 ? 7 + Math.random() * 11 : 1.5 + Math.random() * 3.5,
        0.15 + Math.random() * 0.45,
        Math.random(),
        g, g, g
      );
    }
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    dust.buffer = buf;
    dust.count = N;
  }
  var dust = {};

  /* ---------------- 开场黑洞涡旋粒子（吸积盘） ----------------
     aPos.x = 半径归一 rn(0..1, 晕圈内)；aPos.y = 初始角(0..2π)。
     密度：黑洞边缘最高、向外指数衰减；尺寸 0.5~2px 小光点为主。 */
  function buildVortex() {
    var N = 3600;
    var arr = [];
    for (var i = 0; i < N; i++) {
      // 幂分布：多数粒子靠近内缘（黑洞边缘密度最高）
      var rn = Math.pow(Math.random(), 1.9);
      var ang = Math.random() * Math.PI * 2;
      // 尺寸：80% 小光点，少数大粒子作视觉锚点
      var big = Math.random() < 0.06;
      var sz = big ? 2.2 + Math.random() * 1.2 : 0.6 + Math.random() * 1.1;
      // 颜色：黑/灰/白（白在暗晕、黑在亮区）
      var t = Math.random();
      var g = t < 0.32 ? 0.08 + Math.random() * 0.15
            : t < 0.66 ? 0.35 + Math.random() * 0.30
            : 0.80 + Math.random() * 0.20;
      arr.push(
        rn, ang,
        sz,
        0.3 + Math.random() * 0.5,
        Math.random(),
        g, g, g
      );
    }
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    vortex.buffer = buf;
    vortex.count = N;
  }
  var vortex = {};

  /* ---------------- 尺寸 ---------------- */
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    gl.uniform1f(U.uPointSize, 1.6 * DPR);
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
      id.data[i + 3] = Math.random() < 0.5 ? 0 : 24;
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
  function drawBg(intensity, intro, burst) {
    gl.useProgram(bgProg);
    gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, bgBuf);
    gl.enableVertexAttribArray(BG.aPos);
    gl.vertexAttribPointer(BG.aPos, 2, gl.FLOAT, false, 8, 0);
    gl.uniform1f(BG.uIntensity, intensity);
    gl.uniform1f(BG.uIntro, intro);
    gl.uniform1f(BG.uTime, time);
    gl.uniform1f(BG.uBurst, burst);
    gl.uniform1f(BG.uAspect, W / H);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
    gl.useProgram(prog);
  }

  function drawPoints(buf, count, kx, ky, ox, oy, alpha, free, vortex) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    var STR = 32; // 8 floats * 4
    gl.enableVertexAttribArray(LOC.aPos);
    gl.vertexAttribPointer(LOC.aPos, 2, gl.FLOAT, false, STR, 0);
    gl.enableVertexAttribArray(LOC.aSize);
    gl.vertexAttribPointer(LOC.aSize, 1, gl.FLOAT, false, STR, 8);
    gl.enableVertexAttribArray(LOC.aAlpha);
    gl.vertexAttribPointer(LOC.aAlpha, 1, gl.FLOAT, false, STR, 12);
    gl.enableVertexAttribArray(LOC.aSeed);
    gl.vertexAttribPointer(LOC.aSeed, 1, gl.FLOAT, false, STR, 16);
    gl.enableVertexAttribArray(LOC.aColor);
    gl.vertexAttribPointer(LOC.aColor, 3, gl.FLOAT, false, STR, 20);

    gl.uniform1f(U.uKX, kx);
    gl.uniform1f(U.uKY, ky);
    gl.uniform2f(U.uOff, ox, oy);
    gl.uniform1f(U.uAlphaScale, alpha);
    gl.uniform1i(U.uFree, free ? 1 : 0);
    gl.uniform1i(U.uVortex, vortex ? 1 : 0);
    gl.uniform1f(U.uAspect, W / H);
    gl.uniform1f(U.uBurst, currentBurst);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, count);
  }

  function frame(dt) {
    time += dt;
    progress += (targetProgress - progress) * 0.07;
    // 摄影机视差平滑跟随
    par.x += (mouse.x - par.x) * 0.05;
    par.y += (mouse.y - par.y) * 0.05;

    var p = progress;

    // 开场（顶部）：宇宙黑洞漩涡；滚动后淡出 → 柔和渐变
    var intro = 1 - smoothstep(0.02, 0.16, p);
    // 爆发：周期性流光快速扫过（每约 9 秒一次）
    var burst = Math.pow(Math.max(0, Math.sin(time * 0.35)), 3) * (0.4 + 0.6 * intro);
    currentBurst = burst;

    // 背景：开场漩涡 / 渐变页对比强度
    var intensity = 0.30 + 0.70 * smoothstep(0.14, 0.5, p);
    drawBg(intensity, intro, burst);

    gl.uniform1f(U.uTime, time);
    gl.uniform2f(U.uPar, par.x, par.y);

    var chapter, focus, disperse, alphaCh;
    if (SINGLE) {
      chapter = 1;
      focus = smoothstep(0.10, 0.55, p);          // 开场之后：聚焦成像
      disperse = smoothstep(0.72, 0.98, p);       // 滚到底：散开
      alphaCh = 1;
    } else {
      var w1 = 1 - smoothstep(0.42, 0.54, p);
      var w2 = smoothstep(0.46, 0.58, p);
      chapter = w2 > 0.5 ? 2 : 1;
      focus = chapter === 1
        ? smoothstep(0.10, 0.40, p) * (1 - smoothstep(0.30, 0.44, p))
        : smoothstep(0.50, 0.80, p) * (1 - smoothstep(0.86, 0.98, p));
      disperse = chapter === 2 ? smoothstep(0.86, 0.98, p) : 0;
      alphaCh = chapter === 1 ? w1 : w2;
    }

    // 开场涡旋粒子（吸积盘）：仅 intro 阶段可见
    if (vortex.buffer && intro > 0.01) {
      gl.uniform1f(U.uProgress, 0);
      gl.uniform1f(U.uDisperse, 0);
      drawPoints(vortex.buffer, vortex.count, 1, 1, 0, 0, intro, false, true);
    }

    // 人像图层（开场后淡入）
    gl.uniform1f(U.uProgress, focus);
    gl.uniform1f(U.uDisperse, disperse);
    var portraitA = (1 - intro) * alphaCh;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (L.chapter !== chapter) continue;
      if (!L.buffer || L.count === 0) continue;
      drawPoints(L.buffer, L.count, L.kx || 1, L.ky || 1, L.ox || 0, L.oy || 0,
                 portraitA, false, false);
    }

    // 满屏漂浮灰尘：始终存在（开场淡、后续强），黑/灰/白星尘
    if (dust.buffer) {
      gl.uniform1f(U.uProgress, 0);
      gl.uniform1f(U.uDisperse, 0);
      var dustA = 0.30 + 0.65 * (1 - intro);
      drawPoints(dust.buffer, dust.count, 1, 1, 0, 0, dustA, true, false);
    }

    drawGrain();
    updateDom(p, chapter, intro);
  }

  /* ---------------- DOM 文字层 ---------------- */
  var introEl = document.getElementById('vg-intro');
  var titleEl = document.getElementById('vg-title');
  var wordEl = document.getElementById('vg-word');
  var wordTextEl = document.getElementById('vg-word-text');
  var ch2El = document.getElementById('vg-ch2');
  var chapterEl = document.getElementById('vg-chapter');
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

  function updateDom(p, chapter, intro) {
    // 开场引言：顶部显示，滚入正文后淡出
    if (introEl) introEl.classList.toggle('is-hidden', intro < 0.6);
    if (SINGLE) {
      // 单主体页：标题在开场后显现
      if (titleEl) titleEl.classList.toggle('is-hidden', intro > 0.4);
      return;
    }
    if (titleEl) titleEl.classList.toggle('is-hidden', (p > 0.18 && chapter === 1) || intro > 0.4);
    if (wordEl) wordEl.classList.toggle('is-hidden', chapter === 2);
    if (chapterEl) chapterEl.textContent = chapter === 2 ? 'CHAPTER 02/' : 'CHAPTER 01/';
    if (ch2El) ch2El.classList.toggle('is-visible', chapter === 2);
  }

  /* ---------------- 交互：鼠标=摄影机视角平移（非斥力） ---------------- */
  window.addEventListener('pointermove', function (e) {
    mouse.x = (e.clientX / W) * 2 - 1;   // -1..1
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
    buildDust();
    buildVortex();
    onScroll();
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 60);
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 60); });
  }
})();
