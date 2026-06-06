# DROPDOWN_STANDARD.md

Статус: активне джерело правди.

## Контракт

Dropdown, menu, picker і popover мають:

- відкриватись передбачувано з миші та клавіатури;
- підтримувати `Escape`;
- закриватись при click-outside;
- не закриватись під час взаємодії всередині активного menu/picker/popover;
- синхронізувати `aria-expanded`;
- скидати локальний state через `office:overlayclose`;
- не зсувати workspace без потреби.

## Головне меню

Пункти головного меню мають мати `data-action`.

Для стандартних команд action у тулбарі і в меню має збігатися. Це перевіряє `Assert-MenuToolbarCommandParity` у `tests/static-ui-audit.ps1`.
