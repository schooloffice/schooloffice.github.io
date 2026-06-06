# MODAL_STANDARD.md

Статус: активне джерело правди.

## Контракт

Модалки мають:

- відкриватись через локальний helper, який делегує в `OfficeUI.openModal`;
- закриватись через локальний helper, який делегує в `OfficeUI.closeModal`;
- мати `aria-hidden="false"` у відкритому стані;
- мати `aria-hidden="true"` у закритому стані;
- мати клас `active` у відкритому стані;
- прибирати `hidden` при відкритті, бо shared shell може додати його при закритті;
- підтримувати `Escape`;
- повертати focus на trigger, якщо це можливо;
- не отримувати повторний focus, якщо focus уже всередині модалки.

## Заборонено

- Inline handlers у HTML.
- Generic кнопки `Так` / `Ні` для confirm-сценаріїв.
- Nested modal без окремого обґрунтування.
- Локальні CSS-перевизначення `.office-modal`, якщо можна використати shared tokens.
