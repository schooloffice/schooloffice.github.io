'use strict';
/* core/sanitize.js — безпечне очищення HTML */

const ArtSanitize = (() => {
  const ALLOWED_TAGS = [
    'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'h1', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'a', 'img'
  ];

  // Дозволяємо лише те оформлення, яке документ справді використовує.
  // Раніше `style` пропускався цілком, тож вставлений фрагмент міг містити
  // position:fixed;inset:0;z-index:999999 і перекрити інтерфейс редактора
  // (аудит F13). Позиціювання, шарів і спливання тут немає навмисно.
  const ALLOWED_CSS_PROPERTIES = new Set([
    'color', 'background-color',
    'font-family', 'font-size', 'font-weight', 'font-style',
    'text-align', 'text-decoration', 'text-decoration-color', 'text-indent',
    'line-height', 'vertical-align', 'white-space',
    'margin-left', 'margin-right', 'margin-top', 'margin-bottom',
    'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom',
    'border', 'border-color', 'border-style', 'border-width', 'border-collapse',
    'width', 'height', 'max-width'
  ]);

  // Значення теж обмежені: url(), expression() і подібне до документа
  // потрапити не мають, навіть у дозволеній властивості.
  const FORBIDDEN_CSS_VALUE = /url\s*\(|expression\s*\(|javascript:|@import|[\\<>]/i;

  function cleanStyleAttribute(value) {
    const out = [];
    for (const part of String(value || '').split(';')) {
      const at = part.indexOf(':');
      if (at < 0) continue;
      const name = part.slice(0, at).trim().toLowerCase();
      const raw = part.slice(at + 1).trim();
      if (!ALLOWED_CSS_PROPERTIES.has(name)) continue;
      if (!raw || FORBIDDEN_CSS_VALUE.test(raw)) continue;
      out.push(`${name}: ${raw}`);
    }
    return out.join('; ');
  }

  function applyStylePolicy(root) {
    for (const el of root.querySelectorAll('[style]')) {
      const cleaned = cleanStyleAttribute(el.getAttribute('style'));
      if (cleaned) el.setAttribute('style', cleaned);
      else el.removeAttribute('style');
    }
  }

  function clean(dirty = '') {
    // Без sanitizer HTML у документ не потрапляє взагалі. Раніше тут був
    // ручний blacklist, слабший за основний шлях: він, зокрема, лишав
    // href="java&#10;script:void(0)" (аудит F13). Другий, слабший парсер —
    // це не запасний варіант, а тихе зниження захисту, тож замість нього
    // повертаємо звичайний текст.
    if (typeof DOMPurify === 'undefined') return textOnly(dirty);

    const html = DOMPurify.sanitize(String(dirty), {
      ALLOWED_TAGS,
      ALLOWED_ATTR: ['style', 'href', 'target', 'rel', 'colspan', 'rowspan', 'src', 'alt'],
      ALLOW_DATA_ATTR: false,
      // Рядки, а не регулярні вирази: DOMPurify звіряє імена атрибутів за
      // точним збігом, тож /^on/i у цьому списку просто ігнорувався б.
      // Обробники подій він і так знімає — тут лише прибрано хибне враження,
      // ніби захист забезпечує саме цей рядок.
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'input', 'button', 'textarea', 'select']
    });

    // DOMPurify не знає, які CSS-властивості доречні саме в цьому документі,
    // тож звужуємо style окремим проходом.
    const holder = document.createElement('template');
    holder.innerHTML = html;
    applyStylePolicy(holder.content);
    return serialize(holder.content);
  }

  // Текстовий запасний шлях: розмітка втрачається, вміст — ні.
  function textOnly(dirty) {
    const holder = document.createElement('template');
    holder.innerHTML = String(dirty);
    const text = holder.content.textContent || '';
    return text
      .split(/\r?\n/)
      .map(line => {
        const p = document.createElement('p');
        if (line.trim()) p.textContent = line;
        else p.appendChild(document.createElement('br'));
        return p.outerHTML;
      })
      .join('');
  }

  function serialize(fragment) {
    const holder = document.createElement('div');
    holder.appendChild(fragment.cloneNode(true));
    return [...holder.childNodes]
      .map(node => (node.nodeType === Node.ELEMENT_NODE ? node.outerHTML : escapeText(node.textContent || '')))
      .join('');
  }

  function escapeText(text) {
    const holder = document.createElement('span');
    holder.textContent = text;
    return holder.outerHTML.replace(/^<span>|<\/span>$/g, '');
  }

  return { clean, cleanStyleAttribute };
})();
