/* ===========================================
   致敬梵高 Elimar — 粒子聚影
   参考 elimar.lmigroupintl.com
   核心效果：
     1. 黑白对半，分界线为烟雾/墨迹状柔和曲线，跟随鼠标
     2. 满屏胶片噪点粒子（白区黑点 / 黑区白点）
     3. 梵高侧面剪影由数千粒子聚集而成，骑在分界线上
     4. 鼠标移动 => 分界线流转 + 粒子被光扰动散开
   纯 Canvas 程序化绘制，零图片依赖。
   =========================================== */
(function() {
  'use strict';

  if (window.__vangoghInited) return;
  window.__vangoghInited = true;

  const WORDS = ['Elimar', 'regret', 'darkness', 'redemption', 'van Gogh'];

  const canvas = document.getElementById('vangogh-canvas');
  const titleEl = document.getElementById('vg-title');
  const wordEl = document.getElementById('vg-word');
  const wordTextEl = document.getElementById('vg-word-text');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, DPR = 1;

  // 鼠标状态（归一化 -1~1）
  const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
  let hasMoved = false;
  let started = false;

  // 分界线参数
  let divideX = 0;        // 当前分界中心x（画布像素）
  let divideTX = 0;       // 目标分界中心x
  let introT = 1;         // 开场墨迹圆状态：1=中心黑圆开场，0=黑白对半
  let introDone = false;

  // 粒子集合
  let figureParticles = [];  // 人物粒子
  let dustParticles = [];    // 背景噪点粒子

  // 离屏：剪影形状
  let silhouetteCanvas = document.createElement('canvas');
  let silhouetteCtx = silhouetteCanvas.getContext('2d');

  /* ---------- 1. 梵高侧面剪影路径（面朝左，归一化坐标） ---------- */
  function traceSilhouette(c, w, h) {
    c.beginPath();
    // 起点：后脑下方/背部
    c.moveTo(w * 0.98, h * 1.02);
    // 背部向上
    c.bezierCurveTo(w * 0.96, h * 0.82, w * 1.02, h * 0.70, w * 0.90, h * 0.60);
    // 颈后
    c.bezierCurveTo(w * 0.95, h * 0.52, w * 0.97, h * 0.46, w * 0.93, h * 0.38);
    // 后脑
    c.bezierCurveTo(w * 1.00, h * 0.30, w * 0.96, h * 0.16, w * 0.82, h * 0.10);
    // 头顶
    c.bezierCurveTo(w * 0.70, h * 0.04, w * 0.52, h * 0.05, w * 0.44, h * 0.14);
    // 额头
    c.bezierCurveTo(w * 0.36, h * 0.22, w * 0.32, h * 0.28, w * 0.30, h * 0.34);
    // 鼻梁
    c.bezierCurveTo(w * 0.24, h * 0.36, w * 0.18, h * 0.38, w * 0.14, h * 0.42);
    // 鼻尖
    c.bezierCurveTo(w * 0.11, h * 0.44, w * 0.13, h * 0.47, w * 0.18, h * 0.47);
    // 上唇 / 嘴
    c.bezierCurveTo(w * 0.22, h * 0.50, w * 0.24, h * 0.52, w * 0.23, h * 0.54);
    // 下唇 / 下巴
    c.bezierCurveTo(w * 0.22, h * 0.57, w * 0.26, h * 0.60, w * 0.30, h * 0.60);
    // 下巴到喉咙
    c.bezierCurveTo(w * 0.34, h * 0.60, w * 0.34, h * 0.66, w * 0.38, h * 0.70);
    // 胸前
    c.bezierCurveTo(w * 0.34, h * 0.80, w * 0.30, h * 0.92, w * 0.32, h * 1.02);
    c.closePath();
  }

  /* ---------- 2. 尺寸 & 初始化 ---------- */
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    divideX = divideTX = W * 0.5;

    buildSilhouette();
    buildParticles();
  }

  function buildSilhouette() {
    // 人物占据画面中右侧区域
    const figW = Math.min(W * 0.42, H * 0.62);
    const figH = figW * 1.25;
    const ox = W * 0.62 - figW * 0.5;
    const oy = H * 0.52 - figH * 0.5;

    silhouetteCanvas.width = W * DPR;
    silhouetteCanvas.height = H * DPR;
    silhouetteCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    silhouetteCtx.clearRect(0, 0, W, H);
    silhouetteCtx.save();
    silhouetteCtx.translate(ox, oy);
    traceSilhouette(silhouetteCtx, figW, figH);
    silhouetteCtx.fillStyle = '#000';
    silhouetteCtx.fill();
    silhouetteCtx.restore();
  }

  /* ---------- 3. 粒子生成 ---------- */
  function buildParticles() {
    figureParticles = [];
    dustParticles = [];

    // 3.1 从剪影采样人物粒子
    const img = silhouetteCtx.getImageData(0, 0, silhouetteCanvas.width, silhouetteCanvas.height);
    const data = img.data;
    const gap = Math.max(3, Math.round(W / 260)); // 采样间距
    for (let y = 0; y < H; y += gap) {
      for (let x = 0; x < W; x += gap) {
        const idx = (Math.round(y * DPR) * silhouetteCanvas.width + Math.round(x * DPR)) * 4 + 3;
        if (data[idx] > 128) {
          figureParticles.push({
            bx: x + (Math.random() - 0.5) * gap,
            by: y + (Math.random() - 0.5) * gap,
            x: x, y: y,
            size: 0.6 + Math.random() * 1.4,
            // 边缘粒子更易飘散：记录到形状边界距离近似（用随机亮度）
            drift: Math.random()
          });
        }
      }
    }

    // 3.2 背景噪点粒子（全屏，密度随屏幕大小）
    const dustCount = Math.round((W * H) / 2600);
    for (let i = 0; i < dustCount; i++) {
      dustParticles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        size: Math.random() < 0.92 ? (0.4 + Math.random() * 1.0) : (1.6 + Math.random() * 1.8),
        tw: Math.random() * Math.PI * 2,      // 闪烁相位
        twSpeed: 0.5 + Math.random() * 1.5
      });
    }
  }

  /* ---------- 4. 黑色墨气场（开场墨迹圆 -> 黑白对半） ---------- */
  // 每帧更新一次的场参数
  const field = { t: 1, r: 0, cx: 0, cy: 0, amp: 0 };

  function updateField(time) {
    // t: 0=开场中心墨迹圆, 1=黑白对半
    field.t = 1 - introT;
    const t = field.t;
    const r0 = Math.min(W * 0.33, H * 0.46);
    const rBig = (W + H) * 1.2;
    field.r = r0 + (rBig - r0) * t;
    field.cx = W / 2 + (divideX + rBig - W / 2) * t;
    field.cy = H / 2;
    // 边缘扰动幅度：墨迹圆时较大，对半时为竖屏烟雾波
    field.amp = (r0 * 0.10) * (1 - t) + (W * 0.05) * t;
  }

  // 沿角度的边缘噪声（墨迹不规则 / 烟雾波动）
  function edgeNoise(theta, time) {
    return (
      Math.sin(theta * 5.0 + time * 0.0008) +
      Math.sin(theta * 9.0 - time * 0.0011) * 0.6 +
      Math.sin(theta * 2.0 + 2.0) * 0.8
    ) * field.amp * 0.45;
  }

  function drawField(time) {
    // 白色底
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // 黑色区域：圆心(field.cx, field.cy)、半径 field.r 的墨迹圆
    ctx.save();
    ctx.beginPath();
    const segs = 160;
    for (let i = 0; i <= segs; i++) {
      const theta = (i / segs) * Math.PI * 2;
      const rr = field.r + edgeNoise(theta, time);
      const x = field.cx + Math.cos(theta) * rr;
      const y = field.cy + Math.sin(theta) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = field.t > 0.5 ? 30 : 46;
    ctx.fillStyle = '#000000';
    ctx.fill();
    ctx.fill(); // 双层柔化墨迹边缘
    ctx.restore();
  }

  /* ---------- 5. 判断点在黑区还是白区 ---------- */
  function isDark(x, y, time) {
    const dx = x - field.cx;
    const dy = y - field.cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > field.r + field.amp) return false;
    if (d < field.r - field.amp) return true;
    const theta = Math.atan2(dy, dx);
    return d < field.r + edgeNoise(theta, time);
  }

  /* ---------- 6. 粒子更新与绘制 ---------- */
  function updateAndDraw(time) {
    const mx = mouse.x * W;
    const my = mouse.y * H;
    const interactR = Math.min(W, H) * 0.16;

    // 6.1 背景噪点
    for (let i = 0; i < dustParticles.length; i++) {
      const p = dustParticles[i];
      p.tw += 0.02 * p.twSpeed;
      const flicker = 0.55 + 0.45 * Math.sin(p.tw);
      const dark = isDark(p.x, p.y, time);
      // 白区黑点，黑区白点
      ctx.fillStyle = dark
        ? 'rgba(255,255,255,' + (0.35 + flicker * 0.55) + ')'
        : 'rgba(0,0,0,' + (0.25 + flicker * 0.5) + ')';
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }

    // 6.2 人物粒子
    for (let i = 0; i < figureParticles.length; i++) {
      const p = figureParticles[i];

      // 鼠标扰动：靠近鼠标的粒子被推开（光的斥力）
      let dx = p.bx - mx;
      let dy = p.by - my;
      let dist = Math.sqrt(dx * dx + dy * dy);
      let ox = 0, oy = 0;
      if (dist < interactR && dist > 0.01) {
        const force = (1 - dist / interactR);
        const push = force * force * 42 * (0.4 + p.drift);
        ox = (dx / dist) * push;
        oy = (dy / dist) * push - force * 12 * p.drift; // 略微上扬
      }

      // 轻微呼吸抖动
      const breathe = Math.sin(time * 0.002 + p.bx * 0.02 + p.by * 0.02) * 0.6;

      p.x = p.bx + ox + breathe;
      p.y = p.by + oy;

      const dark = isDark(p.x, p.y, time);
      // 人物粒子：黑区白粒子、白区黑粒子（与背景反色 => 聚影效果）
      const alpha = 0.75 + p.drift * 0.25;
      ctx.fillStyle = dark
        ? 'rgba(255,255,255,' + alpha + ')'
        : 'rgba(0,0,0,' + (alpha * 0.85) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---------- 7. 主循环 ---------- */
  function loop(time) {
    // 平滑鼠标
    mouse.x += (mouse.tx - mouse.x) * 0.06;
    mouse.y += (mouse.ty - mouse.y) * 0.06;
    divideTX = mouse.x * W;
    divideX += (divideTX - divideX) * 0.045;

    // 开场墨迹圆 -> 黑白对半 过渡
    if (started && introT > 0) {
      introT = Math.max(0, introT - 0.012);
    }

    updateField(time);
    drawField(time);

    // 开场只画噪点；过渡后出现人物粒子
    if (introT < 0.6) {
      updateAndDraw(time);
    } else {
      drawDustOnly(time);
    }

    requestAnimationFrame(loop);
  }

  function drawDustOnly(time) {
    for (let i = 0; i < dustParticles.length; i++) {
      const p = dustParticles[i];
      p.tw += 0.02 * p.twSpeed;
      const flicker = 0.55 + 0.45 * Math.sin(p.tw);
      const dark = isDark(p.x, p.y, time);
      ctx.fillStyle = dark
        ? 'rgba(255,255,255,' + (0.35 + flicker * 0.55) + ')'
        : 'rgba(0,0,0,' + (0.25 + flicker * 0.5) + ')';
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
  }

  /* ---------- 8. 交互 ---------- */
  function onMove(cx, cy) {
    mouse.tx = cx / W;
    mouse.ty = cy / H;
    if (!hasMoved) {
      hasMoved = true;
      if (!started) {
        started = true;
        // 首次互动：标题淡出，单词渐入
        if (titleEl) titleEl.classList.add('is-hidden');
        cycleWords();
      }
    }
  }

  window.addEventListener('mousemove', function(e) {
    onMove(e.clientX, e.clientY);
  });
  window.addEventListener('touchmove', function(e) {
    if (e.touches && e.touches[0]) {
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });

  // 单词循环
  let wordIdx = 0;
  function cycleWords() {
    if (!wordEl || !wordTextEl) return;
    function showNext() {
      wordEl.classList.remove('is-visible');
      setTimeout(function() {
        wordIdx = (wordIdx + 1) % WORDS.length;
        wordTextEl.textContent = WORDS[wordIdx];
        wordEl.classList.add('is-visible');
        setTimeout(showNext, 3200);
      }, 900);
    }
    setTimeout(showNext, 1600);
  }

  /* ---------- 9. 启动 ---------- */
  function init() {
    resize();
    requestAnimationFrame(loop);
  }

  let resizeTimer;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(init, 200);
  });

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 60);
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(init, 60);
    });
  }
})();
