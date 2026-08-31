/* ===========================================
   梵高粒子肖像 - 核心脚本
   4阶段设计：
     1. 黑洞入场（0-3s）：背景黑色椭圆 + 周围光晕 + 星尘噪点
     2. 粒子梵高显现（2-5s）：3000+粒子在右侧构成梵高半身像
     3. 镜头拉近（鼠标Y控制）：图3 → 图4 的过渡
     4. 鼠标互动：左右旋转 + 粒子推散 + 文字轮播
   =========================================== */
(function() {
  'use strict';

  if (window.__vincentInited) return;
  window.__vincentInited = true;

  /* ============================================
     模块1：梵高侧面剪影定义（抽象几何 + 贝塞尔曲线）
     不用图片，纯数学构造轮廓
     ============================================ */
  function getVanGoghSilhouette(w, h) {
    // 梵高侧面半身像路径（基于参考图简化） - 头部+肩部
    // 坐标系：中心为(0,0)，宽 w 高 h
    const cx = w * 0.62;  // 偏右
    const cy = h * 0.5;

    // 头部轮廓（侧面）
    const headPath = [
      // 头顶
      {x: cx + 30, y: cy - 180},
      {x: cx + 50, y: cy - 195},
      {x: cx + 80, y: cy - 200},
      {x: cx + 110, y: cy - 195},
      {x: cx + 130, y: cy - 175},
      // 额头到鼻子
      {x: cx + 140, y: cy - 150},
      {x: cx + 145, y: cy - 120},
      {x: cx + 150, y: cy - 90},
      // 鼻尖
      {x: cx + 165, y: cy - 70},
      {x: cx + 160, y: cy - 60},
      {x: cx + 150, y: cy - 55},
      // 嘴部
      {x: cx + 140, y: cy - 45},
      {x: cx + 135, y: cy - 35},
      // 下巴
      {x: cx + 125, y: cy - 20},
      {x: cx + 110, y: cy - 5},
      // 颈部
      {x: cx + 105, y: cy + 20},
      {x: cx + 100, y: cy + 50},
      // 肩部
      {x: cx + 150, y: cy + 100},
      {x: cx + 200, y: cy + 180},
      {x: cx + 280, y: cy + 260}
    ];

    // 内部细节路径（眼睛区域、胡子、嘴部）
    const eyeRegion = [
      {x: cx + 130, y: cy - 110, w: 25, h: 12}
    ];

    const beardRegion = [
      // 络腮胡区域
      {x: cx + 95, y: cy - 20, w: 50, h: 50}
    ];

    return { headPath, eyeRegion, beardRegion, cx, cy };
  }

  /* ============================================
     模块2：粒子采样
     在路径内生成指定数量的粒子
     ============================================ */
  function samplePointsInPath(path, count) {
    const points = [];
    // 用边界框做粗筛
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    path.forEach(p => {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    });

    // 简化：用椭圆+高斯密度模拟头部粒子分布
    // 头部中心
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rx = (maxX - minX) / 2;
    const ry = (maxY - minY) / 2;

    // 我们用鼻尖为"最密集"中心点（参考图中粒子集中在面部）
    const densityCenter = { x: maxX - rx * 0.3, y: cy - ry * 0.1 };

    let attempts = 0;
    while (points.length < count && attempts < count * 5) {
      attempts++;
      // 用高斯分布采样
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random());
      const x = densityCenter.x + Math.cos(angle) * radius * rx * 0.95;
      const y = densityCenter.y + Math.sin(angle) * radius * ry * 0.95;

      // 椭圆边界检查
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 0.95) {
        points.push({
          x, y,
          // 粒子大小 - 鼻尖/眼睛区域更大
          size: 0.5 + Math.random() * 1.5,
          // 粒子亮度
          alpha: 0.4 + Math.random() * 0.6,
          // 初始随机偏移（用于粒子推散效果）
          homeX: x,
          homeY: y,
          vx: 0,
          vy: 0,
          // 粒子目标深度（用于镜头推拉时的视差）
          depth: 0.5 + Math.random() * 0.5
        });
      }
    }

    return points;
  }

  /* ============================================
     模块3：粒子类
     ============================================ */
  class Particle {
    constructor(x, y, depth) {
      this.homeX = x;
      this.homeY = y;
      this.x = x;
      this.y = y;
      this.vx = 0;
      this.vy = 0;
      this.size = 0.4 + Math.random() * 1.6;
      this.alpha = 0.3 + Math.random() * 0.7;
      this.depth = depth;
      this.phase = Math.random() * Math.PI * 2;
    }

    update(time, mouseInfluence, zoom, panX) {
      // 鼠标推力
      const dx = this.x - mouseInfluence.x;
      const dy = this.y - mouseInfluence.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const pushRadius = 120;
      if (dist < pushRadius && dist > 0) {
        const force = (1 - dist / pushRadius) * 0.8;
        this.vx += (dx / dist) * force;
        this.vy += (dy / dist) * force;
      }

      // 阻尼
      this.vx *= 0.92;
      this.vy *= 0.92;

      // 缓慢呼吸偏移
      const breath = Math.sin(time * 0.0008 + this.phase) * 0.5;
      this.x += this.vx + breath * 0.1;
      this.y += this.vy;

      // 回弹力
      const sx = this.homeX - this.x;
      const sy = this.homeY - this.y;
      this.vx += sx * 0.04;
      this.vy += sy * 0.04;
    }
  }

  /* ============================================
     模块4：主程序
     ============================================ */
  function init() {
    const bgCanvas = document.getElementById('vincent-bg');
    const pCanvas = document.getElementById('vincent-particles');
    if (!bgCanvas || !pCanvas) return;

    const bgCtx = bgCanvas.getContext('2d');
    const pCtx = pCanvas.getContext('2d');
    if (!bgCtx || !pCtx) return;

    let w, h;
    let particles = [];
    let stars = [];           // 背景星尘
    let blackHole = null;     // 黑洞
    let mouseX = 0, mouseY = 0;
    let targetMouseX = 0, targetMouseY = 0;
    let zoom = 1;             // 镜头缩放
    let targetZoom = 1;
    let panX = 0;             // 镜头水平旋转
    let targetPanX = 0;
    let startTime = Date.now();

    /* ----- 自定义鼠标 ----- */
    const cursor = document.createElement('div');
    cursor.className = 'vincent-cursor';
    document.body.appendChild(cursor);
    document.addEventListener('mousemove', e => {
      cursor.style.left = e.clientX + 'px';
      cursor.style.top = e.clientY + 'px';
    });

    /* ----- 调整尺寸 ----- */
    function resize() {
      w = bgCanvas.width = pCanvas.width = window.innerWidth;
      h = bgCanvas.height = pCanvas.height = window.innerHeight;
      setupScene();
    }

    function setupScene() {
      // 背景星尘
      stars = [];
      for (let i = 0; i < 200; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          size: 0.3 + Math.random() * 1.5,
          alpha: 0.1 + Math.random() * 0.6,
          twinkle: Math.random() * Math.PI * 2
        });
      }

      // 黑洞
      blackHole = {
        x: w * 0.5,
        y: h * 0.5,
        rx: Math.min(w, h) * 0.32,
        ry: Math.min(w, h) * 0.28,
        alpha: 1
      };

      // 梵高粒子
      const sil = getVanGoghSilhouette(w, h);
      // 在头部区域采样粒子
      const headParticles = samplePointsInPath(sil.headPath, 2800);
      particles = headParticles.map(p => new Particle(p.x, p.y, p.depth));
    }

    /* ----- 鼠标控制 ----- */
    document.addEventListener('mousemove', e => {
      targetMouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      targetMouseY = (e.clientY / window.innerHeight - 0.5) * 2;

      // 镜头水平旋转（左右）
      targetPanX = -targetMouseX * 30;
      // 镜头推拉（上下）
      targetZoom = 1 + (-targetMouseY) * 0.35;
      // 限制范围
      targetZoom = Math.max(0.85, Math.min(1.4, targetZoom));
    });

    /* ----- 缓动函数 ----- */
    function lerp(a, b, t) { return a + (b - a) * t; }

    /* ----- 渲染背景 ----- */
    function renderBg(time) {
      bgCtx.clearRect(0, 0, w, h);

      // 全黑底
      bgCtx.fillStyle = '#000';
      bgCtx.fillRect(0, 0, w, h);

      // 黑洞入场（3秒后淡出）
      const elapsed = (Date.now() - startTime) / 1000;
      const blackHoleAlpha = Math.max(0, 1 - elapsed / 3);
      blackHole.alpha = blackHoleAlpha;

      if (blackHoleAlpha > 0) {
        // 边缘光晕
        const cx = blackHole.x;
        const cy = blackHole.y;
        const grad = bgCtx.createRadialGradient(
          cx, cy, blackHole.rx * 0.7,
          cx, cy, blackHole.rx * 2.5
        );
        grad.addColorStop(0, `rgba(0, 0, 0, ${blackHoleAlpha})`);
        grad.addColorStop(0.3, `rgba(20, 20, 20, ${blackHoleAlpha * 0.6})`);
        grad.addColorStop(0.6, `rgba(80, 80, 80, ${blackHoleAlpha * 0.2})`);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        bgCtx.fillStyle = grad;
        bgCtx.fillRect(0, 0, w, h);

        // 黑洞本体
        bgCtx.save();
        bgCtx.translate(cx, cy);
        bgCtx.scale(1, blackHole.ry / blackHole.rx);
        bgCtx.beginPath();
        bgCtx.arc(0, 0, blackHole.rx, 0, Math.PI * 2);
        bgCtx.fillStyle = `rgba(0, 0, 0, ${blackHoleAlpha})`;
        bgCtx.fill();
        bgCtx.restore();
      }

      // 左侧亮光晕（图1-4的左上都比右侧亮）
      const lightGrad = bgCtx.createLinearGradient(0, 0, w, 0);
      lightGrad.addColorStop(0, 'rgba(80, 80, 80, 0.35)');
      lightGrad.addColorStop(0.5, 'rgba(30, 30, 30, 0.15)');
      lightGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      bgCtx.fillStyle = lightGrad;
      bgCtx.fillRect(0, 0, w * 0.6, h);

      // 背景星尘
      stars.forEach(s => {
        const tw = 0.5 + Math.sin(time * 0.002 + s.twinkle) * 0.5;
        bgCtx.beginPath();
        bgCtx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        bgCtx.fillStyle = `rgba(255, 255, 255, ${s.alpha * tw * 0.4})`;
        bgCtx.fill();
      });
    }

    /* ----- 渲染粒子梵高 ----- */
    function renderParticles(time) {
      pCtx.clearRect(0, 0, w, h);

      // 镜头变换
      pCtx.save();
      pCtx.translate(w / 2, h / 2);
      pCtx.scale(zoom, zoom);
      pCtx.translate(-w / 2 + panX, -h / 2);

      // 入场过渡（2-4s粒子从外向内聚拢）
      const elapsed = (Date.now() - startTime) / 1000;
      const appear = Math.max(0, Math.min(1, (elapsed - 1.5) / 2));

      particles.forEach(p => {
        // 入场动画：初始位置随机 → 回家
        if (appear < 1) {
          const scatter = (1 - appear);
          const angle = Math.random() * Math.PI * 2;
          const dist = scatter * 300;
          p.x = lerp(p.x, p.homeX + Math.cos(angle) * dist, 0.05);
          p.y = lerp(p.y, p.homeY + Math.sin(angle) * dist, 0.05);
          p.alpha = appear * (0.3 + Math.random() * 0.5);
        } else {
          // 鼠标推力计算
          const mouseInfluence = {
            x: (mouseX * 0.5 + 0.5) * w,
            y: (mouseY * 0.5 + 0.5) * h
          };
          p.update(time, mouseInfluence, zoom, panX);
          p.alpha = 0.4 + Math.sin(time * 0.003 + p.phase) * 0.3;
        }

        // 绘制粒子
        pCtx.beginPath();
        pCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        pCtx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, p.alpha)})`;
        pCtx.fill();
      });

      pCtx.restore();
    }

    /* ----- 主循环 ----- */
    function loop(time) {
      // 缓动鼠标
      mouseX = lerp(mouseX, targetMouseX, 0.06);
      mouseY = lerp(mouseY, targetMouseY, 0.06);
      zoom = lerp(zoom, targetZoom, 0.04);
      panX = lerp(panX, targetPanX, 0.06);

      renderBg(time);
      renderParticles(time);

      requestAnimationFrame(loop);
    }

    /* ----- 启动 ----- */
    resize();
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 200);
    });
    requestAnimationFrame(loop);
  }

  /* ----- 启动入口 ----- */
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 100);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 100));
  }
})();
