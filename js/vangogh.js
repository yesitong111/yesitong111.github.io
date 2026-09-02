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
    'attribute float aEdge;',    // 1=剪影轮廓粒子：沿边缘小范围流动（不静止）
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
    'uniform float uSweep;',     // 0→1.3 聚合前沿，从左向右扫过（人像从左侧显现）
    'uniform float uCamScale;',  // 电影镜头：视野缩放倍数（>1 镜头推近/猫在画面外；=1 全身取景）
    'uniform vec2 uCamPivot;',   // 变焦光心（NDC），固定不动——拉远时原画面外内容从边缘入镜（非平移滑入）
    'varying float vAlpha;',
    'varying float vGlint;',     // 扫过前端粒子短暂放大（新区域突显）
    'varying float vHard;',      // 粒子硬度 0=虚(柔羽化) ~ 1=实(锐利实心)，画面中有实有虚
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
    // 全身取景下的 NDC 位置
    '  vec2 posNDC = vec2((aPos.x - 0.5) * 2.0 * uKX + uOff.x, (0.5 - aPos.y) * 2.0 * uKY + uOff.y);',
    // 猫身呼吸感：组成猫的粒子(非尘埃)在世界坐标做缓慢、小范围、有机的噪声漂浮——
    //   加在镜头变换之前，故随变焦一致缩放(透视自然)；低频慢漂移(不抽搐、不单向、不破坏轮廓)，像呼吸/轻轻浮动。
    '  float subj = 1.0 - aAmbient;',
    '  vec2 bN = vec2(vnoise(aPos * 3.0 + vec2(uTime * 0.10, aSeed * 6.1)),',
    '                 vnoise(aPos * 3.0 + vec2(aSeed * 4.3, uTime * 0.11)));',
    '  posNDC += (bN - 0.5) * 2.0 * 0.018 * subj;',
    // 电影镜头（纯光学变焦，非平移）：以固定光心 uCamPivot 为中心缩放取景。
    //   uCamScale>1 镜头推近（取景框小，猫在画面右侧之外）；随滚轮 uCamScale→1 拉远，取景框扩大，
    //   原本在画面外的猫从右边缘“入镜”——内容不动、是镜头视野把它取进来，不是猫平移滑入。
    '  vec2 base = uCamPivot + (posNDC - uCamPivot) * uCamScale;',
    // 左右裁剪（vangogh 章节用；电影模式主体全开 = -2..2）。尘埃恒全屏(freePos)，不参与猫形裁剪
    '  float clip = mix(step(uClipL, base.x) * step(base.x, uClipR), 1.0, aAmbient);',
    // 尘埃锚点：远景星空铺满屏幕[-1,1]；近景光斑铺到更大世界范围[-2.2,2.2]供变焦时从画外涌入
    '  vec2 anchorFar  = vec2(hash(vec2(aSeed, 1.7)) * 2.0 - 1.0, hash(vec2(aSeed, 3.1)) * 2.0 - 1.0);',
    '  vec2 anchorNear = anchorFar * 2.2;',
    // 电影镜头叙事（纯光学变焦）：猫恒处于猫形 base（光心固定、仅缩放）。尘埃分两层景深：
    //   远景(depth≈0)=无限远星空，几乎固定在屏幕上(始终密集铺满、不随变焦散开)，只随镜头极轻微缩放；
    //   近景(depth≈1)=空气中的大光斑，以猫镜头光心 uCamPivot 为锚按 S 投影——推近成大光斑推到画外、拉远从边缘涌入。
    '  float dDepth = hash(vec2(aSeed, 5.9));',
    '  float farK = 1.0 + 0.12 * (uCamScale - 1.0);',      // 远景星空对变焦的极轻微响应
    '  vec2 dBaseFar  = anchorFar * farK;',                 // 远景：绕画面中心、近于固定(满天星恒在)
    '  vec2 dBaseNear = uCamPivot + (anchorNear - uCamPivot) * uCamScale;', // 近景：绕猫镜头光心、随变焦涌入
    '  vec2 dBase = mix(dBaseFar, dBaseNear, dDepth);',
    '  float posK = mix(farK, uCamScale, dDepth);',         // 尺寸/漂浮随变焦的响应强度
    // 噪声流场驱动的无序漂浮（非单向、速度各异），作为空气运动温和叠加在世界投影位上
    '  float spd = 0.05 + aSeed * 0.14;',
    '  vec2 f1 = vec2(vnoise(anchorFar * 2.2 + vec2(uTime * spd, 0.0)), vnoise(anchorFar * 2.2 + vec2(0.0, uTime * spd)));',
    '  vec2 wander = (f1 - 0.5) * 1.6;',
    '  vec2 freePos = dBase + wander * 0.8;',
    // 尘埃走世界投影位(远景星空恒铺满/近景光斑随变焦涌入)；主体恒走猫形位(镜头缩放)，出画者由视口自然裁切
    '  vec2 pos = mix(base, freePos, aAmbient);',
    // 章节散射（vangogh模式滚动散开，绕原位）
    '  float r = hash(aPos * vec2(143.7, 211.3) + aSeed);',
    '  float ang = r * 6.2831853;',
    '  float rad = 0.6 + 1.8 * hash(aPos * vec2(97.3, 51.1) + aSeed);',
    '  vec2 scattered = pos + vec2(cos(ang), sin(ang)) * rad * (1.0 - aAmbient);',
    '  pos = mix(pos, scattered, uProgress);',
    // 微运动：尘埃持续无序漂浮(屏幕空间、幅度大)；主体的呼吸漂浮已在世界坐标施加(随镜头缩放)，此处不再叠加
    '  float mAmp = aAmbient * 0.10;',
    '  vec2 mN = vec2(vnoise(aPos * 5.0 + vec2(uTime * 0.12, aSeed * 9.0)),',
    '                 vnoise(aPos * 5.0 + vec2(aSeed * 5.0, uTime * 0.14)));',
    '  pos += (mN - 0.5) * 2.0 * mAmp;',
    // 鼠标斥力（vangogh模式；电影模式强度为0）
    '  vec2 delta = pos - uMouse;',
    '  float len = max(length(delta), 0.0001);',
    '  float fo = 1.0 - clamp(len / uMouseRadius, 0.0, 1.0);',
    '  vec2 push = (delta / len) * (fo * fo * uMouseStrength);',
    // 相机视差：鼠标移动=摄影机偏移，前景/近景粒子位移大(跟手强)，猫主体轻微跟随(更稳)
    '  float parK = mix(0.35, 1.5, aAmbient) * (0.55 + aSeed * 0.9);',
    '  vec2 par = uView * parK;',
    '  vec2 finalPos = pos + push + par;',
    '  vGlint = 0.0;',
    // 硬度：每颗粒子由种子决定 0~1（画面中有实有虚）；轮廓粒子偏硬以保持轮廓清晰；星点也偏实(星空锐利光点)
    '  float hRand = hash(vec2(aSeed * 7.31 + 3.7, aSeed * 2.13));',
    '  vHard = clamp(hRand + 0.20 + aEdge * 0.40, 0.0, 1.0);',
    // 粒子大小随变焦分两路：
    //   轮廓点严格随变焦线性放大(edgeZoom=uCamScale)——与边缘间距同步，任何焦段都和全身时一样连成“细而锐”的实线勾边（不粗成糊带、也不断开）；
    //   内部点 pow(S,0.55) 放大很慢——近景点远小于间距，留大量气隙呈通透点绘，白毛不叠成墙、五官可辨。
    '  float subjZoomIn = pow(uCamScale, 0.55);',
    '  float edgeZoom   = uCamScale;',
    '  float subjScale = mix(subjZoomIn, edgeZoom * 1.02, aEdge);',
    '  float dSizeK = mix(1.0, uCamScale, dDepth);',
    '  float baseSize = aSize * (aAmbient * 1.4 * dSizeK + (1.0 - aAmbient) * subjScale);',
    // 少数粒子低频变大（大颗粒数量少、频率低）；慢(0.18rad/s)无闪烁
    '  float bigGate = step(0.95, hash(vec2(aSeed, 3.3)));',
    '  float big = bigGate * (0.6 + 1.8 * (0.5 + 0.5 * sin(uTime * 0.18 + aSeed * 40.0))) * (aAmbient * 1.2 + (1.0 - aAmbient));',
    '  float size = baseSize + big;',
    // 轮廓粒子沿剪影边缘小范围平滑流动：居中缓慢噪声漂移(不抽搐、不单向)，有流动感
    '  vec2 eN = vec2(vnoise(aPos * 2.5 + vec2(uTime * 0.06, aSeed * 7.0)),',
    '                 vnoise(aPos * 2.5 + vec2(aSeed * 7.0, uTime * 0.06)));',
    '  vec2 eFlow = (eN - 0.5) * 2.0 * 0.022 * aEdge * (1.0 - aAmbient);',
    '  finalPos += eFlow;',
    // 变焦自适应细节：只在“强推近”时才对主体内部粒子轻微抽稀（脸部特写取景框已对准猫脸、需要保留五官密度，
    //   故抽稀阈值上移到 S>2、且更温和）；轮廓(aEdge)严格线性放大保持细锐实线不抽稀；尘埃(aAmbient)不抽稀。
    //   拉远(S→1)时 zAmt→0，全部粒子恢复饱满，全身猫完整。
    '  float zAmt = smoothstep(2.0, 4.5, uCamScale);',
    '  float interior = (1.0 - aEdge) * (1.0 - aAmbient);',
    '  float thinGate = step(hash(vec2(aSeed * 13.7 + 1.1, aSeed * 7.7)), 0.50);',
    '  float thin = zAmt * interior * thinGate;',
    '  float detailKeep = 1.0 - thin * 0.70;',
    '  gl_Position = vec4(finalPos, 0.0, 1.0);',
    '  gl_PointSize = size * uPointSize * clip * detailKeep;',
    // 透明度：恒为粒子本色；轮廓粒子提亮(勾边更明显)；被抽稀的内部粒子同步淡出；出画部分由视口几何裁切（真实镜头硬边缘）
    '  float edgeGlow = mix(1.0, 1.45, aEdge * (1.0 - aAmbient));',
    '  vAlpha = aAlpha * uAlphaScale * clip * edgeGlow * detailKeep;',
    '}'
  ].join('\n');

  var FSH = [
    'precision mediump float;',
    'uniform vec3 uColor;',
    'varying float vAlpha;',
    'varying float vGlint;',
    'varying float vHard;',
    'void main(){',
    // 粒子有实有虚：vHard≈0 柔羽化(虚)、vHard≈1 锐利实心(实)。inner 越小越柔、越大越实。
    '  vec2 c = gl_PointCoord - vec2(0.5);',
    '  float d = length(c);',
    '  float inner = mix(0.06, 0.42, vHard);',
    '  float a = smoothstep(0.5, inner, d) * min(1.0, vAlpha + vGlint * 0.35);',
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
    aAmbient: gl.getAttribLocation(prog, 'aAmbient'),
    aEdge: gl.getAttribLocation(prog, 'aEdge')
  };
  var U = {};
  ['uTime', 'uProgress', 'uFocus', 'uSweep', 'uCamScale', 'uCamPivot',
   'uKX', 'uKY', 'uOff', 'uPointSize', 'uMouseRadius',
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
  var viewA = { x: 0, y: 0 };                // 视差第一级缓冲（延迟惯性）
  var progress = 0, targetProgress = 0;
  var time = 0;

  /* 页面配置：/vangogh/ 用默认（双章节），/cat/ 通过 window.VANGOGH_CONFIG 覆盖 */
  var CFG = window.VANGOGH_CONFIG || {};
  var SINGLE = !!CFG.single;                 // 单章节页面（猫）
  var CINEMATIC = !!CFG.cinematic;           // 电影模式（原网页图1→4：尘埃→聚合）
  var EDGE_NDC = CFG.edge != null ? CFG.edge : 0.24; // 渐变中心 NDC x
  var BG_SOFT = CFG.soft != null ? CFG.soft : (CINEMATIC ? 0.85 : 0.22); // 渐变柔和度（越大越无分界线）

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

  /* ---------------- 等比映射系数（不拉伸） ----------------
     NDC 下 x 与 y 量纲不同：屏幕宽高比 va=W/H。
     uv→NDC 后 x 方向跨度是 y 的 va 倍，故 contain 时需按 va 归一化，
     否则横/竖图都会被压变形。zoom>1 放大主体。 */
  function fitK(ia, va, fit, zoom) {
    zoom = zoom || 1;
    // 约束 kx/ky = ia/va（保证等比不变形）；contain 完整放入、cover 铺满裁剪
    var kx, ky;
    if (fit === 'cover') {
      kx = Math.max(1, ia / va);
      ky = Math.max(1, va / ia);
    } else {
      kx = Math.min(1, ia / va);
      ky = Math.min(1, va / ia);
    }
    return { kx: kx * zoom, ky: ky * zoom };
  }

  function applyFits() {
    var va = W / H;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (!L.aspect) continue;
      var k = fitK(L.aspect, va, L.fit, L.zoom);
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
    var alpha = new Float32Array(sw * sh);   // 剪影：1=不透明(猫身) 0=透明(抠图背景)
    var p, i;
    for (i = 0, p = 0; i < data.length; i += 4, p++) {
      alpha[p] = data[i + 3] < 128 ? 0 : 1;
      // 透明像素视为白色背景（避免 ghost 身体掩膜/暗部采样把抠图区域算进去）
      luma[p] = data[i + 3] < 128 ? 255 : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    // 局部纹理 = 与模糊基线的差（五官/胡须/衣纹/版画笔触）
    var base = boxBlur(luma, sw, sh, 3);
    // 大模糊基线：幽灵轮廓（ghost）与脸部重心用
    var baseBig = boxBlur(luma, sw, sh, 12);

    // 脸部重心：上半身高纹理不透明像素的加权质心（脸=细节最集中处，用于特写取景）
    var fxw = 0, fyw = 0, fw = 0;
    for (y = 0; y < sh; y++) {
      for (x = 0; x < sw; x++) {
        p = y * sw + x;
        if (data[p * 4 + 3] < 128) continue;
        if (y > sh * 0.62) continue; // 只看上半身
        var t = Math.min(1, Math.abs(luma[p] - base[p]) / 40) + (1 - luma[p] / 255) * 0.4;
        fxw += x * t; fyw += y * t; fw += t;
      }
    }
    if (fw > 0) layer.face = [fxw / fw / sw, fyw / fw / sh];

    // 头部重心：仅取最上方 30% 的不透明像素（猫脸所在），用于电影镜头开场先聚焦脸部
    var hxw = 0, hyw = 0, hw = 0;
    for (y = 0; y < sh; y++) {
      for (x = 0; x < sw; x++) {
        p = y * sw + x;
        if (data[p * 4 + 3] < 128) continue;
        if (y > sh * 0.30) continue;
        var ht = Math.min(1, Math.abs(luma[p] - base[p]) / 40) + (1 - luma[p] / 255) * 0.4;
        hxw += x * ht; hyw += y * ht; hw += ht;
      }
    }
    if (hw > 0) layer.head = [hxw / hw / sw, hyw / hw / sh];

    // 剪影边缘：抠图轮廓（透明/不透明交界处），用于 ghost 沿边缘勾勒 + 轮廓粒子流动
    var edgeMask = new Float32Array(sw * sh);
    for (var ey = 1; ey < sh - 1; ey++) {
      for (var ex = 1; ex < sw - 1; ex++) {
        var ep = ey * sw + ex;
        if (alpha[ep] < 0.5) continue;
        var nb = alpha[ep - 1] + alpha[ep + 1] + alpha[ep - sw] + alpha[ep + sw];
        if (nb < 3.5) edgeMask[ep] = 1;   // 四邻有透明像素 => 剪影边缘
      }
    }

    var arr = []; // x, y, size, alpha, seed, ambient, edge
    for (var y = 0; y < sh; y++) {
      for (var x = 0; x < sw; x++) {
        p = y * sw + x;
        // 透明底PNG：alpha<128 不生成粒子（抠图区域干净）
        if (data[p * 4 + 3] < 128) continue;
        var gray = luma[p];
        var tex = Math.min(1, Math.abs(gray - base[p]) / 45);
        var isEdge = edgeMask[p];          // 剪影轮廓（所有层通用）：近景特写时清晰勾勒外形
        var w = 0, sz, al, edgeFlag = isEdge ? 1 : 0;
        if (layer.mode === 'ghost') {
          // 幽灵轮廓：身体=极稀疏、大粒、很淡的虚影(仅托体积、不抢轮廓)；剪影边缘=小而密、极亮极实的清晰描边
          //   （近景放大后轮廓线依然锐利醒目，黑/白两层分别在亮底/暗底上形成高对比勾边）
          var body = Math.max(0, 1 - baseBig[p] / 200);
          if (body < 0.10 && !isEdge) continue;
          w = body * 0.30 + isEdge * 1.0;
          if (isEdge) {
            sz = 0.8 + Math.random() * 0.9;              // 轮廓：小实点，勾出锐利线
            al = 0.78 + Math.random() * 0.22;            // 轮廓：极亮极实（白层纯白、黑层纯黑）
          } else {
            sz = 2.6 + Math.random() * 3.0;              // 身体虚影：更大更软更淡
            al = 0.035 + body * 0.07;
          }
        } else if (layer.mode === 'dark') {
          // 黑粒子（白底上）：越暗越密，纹理处更实；尺寸方差大（组成猫的粒子有大有小）
          var darkness = (150 - gray) / 150;
          if (darkness <= 0.02) continue;
          w = darkness * (0.45 + 0.55 * tex);
          sz = (0.6 + w * 1.7 + Math.random() * 0.5) * (0.7 + Math.random() * 1.0); al = 0.4 + w * 0.6;
        } else if (layer.mode === 'light') {
          // 白粒子（黑底上）：亮部×纹理；均匀浅底(背景)纹理≈0被剔除
          if (tex < 0.10) continue;
          w = (gray / 255) * (0.25 + 0.75 * tex);
          sz = (0.6 + w * 1.7 + Math.random() * 0.5) * (0.7 + Math.random() * 1.0); al = 0.4 + w * 0.6;
        } else if (layer.mode === 'lightCat') {
          // 白粒子（黑底上，深色猫）：只在亮毛/强毛发纹理处落子；眼鼻等暗部(低灰度)与平面区域自然稀疏留空——
          //   五官靠"亮毛密、五官暗部稀"的点绘疏密关系呈现，近景放大也不糊
          if (tex < 0.12) continue;
          var texK = Math.min(1, (tex - 0.12) / 0.45);   // 纹理越强越密
          var lw = (gray / 255) * 0.75 + 0.10;           // 亮毛密、暗部(眼鼻)极稀
          w = lw * (0.15 + 0.85 * texK);
          sz = (0.5 + w * 1.3 + Math.random() * 0.45) * (0.75 + Math.random() * 0.9); al = 0.5 + w * 0.5;
        } else if (layer.mode === 'lightFlat') {
          // 白粒子（蒙版白区，版画亮部整块）
          if (gray <= 128) continue;
          w = 0.9;
          sz = 0.6 + w * 1.7 + Math.random() * 0.5; al = 0.4 + w * 0.6;
        } else {
          if (gray <= 128) continue;
          w = 1;
          sz = 0.6 + w * 1.7 + Math.random() * 0.5; al = 0.4 + w * 0.6;
        }
        // 主体毛发层的剪影轮廓：更密、更亮、点更锐（近景特写时外形清晰可辨，不只是粒子数量多）
        if (isEdge && layer.mode !== 'ghost' && layer.mode !== 'lightFlat') {
          w = Math.min(1, w + 0.55);
          al = Math.min(1, al + 0.25);
          sz = sz * 0.78 + 0.42;
        }
        // 密度分级
        if (Math.random() > w) continue;
        arr.push(
          (x + 0.5) / sw, (y + 0.5) / sh,
          sz, al,
          Math.random(),
          0,                                     // ambient=0（主体粒子）
          edgeFlag                               // edge=1 剪影轮廓粒子（沿边缘流动）
        );
      }
    }

    var n = arr.length / 7;
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
    while (arr.length / 7 < layer.dust) {
      var x = Math.random();
      // 右侧密度偏置：越靠右保留概率越高（左~45% → 右~100%），画面右侧更密集
      if (Math.random() > 0.45 + 0.55 * x) continue;
      // 星空式星等分层：大量细密亮点(针尖星点) + 少数中等星 + 极少数醒目大星斑；透明度也分层(有虚有实)，大小对比强、疏密有致
      var r = Math.random(), sz, al;
      if (r < 0.70) {                        // 细密星点（最密、针尖亮点）
        sz = 0.28 + Math.random() * 0.85;
        al = 0.30 + Math.random() * 0.50;
      } else if (r < 0.92) {                 // 中等星点
        sz = 1.4 + Math.random() * 2.0;
        al = 0.30 + Math.random() * 0.45;
      } else {                               // 大星斑（少而醒目，虚实皆有）
        sz = 3.8 + Math.random() * 6.5;
        al = 0.32 + Math.random() * 0.48;
      }
      arr.push(
        x, Math.random(),                        // 全屏随机位置（右侧偏密）
        sz,                                      // 星等分层：小星点 / 中星 / 大星斑
        al,                                      // 透明度分层：有虚有实
        Math.random(),
        1,                                       // ambient=1（永不聚合）
        0                                        // edge=0
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
  function drawBg(contrast, edge) {
    gl.useProgram(bgProg);
    gl.uniform1f(BG.uContrast, contrast);
    gl.uniform1f(BG.uEdge, edge);
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
    gl.vertexAttribPointer(LOC.aPos, 2, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(LOC.aSize);
    gl.vertexAttribPointer(LOC.aSize, 1, gl.FLOAT, false, 28, 8);
    gl.enableVertexAttribArray(LOC.aAlpha);
    gl.vertexAttribPointer(LOC.aAlpha, 1, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(LOC.aSeed);
    gl.vertexAttribPointer(LOC.aSeed, 1, gl.FLOAT, false, 28, 16);
    gl.enableVertexAttribArray(LOC.aAmbient);
    gl.vertexAttribPointer(LOC.aAmbient, 1, gl.FLOAT, false, 28, 20);
    gl.enableVertexAttribArray(LOC.aEdge);
    gl.vertexAttribPointer(LOC.aEdge, 1, gl.FLOAT, false, 28, 24);

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

  // 电影镜头状态（纯光学变焦）：camScale=视野缩放倍数（>1 推近，1 全身）；camPivot=变焦光心(NDC)
  var camState = { scale: 1, pivot: [-0.55, 0.0] };

  // 猫脸(头部中心)在世界坐标(NDC)中的高度：从已采样图层的头部重心 + contain 系数算出
  // （电影镜头开场把光心反解为使该点落到屏幕 faceScreen 位置，形成真正的“脸部特写”）
  function faceWorldY() {
    if (CFG.faceWorldY != null) return CFG.faceWorldY;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (L.dust || !L.ky) continue;
      var hd = L.head || L.face;                 // 头部重心 [u,v]；无头部数据时退回脸部重心
      if (hd) return (0.5 - hd[1]) * 2 * L.ky;   // 头部中心的世界 y
    }
    return 0.6;                                  // 图片未加载完时的兜底值
  }

  // 猫脸(头部中心)在世界坐标(NDC)中的水平位置（头部重心 u + ox 偏移，再按 contain 归一）
  function faceWorldX() {
    if (CFG.faceWorldX != null) return CFG.faceWorldX;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (L.dust || !L.kx) continue;
      var hd = L.head || L.face;
      if (hd) return ((hd[0] - 0.5) * 2 * L.kx + (L.ox || 0));
    }
    return 0.0;
  }

  function frame(dt) {
    time += dt;

    progress += (targetProgress - progress) * 0.08;
    mouse.strength += (mouse.target - mouse.strength) * 0.15;

    var p = progress;
    var w1, w2, scatter1, scatter2, focus, contrast, edge;
    if (CINEMATIC) {
      // 电影叙事（纯光学变焦，光心全程固定不动）：只有取景框以固定光心为锚随 uCamScale 缩小而扩大，
      //   内容本身不移动。光心设在画面左侧偏上(水平 -0.55 使猫从右边缘入镜、垂直取猫脸上方高度)，
      //   故推近时猫在右画外、取景框只够到猫脸高度；拉远时取景框连续扩大，猫脸先从右边缘进入屏幕
      //   垂直中部(脸部特写)，继续拉远颈部/身体再单调连续入镜，最后 scale=1 完整居中全身。
      //   光心不动 ⇒ 无任何平移/上下反复，过渡丝滑，符合电影镜头语言。
      w1 = 1; w2 = 0;
      scatter1 = 0; scatter2 = 0;
      var t = smoothstep(0.03, 0.97, p);
      var S0 = (CFG.faceZoom != null) ? CFG.faceZoom : (CFG.camScaleStart || 2.6);  // 开场特写倍数
      camState.scale = 1.0 + (S0 - 1.0) * (1.0 - t);     // S0(推近脸特写) → 1(全身取景)
      // 纯光学变焦、光心全程固定：屏幕 = S·世界 + pivot·(1−S)。
      //   按“开场(S=S0)时把猫脸世界点(wx,wy)对准屏幕 faceScreen(sx,sy)”反解固定光心：
      //   pivot = (s − S0·world)/(1−S0)。这样近景真正框住猫脸（眼/鼻/耳在画内，跨明暗分界两侧可见），
      //   随滚轮拉远取景框以该光心连续扩大，身体单调入镜，结尾 S=1 时光心失效、猫完整居中全身。
      var fs = CFG.faceScreen || [0.2, 0.05];
      var wx = faceWorldX(), wy = faceWorldY();
      var denom = 1.0 - S0;
      var pivotX = (CFG.camPivotX != null) ? CFG.camPivotX : (fs[0] - S0 * wx) / denom;
      var pivotY = (CFG.camPivotY != null) ? CFG.camPivotY : (fs[1] - S0 * wy) / denom;
      camState.pivot = [pivotX, pivotY];
      focus = 1;                                          // 猫恒存在，出画部分由取景框几何裁切
      contrast = smoothstep(0.02, 0.40, p);              // 背景渐变渐显
      // 渐变过渡带：开场对齐猫脸目标 x(特写时明暗分界正好擦过猫脸)，随滚动移到画面中间
      var edge0 = (CFG.edgeStart != null) ? CFG.edgeStart : fs[0] + 0.42;
      edge = edge0 * (1 - t) + EDGE_NDC * t;
    } else if (SINGLE) {
      w1 = 1; w2 = 0;
      scatter1 = smoothstep(0.55, 0.95, p);
      scatter2 = 0;
      focus = 1; contrast = 1; edge = EDGE_NDC;
      camState.scale = 1; camState.pivot = [0, 0];
    } else {
      w1 = 1 - smoothstep(0.40, 0.52, p);
      w2 = smoothstep(0.46, 0.58, p);
      scatter1 = smoothstep(0.06, 0.42, p);
      scatter2 = smoothstep(0.60, 0.95, p);
      focus = 1; contrast = 1; edge = EDGE_NDC;
      camState.scale = 1; camState.pivot = [0, 0];
    }

    // 相机视差：电影模式下鼠标移动=摄影机偏移（画面随鼠标同向轻移）
    //   幅度更大、双级平滑(目标→缓冲→镜头)产生明显的延迟惯性/拖尾感，像手持摄影机缓缓跟上。
    var vx = 0, vy = 0;
    if (CINEMATIC && mouse.target > 0) { vx = mouse.x * 0.12; vy = mouse.y * 0.09; }
    viewA.x += (vx - viewA.x) * 0.055;   // 第一级：目标点先缓慢逼近
    viewA.y += (vy - viewA.y) * 0.055;
    view.x += (viewA.x - view.x) * 0.06; // 第二级：镜头再带惯性追上（拖尾）
    view.y += (viewA.y - view.y) * 0.06;

    drawBg(contrast, edge);

    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uFocus, focus);
    gl.uniform1f(U.uSweep, 0);
    gl.uniform2f(U.uMouse, mouse.x, mouse.y);
    gl.uniform2f(U.uView, view.x, view.y);
    gl.uniform1f(U.uMouseRadius, 0.16);
    // 电影模式：鼠标只控制视角，无斥力；vangogh模式：小半径轻柔斥力
    gl.uniform1f(U.uMouseStrength, CINEMATIC ? 0 : mouse.strength * 0.06);
    // 电影镜头（纯光学变焦）：缩放倍数与固定光心
    gl.uniform1f(U.uCamScale, camState.scale);
    gl.uniform2f(U.uCamPivot, camState.pivot[0], camState.pivot[1]);

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
