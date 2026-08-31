/* ===========================================
   致敬梵高 Elimar — 粒子聚影（真实肖像采样版）
   参考 elimar.lmigroupintl.com Chapter 01
   人物粒子采样自原站英雄图 background-1（公有领域历史肖像）：
     小画布降采样 -> 高斯基线高频提取（点/五官/胡须/明暗）
     -> 按真实照片分布生成数千粒子
   粒子颜色由鼠标黑白墨气场实时决定，保留互动。
   =========================================== */
(function() {
  'use strict';

  if (window.__vangoghInited) return;
  window.__vangoghInited = true;

  const FIGURE_IMG = '/img/vangogh/young-vincent.png';
  const WORDS = ['Elimar', 'regret', 'darkness', 'redemption', 'van Gogh'];
  const GAP = 3.5;          // 采样间距（css像素），越小越精细
  const DOT_THRESHOLD = 30; // 高频提取阈值
  const BLUR_RADIUS = 4;    // 基线模糊半径（网格格数）

  const canvas = document.getElementById('vangogh-canvas');
  const titleEl = document.getElementById('vg-title');
  const wordEl = document.getElementById('vg-word');
  const wordTextEl = document.getElementById('vg-word-text');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, DPR = 1;

  const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
  let hasMoved = false, started = false;

  let divideX = 0, divideTX = 0;
  let introT = 1;

  let figureParticles = [];
  let dustParticles = [];
  let figureReady = false;

  const field = { t: 1, r: 0, cx: 0, cy: 0, amp: 0 };

  /* ---------- 1. 尺寸 ---------- */
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
    buildDust();
  }

  /* ---------- 2. 背景噪点 ---------- */
  function buildDust() {
    dustParticles = [];
    const n = Math.round((W * H) / 3200);
    for (let i = 0; i < n; i++) {
      dustParticles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        size: Math.random() < 0.92 ? (0.4 + Math.random() * 1.0) : (1.6 + Math.random() * 1.8),
        tw: Math.random() * Math.PI * 2,
        twSpeed: 0.5 + Math.random() * 1.5
      });
    }
  }

  /* ---------- 3. 从真实肖像图采样人物粒子 ---------- */
  function buildFigureFromImage() {
    figureReady = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      try {
        sampleImageToParticles(img);
        figureReady = true;
      } catch (e) { /* 采样失败则保留空白，不报错 */ }
    };
    img.onerror = function() { /* 图片缺失时静默降级为纯噪点 */ };
    img.src = FIGURE_IMG;
  }

  function sampleImageToParticles(img) {
    const SW = Math.max(2, Math.round(W / GAP));
    const SH = Math.max(2, Math.round(H / GAP));

    const sc = document.createElement('canvas');
    sc.width = SW; sc.height = SH;
    const sctx = sc.getContext('2d', { willReadFrequently: true });

    // contain 方式完整放入肖像：高度铺满，水平定位在画面中右（骑分界线构图）
    const targetH = SH * 0.94;
    const dh = targetH;
    const dw = dh * (img.width / img.height);
    const cx = SW * 0.66;           // 人物中心 x（中右，骑分界线）
    const cy = SH * 0.54;           // 人物中心 y（略偏下，留出标题）
    const dx = cx - dw / 2;
    const dy = cy - dh / 2;
    sctx.fillStyle = '#ffffff';
    sctx.fillRect(0, 0, SW, SH);
    sctx.drawImage(img, dx, dy, dw, dh);

    const data = sctx.getImageData(0, 0, SW, SH).data;
    const luma = new Float32Array(SW * SH);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      luma[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    // 盒式模糊基线（前缀积分，分离式两次）
    const base = boxBlur(luma, SW, SH, BLUR_RADIUS);

    figureParticles = [];
    for (let cy = 0; cy < SH; cy++) {
      for (let cx = 0; cx < SW; cx++) {
        const p = cy * SW + cx;
        const L = luma[p];
        const diff = Math.abs(L - base[p]);
        const px = (cx + 0.5) / SW * W;
        const py = (cy + 0.5) / SH * H;

        if (diff > DOT_THRESHOLD) {
          // 高频细节点：五官 / 胡须 / 纹理 / 轮廓边缘 —— 大而清晰
          const strength = Math.min(1, diff / 160);
          if (Math.random() > 0.25 + strength * 0.7) continue;
          figureParticles.push({
            bx: px, by: py, x: px, y: py,
            size: 1.0 + Math.random() * (1.0 + strength * 1.6),
            drift: Math.random(),
            sh: 0.6 + strength * 0.4
          });
        } else if (L < 82) {
          // 暗部密铺点：头发 / 西装 / 身体阴影 —— 小而密，形成实底剪影
          const darkness = (82 - L) / 82;              // 越暗概率越高
          if (Math.random() < darkness * 0.38) {
            figureParticles.push({
              bx: px, by: py, x: px, y: py,
              size: 0.55 + Math.random() * 0.8,
              drift: Math.random(),
              sh: 0.35 + darkness * 0.4
            });
          }
        }
      }
    }
  }

  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const win = r * 2 + 1;
    // 横向
    for (let y = 0; y < h; y++) {
      let sum = 0;
      const row = y * w;
      for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / win;
        const x1 = Math.min(w - 1, x + r + 1);
        const x0 = Math.max(0, x - r);
        sum += src[row + x1] - src[row + x0];
      }
    }
    // 纵向
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / win;
        const y1 = Math.min(h - 1, y + r + 1);
        const y0 = Math.max(0, y - r);
        sum += tmp[y1 * w + x] - tmp[y0 * w + x];
      }
    }
    return out;
  }

  /* ---------- 4. 墨气场 ---------- */
  function updateField(time) {
    field.t = 1 - introT;
    const t = field.t;
    const r0 = Math.min(W * 0.33, H * 0.46);
    const rBig = (W + H) * 1.2;
    field.r = r0 + (rBig - r0) * t;
    field.cx = W / 2 + (divideX + rBig - W / 2) * t;
    field.cy = H / 2;
    field.amp = (r0 * 0.10) * (1 - t) + (W * 0.05) * t;
  }

  function edgeNoise(theta, time) {
    return (
      Math.sin(theta * 5.0 + time * 0.0008) +
      Math.sin(theta * 9.0 - time * 0.0011) * 0.6 +
      Math.sin(theta * 2.0 + 2.0) * 0.8
    ) * field.amp * 0.45;
  }

  function drawField(time) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    const segs = 160;
    for (let i = 0; i <= segs; i++) {
      const theta = (i / segs) * Math.PI * 2;
      const rr = field.r + edgeNoise(theta, time);
      const x = field.cx + Math.cos(theta) * rr;
      const y = field.cy + Math.sin(theta) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = field.t > 0.5 ? 30 : 46;
    ctx.fillStyle = '#000000';
    ctx.fill();
    ctx.fill();
    ctx.restore();
  }

  function isDark(x, y, time) {
    const dx = x - field.cx;
    const dy = y - field.cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > field.r + field.amp) return false;
    if (d < field.r - field.amp) return true;
    const theta = Math.atan2(dy, dx);
    return d < field.r + edgeNoise(theta, time);
  }

  /* ---------- 5. 粒子绘制 ---------- */
  function drawDust(time) {
    for (let i = 0; i < dustParticles.length; i++) {
      const p = dustParticles[i];
      p.tw += 0.02 * p.twSpeed;
      const flicker = 0.55 + 0.45 * Math.sin(p.tw);
      const dark = isDark(p.x, p.y, time);
      ctx.fillStyle = dark
        ? 'rgba(255,255,255,' + (0.30 + flicker * 0.5) + ')'
        : 'rgba(0,0,0,' + (0.22 + flicker * 0.45) + ')';
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
  }

  function drawFigure(time) {
    const mx = mouse.x * W;
    const my = mouse.y * H;
    const interactR = Math.min(W, H) * 0.16;
    for (let i = 0; i < figureParticles.length; i++) {
      const p = figureParticles[i];
      let dx = p.bx - mx;
      let dy = p.by - my;
      let dist = Math.sqrt(dx * dx + dy * dy);
      let ox = 0, oy = 0;
      if (dist < interactR && dist > 0.01) {
        const force = (1 - dist / interactR);
        const push = force * force * 40 * (0.4 + p.drift);
        ox = (dx / dist) * push;
        oy = (dy / dist) * push - force * 10 * p.drift;
      }
      const breathe = Math.sin(time * 0.002 + p.bx * 0.02 + p.by * 0.02) * 0.5;
      p.x = p.bx + ox + breathe;
      p.y = p.by + oy;

      const dark = isDark(p.x, p.y, time);
      const alpha = (0.65 + p.drift * 0.35) * p.sh;
      ctx.fillStyle = dark
        ? 'rgba(255,255,255,' + alpha + ')'
        : 'rgba(0,0,0,' + (alpha * 0.9) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---------- 6. 主循环 ---------- */
  function loop(time) {
    mouse.x += (mouse.tx - mouse.x) * 0.06;
    mouse.y += (mouse.ty - mouse.y) * 0.06;
    divideTX = mouse.x * W;
    divideX += (divideTX - divideX) * 0.045;

    if (started && introT > 0) introT = Math.max(0, introT - 0.012);

    updateField(time);
    drawField(time);

    drawDust(time);
    if (introT < 0.75 && figureReady) drawFigure(time);

    requestAnimationFrame(loop);
  }

  /* ---------- 7. 交互 ---------- */
  function onMove(cx, cy) {
    mouse.tx = cx / W;
    mouse.ty = cy / H;
    if (!hasMoved) {
      hasMoved = true;
      if (!started) {
        started = true;
        if (titleEl) titleEl.classList.add('is-hidden');
        cycleWords();
      }
    }
  }

  window.addEventListener('mousemove', function(e) { onMove(e.clientX, e.clientY); });
  window.addEventListener('touchmove', function(e) {
    if (e.touches && e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

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

  /* ---------- 8. 启动 ---------- */
  function init() {
    resize();
    buildFigureFromImage();
    requestAnimationFrame(loop);
  }

  let resizeTimer;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      resize();
      buildFigureFromImage();
    }, 250);
  });

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 60);
  } else {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(init, 60); });
  }
})();
