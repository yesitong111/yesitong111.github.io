document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() {
    var subtitleEl = document.getElementById('subtitle');
    if (!subtitleEl) return;

    if (window.typed && typeof window.typed.destroy === 'function') {
      window.typed.destroy();
    }
    subtitleEl.innerHTML = '';

    var targetCycleTime = 4000;
    var pauseTime = 1500;

    var sentences = [
      { text: '谁怕？一蓑烟雨任平生', charCount: 9 },
      { text: "What to fear? I'll walk through life, rain-cloaked, come what may.", charCount: 64 },
      { text: '¿Qué hay que temer? Con mi capa de paja, atravieso la vida ante cualquier tormenta.', charCount: 88 }
    ];

    sentences.forEach(function(sen) {
      var typingTime = (targetCycleTime - pauseTime) / 2;
      var perCharDelay = Math.max(5, Math.floor(typingTime / sen.charCount));
      sen.typeSpeed = perCharDelay;
      sen.backSpeed = perCharDelay;
      sen.backDelay = pauseTime;
    });

    var cursor = document.createElement('span');
    cursor.className = 'typed-cursor';
    cursor.textContent = '|';
    var blinkStyle = 'opacity:1; -webkit-animation:blink .7s infinite; -moz-animation:blink .7s infinite; animation:blink .7s infinite; margin-left:2px; display:inline-block;';
    cursor.style.cssText = blinkStyle;

    var style = document.createElement('style');
    style.textContent = '@keyframes blink{0%{opacity:1}50%{opacity:0}100%{opacity:1}}@-webkit-keyframes blink{0%{opacity:1}50%{opacity:0}100%{opacity:1}}@-moz-keyframes blink{0%{opacity:1}50%{opacity:0}100%{opacity:1}}';
    document.head.appendChild(style);

    var textNode = document.createTextNode('');
    subtitleEl.appendChild(textNode);
    subtitleEl.appendChild(cursor);

    var senIdx = 0;

    function typeNext() {
      var sen = sentences[senIdx];
      var fullText = sen.text;
      var charIdx = 0;

      function typeChar() {
        if (charIdx < fullText.length) {
          charIdx++;
          textNode.textContent = fullText.substring(0, charIdx);
          setTimeout(typeChar, sen.typeSpeed);
        } else {
          setTimeout(backspace, sen.backDelay);
        }
      }

      function backspace() {
        if (charIdx > 0) {
          charIdx--;
          textNode.textContent = fullText.substring(0, charIdx);
          setTimeout(backspace, sen.backSpeed);
        } else {
          senIdx = (senIdx + 1) % sentences.length;
          setTimeout(typeNext, 200);
        }
      }

      typeChar();
    }

    setTimeout(typeNext, 400);
  }, 500);
});
