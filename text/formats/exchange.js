'use strict';
/* formats/exchange.js — що саме втрачається у форматах обміну.
 *
 * DOCX, RTF і TXT — це формати передавання роботи, а не її продовження.
 * Раніше імпорт мовчав: список попереджень приходив порожнім навіть тоді,
 * коли з документа зникали властивості сторінки й частина оформлення
 * (аудит F06). Тут рахуємо втрати за фактом — порівнюючи те, що дав
 * конвертер, із тим, що редактор справді прийняв, — і додаємо те, чого
 * формат не описує в принципі.
 */

const ArtExchange = (() => {
  // Відоме наперед: цього у форматі просто немає, скільки не порівнюй.
  const FORMAT_LIMITS = {
    txt: ['таблиці', 'зображення', 'усе оформлення'],
    rtf: ['властивості сторінки', 'частину оформлення'],
    docx: ['властивості сторінки: розмір, орієнтацію, поля й нумерацію']
  };

  // Виміряне: що прийшло від конвертера, але не пройшло в документ.
  const TRACKED = [
    { selector: 'img', one: 'зображення', many: 'зображень' },
    { selector: 'table', one: 'таблицю', many: 'таблиць' },
    { selector: 'h1,h2,h3,h4', one: 'заголовок', many: 'заголовків' },
    { selector: 'ul,ol', one: 'список', many: 'списків' },
    { selector: 'a[href]', one: 'посилання', many: 'посилань' },
    { selector: 'sup,sub', one: 'індекс', many: 'індексів' }
  ];

  function parse(html) {
    return new DOMParser().parseFromString(`<body>${String(html || '')}</body>`, 'text/html').body;
  }

  function describeImport(format, rawHtml, cleanHtml) {
    const notes = [];
    const raw = parse(rawHtml);
    const clean = parse(cleanHtml);

    for (const item of TRACKED) {
      const before = raw.querySelectorAll(item.selector).length;
      const after = clean.querySelectorAll(item.selector).length;
      if (before > after) {
        const lost = before - after;
        notes.push(`${lost} ${lost === 1 ? item.one : item.many} не перенесено`);
      }
    }

    // Оформлення рахуємо окремо: у ньому зникають не вузли, а властивості.
    const styledBefore = raw.querySelectorAll('[style]').length;
    const styledAfter = clean.querySelectorAll('[style]').length;
    if (styledBefore > styledAfter) notes.push('частину оформлення спрощено');

    return { measured: notes, inherent: [...(FORMAT_LIMITS[format] || [])] };
  }

  // Текст для користувача. Порожній список — теж відповідь: формат обміну
  // однаково не описує всього, що вміє редактор.
  function importSummary(format, report, workingExtension) {
    const lines = [];
    if (report.measured.length) lines.push(`З цього файла: ${report.measured.join(', ')}.`);
    if (report.inherent.length) lines.push(`Формат .${format} не зберігає: ${report.inherent.join(', ')}.`);
    lines.push(`Робота відкрита, але ще не збережена. Щоб продовжити її наступного разу, збережіть у .${workingExtension}.`);
    return lines.join('\n');
  }

  return { describeImport, importSummary, FORMAT_LIMITS };
})();
