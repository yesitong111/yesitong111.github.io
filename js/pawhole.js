/*
 * pawhole.js — 博客首页首屏：猫爪形“黑洞” + 流动水波边缘 + 涟漪/极光光环 + 水晶球闪粉粒子
 * 只在首页（#site-info 存在时）挂载。全屏 WebGL canvas 铺在封面背景上、文字之下。
 * 鼠标移动有延迟惯性视差（同猫咪页）。纯黑白银调，点彩/极光美感。
 */
(function () {
  'use strict';

  function init() {
    var header = document.getElementById('page-header');
    if (!header || !header.classList.contains('full_page')) return;
    if (!window.WebGLRenderingContext) return;

    var canvas = document.createElement('canvas');
    canvas.className = 'pawhole-canvas';
    header.insertBefore(canvas, header.firstChild);

    var gl = canvas.getContext('webgl', { alpha: false, antialias: false }) ||
             canvas.getContext('experimental-webgl', { alpha: false });
    if (!gl) return;

    /* ---------- 全屏背景着色器（猫爪黑洞 + 水波 + 涟漪极光 + 颗粒） ---------- */
    var BG_VSH =
      'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';

    var BG_FSH = [
      'precision highp float;',
      'varying vec2 vUv;',
      'uniform float uTime, uAspect;',
      'uniform vec2 uMouse;',

      // 哈希 / 噪声
      'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }',
      'float noise(vec2 p){',
      '  vec2 i = floor(p), f = fract(p);',
      '  vec2 u = f*f*(3.0-2.0*f);',
      '  return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), u.x),',
      '             mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), u.x), u.y);',
      '}',
      'float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }',

      // 椭圆高斯团（用于拼成猫爪：一个大掌垫 + 四个趾垫）
      'float blob(vec2 p, vec2 c, vec2 r){ vec2 q = (p-c)/r; return exp(-dot(q,q)*2.6); }',

      // 猫爪力场 F（越大越靠近内部），位置经水波域扭曲→边缘流动
      'float pawField(vec2 p){',
      '  vec2 w = p;',
      '  w += vec2(fbm(p*2.2 + vec2(uTime*0.10, 0.0)), fbm(p*2.2 + vec2(0.0, uTime*0.12))) * 0.05;',
      '  w += vec2(noise(p*5.0 - uTime*0.18), noise(p*5.0 + uTime*0.15)) * 0.02;',
      '  float f = 0.0;',
      '  f += blob(w, vec2(0.0, -0.16), vec2(0.40, 0.34));  // 大掌垫',
      '  f += blob(w, vec2(-0.285, 0.26), vec2(0.145, 0.165)); // 趾垫 外',
      '  f += blob(w, vec2( 0.285, 0.26), vec2(0.145, 0.165));',
      '  f += blob(w, vec2(-0.095, 0.40), vec2(0.125, 0.145)); // 趾垫 内',
      '  f += blob(w, vec2( 0.095, 0.40), vec2(0.125, 0.145));',
      '  return f;',
      '}',

      'void main(){',
      '  vec2 uv = vUv;',
      // 归一化坐标（以高度为基准），中心 0
      '  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0) * 2.0;',
      // 鼠标延迟视差：黑洞轻微跟随，背景反向轻移（层次）
      '  vec2 m = uMouse;',
      '  vec2 pc = p - m * 0.06;',
      '  vec2 pp = pc * 0.66;',   // 收缩场坐标→放大猫爪，使其成为画面主体
      '  float F = pawField(pp);',

      // 背景：左亮右暗的柔和银灰渐变 + 暗角 + 颗粒（黑白调）
      '  float grad = 1.0 - smoothstep(-0.55, 1.15, p.x + m.x*0.10);',
      '  float bg = mix(0.10, 0.82, grad);',
      '  float vig = 1.0 - smoothstep(0.35, 1.9, length(p*vec2(0.72, 0.95)));',
      '  bg *= 0.55 + 0.45 * vig;',
      '  bg += (hash(uv*vec2(uAspect*900.0, 700.0)) - 0.5) * 0.05;',

      // 黑洞内部
      '  float hole = smoothstep(0.55, 0.72, F);',

      // 边缘流动亮边（极光感）：F 附近的亮带，随噪声流动明暗
      '  float rimBand = exp(-pow((F - 0.52) * 6.0, 2.0));',
      '  float flow = 0.6 + 0.4 * fbm(pc*3.0 + vec2(uTime*0.25, -uTime*0.2));',
      '  float rim = rimBand * flow;',

      // 涟漪：从爪心向外一圈圈荡出，集中在边缘外侧、随距离衰减（用缩放坐标与爪同心）
      '  float r0 = length(pp - vec2(0.0, 0.02));',
      '  float rings = 0.5 + 0.5 * sin(r0 * 14.0 - uTime * 2.2);',
      '  float ringEnv = (1.0 - smoothstep(0.45, 0.78, F)) * (1.0 - smoothstep(0.5, 1.6, r0));',
      '  float ripple = rings * ringEnv * 0.30;',

      // 合成：背景 + 涟漪极光，再压入黑洞
      '  float col = bg;',
      '  col += rim * 0.55 + ripple;',
      '  col = mix(col, 0.0, hole);',
      '  col = clamp(col, 0.0, 1.0);',
      '  gl_FragColor = vec4(vec3(col), 1.0);',
      '}'
    ].join('\n');

    /* ---------- 闪粉粒子着色器（水晶球里漂浮、闪烁发光的小亮片） ---------- */
    var PT_VSH = [
      'attribute vec2 aSeed;',   // xy: 随机
      'uniform float uTime, uAspect, uSize;',
      'uniform vec2 uMouse;',
      'varying float vTw;',
      'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }',
      'void main(){',
      '  vec2 anchor = (vec2(hash(aSeed), hash(aSeed + 17.3)) * 2.0 - 1.0) * vec2(uAspect, 1.0);',
      // 缓慢漂浮
      '  vec2 drift = vec2(sin(uTime*0.10 + aSeed.x*40.0), cos(uTime*0.08 + aSeed.y*40.0)) * 0.06;',
      // 视差深度：近景跟随大、远景小（鼠标延迟惯性由 JS 传入 uMouse）
      '  float depth = mix(0.3, 1.3, hash(aSeed + 5.1));',
      '  vec2 pos = anchor + drift - uMouse * depth * 0.10;',
      '  pos.x /= uAspect;',
      '  gl_Position = vec4(pos, 0.0, 1.0);',
      // 尖峰闪烁（闪粉被光打到偶发亮）
      '  float sp = 0.7 + hash(aSeed + 9.9) * 1.8;',
      '  float tw = 0.5 + 0.5 * sin(uTime * sp + aSeed.x * 80.0);',
      '  vTw = tw * tw * tw;',
      '  float base = mix(1.2, 3.4, hash(aSeed + 3.3));',
      '  gl_PointSize = base * (0.7 + vTw * 1.3) * uSize;',
      '}'
    ].join('\n');

    var PT_FSH = [
      'precision mediump float;',
      'varying float vTw;',
      'void main(){',
      '  vec2 c = gl_PointCoord - 0.5;',
      '  float d = length(c);',
      '  float core = smoothstep(0.5, 0.12, d);',
      '  float halo = vTw * exp(-d*d*9.0) * 0.9;',                 // 亮闪柔光晕
      '  float rays = vTw * (exp(-abs(c.x)*26.0) + exp(-abs(c.y)*26.0)) * exp(-d*3.0) * 0.25;', // 细星芒
      '  float a = (core * 0.85 + halo + rays);',
      '  if (a < 0.01) discard;',
      '  gl_FragColor = vec4(1.0, 1.0, 1.0, a);',
      '}'
    ].join('\n');

    function compile(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('pawhole shader error:', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    }
    function program(vsh, fsh) {
      var p = gl.createProgram();
      var vs = compile(gl.VERTEX_SHADER, vsh), fs = compile(gl.FRAGMENT_SHADER, fsh);
      if (!vs || !fs) return null;
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn('link fail'); return null; }
      return p;
    }

    var bgProg = program(BG_VSH, BG_FSH);
    var ptProg = program(PT_VSH, PT_FSH);
    if (!bgProg || !ptProg) return;

    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);

    // 闪粉粒子
    var FLAKES = 420;
    var seeds = new Float32Array(FLAKES * 2);
    for (var i = 0; i < FLAKES; i++) { seeds[i*2] = Math.random(); seeds[i*2+1] = Math.random(); }
    var flakeBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, flakeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);

    var bgLoc = {
      aPos: gl.getAttribLocation(bgProg, 'aPos'),
      uTime: gl.getUniformLocation(bgProg, 'uTime'),
      uAspect: gl.getUniformLocation(bgProg, 'uAspect'),
      uMouse: gl.getUniformLocation(bgProg, 'uMouse')
    };
    var ptLoc = {
      aSeed: gl.getAttribLocation(ptProg, 'aSeed'),
      uTime: gl.getUniformLocation(ptProg, 'uTime'),
      uAspect: gl.getUniformLocation(ptProg, 'uAspect'),
      uSize: gl.getUniformLocation(ptProg, 'uSize'),
      uMouse: gl.getUniformLocation(ptProg, 'uMouse')
    };

    // 鼠标（延迟惯性）
    var target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
    function onMove(e) {
      var w = window.innerWidth, h = window.innerHeight;
      var cx = (e.touches ? e.touches[0].clientX : e.clientX);
      var cy = (e.touches ? e.touches[0].clientY : e.clientY);
      target.x = (cx / w) * 2 - 1;
      target.y = -((cy / h) * 2 - 1);
    }
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = header.clientWidth || window.innerWidth;
      var h = header.clientHeight || window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      gl.viewport(0, 0, canvas.width, canvas.height);
      resize.aspect = canvas.width / canvas.height;
      resize.usize = dpr * (h / 700);
    }
    resize();
    window.addEventListener('resize', resize);

    var start = performance.now();
    function frame() {
      var t = (performance.now() - start) / 1000;
      // 延迟惯性
      cur.x += (target.x - cur.x) * 0.055;
      cur.y += (target.y - cur.y) * 0.055;

      gl.disable(gl.BLEND);
      gl.useProgram(bgProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(bgLoc.aPos);
      gl.vertexAttribPointer(bgLoc.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(bgLoc.uTime, t);
      gl.uniform1f(bgLoc.uAspect, resize.aspect);
      gl.uniform2f(bgLoc.uMouse, cur.x, cur.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // 加色发光
      gl.useProgram(ptProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, flakeBuf);
      gl.enableVertexAttribArray(ptLoc.aSeed);
      gl.vertexAttribPointer(ptLoc.aSeed, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(ptLoc.uTime, t);
      gl.uniform1f(ptLoc.uAspect, resize.aspect);
      gl.uniform1f(ptLoc.uSize, resize.usize);
      gl.uniform2f(ptLoc.uMouse, cur.x, cur.y);
      gl.drawArrays(gl.POINTS, 0, FLAKES);

      requestAnimationFrame(frame);
    }
    frame();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 60);
  } else {
    window.addEventListener('DOMContentLoaded', function () { setTimeout(init, 60); });
  }
})();
