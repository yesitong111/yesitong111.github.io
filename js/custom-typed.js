document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() {
    var subtitleEl = document.getElementById('subtitle');
    if (!subtitleEl) return;

    if (window.typed && typeof window.typed.destroy === 'function') {
      window.typed.destroy();
    }
    subtitleEl.innerHTML = '';

    // 打字机节奏参数（单位：毫秒/字符）
    // 设计原则：
    //   1. 打印速度取经典打字机节奏，逐字可见（约每秒20-28个字母，8-11个汉字）
    //   2. 退格速度约为打印速度的70%，更接近真实打字机的修正节奏
    //   3. 英/西语按字符数反比配速（64字符 vs 88字符），单轮打印+退格总时长基本一致
    //   4. 打印时加入±15%的轻微节奏抖动，模拟打印机出字的不均匀感
    var sentences = [
      { text: '谁怕？一蓑烟雨任平生', typeSpeed: 180, backSpeed: 120, backDelay: 1500 },
      { text: "What to fear? I'll walk through life, rain-cloaked, come what may.", typeSpeed: 50, backSpeed: 32, backDelay: 1500 },
      { text: '¿Qué hay que temer? Con mi capa de paja, atravieso la vida ante cualquier tormenta.', typeSpeed: 36, backSpeed: 23, backDelay: 1500 }
    ];

    var cursor = document.createElement('span');
    cursor.className = 'typed-cursor';
    cursor.textContent = '|';
    cursor.style.cssText = 'opacity:1; -webkit-animation:blink .7s infinite; -moz-animation:blink .7s infinite; animation:blink .7s infinite; margin-left:2px; display:inline-block;';

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
          // ±15%节奏抖动，让打印更自然
          var jitter = sen.typeSpeed * (0.85 + Math.random() * 0.3);
          setTimeout(typeChar, jitter);
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
          setTimeout(typeNext, 250);
        }
      }

      typeChar();
    }

    setTimeout(typeNext, 400);
  }, 500);
});
