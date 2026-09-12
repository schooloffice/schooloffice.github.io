'use strict';
/* core/document-model.js — канонічний логічний потік документа Text */

// Аркуші (.page), повторені рядки заголовків, маркери каретки й позначки частин,
// розрізаних сторінками, — це верстка, а не документ. Серіалізатор знімає їх і зшиває
// розрізані частини назад: історія, чернетка й файл отримують однаковий вміст
// незалежно від того, як документ зараз розкладено по аркушах. Виділення зберігається
// як логічні якорі — шлях від кореня цього потоку, а не від сторінкового DOM.
const ArtDocumentModel = (() => {
  const LAYOUT_ATTRIBUTES = ['data-art-split', 'data-art-flow-tail', 'data-art-oversize', 'data-art-table-part'];
  const TEXT_BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE']);
  const LIST_BLOCKS = new Set(['UL', 'OL']);
  const MAX_ANCHOR_DEPTH = 64;

  function _pageContents(root) {
    if (!root) return [];
    const pages = [...root.querySelectorAll('.page-content')];
    return pages.length ? pages : [root];
  }

  // ---- Точки виділення, що переживають перестановку вузлів ----
  // Точка — { node: Text, offset } або { parent: Element, ref: Node|null }
  // (позиція перед ref; null — у кінці parent).

  function _firstCloneAfter(contents, clones, index) {
    for (let next = index + 1; next < contents.length; next += 1) {
      const first = contents[next].firstChild;
      if (first) return clones.get(first) || null;
    }
    return null;
  }

  function _pointInClone(temp, contents, clones, container, offset) {
    for (let index = 0; index < contents.length; index += 1) {
      const content = contents[index];
      if (container === content) {
        const child = content.childNodes[offset];
        return { parent: temp, ref: child ? clones.get(child) || null : _firstCloneAfter(contents, clones, index) };
      }
      if (!content.contains(container)) continue;
      const path = [];
      let top = container;
      while (top.parentNode !== content) {
        path.unshift(Array.prototype.indexOf.call(top.parentNode.childNodes, top));
        top = top.parentNode;
      }
      let node = clones.get(top);
      for (const step of path) node = node?.childNodes?.[step];
      if (!node) return null;
      if (node.nodeType === Node.TEXT_NODE) return { node, offset: Math.min(offset, node.data.length) };
      return { parent: node, ref: node.childNodes[offset] || null };
    }
    // Виділення на рівні самих аркушів (наприклад, «Виділити все»).
    if (container?.nodeType === Node.ELEMENT_NODE && contents.some(content => container.contains(content))) {
      const child = container.childNodes[offset];
      const nextContent = child
        ? contents.find(content => child === content || child.contains(content)
          || !!(child.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING))
        : null;
      const first = nextContent ? [...nextContent.childNodes].find(node => clones.has(node)) : null;
      return { parent: temp, ref: first ? clones.get(first) : null };
    }
    return null;
  }

  function _pointInside(ancestor, point) {
    const at = point.node || point.parent;
    return !!at && (at === ancestor || ancestor.contains(at));
  }

  function _removeNode(points, node, fallback = null) {
    const parent = node.parentNode;
    const next = node.nextSibling;
    points.forEach(point => {
      if (!point) return;
      if (_pointInside(node, point)) {
        const target = fallback || { parent, ref: next };
        delete point.node;
        delete point.offset;
        point.parent = target.parent;
        point.ref = target.ref;
      } else if (point.ref === node) {
        point.ref = next;
      }
    });
    node.remove();
  }

  // Переносить дітей source у кінець target і прибирає source.
  function _appendChildren(points, target, source) {
    const first = source.firstChild;
    points.forEach(point => {
      if (!point || point.node) return;
      if (point.parent === target && point.ref === null) point.ref = first;
      if (point.parent === source) {
        point.parent = target;
      } else if (point.ref === source) {
        point.parent = target;
        point.ref = first;
      }
    });
    while (source.firstChild) target.appendChild(source.firstChild);
    source.remove();
  }

  function _isPlaceholder(block) {
    return !(block.textContent || '').replace(/​/g, '').trim()
      && !block.querySelector('img,table,hr,li,figure');
  }

  // Послідовні частини одного розрізаного блока (той самий тег і data-art-split) — один блок.
  function _mergeSplitParts(container, points = []) {
    let node = container.firstElementChild;
    while (node) {
      const next = node.nextElementSibling;
      const id = node.getAttribute('data-art-split');
      const mergeable = !!id && !!next && next.tagName === node.tagName
        && next.getAttribute('data-art-split') === id
        && (TEXT_BLOCKS.has(node.tagName) || LIST_BLOCKS.has(node.tagName));
      if (!mergeable) {
        node = next;
        continue;
      }
      if (TEXT_BLOCKS.has(node.tagName)) {
        if (_isPlaceholder(next)) {
          _removeNode(points, next, { parent: node, ref: null });
          continue;
        }
        if (_isPlaceholder(node)) {
          [...node.childNodes].forEach(child => _removeNode(points, child, { parent: node, ref: null }));
        }
      }
      _appendChildren(points, node, next);
    }
  }

  function _logicalHeaderRow(table) {
    let first = table;
    while (first?.getAttribute('data-art-table-part') === 'continued' && first.previousElementSibling?.tagName === 'TABLE') {
      first = first.previousElementSibling;
    }
    const head = first?.tHead?.rows?.[0];
    if (head) return head;
    const firstRow = (first?.tBodies?.[0] || first)?.rows?.[0];
    return firstRow?.querySelector('th') ? firstRow : null;
  }

  // Каретка в повтореному заголовку продовження таблиці — це справжній рядок заголовка.
  function _mapRepeatedHeaderPoints(points) {
    points.forEach((point, index) => {
      if (!point) return;
      const at = point.node ? point.node.parentElement : point.parent;
      const repeated = at?.closest?.('tr[data-art-table-repeat]');
      if (!repeated) return;
      const cell = at.closest('th,td');
      const original = _logicalHeaderRow(repeated.closest('table'))?.cells?.[cell ? cell.cellIndex : 0];
      points[index] = original ? { parent: original, ref: original.firstChild } : null;
    });
  }

  function _mergeTableParts(container, points) {
    let node = container.firstElementChild;
    while (node) {
      const next = node.nextElementSibling;
      if (node.tagName === 'TABLE' && next?.tagName === 'TABLE' && next.getAttribute('data-art-table-part') === 'continued') {
        const body = node.tBodies[0] || node;
        const nextBody = next.tBodies[0];
        if (nextBody) _appendChildren(points, body, nextBody);
        _removeNode(points, next, { parent: body, ref: null });
        continue;
      }
      node = next;
    }
  }

  // Переносна форма для файлу й чернетки: блок зображення стає <img> зі стилями розміру
  // й обтікання, які проходять санітайзер.
  function _portableImages(container, points) {
    container.querySelectorAll('figure.art-image-block').forEach(figure => {
      const img = figure.querySelector('img');
      if (!img) {
        _removeNode(points, figure);
        return;
      }
      const frame = figure.querySelector('.art-image-frame');
      const cleanImg = img.cloneNode(true);
      const width = parseFloat(frame?.style.width || figure.style.width || 0);
      if (width) cleanImg.style.width = `${Math.round(width)}px`;

      if (figure.classList.contains('img-align-left')) {
        cleanImg.style.cssText += ';display:block;margin:.85rem 0 .85rem 0;';
      }
      if (figure.classList.contains('img-align-center')) {
        cleanImg.style.cssText += ';display:block;margin:.85rem auto;';
      }
      if (figure.classList.contains('img-align-right')) {
        cleanImg.style.cssText += ';display:block;margin:.85rem 0 .85rem auto;';
      }
      if (figure.classList.contains('img-wrap-left')) {
        cleanImg.style.cssText += ';float:left;margin:.2rem 1rem .6rem 0;';
      }
      if (figure.classList.contains('img-wrap-right')) {
        cleanImg.style.cssText += ';float:right;margin:.2rem 0 .6rem 1rem;';
      }

      cleanImg.removeAttribute('class');
      figure.before(cleanImg);
      points.forEach(point => {
        if (point && point.ref === figure) point.ref = cleanImg;
      });
      _removeNode(points, figure, { parent: cleanImg.parentNode, ref: cleanImg });
    });
  }

  function _trimEdgeWhitespace(container, points) {
    while (container.firstChild?.nodeType === Node.TEXT_NODE && !container.firstChild.data.trim()) {
      _removeNode(points, container.firstChild);
    }
    while (container.lastChild?.nodeType === Node.TEXT_NODE && !container.lastChild.data.trim()) {
      _removeNode(points, container.lastChild);
    }
  }

  function _boundary(container, point) {
    if (point.node) {
      return container.contains(point.node)
        ? { node: point.node, offset: Math.min(point.offset, point.node.data.length) }
        : null;
    }
    const parent = point.parent;
    if (!parent || !(parent === container || container.contains(parent))) return null;
    const offset = point.ref && point.ref.parentNode === parent
      ? Array.prototype.indexOf.call(parent.childNodes, point.ref)
      : parent.childNodes.length;
    return { node: parent, offset };
  }

  function _pathTo(container, node) {
    const path = [];
    let current = node;
    while (current && current !== container) {
      const parent = current.parentNode;
      if (!parent) return null;
      path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
      current = parent;
    }
    return current === container ? path : null;
  }

  function _anchors(container, points) {
    if (points.length !== 2 || points.some(point => !point)) return null;
    const start = _boundary(container, points[0]);
    const end = _boundary(container, points[1]);
    if (!start || !end) return null;
    const range = document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    } catch {
      return null;
    }
    // Після розбору HTML сусідні текстові вузли зливаються. normalize() робить те саме
    // зараз, а живий Range переносить позиції всередину злитих вузлів.
    container.normalize();
    const startPath = _pathTo(container, range.startContainer);
    const endPath = _pathTo(container, range.endContainer);
    if (!startPath || !endPath) return null;
    return {
      start: { path: startPath, offset: range.startOffset },
      end: { path: endPath, offset: range.endOffset }
    };
  }

  // root — #editor з аркушами або будь-який контейнер з логічним вмістом.
  // portable: форма для файлу й чернетки (зображення як <img>); інакше — форма
  // редагування для історії. range — живе виділення, яке треба перетворити на якорі.
  function serialize(root, { portable = false, range = null } = {}) {
    const contents = _pageContents(root);
    const temp = document.createElement('div');
    const clones = new Map();
    contents.forEach(content => {
      content.childNodes.forEach(node => {
        const clone = node.cloneNode(true);
        clones.set(node, clone);
        temp.appendChild(clone);
      });
    });

    const points = range
      ? [
        _pointInClone(temp, contents, clones, range.startContainer, range.startOffset),
        _pointInClone(temp, contents, clones, range.endContainer, range.endOffset)
      ]
      : [];

    _mapRepeatedHeaderPoints(points);
    temp.querySelectorAll('.art-sel-marker').forEach(marker => _removeNode(points, marker));
    temp.querySelectorAll('tr[data-art-table-repeat]').forEach(row => _removeNode(points, row));
    _mergeTableParts(temp, points);
    _mergeSplitParts(temp, points);
    temp.querySelectorAll('.is-selected').forEach(node => {
      node.classList.remove('is-selected');
      if (!node.classList.length) node.removeAttribute('class');
    });
    LAYOUT_ATTRIBUTES.forEach(name => {
      temp.querySelectorAll(`[${name}]`).forEach(node => node.removeAttribute(name));
    });
    if (portable) _portableImages(temp, points);
    _trimEdgeWhitespace(temp, points);

    const selection = _anchors(temp, points);
    const html = temp.innerHTML;
    return { html: html || '<p><br></p>', selection: html ? selection : null };
  }

  function _validPoint(point) {
    return !!point && Array.isArray(point.path) && point.path.length <= MAX_ANCHOR_DEPTH
      && point.path.every(step => Number.isInteger(step) && step >= 0)
      && Number.isInteger(point.offset) && point.offset >= 0;
  }

  function _resolvePoint(container, point) {
    let node = container;
    for (const step of point.path) {
      node = node?.childNodes?.[step];
      if (!node) return null;
    }
    const max = node.nodeType === Node.TEXT_NODE ? node.data.length : node.childNodes.length;
    return { node, offset: Math.min(point.offset, max) };
  }

  // Якорі можуть прийти з чернетки, тож перевіряємо форму й межі.
  function resolveSelection(container, selection) {
    if (!container || !selection || !_validPoint(selection.start) || !_validPoint(selection.end)) return null;
    const start = _resolvePoint(container, selection.start);
    const end = _resolvePoint(container, selection.end);
    if (!start || !end) return null;
    const range = document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    } catch {
      return null;
    }
    return range;
  }

  return {
    serialize,
    resolveSelection,
    mergeSplitParts: container => _mergeSplitParts(container)
  };
})();
