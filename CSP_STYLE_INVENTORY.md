# CSP_STYLE_INVENTORY.md — інвентаризація динамічного стилювання

Статус: вимірювання, а не рішення. Документ відповідає на одне питання: що станеться, якщо з CSP
production-сторінок прибрати `style-src 'unsafe-inline'`. План аудиту вимагає робити hardening
лише після такої інвентаризації й не переписувати всі style-присвоєння наосліп.

Дата вимірювання: 2026-09-16. Браузер: Chrome (той самий, на якому йде browser smoke).

## Поточний стан

Усі production-сторінки несуть однаковий CSP у `<meta http-equiv="Content-Security-Policy">`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none';
form-action 'self'; worker-src 'self' blob:;
```

`script-src` уже без `'unsafe-inline'`. Послаблення лишилося тільки для стилів.

## Що саме блокує `style-src 'self'` (виміряно)

`tests/csp-style-probe.html` — сторінка з власним суворим CSP, яка застосовує стиль шістьма
способами й читає `getComputedStyle`. Вона не входить у smoke; відкривати вручну через
`tests/serve-office.ps1`. Результат:

| Спосіб | Приклад | Під `style-src 'self'` |
| --- | --- | --- |
| Атрибут `style` у розмітці | `<div style="color: red">` | заблоковано |
| Атрибут `style` через `innerHTML` | `el.innerHTML = '<div style="...">'` | заблоковано |
| `setAttribute('style', ...)` | `el.setAttribute('style', 'color: red')` | заблоковано |
| Властивість CSSOM | `el.style.color = 'red'` | працює |
| `style.cssText` | `el.style.cssText = 'color: red'` | працює |
| Створений у рантаймі `<style>` | `document.head.appendChild(styleEl)` | заблоковано |

Тобто межа проходить не між «статичним» і «динамічним» стилем, а між **атрибутом `style`** (і
елементом `<style>`) з одного боку та **CSSOM-присвоєннями** з іншого.

## Інвентаризація коду

| Місце | Кількість | Під суворим CSP |
| --- | --- | --- |
| `index.html`: вбудований `<style>` | 1 блок, ~354 рядки | заблоковано |
| `index.html`: атрибути `style` | 7 (розкладка `main` і акцентні змінні шести карток) | заблоковано |
| `*/index.html` шести редакторів: атрибути `style` | 0 | — |
| `text/index.html`: `<style id="pagePrintGeometry">`, `<style id="pageSectionPrintGeometry">` | 2 порожні теги, які наповнює `text/ui/page.js` | заблоковано (наповнення не застосується) |
| `text/ui/page.js`: наповнення цих тегів | 2 місця | заблоковано |
| `paint/js/document.js`, `vector/js/app.js`, `slides/js/export.js`: `createElement('style')` | 3 місця | не стосується: стиль додається в документ **нового вікна друку/експорту**, у якого власного CSP немає |
| `text/core/document-model.js`: `style.cssText +=` для вирівнювання зображень | 5 місць | працює (CSSOM) |
| `text/formats/docx.js`: `setAttribute('style', 'break-after: page;')` | 1 місце | заблоковано |
| Присвоєння виду `el.style.prop = ...` у production JS | ~314 | працює (CSSOM) |
| `style.setProperty(...)` у production JS | 29 | працює (CSSOM) |

## Головний блокер — не код, а документи учнів

Текст зберігає форматування документа саме атрибутом `style`: колір, виділення, вирівнювання,
шрифт і розмір. Санітайзер (`text/core/sanitize.js`) свідомо тримає `style` у списку дозволених
атрибутів, а документ потрапляє в DOM через `innerHTML`. Так само приходять документи з `.docx`,
`.rtf` і `.html`, а Таблиці й Слайди відновлюють оформлення клітинок та об'єктів.

Під `style-src 'self'` усе це перестане застосовуватися: документ відкриється, текст буде на місці,
але без кольорів, вирівнювання й розмірів. Тобто hardening тут коштує не «переписати 6 місць», а
перевести рендер користувацького вмісту з атрибутів на CSSOM — це зміна моделі рендеру, а не
косметика.

## Що робити (порядок, а не обіцянка)

1. **Не прибирати `'unsafe-inline'` зараз.** Вартість — переписаний рендер документів; вигода —
   захист від вставленого стилю, тоді як реальний ризик (скрипт) уже закритий `script-src 'self'`.
2. Тримати нуль атрибутів `style` у HTML шести редакторів — це вже так, і це перевіряє
   `tests/static-ui-audit.ps1`.
3. Дешевий наступний крок, якщо до теми повернуться: винести `<style>` головної сторінки у файл
   (`landing.css`) і замінити 7 атрибутів `style` класами. Після цього головна сторінка зможе жити
   під суворішим CSP окремо від редакторів.
4. Для редакторів спершу перевести на CSSOM два місця, які застосовують стиль до **сторінки**, а не
   до документа: `text/ui/page.js` (геометрія друку) і `text/formats/docx.js` (позначка розриву).
5. Лише після цього розглядати рендер документа: або застосовувати стилі властивостями CSSOM після
   вставлення, або генерувати правила в `CSSStyleSheet` з `adoptedStyleSheets`. Обов'язково з
   негативними тестами: імпорт `.docx` із кольорами, виділенням і вирівнюванням має виглядати
   так само, як зараз.

## Як повторити вимірювання

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests\serve-office.ps1 -Port 4173
```

Далі відкрити `http://127.0.0.1:4173/tests/csp-style-probe.html` і звірити таблицю вище, а кількості
перерахувати пошуком по `style="`, `setAttribute('style'`, `.style.cssText`, `createElement('style')`
у production-файлах (без `tests/` і `vendor/`).
