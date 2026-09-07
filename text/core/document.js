'use strict';
/* core/document.js — логічна модель документа Тексту.
 *
 * Тут живе межа між ДОКУМЕНТОМ і його ВІДОБРАЖЕННЯМ. У DOM редактора вони
 * змішані: пагінатор ріже таблиці між сторінками, повторює рядок заголовка,
 * додає маркери виділення й підсвітку пошуку. Усе це — верстка, а не вміст,
 * і у файл потрапляти не має (аудит F06).
 *
 * Модуль навмисно не знає ні про UI, ні про сторінки: він приймає HTML
 * редактора й властивості документа, а повертає версіоновану структуру.
 * Застосуванням до редактора займається UI-шар.
 */

const ArtDocument = (() => {
  const FORMAT = 'office-plus-text';
  const SCHEMA_VERSION = 1;
  const FILE_EXTENSION = 'tekst';

  // Ті самі межі, що й в імпорті обміну (ui/editor.js): файл у межах розміру
  // все одно може розгорнутися в документ, який редактор не витягне.
  const MAX_CONTENT_CHARS = 4 * 1024 * 1024;
  const MAX_NAME_CHARS = 120;

  // Словник геометрії. Остаточне обмеження полів робить ui/page.js, коли
  // рахує реальну сторінку; тут відсікаємо лише значення поза будь-яким
  // здоровим діапазоном, щоб недовірений файл не потрапив у стан.
  const PAGE_SIZES = ['a4', 'a5', 'letter'];
  const ORIENTATIONS = ['portrait', 'landscape'];
  const MARGIN_SIDES = ['top', 'right', 'bottom', 'left'];
  const MIN_MARGIN_CM = 0;
  const MAX_MARGIN_CM = 10;
  const DEFAULT_MARGINS = { top: 2, right: 1.5, bottom: 2, left: 3 };

  // ---- Логічний вміст ----
  // Єдине місце, яке знає, які сліди лишає пагінатор. Історія користується
  // цією ж функцією для порівняння станів, тож розбіжності між «що вважається
  // зміною» і «що потрапляє у файл» бути не може.
  function logicalContent(html) {
    const source = document.createElement('div');
    source.innerHTML = html || '';
    const logical = document.createElement('div');

    // Сторінки — контейнери верстки: зливаємо їхній вміст в один потік.
    const pageContents = [...source.querySelectorAll('.page-content')];
    const containers = pageContents.length ? pageContents : [source];
    containers.forEach(container => {
      [...container.childNodes].forEach(node => logical.appendChild(node.cloneNode(true)));
    });

    logical.querySelectorAll('.art-sel-marker, tr[data-art-table-repeat]').forEach(node => node.remove());
    logical.querySelectorAll('[data-art-flow-tail]').forEach(node => node.removeAttribute('data-art-flow-tail'));
    logical.querySelectorAll('.is-selected').forEach(node => node.classList.remove('is-selected'));
    logical.querySelectorAll('mark.search-hit').forEach(mark => mark.replaceWith(...mark.childNodes));

    // Таблиця, розрізана між сторінками, — це одна таблиця документа.
    let node = logical.firstElementChild;
    while (node) {
      const next = node.nextElementSibling;
      if (node.tagName === 'TABLE' && next?.tagName === 'TABLE' && next.dataset.artTablePart === 'continued') {
        const body = node.tBodies[0] || node;
        [...(next.tBodies[0] || next).rows].forEach(row => body.appendChild(row));
        next.remove();
        continue;
      }
      node = next;
    }
    logical.querySelectorAll('table[data-art-table-part]').forEach(table => table.removeAttribute('data-art-table-part'));

    // Кнопки зміни розміру зображення — елементи керування, а не вміст.
    logical.querySelectorAll('.art-image-handle').forEach(node => node.remove());

    // Атрибути редагування редактор проставляє сам під час завантаження
    // (див. _upgradeImageBlocks). У файлі вони зайві, а очищення їх усе одно
    // зніме — і тоді збережене й перевірене не збігалися б.
    logical.querySelectorAll('[contenteditable], [tabindex], [spellcheck]').forEach(node => {
      node.removeAttribute('contenteditable');
      node.removeAttribute('tabindex');
      node.removeAttribute('spellcheck');
    });

    return logical.innerHTML;
  }

  // ---- Серіалізація ----
  // Вміст записуємо вже очищеним: це та сама форма, у якій він повернеться
  // після валідації, тож збережене і перевірене збігаються байт у байт.
  function serialize({ html = '', name = '', page = null } = {}) {
    return {
      format: FORMAT,
      version: SCHEMA_VERSION,
      name: normalizeName(name),
      page: normalizePage(page),
      content: ArtSanitize.clean(logicalContent(html))
    };
  }

  // ---- Валідація ----
  // Робочий файл — недовірений вхід: його могли надіслати учневі звідки
  // завгодно. Повертаємо явний результат, а не кидаємо виняток, щоб виклик
  // міг лишити поточний документ на місці й показати причину.
  function validate(payload) {
    if (!payload || typeof payload !== 'object') return fail('not-an-object');
    if (payload.format !== FORMAT) return fail('wrong-format');

    const version = Number(payload.version);
    if (!Number.isInteger(version) || version < 1) return fail('bad-version');
    if (version > SCHEMA_VERSION) return fail('newer-version');

    const rawContent = typeof payload.content === 'string' ? payload.content : '';
    if (rawContent.length > MAX_CONTENT_CHARS) return fail('too-large');

    // Очищення — частина валідації, а не окремий крок пізніше: у стан має
    // потрапляти вже безпечний вміст.
    const content = ArtSanitize.clean(rawContent);
    if (content.length > MAX_CONTENT_CHARS) return fail('too-large');

    return {
      ok: true,
      reason: '',
      value: {
        format: FORMAT,
        version: SCHEMA_VERSION,
        name: normalizeName(payload.name),
        page: normalizePage(payload.page),
        content
      }
    };
  }

  function fail(reason) {
    return { ok: false, reason, value: null };
  }

  // ---- Нормалізація частин ----
  function normalizeName(value) {
    const name = String(value ?? '').trim().replace(/[\r\n\t]/g, ' ');
    return name ? name.slice(0, MAX_NAME_CHARS) : 'документ';
  }

  function normalizeMargins(value) {
    const source = value && typeof value === 'object' ? value : {};
    const out = {};
    for (const side of MARGIN_SIDES) {
      const raw = Number(source[side]);
      out[side] = Number.isFinite(raw)
        ? Math.min(MAX_MARGIN_CM, Math.max(MIN_MARGIN_CM, raw))
        : DEFAULT_MARGINS[side];
    }
    return out;
  }

  function normalizePage(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      size: PAGE_SIZES.includes(source.size) ? source.size : 'a4',
      orientation: ORIENTATIONS.includes(source.orientation) ? source.orientation : 'portrait',
      margins: normalizeMargins(source.margins),
      numbers: ArtState.normalizePageNumbers(source.numbers)
    };
  }

  // ---- Міст до стану редактора ----
  // ArtState зберігає геометрію в трохи інших іменах (pageSize/pageNumbers),
  // ніж файл (size/numbers): у схемі імена коротші й не тягнуть за собою
  // внутрішню структуру стану. Перехід між ними тримаємо в одному місці.
  function pageFromState(snapshot) {
    const source = snapshot || {};
    return normalizePage({
      size: source.pageSize,
      orientation: source.orientation,
      margins: source.margins,
      numbers: source.pageNumbers
    });
  }

  function pageToState(page) {
    const normalized = normalizePage(page);
    return {
      pageSize: normalized.size,
      orientation: normalized.orientation,
      margins: normalized.margins,
      pageNumbers: normalized.numbers
    };
  }

  return {
    FORMAT, SCHEMA_VERSION, FILE_EXTENSION,
    MAX_CONTENT_CHARS, MAX_NAME_CHARS,
    logicalContent, serialize, validate,
    normalizePage, pageFromState, pageToState
  };
})();
