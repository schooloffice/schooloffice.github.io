'use strict';
/* core/draft.js — політика чернетки Тексту.
 *
 * Чернетка — це страховка від аварії вкладки, браузера чи живлення, а не
 * збереження. Вона живе в цьому браузері, її може перезаписати наступна
 * робота, і вона НЕ замінює файл (аудит F04, F07). Тому відновлена робота
 * лишається позначеною як незбережена, а користувач сам вирішує, відновлювати
 * її чи почати спочатку.
 *
 * Тут немає DOM: вміст будує викликач, статус повертається колбеком.
 */

const ArtDraft = (() => {
  // Пауза після останньої зміни. Достатньо мала, щоб втратити щонайбільше
  // кілька секунд роботи, і достатньо велика, щоб не писати на кожну літеру.
  const SAVE_DELAY_MS = 900;

  let _storage = null;
  let _build = null;
  let _onStatus = null;

  // Ревізія зростає з кожною зміною документа. Вона потрібна, щоб пізній запис
  // не оголосив збереженими новіші зміни (аудит F07): статус «оновлено»
  // виставляється лише тоді, коли записана ревізія й досі остання.
  let _revision = 0;
  let _savedRevision = 0;
  let _timer = 0;
  let _writing = false;

  function init({ storage = ArtDraftStorage, build, onStatus } = {}) {
    _storage = storage;
    _build = typeof build === 'function' ? build : null;
    _onStatus = typeof onStatus === 'function' ? onStatus : null;
    _revision = 0;
    _savedRevision = 0;
    clearTimeout(_timer);
    _timer = 0;
  }

  function noteChange() {
    if (!_build || !_storage) return;
    _revision += 1;
    report({ state: 'pending' });
    clearTimeout(_timer);
    _timer = setTimeout(() => { flush(); }, SAVE_DELAY_MS);
  }

  // Негайний запис — для beforeunload і тестів. Повертає результат, щоб
  // виклик міг показати правду, а не припущення.
  async function flush() {
    clearTimeout(_timer);
    _timer = 0;
    if (!_build || !_storage) return { ok: false, reason: 'not-initialised' };
    if (_writing) return { ok: false, reason: 'busy' };

    const revision = _revision;
    let payload;
    try {
      payload = _build();
    } catch (error) {
      report({ state: 'failed' });
      return { ok: false, reason: 'build-failed', error };
    }

    _writing = true;
    try {
      await _storage.saveDraft({ revision, payload });
      // Старий запис не має відкочувати позначку назад.
      if (revision > _savedRevision) _savedRevision = revision;
      // Якщо за час запису з'явилися нові зміни, чернетка вже застаріла —
      // і казати «оновлено» було б неправдою.
      report({ state: _savedRevision === _revision ? 'saved' : 'pending' });
      return { ok: true, revision };
    } catch (error) {
      report({ state: 'failed' });
      return { ok: false, reason: 'write-failed', error };
    } finally {
      _writing = false;
    }
  }

  // Повертає перевірений payload документа або null. Чернетка — це вхід із
  // браузерного сховища, тож вона проходить ту саму валідацію, що й файл.
  async function load() {
    if (!_storage) return null;
    let record;
    try {
      record = await _storage.loadDraft();
    } catch {
      return null;
    }
    if (!record || typeof record !== 'object') return null;

    const payload = record.payload ?? record;
    const validated = ArtDocument.validate(payload);
    if (!validated.ok) return null;
    if (!hasContent(validated.value.content)) return null;
    return validated.value;
  }

  // Порожня чернетка не варта питання «відновити?»: свіжий документ і так
  // порожній, а зайвий діалог на старті лише заважає.
  function hasContent(content) {
    // Через DOMParser, а не через тимчасовий вузол: статичний аудит тримає
    // ratchet на той спосіб доступу до DOM, і збільшувати борг заради
    // перевірки «чи є що відновлювати» не варто.
    const parsed = new DOMParser().parseFromString(`<body>${String(content || '')}</body>`, 'text/html');
    if (parsed.body.querySelector('img, table')) return true;
    return (parsed.body.textContent || '').trim().length > 0;
  }

  async function clear() {
    clearTimeout(_timer);
    _timer = 0;
    if (!_storage) return false;
    try {
      return await _storage.clearDraft();
    } catch {
      return false;
    }
  }

  function report(status) {
    _onStatus?.(status);
  }

  // Для тестів і діагностики: без цього не перевірити, що пізній запис не
  // перекриває новішу ревізію.
  function revisions() {
    return { current: _revision, saved: _savedRevision };
  }

  return { init, noteChange, flush, load, clear, revisions, SAVE_DELAY_MS };
})();
