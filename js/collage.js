/* ===========================================
   拼贴风互动页面 - 核心脚本
   功能：
     1. Canvas绘制粉红噪点背景 + 蓝色撕纸笔触
     2. 渲染可替换的SVG贴纸（心脏/眼/大脑/花/山/沙发等）
     3. 多层级鼠标视差互动
     4. 便利贴便签
   图案替换说明：改下方 STICKERS 数组即可
   =========================================== */
(function() {
  'use strict';

  if (window.__collageInited) return;
  window.__collageInited = true;

  /* ====== 1. 贴纸库 - 用纯SVG绘制，方便你换图案 ====== */
  const STICKER_SVG = {
    heart: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><radialGradient id="hg" cx="50%" cy="40%"><stop offset="0%" stop-color="#ff8aa8"/><stop offset="100%" stop-color="#a01040"/></radialGradient></defs>
      <path d="M50 88 C 20 65, 5 50, 5 32 C 5 18, 18 8, 30 12 C 40 15, 46 22, 50 30 C 54 22, 60 15, 70 12 C 82 8, 95 18, 95 32 C 95 50, 80 65, 50 88 Z" fill="url(#hg)" stroke="#600020" stroke-width="1.5"/>
      <path d="M30 28 C 28 35, 32 42, 38 45" stroke="#fff" stroke-width="2" fill="none" opacity="0.4"/>
      <path d="M28 30 C 26 36, 30 42, 36 46" stroke="#000" stroke-width="0.5" fill="none" opacity="0.3"/>
    </svg>`,

    eye: `<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="60" cy="40" rx="58" ry="35" fill="#f5f0e8" stroke="#222" stroke-width="2"/>
      <ellipse cx="60" cy="40" rx="30" ry="30" fill="#3a7ad9"/>
      <ellipse cx="60" cy="40" rx="14" ry="14" fill="#0a1f4a"/>
      <circle cx="60" cy="40" r="5" fill="#000"/>
      <circle cx="55" cy="35" r="3" fill="#fff" opacity="0.8"/>
      <path d="M5 30 Q 15 8, 35 5" stroke="#222" stroke-width="2.5" fill="none"/>
      <path d="M115 30 Q 105 8, 85 5" stroke="#222" stroke-width="2.5" fill="none"/>
      <path d="M2 45 Q 15 60, 35 65" stroke="#222" stroke-width="2" fill="none"/>
      <path d="M118 45 Q 105 60, 85 65" stroke="#222" stroke-width="2" fill="none"/>
    </svg>`,

    brain: `<svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
      <defs><radialGradient id="bg" cx="50%" cy="40%"><stop offset="0%" stop-color="#f5d4a8"/><stop offset="100%" stop-color="#a8723a"/></radialGradient></defs>
      <ellipse cx="60" cy="75" rx="50" ry="60" fill="url(#bg)" stroke="#5a3a1a" stroke-width="1.5"/>
      <path d="M30 50 Q 45 45, 60 50 Q 75 45, 90 50" stroke="#5a3a1a" stroke-width="1" fill="none" opacity="0.5"/>
      <path d="M25 70 Q 40 65, 60 70 Q 80 65, 95 70" stroke="#5a3a1a" stroke-width="1" fill="none" opacity="0.5"/>
      <path d="M28 90 Q 45 85, 60 90 Q 75 85, 92 90" stroke="#5a3a1a" stroke-width="1" fill="none" opacity="0.5"/>
      <path d="M30 110 Q 45 105, 60 110 Q 75 105, 90 110" stroke="#5a3a1a" stroke-width="1" fill="none" opacity="0.5"/>
      <path d="M40 30 Q 50 25, 60 30 Q 70 25, 80 30 L 80 45 L 40 45 Z" fill="#f5d4a8" stroke="#5a3a1a" stroke-width="1.5"/>
      <path d="M45 32 Q 55 28, 65 32 Q 75 28, 78 32" stroke="#5a3a1a" stroke-width="0.5" fill="none" opacity="0.6"/>
    </svg>`,

    flower: `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg">
      <line x1="50" y1="70" x2="50" y2="135" stroke="#2a4a20" stroke-width="3"/>
      <ellipse cx="35" cy="110" rx="12" ry="5" fill="#3a6a30" transform="rotate(-30 35 110)"/>
      <ellipse cx="65" cy="115" rx="12" ry="5" fill="#3a6a30" transform="rotate(30 65 115)"/>
      <g>
        <ellipse cx="50" cy="25" rx="14" ry="22" fill="#222"/>
        <ellipse cx="25" cy="50" rx="14" ry="22" fill="#222" transform="rotate(-60 25 50)"/>
        <ellipse cx="75" cy="50" rx="14" ry="22" fill="#222" transform="rotate(60 75 50)"/>
        <ellipse cx="30" cy="75" rx="14" ry="22" fill="#222" transform="rotate(-120 30 75)"/>
        <ellipse cx="70" cy="75" rx="14" ry="22" fill="#222" transform="rotate(120 70 75)"/>
      </g>
      <circle cx="50" cy="50" r="14" fill="#d4a040"/>
      <circle cx="46" cy="46" r="3" fill="#f5d080" opacity="0.6"/>
    </svg>`,

    mountain: `<svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7090b0"/><stop offset="60%" stop-color="#a8b0a0"/><stop offset="100%" stop-color="#4a5040"/></linearGradient></defs>
      <polygon points="0,120 50,40 90,80 130,30 180,70 200,120" fill="url(#mg)"/>
      <polygon points="0,120 30,80 60,90 90,75 120,85 150,80 180,90 200,120" fill="#5a6050" opacity="0.6"/>
      <circle cx="160" cy="25" r="12" fill="#f5e0a8" opacity="0.85"/>
      <ellipse cx="100" cy="118" rx="100" ry="6" fill="#2a3020" opacity="0.4"/>
    </svg>`,

    chair: `<svg viewBox="0 0 80 120" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="10" width="40" height="50" rx="20" fill="none" stroke="#8a4a20" stroke-width="3"/>
      <ellipse cx="40" cy="62" rx="20" ry="6" fill="#a8622a" stroke="#6a3010" stroke-width="2"/>
      <line x1="25" y1="65" x2="20" y2="115" stroke="#6a3010" stroke-width="3"/>
      <line x1="55" y1="65" x2="60" y2="115" stroke="#6a3010" stroke-width="3"/>
      <line x1="20" y1="115" x2="60" y2="115" stroke="#6a3010" stroke-width="3"/>
    </svg>`,

    sofa: `<svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg">
      <defs><pattern id="sp" patternUnits="userSpaceOnUse" width="20" height="20"><rect width="20" height="20" fill="#c84a3a"/><path d="M0 0 L20 20 M20 0 L0 20" stroke="#a83828" stroke-width="2"/></pattern></defs>
      <rect x="10" y="40" width="140" height="50" rx="6" fill="url(#sp)"/>
      <rect x="5" y="35" width="20" height="55" rx="6" fill="#a83828"/>
      <rect x="135" y="35" width="20" height="55" rx="6" fill="#a83828"/>
      <rect x="25" y="45" width="40" height="30" rx="3" fill="#d8a04a"/>
      <rect x="70" y="45" width="40" height="30" rx="3" fill="#d8a04a"/>
      <rect x="115" y="45" width="20" height="30" rx="3" fill="#d8a04a"/>
      <line x1="20" y1="90" x2="15" y2="100" stroke="#3a1808" stroke-width="3"/>
      <line x1="140" y1="90" x2="145" y2="100" stroke="#3a1808" stroke-width="3"/>
    </svg>`,

    torn_paper: `<svg viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 5 L 15 2 L 30 6 L 50 3 L 70 5 L 90 2 L 110 4 L 120 0 L 120 55 L 105 58 L 85 56 L 65 58 L 45 55 L 25 58 L 10 56 L 0 58 Z" fill="#0a2e8c" stroke="#001a5a" stroke-width="1"/>
    </svg>`,

    star: `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
      <polygon points="30,5 36,22 54,22 40,33 46,52 30,40 14,52 20,33 6,22 24,22" fill="#ffd700" stroke="#b8860b" stroke-width="1"/>
    </svg>`
  };

  /* ====== 2. 贴纸布局配置（换图案只改这里） ======
     pos: 相对视口的百分比位置
     size: 像素尺寸
     depth: 视差深度 (0=最远 1=最近)
     rot: 旋转角度 */
  const STICKERS = [
    { type: 'chair',      pos: {x: 12, y: 25}, size: 110, depth: 0.6, rot: -8 },
    { type: 'torn_paper', pos: {x: 25, y: 18}, size: 130, depth: 0.2, rot: 2 },
    { type: 'brain',      pos: {x: 50, y: 22}, size: 130, depth: 0.5, rot: -5 },
    { type: 'flower',     pos: {x: 65, y: 30}, size: 130, depth: 0.7, rot: 6 },
    { type: 'eye',        pos: {x: 88, y: 24}, size: 140, depth: 0.5, rot: 3 },
    { type: 'heart',      pos: {x: 22, y: 50}, size: 90,  depth: 0.7, rot: -12 },
    { type: 'mountain',   pos: {x: 50, y: 48}, size: 160, depth: 0.4, rot: 0 },
    { type: 'sofa',       pos: {x: 75, y: 55}, size: 140, depth: 0.6, rot: 4 },
    { type: 'star',       pos: {x: 92, y: 50}, size: 50,  depth: 0.85, rot: 10 },
    { type: 'torn_paper', pos: {x: 8,  y: 70}, size: 90,  depth: 0.3, rot: -5 },
    { type: 'heart',      pos: {x: 40, y: 75}, size: 50,  depth: 0.85, rot: 8 },
    { type: 'star',       pos: {x: 60, y: 78}, size: 35,  depth: 0.85, rot: -10 }
  ];

  /* ====== 3. 便利贴配置 ====== */
  const NOTES = [
    { text: 'I am not broken', color: 'yellow', pos: {x: 18, y: 38}, rot: -5, depth: 0.6 },
    { text: 'This is not venting,<br>I don\'t know what else to do', color: 'white', pos: {x: 65, y: 18}, rot: 4, depth: 0.5 },
    { text: 'What I feel<br>is MATTERS', color: 'yellow', pos: {x: 90, y: 38}, rot: 6, depth: 0.6 },
    { text: 'Do you try<br>to figure<br>this one out too', color: 'pink', pos: {x: 50, y: 65}, rot: 0, depth: 0.7 },
    { text: 'This weekend<br>was a reprieve', color: 'white', pos: {x: 80, y: 65}, rot: 5, depth: 0.7 }
  ];

  /* ====== 4. 初始化 ====== */
  function init() {
    const bgCanvas = document.getElementById('collage-bg');
    const stickersEl = document.getElementById('collage-stickers');
    const notesEl = document.getElementById('collage-notes');
    if (!bgCanvas || !stickersEl || !notesEl) return;

    initBackground(bgCanvas);
    initStickers(stickersEl);
    initNotes(notesEl);
    initParallax();
  }

  /* ====== 5. 背景画布：粉红噪点 + 蓝色撕纸笔触 ====== */
  function initBackground(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w, h;
    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      draw();
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);

      // 5.1 整体粉红色（背景已由CSS提供，这里画点变化）
      ctx.fillStyle = 'rgba(255, 95, 162, 1)';
      ctx.fillRect(0, 0, w, h);

      // 5.2 噪点纹理（随机像素）
      const imageData = ctx.createImageData(w, h);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const noise = (Math.random() - 0.5) * 25;
        d[i]     = Math.max(0, Math.min(255, 255 + noise));
        d[i + 1] = Math.max(0, Math.min(255, 95  + noise * 0.6));
        d[i + 2] = Math.max(0, Math.min(255, 162 + noise * 0.7));
        d[i + 3] = 18;
      }
      ctx.putImageData(imageData, 0, 0);

      // 5.3 蓝色撕纸笔触（呼应参考图）
      drawTornStrokes(ctx, w, h);
    }

    function drawTornStrokes(ctx, w, h) {
      ctx.save();
      ctx.fillStyle = '#0a2e8c';
      ctx.strokeStyle = '#001a5a';
      ctx.lineWidth = 1;

      // 3道蓝色撕纸痕迹
      const strokes = [
        { x: w * 0.18, y: h * 0.22, w: 130, h: 28, rot: -3 },
        { x: w * 0.55, y: h * 0.18, w: 90,  h: 22, rot: 2 },
        { x: w * 0.12, y: h * 0.62, w: 110, h: 26, rot: -8 }
      ];

      strokes.forEach(s => {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot * Math.PI / 180);
        // 撕纸形状 - 不规则多边形
        ctx.beginPath();
        const pts = generateTornPath(s.w, s.h);
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });
      ctx.restore();
    }

    function generateTornPath(w, h) {
      const pts = [];
      const steps = 16;
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const y = (Math.random() - 0.5) * 6;
        pts.push({ x: t * w, y: y });
      }
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const y = h + (Math.random() - 0.5) * 6;
        pts.push({ x: t * w, y: y });
      }
      return pts;
    }

    resize();
    let resizeTimer;
    window.addEventListener('resize', function() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 200);
    });

    // 背景画布也参与轻微视差
    let mouseX = 0, mouseY = 0;
    document.addEventListener('mousemove', function(e) {
      mouseX = (e.clientX / window.innerWidth - 0.5);
      mouseY = (e.clientY / window.innerHeight - 0.5);
    });
    function loop() {
      canvas.style.transform = `translate(${mouseX * -8}px, ${mouseY * -8}px)`;
      requestAnimationFrame(loop);
    }
    loop();
  }

  /* ====== 6. 渲染贴纸 ====== */
  function initStickers(container) {
    STICKERS.forEach(cfg => {
      const el = document.createElement('div');
      el.className = 'collage-sticker';
      el.style.left = cfg.pos.x + '%';
      el.style.top = cfg.pos.y + '%';
      el.style.width = cfg.size + 'px';
      el.style.height = cfg.size + 'px';
      el.style.transform = `translate(-50%, -50%) rotate(${cfg.rot}deg)`;
      el.dataset.depth = cfg.depth;
      el.dataset.baseX = cfg.pos.x;
      el.dataset.baseY = cfg.pos.y;
      el.dataset.baseRot = cfg.rot;
      el.innerHTML = STICKER_SVG[cfg.type] || '';
      container.appendChild(el);
    });
  }

  /* ====== 7. 渲染便签 ====== */
  function initNotes(container) {
    NOTES.forEach(cfg => {
      const el = document.createElement('div');
      el.className = 'collage-note ' + cfg.color;
      el.style.left = cfg.pos.x + '%';
      el.style.top = cfg.pos.y + '%';
      el.style.setProperty('--rot', cfg.rot + 'deg');
      el.style.transform = `translate(-50%, -50%) rotate(${cfg.rot}deg)`;
      el.dataset.depth = cfg.depth;
      el.dataset.baseX = cfg.pos.x;
      el.dataset.baseY = cfg.pos.y;
      el.dataset.baseRot = cfg.rot;
      el.innerHTML = cfg.text;
      container.appendChild(el);
    });
  }

  /* ====== 8. 多层级视差互动 ====== */
  function initParallax() {
    const stickers = document.querySelectorAll('.collage-sticker, .collage-note');
    const headline = document.querySelector('.collage-headline');
    const headlineLines = document.querySelectorAll('.collage-headline .line');
    const msg = document.querySelector('.collage-msg');

    let targetX = 0, targetY = 0;
    let curX = 0, curY = 0;

    document.addEventListener('mousemove', function(e) {
      targetX = (e.clientX / window.innerWidth - 0.5) * 2;
      targetY = (e.clientY / window.innerHeight - 0.5) * 2;
    });

    function lerp(a, b, t) { return a + (b - a) * t; }

    function loop() {
      curX = lerp(curX, targetX, 0.08);
      curY = lerp(curY, targetY, 0.08);

      // 贴纸 - 根据depth位移
      stickers.forEach(el => {
        const depth = parseFloat(el.dataset.depth) || 0.5;
        const dx = -curX * depth * 60;
        const dy = -curY * depth * 60;
        const baseRot = parseFloat(el.dataset.baseRot) || 0;
        el.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${baseRot + curX * depth * 4}deg)`;
      });

      // 主标题 - 中等深度
      if (headline) {
        const d = 0.35;
        headline.style.transform = `translate(${-curX * d * 30}px, ${-curY * d * 20}px)`;
      }
      headlineLines.forEach((line, i) => {
        const d = 0.2 + i * 0.1;
        line.style.transform = `translate(${-curX * d * 15}px, ${-curY * d * 10}px)`;
      });

      // 讯息
      if (msg) {
        const d = 0.4;
        msg.style.transform = `translate(${-curX * d * 25}px, ${-curY * d * 20}px)`;
      }

      requestAnimationFrame(loop);
    }
    loop();
  }

  /* ====== 9. 启动 ====== */
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 100);
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(init, 100);
    });
  }
})();
