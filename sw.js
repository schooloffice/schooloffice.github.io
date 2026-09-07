// sw.js — перехідний worker на час, поки офлайн відкладено.
//
// Офлайн лишається метою продукту, але виноситься в кінець, після базової
// функціональності редакторів (див. розділ «Офлайн» у PROJECT_DIRECTION.md).
// Реалізацію, що була тут раніше, знято: вона не покривала адреси на кшталт
// /text/, зате віддавала новий HTML зі старим JS після кожного релізу.
//
// Цей файл лишається за старою адресою виключно для того, щоб зняти Service
// Worker попередніх релізів у браузерах, де він уже встановлений: браузер сам
// звіряє байти sw.js під час навігації, тому стара реєстрація оновиться до
// цього коду навіть без реєстратора на сторінці. Коли офлайн повертатимемо,
// тут буде нова реалізація, а не відновлений старий precache.
//
// Навмисно без fetch-обробника: сторінки й ресурси йдуть у мережу напряму, тож
// старий код більше не може повернутися з Cache API. Видаляються лише кеші
// цього пакета за префіксом LEGACY_CACHE_PREFIX — localStorage, IndexedDB,
// чужі кеші та чужі реєстрації не чіпаються. Відкриті вкладки не
// перезавантажуються примусово: незбережена робота лишається на місці.

const LEGACY_CACHE_PREFIX = 'office-plus-v';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(teardown());
});

async function teardown() {
  await deleteLegacyCaches();
  await self.registration.unregister();
}

async function deleteLegacyCaches() {
  let keys;
  try {
    keys = await caches.keys();
  } catch (error) {
    return;
  }
  await Promise.all(
    keys
      .filter(key => key.startsWith(LEGACY_CACHE_PREFIX))
      .map(key => caches.delete(key).catch(() => false))
  );
}
