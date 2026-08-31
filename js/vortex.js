/* ===========================================
   漩涡粒子互动页面 - 核心脚本
   功能：
     1. Canvas绘制黑-白径向漩涡渐变（中央深黑→边缘白）
     2. 800+ 粒子按漩涡轨道运动
     3. 鼠标互动：粒子被鼠标吸引/排斥（半径80px内）
     4. 鼠标轨迹形成光晕
   性能优化：粒子预渲染到离屏canvas，使用drawImage拷贝
   =========================================== */
(function() {
  'use strict';

  if (window.__vortexInited) return;
  window.__vortexInited = true;

  function init() {
    const canvas = document.getElementById('vortex-bg');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w, h, cx, cy, dpr;
    const PARTICLE_COUNT = 800;

    // 鼠标状态
    let mouseX = -9999, mouseY = -9999;
    let mouseActive = false;
    let mouseInfluence = 100; // 鼠标影响半径

    // 粒子数组
    let particles = [];

    // 预渲染粒子（生成不同大小的白/灰点）
    const spriteCache = {};
    function getParticleSprite(size, alpha) {
      const key = size + '_' + Math.round(alpha * 10);
      if (spriteCache[key]) return spriteCache[key];
      const c = document.createElement('canvas');
      const s = size * 2;
      c.width = c.height = s;
      const cc = c.getContext('2d');
      const grd = cc.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
      grd.addColorStop(0, 'rgba(255,255,255,' + alpha + ')');
      grd.addColorStop(0.4, 'rgba(255,255,255,' + (alpha*0.6) + ')');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      cc.fillStyle = grd;
      cc.fillRect(0, 0, s, s);
      spriteCache[key] = c;
      return c;
    }

    // 设置画布尺寸（高DPI适配）
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = w / 2;
      cy = h / 2;
      initParticles();
    }

    // 初始化粒子 - 按对数螺线分布
    function initParticles() {
      particles = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        // 用黄金角度分布避免聚集
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        const t = i / PARTICLE_COUNT;
        // 半径从中心向外（对数分布，中心少边缘多）
        const r = Math.pow(t, 0.6) * Math.max(w, h) * 0.7;
        const theta = i * goldenAngle;
        const isBlack = Math.random() < 0.15; // 15%黑点

        particles.push({
          x: cx + Math.cos(theta) * r,
          y: cy + Math.sin(theta) * r,
          r: r,
          theta: theta,
          // 角速度（不同半径不同速度，模拟漩涡）
          angularSpeed: 0.0008 + (1 - t) * 0.0015,
          // 径向缓慢外扩
          radialSpeed: 0.02 + Math.random() * 0.03,
          size: 1 + Math.random() * 2.5,
          alpha: 0.3 + Math.random() * 0.7,
          isBlack: isBlack,
          // 微抖动
          wobble: Math.random() * Math.PI * 2
        });
      }
    }

    // 绘制漩涡渐变背景
    function drawVortex() {
      // 径向渐变：中心黑（#000）→ 边缘白（#f5f5f5）
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.75);
      grd.addColorStop(0, '#000000');
      grd.addColorStop(0.35, '#1a1a1a');
      grd.addColorStop(0.65, '#888888');
      grd.addColorStop(1, '#f5f5f5');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);

      // 额外加一层径向暗化（中心更黑）
      const darken = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.4);
      darken.addColorStop(0, 'rgba(0,0,0,0.4)');
      darken.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = darken;
      ctx.fillRect(0, 0, w, h);
    }

    // 更新粒子位置
    function updateParticles(time) {
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // 漩涡运动：角速度 + 缓慢径向外扩
        p.theta += p.angularSpeed;
        p.r += p.radialSpeed;
        p.wobble += 0.02;

        // 如果粒子飘出范围，重置到中心附近
        if (p.r > Math.max(w, h) * 0.75) {
          p.r = 10 + Math.random() * 50;
          p.theta = Math.random() * Math.PI * 2;
        }

        // 计算基础位置
        let px = cx + Math.cos(p.theta) * p.r;
        let py = cy + Math.sin(p.theta) * p.r;

        // 鼠标互动 - 排斥力
        if (mouseActive) {
          const dx = px - mouseX;
          const dy = py - mouseY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < mouseInfluence && dist > 0) {
            const force = (1 - dist / mouseInfluence) * 8;
            px += (dx / dist) * force;
            py += (dy / dist) * force;
          }
        }

        p._x = px;
        p._y = py;
      }
    }

    // 绘制粒子
    function drawParticles() {
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const sprite = getParticleSprite(p.size, p.alpha);
        if (p.isBlack) {
          // 黑点用globalCompositeOperation
          ctx.globalCompositeOperation = 'multiply';
          ctx.drawImage(sprite, p._x - p.size, p._y - p.size);
          ctx.globalCompositeOperation = 'source-over';
        } else {
          ctx.drawImage(sprite, p._x - p.size, p._y - p.size);
        }
      }
    }

    // 绘制鼠标光晕
    function drawMouseGlow() {
      if (!mouseActive) return;
      const grd = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, mouseInfluence);
      grd.addColorStop(0, 'rgba(255,255,255,0.15)');
      grd.addColorStop(0.5, 'rgba(255,255,255,0.05)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(mouseX - mouseInfluence, mouseY - mouseInfluence, mouseInfluence * 2, mouseInfluence * 2);
    }

    // 主循环
    function loop() {
      drawVortex();
      drawMouseGlow();
      updateParticles();
      drawParticles();
      requestAnimationFrame(loop);
    }

    // 鼠标事件
    document.addEventListener('mousemove', function(e) {
      mouseX = e.clientX;
      mouseY = e.clientY;
      mouseActive = true;
    });
    document.addEventListener('mouseleave', function() {
      mouseActive = false;
    });
    // 触屏支持
    document.addEventListener('touchmove', function(e) {
      if (e.touches.length > 0) {
        mouseX = e.touches[0].clientX;
        mouseY = e.touches[0].clientY;
        mouseActive = true;
      }
    }, { passive: true });
    document.addEventListener('touchend', function() {
      mouseActive = false;
    });

    // 窗口resize
    let resizeTimer;
    window.addEventListener('resize', function() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 200);
    });

    resize();
    loop();
  }

  // 启动
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 100);
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(init, 100);
    });
  }
})();
