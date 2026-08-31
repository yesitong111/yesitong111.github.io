(function() {
  function initCustomTyped() {
    var subtitleEl = document.getElementById('subtitle');
    if (!subtitleEl) return;

    if (window.typed && typeof window.typed.destroy === 'function') {
      try { window.typed.destroy(); } catch (e) {}
    }
    subtitleEl.innerHTML = '';

    var sentences = [
      { text: '谁怕？一蓑烟雨任平生', typeSpeed: 180, backSpeed: 120, backDelay: 1500 },
      { text: "What to fear? I'll walk through life, rain-cloaked, come what may.", typeSpeed: 50, backSpeed: 32, backDelay: 1500 },
      { text: '¿Qué hay que temer? Con mi capa de paja, atravieso la vida ante cualquier tormenta.', typeSpeed: 36, backSpeed: 23, backDelay: 1500 }
    ];

    var cursor = document.createElement('span');
    cursor.className = 'typed-cursor';
    cursor.textContent = '|';
    cursor.style.cssText = 'opacity:1; -webkit-animation:blink .7s infinite; -moz-animation:blink .7s infinite; animation:blink .7s infinite; margin-left:2px; display:inline-block;';

    var styleId = 'custom-typed-blink-style';
    if (!document.getElementById(styleId)) {
      var style = document.createElement('style');
      style.id = styleId;
      style.textContent = '@keyframes blink{0%{opacity:1}50%{opacity:0}100%{opacity:1}}@-webkit-keyframes blink{0%{opacity:1}50%{opacity:0}100%{opacity:1}}@-moz-keyframes blink{0%{opacity:1}50%{opacity:0}100%{opacity:1}}';
      document.head.appendChild(style);
    }

    var textNode = document.createTextNode('');
    subtitleEl.appendChild(textNode);
    subtitleEl.appendChild(cursor);

    var senIdx = 0;
    var typeTimer = null;
    var backTimer = null;
    var nextTimer = null;

    function clearAllTimers() {
      if (typeTimer) { clearTimeout(typeTimer); typeTimer = null; }
      if (backTimer) { clearTimeout(backTimer); backTimer = null; }
      if (nextTimer) { clearTimeout(nextTimer); nextTimer = null; }
    }

    function typeNext() {
      clearAllTimers();
      var sen = sentences[senIdx];
      var fullText = sen.text;
      var charIdx = 0;

      function typeChar() {
        if (charIdx < fullText.length) {
          charIdx++;
          textNode.textContent = fullText.substring(0, charIdx);
          var jitter = sen.typeSpeed * (0.85 + Math.random() * 0.3);
          typeTimer = setTimeout(typeChar, jitter);
        } else {
          backTimer = setTimeout(backspace, sen.backDelay);
        }
      }

      function backspace() {
        if (charIdx > 0) {
          charIdx--;
          textNode.textContent = fullText.substring(0, charIdx);
          backTimer = setTimeout(backspace, sen.backSpeed);
        } else {
          senIdx = (senIdx + 1) % sentences.length;
          nextTimer = setTimeout(typeNext, 250);
        }
      }

      typeChar();
    }

    typeTimer = setTimeout(typeNext, 400);

    window.addEventListener('pjax:send', function() {
      clearAllTimers();
    }, { once: true });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initCustomTyped, 300);
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(initCustomTyped, 300);
    });
  }
})();
