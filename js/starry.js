/* ===========================================
   梵高《星夜》互动笔触引擎
   效果来源：经典梵高数字艺术互动（油画笔触流动）
   实现原理：
     1. 离屏画布程序化绘制《星夜》场景作为色彩源
        （深蓝天空 / 双漩涡 / 星月 / 山丘 / 村庄 / 柏树 / 梵高人物）
     2. 从画面网格采样生成 ~1.4万根"笔触"粒子
     3. 物理：回弹弹簧 + 常驻漩涡流场 + 鼠标牵引力 + 点击涟漪
     4. 渲染：按颜色分桶批量描边 + 残影渐隐 = 油画流动质感
   互动对应（视频中图2/3/4的变化 → 鼠标交互）：
     - 移动鼠标 → 笔触被搅动、跟随拖拽
     - 点击画面 → 油彩涟漪爆发后回弹
     - 静止不动 → 天空漩涡持续缓缓流动
   =========================================== */
(function () {
  'use strict';

  if (window.__starryInited) return;
  window.__starryInited = true;

  var canvas = null;
  var ctx = null;
  var particles = [];
  var spacing = 6;
  var W = 0, H = 0;
  var frame = 0;
  var rafId = 0;
  var destroyed = false;

  // 鼠标状态（模拟坐标系）
  var mouse = { x: -9999, y: -9999, vx: 0, vy: 0, active: false };
  var MOUSE_R = 150;   // 鼠标影响半径
  var MOUSE_F = 0.35;  // 牵引力系数

  // 物理参数
  var SPRING = 0.012;  // 回弹弹簧系数
  var DAMP = 0.94;     // 速度阻尼
  var AMB = 0.035;     // 环境流动强度
  var FADE = 0.10;     // 残影渐隐速度

  // 两个天空气流漩涡中心（大漩涡 + 小漩涡）
  var vortexA = { x: 0, y: 0, r: 0, s: 0.22 };
  var vortexB = { x: 0, y: 0, r: 0, s: -0.18 };

  /* ============ 1. 程序化绘制《星夜》场景 ============ */
  function buildPaint(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var g = c.getContext('2d');
    if (!g) return c;

    var horizon = h * 0.74;
    var S = Math.min(w, h);

    // 1.1 深蓝夜空渐变
    var sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#101a44');
    sky.addColorStop(0.45, '#1f3070');
    sky.addColorStop(0.72, '#3a5a9e');
    sky.addColorStop(1, '#8a9cc4');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);

    // 1.2 月亮（右上角，明黄新月 + 光晕）
    drawMoon(g, w * 0.84, h * 0.15, S * 0.055);

    // 1.3 星星（黄色光晕 + 亮核）
    var stars = [
      [0.08, 0.12], [0.2, 0.32], [0.3, 0.15], [0.5, 0.09],
      [0.63, 0.22], [0.72, 0.1], [0.93, 0.3], [0.46, 0.4],
      [0.14, 0.42], [0.56, 0.33], [0.35, 0.5], [0.78, 0.42]
    ];
    for (var i = 0; i < stars.length; i++) {
      drawStar(g, w * stars[i][0], h * stars[i][1], S * 0.014);
    }

    // 1.4 天空大漩涡（两处，笔触螺旋）
    drawSwirl(g, w * 0.36, h * 0.30, S * 0.13, 1);
    drawSwirl(g, w * 0.61, h * 0.25, S * 0.09, -1);

    // 1.5 横向气流笔触带
    var bands = [
      { y: 0.18, a: 0.10 }, { y: 0.38, a: 0.08 }, { y: 0.55, a: 0.09 }, { y: 0.66, a: 0.07 }
    ];
    for (var b = 0; b < bands.length; b++) {
      var yy = h * bands[b].y;
      for (var x = w * 0.05; x < w * 0.95; x += 14) {
        g.beginPath();
        g.moveTo(x, yy + Math.sin(x * 0.02) * 6);
        g.quadraticCurveTo(x + 7, yy - 4, x + 14, yy + Math.sin((x + 14) * 0.02) * 6);
        g.strokeStyle = 'rgba(215,228,250,' + bands[b].a + ')';
        g.lineWidth = 5;
        g.stroke();
      }
    }

    // 1.6 山丘（深蓝色波浪剪影）
    g.fillStyle = '#0c1633';
    g.beginPath();
    g.moveTo(0, horizon + 10);
    g.quadraticCurveTo(w * 0.18, horizon - h * 0.06, w * 0.38, horizon + 4);
    g.quadraticCurveTo(w * 0.6, horizon + h * 0.08, w * 0.82, horizon - h * 0.02);
    g.quadraticCurveTo(w * 0.95, horizon - h * 0.05, w, horizon + 8);
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.closePath();
    g.fill();

    // 1.7 村庄（小屋 + 黄色窗光 + 教堂尖顶）
    drawVillage(g, w, h, horizon);

    // 1.8 柏树（左侧黑色火焰状剪影）
    drawCypress(g, w * 0.09, h * 0.98, S * 0.62);

    // 1.9 梵高人物形象（右侧站立，红发红须自画像风格）
    drawFigure(g, w * 0.62, h * 0.94, h * 0.34);

    return c;
  }

  /* 画月亮 */
  function drawMoon(g, x, y, r) {
    var halo = g.createRadialGradient(x, y, 0, x, y, r * 5);
    halo.addColorStop(0, 'rgba(255,235,120,0.75)');
    halo.addColorStop(0.35, 'rgba(255,220,80,0.25)');
    halo.addColorStop(1, 'rgba(255,220,80,0)');
    g.fillStyle = halo;
    g.beginPath();
    g.arc(x, y, r * 5, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = '#f7e04a';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();

    // 新月缺口
    g.fillStyle = '#16224e';
    g.beginPath();
    g.arc(x - r * 0.42, y - r * 0.18, r * 0.88, 0, Math.PI * 2);
    g.fill();
  }

  /* 画星星 */
  function drawStar(g, x, y, r) {
    var halo = g.createRadialGradient(x, y, 0, x, y, r * 4.5);
    halo.addColorStop(0, 'rgba(255,235,130,0.85)');
    halo.addColorStop(0.3, 'rgba(255,220,80,0.3)');
    halo.addColorStop(1, 'rgba(255,220,80,0)');
    g.fillStyle = halo;
    g.beginPath();
    g.arc(x, y, r * 4.5, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = '#fff3b0';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  /* 画笔触螺旋漩涡 */
  function drawSwirl(g, cx, cy, r, dir) {
    for (var i = 0; i < 20; i++) {
      var rr = r * (0.22 + i * 0.045);
      var a0 = i * 0.55 * dir + (i % 3) * 0.3;
      g.beginPath();
      g.arc(cx, cy, rr, a0, a0 + Math.PI * 1.25);
      var alpha = 0.10 + (i % 3) * 0.045;
      g.strokeStyle = (i % 2 === 0)
        ? 'rgba(225,232,252,' + alpha + ')'
        : 'rgba(190,208,242,' + alpha + ')';
      g.lineWidth = 2 + (i % 4);
      g.stroke();
    }
    // 漩涡核心亮点
    drawStar(g, cx, cy, r * 0.1);
  }

  /* 画村庄 */
  function drawVillage(g, w, h, horizon) {
    var houses = [
      { x: 0.16, s: 0.028 }, { x: 0.24, s: 0.034 }, { x: 0.31, s: 0.026 },
      { x: 0.4, s: 0.038 }, { x: 0.47, s: 0.03 }, { x: 0.78, s: 0.03 },
      { x: 0.85, s: 0.026 }, { x: 0.92, s: 0.032 }
    ];
    var S = Math.min(w, h);
    for (var i = 0; i < houses.length; i++) {
      var hx = w * houses[i].x;
      var hw = S * houses[i].s;
      var hh = hw * 0.9;
      var hy = horizon + h * 0.02 - hh;
      // 屋身
      g.fillStyle = '#0a1226';
      g.fillRect(hx, hy, hw, hh);
      // 屋顶
      g.beginPath();
      g.moveTo(hx - hw * 0.08, hy);
      g.lineTo(hx + hw * 0.5, hy - hh * 0.55);
      g.lineTo(hx + hw * 1.08, hy);
      g.closePath();
      g.fill();
      // 黄色窗光
      g.fillStyle = '#f7d24a';
      g.fillRect(hx + hw * 0.22, hy + hh * 0.32, hw * 0.22, hh * 0.3);
      g.fillRect(hx + hw * 0.6, hy + hh * 0.32, hw * 0.22, hh * 0.3);
    }
    // 教堂尖顶
    var cx2 = w * 0.545;
    var base = horizon + h * 0.02;
    g.fillStyle = '#0a1226';
    g.fillRect(cx2, base - h * 0.09, S * 0.014, h * 0.09);
    g.beginPath();
    g.moveTo(cx2 - S * 0.008, base - h * 0.09);
    g.lineTo(cx2 + S * 0.007, base - h * 0.15);
    g.lineTo(cx2 + S * 0.022, base - h * 0.09);
    g.closePath();
    g.fill();
  }

  /* 画柏树（火焰状） */
  function drawCypress(g, x, baseY, height) {
    g.fillStyle = '#0a1410';
    g.beginPath();
    g.moveTo(x - height * 0.07, baseY);
    g.bezierCurveTo(
      x - height * 0.10, baseY - height * 0.35,
      x - height * 0.03, baseY - height * 0.55,
      x - height * 0.05, baseY - height * 0.8
    );
    g.bezierCurveTo(
      x - height * 0.01, baseY - height * 0.92,
      x + height * 0.02, baseY - height * 0.96,
      x, baseY - height
    );
    g.bezierCurveTo(
      x + height * 0.06, baseY - height * 0.9,
      x + height * 0.04, baseY - height * 0.6,
      x + height * 0.08, baseY - height * 0.4
    );
    g.bezierCurveTo(
      x + height * 0.1, baseY - height * 0.2,
      x + height * 0.09, baseY - height * 0.08,
      x + height * 0.08, baseY
    );
    g.closePath();
    g.fill();
  }

  /* 画梵高人物（红发红须自画像风格，站立于山丘） */
  function drawFigure(g, cx, baseY, size) {
    var headR = size * 0.115;
    var headY = baseY - size * 0.88;

    // 身体（深蓝外套）
    g.fillStyle = '#101a38';
    g.beginPath();
    g.moveTo(cx - size * 0.19, baseY);
    g.quadraticCurveTo(cx - size * 0.21, headY + headR * 1.4, cx - size * 0.1, headY + headR * 1.05);
    g.lineTo(cx + size * 0.1, headY + headR * 1.05);
    g.quadraticCurveTo(cx + size * 0.21, headY + headR * 1.4, cx + size * 0.19, baseY);
    g.closePath();
    g.fill();

    // 领口白衬衫
    g.fillStyle = '#d8dce8';
    g.beginPath();
    g.moveTo(cx - headR * 0.55, headY + headR * 1.1);
    g.lineTo(cx, headY + headR * 1.75);
    g.lineTo(cx + headR * 0.55, headY + headR * 1.1);
    g.closePath();
    g.fill();

    // 头部（肤色）
    g.fillStyle = '#d9a06a';
    g.beginPath();
    g.ellipse(cx, headY, headR * 0.85, headR, 0, 0, Math.PI * 2);
    g.fill();

    // 红发（头顶）
    g.fillStyle = '#a8431c';
    g.beginPath();
    g.ellipse(cx, headY - headR * 0.45, headR * 0.9, headR * 0.6, 0, Math.PI, Math.PI * 2);
    g.fill();

    // 红色络腮胡（下半脸）
    g.fillStyle = '#b8501f';
    g.beginPath();
    g.ellipse(cx, headY + headR * 0.55, headR * 0.8, headR * 0.55, 0, 0, Math.PI);
    g.fill();

    // 眼睛
    g.fillStyle = '#16213a';
    g.beginPath();
    g.arc(cx - headR * 0.32, headY - headR * 0.08, headR * 0.09, 0, Math.PI * 2);
    g.arc(cx + headR * 0.32, headY - headR * 0.08, headR * 0.09, 0, Math.PI * 2);
    g.fill();

    // 鼻影
    g.strokeStyle = 'rgba(120,70,30,0.6)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(cx, headY - headR * 0.05);
    g.lineTo(cx - headR * 0.04, headY + headR * 0.28);
    g.stroke();
  }

  /* ============ 2. 初始化笔触粒子 ============ */
  function initParticles(paintCanvas) {
    var pctx = paintCanvas.getContext('2d');
    var img = pctx.getImageData(0, 0, W, H);
    var data = img.data;

    // 根据面积自适应间距，控制总粒子数 ~1.4 万
    spacing = Math.max(5, Math.round(Math.sqrt((W * H) / 14000)));
    particles = [];

    for (var y = spacing / 2; y < H; y += spacing) {
      for (var x = spacing / 2; x < W; x += spacing) {
        var i = ((y | 0) * W + (x | 0)) * 4;
        var jitter = (Math.random() - 0.5) * 26;
        particles.push({
          ox: x, oy: y,          // 原始位置（回弹目标）
          x: x, y: y,            // 当前位置
          vx: 0, vy: 0,          // 速度
          px: x, py: y,          // 上一帧位置（描边起点）
          r: clamp255(data[i] + jitter),
          g: clamp255(data[i + 1] + jitter),
          b: clamp255(data[i + 2] + jitter * 0.6)
        });
      }
    }
  }

  function clamp255(v) {
    return v < 0 ? 0 : (v > 255 ? 255 : v);
  }

  /* ============ 3. 物理更新 ============ */
  function step() {
    var t = frame * 0.004;
    var groundFactor = 0.12;    // 地面（山丘/村庄/人物）区域流动减弱
    var i, p, fx, fy, dx, dy, d;

    // 鼠标速度自然衰减
    mouse.vx *= 0.82;
    mouse.vy *= 0.82;

    var MR = MOUSE_R;
    var MR2 = MR * MR;
    var mActive = mouse.active;

    for (i = 0; i < particles.length; i++) {
      p = particles[i];
      fx = 0;
      fy = 0;

      // 3.1 回弹弹簧（笔触始终回到原位）
      fx += (p.ox - p.x) * SPRING;
      fy += (p.oy - p.y) * SPRING;

      // 3.2 常驻环境流动（天空活跃，地面安静）
      var sky = p.oy < H * 0.72 ? 1 : groundFactor;
      fx += Math.sin(p.y * 0.012 + t * 2.1) * AMB * sky;
      fy += Math.cos(p.x * 0.010 - t * 1.7) * AMB * sky;

      // 3.3 大漩涡（切向力）
      dx = p.x - vortexA.x;
      dy = p.y - vortexA.y;
      d = Math.sqrt(dx * dx + dy * dy) + 1;
      if (d < vortexA.r) {
        var f1 = vortexA.s * (1 - d / vortexA.r) * sky;
        fx += (-dy / d) * f1;
        fy += (dx / d) * f1;
      }

      // 3.4 小漩涡（反向切向力）
      dx = p.x - vortexB.x;
      dy = p.y - vortexB.y;
      d = Math.sqrt(dx * dx + dy * dy) + 1;
      if (d < vortexB.r) {
        var f2 = vortexB.s * (1 - d / vortexB.r) * sky;
        fx += (-dy / d) * f2;
        fy += (dx / d) * f2;
      }

      // 3.5 鼠标牵引力（搅动/拖拽油彩）
      if (mActive) {
        dx = p.x - mouse.x;
        dy = p.y - mouse.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < MR2) {
          var fall = 1 - Math.sqrt(d2) / MR;
          fx += mouse.vx * fall * MOUSE_F;
          fy += mouse.vy * fall * MOUSE_F;
        }
      }

      // 3.6 积分
      p.px = p.x;
      p.py = p.y;
      p.vx = (p.vx + fx) * DAMP;
      p.vy = (p.vy + fy) * DAMP;
      p.x += p.vx;
      p.y += p.vy;
    }
  }

  /* ============ 4. 渲染（颜色分桶批量描边 + 残影） ============ */
  var colorCache = new Array(512);
  function render() {
    // 4.1 全画面渐隐（制造笔触拖尾残影）
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,' + FADE + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';

    // 4.2 颜色分桶（5位量化 → 512桶）
    var buckets = new Array(512);
    var i, p, idx;
    for (i = 0; i < particles.length; i++) {
      p = particles[i];
      idx = ((p.r >> 5) << 6) | ((p.g >> 5) << 3) | (p.b >> 5);
      var path = buckets[idx];
      if (!path) {
        path = buckets[idx] = new Path2D();
        if (!colorCache[idx]) {
          colorCache[idx] = 'rgb(' + ((p.r >> 5) << 5) + ',' + ((p.g >> 5) << 5) + ',' + ((p.b >> 5) << 5) + ')';
        }
      }
      // 从上一帧位置画到当前位置 = 笔触
      path.moveTo(p.px, p.py);
      if (Math.abs(p.x - p.px) + Math.abs(p.y - p.py) < 0.25) {
        path.lineTo(p.px + 0.4, p.py); // 静止时画点，保持覆盖
      } else {
        path.lineTo(p.x, p.y);
      }
    }

    // 4.3 每桶一次描边（性能关键）
    ctx.lineWidth = Math.max(1.4, spacing * 0.85);
    ctx.lineCap = 'round';
    for (i = 0; i < 512; i++) {
      if (buckets[i]) {
        ctx.strokeStyle = colorCache[i];
        ctx.stroke(buckets[i]);
      }
    }
  }

  /* ============ 5. 主循环 ============ */
  function loop() {
    if (destroyed) return;
    rafId = requestAnimationFrame(loop);
    if (document.hidden) return; // 页面不可见时暂停计算
    step();
    render();
    frame++;
  }

  /* ============ 6. 点击涟漪 ============ */
  function burst(x, y) {
    var R = W * 0.24;
    var power = 7;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var dx = p.x - x;
      var dy = p.y - y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < R && d > 0.01) {
        var f = (1 - d / R) * power;
        p.vx += (dx / d) * f;
        p.vy += (dy / d) * f;
      }
    }
  }

  /* ============ 7. 事件绑定 ============ */
  function toSimX(clientX) { return clientX * (W / window.innerWidth); }
  function toSimY(clientY) { return clientY * (H / window.innerHeight); }

  function onMouseMove(e) {
    var nx = toSimX(e.clientX);
    var ny = toSimY(e.clientY);
    if (mouse.x > -9000) {
      mouse.vx = clamp(mouse.vx * 0.5 + (nx - mouse.x) * 0.5, -40, 40);
      mouse.vy = clamp(mouse.vy * 0.5 + (ny - mouse.y) * 0.5, -40, 40);
    }
    mouse.x = nx;
    mouse.y = ny;
    mouse.active = true;
  }

  function clamp(v, min, max) {
    return v < min ? min : (v > max ? max : v);
  }

  function onMouseLeave() { mouse.active = false; }

  function onClick(e) {
    burst(toSimX(e.clientX), toSimY(e.clientY));
  }

  function onTouchMove(e) {
    if (e.touches && e.touches.length > 0) {
      onMouseMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
    }
  }

  /* ============ 8. 初始化与销毁 ============ */
  var resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(setup, 300);
  }

  function setup() {
    if (destroyed) return;
    // 半分辨率模拟（放大后自带油画柔和感，性能翻倍）
    W = Math.max(320, Math.floor(window.innerWidth / 2));
    H = Math.max(240, Math.floor(window.innerHeight / 2));

    canvas.width = W;
    canvas.height = H;

    // 漩涡位置随画布尺寸确定
    vortexA.x = W * 0.36;
    vortexA.y = H * 0.30;
    vortexA.r = Math.min(W, H) * 0.42;
    vortexB.x = W * 0.61;
    vortexB.y = H * 0.25;
    vortexB.r = Math.min(W, H) * 0.28;

    MOUSE_R = Math.min(W, H) * 0.18;

    // 生成画面与粒子
    var paint = buildPaint(W, H);
    initParticles(paint);

    // 首帧直接整幅画出原画
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(paint, 0, 0);
  }

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseleave', onMouseLeave);
    window.removeEventListener('click', onClick);
    window.removeEventListener('touchmove', onTouchMove);
  }

  function init() {
    canvas = document.getElementById('starry-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    if (!ctx) return;

    setup();

    window.addEventListener('resize', onResize);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('click', onClick);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('pjax:send', destroy, { once: true });

    loop();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 50);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(init, 50);
    });
  }
})();
