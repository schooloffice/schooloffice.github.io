'use strict';
/* core/selection.js — page-aware selection and DOM helpers */

const ArtSelection = (() => {
  const ZWSP = '\u200B';
  const BLOCK_SELECTOR = 'p,div,h1,h2,h3,h4,blockquote,ul,ol,table,figure,hr';

  function getSelection() { return window.getSelection(); }

  function getRange(editor) {
    const sel = getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return null;
    return range;
  }

  function save(editor) {
    const range = getRange(editor);
    return range ? range.cloneRange() : null;
  }

  function restore(range) {
    if (!range) return;
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function cloneRangeSafe(range) { return range ? range.cloneRange() : null; }

  function serializeSelection(editor) {
    const range = getRange(editor);
    if (!range) return null;
    return {
      start: { path: _nodePath(editor, range.startContainer), offset: range.startOffset },
      end: { path: _nodePath(editor, range.endContainer), offset: range.endOffset }
    };
  }

  function restoreSerializedSelection(editor, data) {
    if (!data) return;
    const startNode = _nodeFromPath(editor, data.start.path);
    const endNode = _nodeFromPath(editor, data.end.path);
    if (!startNode || !endNode) return;
    const range = document.createRange();
    try {
      range.setStart(startNode, Math.min(data.start.offset, _maxOffset(startNode)));
      range.setEnd(endNode, Math.min(data.end.offset, _maxOffset(endNode)));
      restore(range);
    } catch { }
  }

  function remember(editor) {
    const range = getRange(editor);
    editor._artSavedRange = range ? range.cloneRange() : editor._artSavedRange || null;
  }

  function restoreLast(editor) {
    const saved = editor?._artSavedRange;
    if (saved) restore(saved.cloneRange ? saved.cloneRange() : saved);
  }

  function focusEditor(editor) {
    restoreLast(editor);
    const active = getActivePageContent(editor) || getPageContents(editor)[0];
    if (!active) return false;
    active.focus();
    const range = getRange(editor);
    if (range) return true;
    const block = active.querySelector(BLOCK_SELECTOR) || active;
    const caret = document.createRange();
    caret.selectNodeContents(block);
    caret.collapse(true);
    restore(caret);
    return true;
  }

  function hasSelection(editor) {
    const range = getRange(editor);
    return !!range && !range.collapsed;
  }

  function getText(editor) { return getRange(editor)?.toString() || ''; }

  function selectAll(editor) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    restore(range);
  }

  function getPageContents(editor) {
    return [...editor.querySelectorAll('.page-content')];
  }

  function getActivePageContent(editor) {
    const range = getRange(editor);
    let node = range?.startContainer || document.activeElement;
    if (!node) return getPageContents(editor)[0] || null;
    if (node.nodeType !== 1) node = node.parentElement;
    return node?.closest?.('.page-content') || getPageContents(editor)[0] || null;
  }

  function insertNode(editor, node) {
    const range = getRange(editor);
    if (!range) return false;
    range.deleteContents();
    range.insertNode(node);
    _placeCaretAfter(node);
    normalizeEditor(editor);
    return true;
  }

  function insertBlockNode(editor, node, options = {}) {
    const { insertParagraphAfter = false } = options;
    const currentBlock = getCurrentBlock(editor);
    const page = getActivePageContent(editor) || getPageContents(editor)[0];
    if (!page) return false;

    if (!currentBlock || currentBlock === page) page.appendChild(node);
    else currentBlock.insertAdjacentElement('afterend', node);

    let target = node;
    if (insertParagraphAfter) {
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      node.insertAdjacentElement('afterend', p);
      target = p;
    }
    _placeCaretInsideStart(target);
    normalizeEditor(editor);
    return true;
  }

  function insertHTML(editor, html) {
    const range = getRange(editor);
    if (!range) return false;
    const frag = _htmlToFragment(ArtSanitize.clean(html));
    const last = frag.lastChild;
    range.deleteContents();
    range.insertNode(frag);
    if (last) _placeCaretAfter(last);
    normalizeEditor(editor);
    return true;
  }

  function insertParagraphAfter(editor) {
    const page = getActivePageContent(editor) || getPageContents(editor)[0];
    const block = getCurrentBlock(editor) || page;
    const p = document.createElement('p');
    p.innerHTML = '<br>';
    if (!block || block === page) page.appendChild(p);
    else block.insertAdjacentElement('afterend', p);
    _placeCaretInsideStart(p);
    normalizeEditor(editor);
  }

  function toggleInlineTag(editor, tagName) {
    const range = getRange(editor);
    if (!range) return false;

    const existing = _closestFormattingAncestor(
      editor,
      range.startContainer,
      el => el.tagName?.toLowerCase() === tagName
    );

    if (existing && (range.collapsed || existing.contains(range.commonAncestorContainer))) {
      _unwrap(existing);
      normalizeEditor(editor);
      return true;
    }

    const el = document.createElement(tagName);
    const colorHost = range.startContainer.nodeType === 1
      ? range.startContainer
      : range.startContainer.parentElement;

    if (colorHost) {
      const computed = getComputedStyle(colorHost).color;
      if (computed && ['u', 's', 'strike'].includes(tagName)) {
        el.style.color = computed;
        el.style.textDecorationColor = computed;
      }
    }

    if (range.collapsed) {
      el.textContent = ZWSP;
      range.insertNode(el);
      _placeCaretInsideStart(el, 1);
      normalizeEditor(editor);
      return true;
    }

    const startBlock = _closestBlockWithin(editor, range.startContainer);
    const endBlock = _closestBlockWithin(editor, range.endContainer);

    if (startBlock && endBlock && startBlock !== endBlock) {
      _wrapSelectedTextNodes(range, tagName);
      normalizeEditor(editor);
      return true;
    }

    _surroundRange(range, el);
    _selectNodeContents(el);
    normalizeEditor(editor);
    return true;
  }

  function applyInlineStyle(editor, styles, options = {}) {
    const range = getRange(editor);
    if (!range) return false;
    const span = document.createElement('span');
    Object.assign(span.style, styles);
    if (range.collapsed) {
      span.textContent = ZWSP;
      range.insertNode(span);
      _syncDecorationColor(span, styles, options);
      _placeCaretInsideStart(span, 1);
    } else {
      _surroundRange(range, span);
      _syncDecorationColor(span, styles, options);
      _selectNodeContents(span);
    }
    normalizeEditor(editor);
    return true;
  }
  function clearInlineStyle(editor, props = []) {
    const range = getRange(editor);
    if (!range || !props.length) return false;

    if (range.collapsed) {
      const span = document.createElement('span');
      props.forEach(prop => {
        span.style[prop] = prop === 'backgroundColor' ? 'transparent' : 'initial';
      });
      span.textContent = ZWSP;
      range.insertNode(span);
      _placeCaretInsideStart(span, 1);
      normalizeEditor(editor);
      return true;
    }

    const fragment = range.extractContents();
    _clearStylesInTree(fragment, props);
    const last = fragment.lastChild;
    range.insertNode(fragment);

    if (last) {
      const after = document.createRange();
      after.setStartAfter(last);
      after.collapse(true);
      restore(after);
    }

    normalizeEditor(editor);
    return true;
  }

  function setBlockTag(editor, tagName) {
    const block = getCurrentBlock(editor);
    if (!block) return false;
    const page = getActivePageContent(editor);
    if (!page || block === page) return false;
    if (block.tagName.toLowerCase() === tagName) return true;
    const replacement = document.createElement(tagName);
    [...block.attributes].forEach(attr => replacement.setAttribute(attr.name, attr.value));
    replacement.innerHTML = block.innerHTML;
    block.replaceWith(replacement);
    _placeCaretInsideStart(replacement);
    normalizeEditor(editor);
    return true;
  }

  function setAlignment(editor, align) {
    const block = getCurrentBlock(editor);
    const page = getActivePageContent(editor);
    if (!block || !page || block === page) return false;
    block.style.textAlign = align === 'left' ? '' : align;
    normalizeEditor(editor);
    return true;
  }

  function toggleList(editor, listTag) {
    const block = getCurrentBlock(editor);
    const page = getActivePageContent(editor);
    if (!block || !page || block === page) return false;
    const item = block.closest('li');
    const list = block.closest('ul,ol');

    if (list && list.tagName.toLowerCase() === listTag && item) {
      const p = document.createElement('p');
      p.innerHTML = item.innerHTML || '<br>';
      if (item.nextElementSibling) list.parentNode.insertBefore(p, list.nextElementSibling);
      else list.insertAdjacentElement('afterend', p);
      item.remove();
      if (!list.children.length) list.remove();
      _placeCaretInsideStart(p);
    } else if (list && item) {
      const replacement = document.createElement(listTag);
      replacement.innerHTML = list.innerHTML;
      list.replaceWith(replacement);
      _placeCaretInsideStart(replacement.querySelector('li') || replacement);
    } else {
      const listEl = document.createElement(listTag);
      const li = document.createElement('li');
      li.innerHTML = block.innerHTML || '<br>';
      listEl.appendChild(li);
      block.replaceWith(listEl);
      _placeCaretInsideStart(li);
    }
    normalizeEditor(editor);
    return true;
  }

  function indent(editor, delta = 24) {
    const block = getCurrentBlock(editor);
    const page = getActivePageContent(editor);
    if (!block || !page || block === page) return false;
    const current = parseInt(block.style.marginLeft || '0', 10) || 0;
    block.style.marginLeft = `${Math.max(0, current + delta)}px`;
    return true;
  }

  function outdent(editor, delta = 24) {
    const block = getCurrentBlock(editor);
    const page = getActivePageContent(editor);
    if (!block || !page || block === page) return false;
    const current = parseInt(block.style.marginLeft || '0', 10) || 0;
    block.style.marginLeft = `${Math.max(0, current - delta)}px`;
    if (block.style.marginLeft === '0px') block.style.marginLeft = '';
    return true;
  }

  function insertHorizontalRule(editor) {
    const hr = document.createElement('hr');
    return insertBlockNode(editor, hr, { insertParagraphAfter: true });
  }

  async function copy(editor) {
    const text = getText(editor);
    if (!text) return false;
    try { await navigator.clipboard.writeText(text); return true; }
    catch { return false; }
  }

  async function cut(editor) {
    const range = getRange(editor);
    if (!range || range.collapsed) return false;
    const ok = await copy(editor);
    range.deleteContents();
    normalizeEditor(editor);
    return ok;
  }

  async function pastePlainText(editor) {
    try {
      const text = await navigator.clipboard.readText();
      return insertText(editor, text);
    } catch {
      return false;
    }
  }

  function insertText(editor, text) {
    const range = getRange(editor);
    if (!range) return false;
    const lines = String(text).replace(/\r/g, '').split('\n');
    if (lines.length === 1) {
      const node = document.createTextNode(lines[0]);
      range.deleteContents();
      range.insertNode(node);
      _placeCaretAfter(node);
    } else {
      const frag = document.createDocumentFragment();
      lines.forEach((line, i) => {
        if (i > 0) frag.appendChild(document.createElement('br'));
        if (line) frag.appendChild(document.createTextNode(line));
      });
      const last = frag.lastChild;
      range.deleteContents();
      range.insertNode(frag);
      if (last) _placeCaretAfter(last);
    }
    normalizeEditor(editor);
    return true;
  }

  function queryState(editor, cmd) {
    const range = getRange(editor);
    if (!range) return false;
    const el = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    if (!el) return false;
    switch (cmd) {
      case 'bold': return !!el.closest('b,strong');
      case 'italic': return !!el.closest('i,em');
      case 'underline': return !!el.closest('u');
      case 'strikeThrough': return !!el.closest('s,strike');
      case 'insertUnorderedList': return !!el.closest('ul');
      case 'insertOrderedList': return !!el.closest('ol');
      default: return false;
    }
  }

  function getCurrentBlock(editor) {
    const range = getRange(editor);
    if (!range) return null;
    const page = getActivePageContent(editor);
    let node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentNode;
    while (node && node !== editor && node !== page) {
      if (_isBlock(node)) return node;
      node = node.parentNode;
    }
    return page?.querySelector(BLOCK_SELECTOR) || page || null;
  }

  function normalizeEditor(editor) {
    const pages = getPageContents(editor);
    if (!pages.length) return;

    pages.forEach(page => {
      // move non-block loose nodes into paragraph wrappers
      const loose = [...page.childNodes].filter(node => !_isAllowedRootNode(node));
      if (loose.length) {
        const p = document.createElement('p');
        loose.forEach(node => p.appendChild(node));
        page.insertBefore(p, page.firstChild);
      }

      page.querySelectorAll('span,strong,b,em,i,u,s,strike').forEach(el => {
        if (el.textContent === ZWSP && !el.querySelector('*')) return;
        if (!el.textContent && !el.querySelector('br,img,table,hr')) el.remove();
      });

      [...page.children].forEach(child => {
        if (_isTextBlock(child) && !child.innerHTML.trim()) child.innerHTML = '<br>';
      });

      if (![...page.children].some(ch => _isBlock(ch))) {
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        page.innerHTML = '';
        page.appendChild(p);
      }
    });
  }

  function insertImage(editor, src, alt = '') {
    const figure = document.createElement('figure');
    figure.className = 'art-image-block';
    figure.setAttribute('contenteditable', 'false');
    figure.tabIndex = -1;

    const frame = document.createElement('div');
    frame.className = 'art-image-frame';
    frame.style.width = '360px';
    frame.style.maxWidth = '100%';

    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;

    ['nw', 'ne', 'sw', 'se'].forEach(dir => {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'art-image-handle';
      handle.dataset.dir = dir;
      handle.setAttribute('aria-label', 'Змінити розмір зображення');
      frame.appendChild(handle);
    });

    frame.prepend(img);
    figure.appendChild(frame);
    return insertBlockNode(editor, figure, { insertParagraphAfter: true });
  }

  function _syncDecorationColor(node, styles, options = {}) {
    if (!options.syncDecorations || !styles?.color) return;
    let el = node.parentElement;
    while (el) {
      const tag = el.tagName?.toLowerCase();
      if (tag === 'u' || tag === 's' || tag === 'strike') {
        el.style.color = styles.color;
        el.style.textDecorationColor = styles.color;
      }
      el = el.parentElement;
    }
    node.querySelectorAll?.('u,s,strike').forEach(dec => {
      dec.style.color = styles.color;
      dec.style.textDecorationColor = styles.color;
    });
  }

  function _nodePath(root, node) {
    const path = [];
    while (node && node !== root) {
      const parent = node.parentNode;
      if (!parent) break;
      path.unshift([...parent.childNodes].indexOf(node));
      node = parent;
    }
    return path;
  }

  function _nodeFromPath(root, path) {
    return path.reduce((node, idx) => node?.childNodes?.[idx], root);
  }

  function _maxOffset(node) {
    return node.nodeType === Node.TEXT_NODE ? node.textContent.length : node.childNodes.length;
  }

  function _surroundRange(range, wrapper) {
    try { range.surroundContents(wrapper); }
    catch {
      const frag = range.extractContents();
      wrapper.appendChild(frag);
      range.insertNode(wrapper);
    }
  }

  function _unwrap(el) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }

  function _closestFormattingAncestor(editor, node, predicate) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== editor) {
      if (predicate(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function _clearStylesInTree(root, props) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    let node;
    while ((node = walker.nextNode())) nodes.push(node);

    nodes.forEach(el => {
      props.forEach(prop => {
        const cssProp = prop.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
        el.style?.removeProperty(cssProp);
      });
      if (props.includes('color')) el.style?.removeProperty('text-decoration-color');
    });

    [...(root.querySelectorAll ? root.querySelectorAll('span') : [])].forEach(span => {
      if (!span.getAttribute('style')) _unwrap(span);
    });
  }

  function _closestBlockWithin(editor, node) {
    let el = node?.nodeType === 1 ? node : node?.parentElement;
    while (el && el !== editor) {
      if (_isBlock(el) || el.classList?.contains('page-content')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function _wrapSelectedTextNodes(range, tagName) {
    const root = range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;

    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!(node.textContent || '').replace(/\u200B/g, '').trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        return range.intersectsNode(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });

    let node;
    while ((node = walker.nextNode())) nodes.push(node);

    nodes.forEach(node => {
      let start = 0;
      let end = node.textContent.length;

      if (node === range.startContainer) start = range.startOffset;
      if (node === range.endContainer) end = range.endOffset;
      if (node === range.startContainer && node === range.endContainer) {
        start = range.startOffset;
        end = range.endOffset;
      }

      if (end <= start) return;

      let target = node;
      if (start > 0) target = target.splitText(start);
      if ((end - start) < target.textContent.length) target.splitText(end - start);
      if (target.parentElement?.tagName?.toLowerCase() === tagName) return;

      const wrapper = document.createElement(tagName);

      if (['u', 's', 'strike'].includes(tagName)) {
        const computed = getComputedStyle(target.parentElement).color;
        if (computed) {
          wrapper.style.color = computed;
          wrapper.style.textDecorationColor = computed;
        }
      }

      target.parentNode.insertBefore(wrapper, target);
      wrapper.appendChild(target);
    });
  }

  function _placeCaretAfter(node) {
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    restore(range);
  }

  function _placeCaretInsideStart(node, offset = 0) {
    const range = document.createRange();
    if (node.firstChild && node.firstChild.nodeType === Node.TEXT_NODE) {
      range.setStart(node.firstChild, Math.min(offset, node.firstChild.textContent.length));
    } else {
      range.setStart(node, Math.min(offset, node.childNodes.length));
    }
    range.collapse(true);
    restore(range);
  }

  function _selectNodeContents(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    restore(range);
  }

  function _htmlToFragment(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    return t.content;
  }

  function _isTextBlock(node) {
    return node && node.nodeType === 1 && ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'LI'].includes(node.tagName);
  }

  function _isBlock(node) {
    return node && node.nodeType === 1 && ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'UL', 'OL', 'TABLE', 'FIGURE', 'HR'].includes(node.tagName);
  }

  function _isAllowedRootNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return !(node.textContent || '').trim();
    return _isBlock(node);
  }

  return {
    save, restore, cloneRangeSafe, restoreLast, remember, serializeSelection, restoreSerializedSelection,
    hasSelection, getText, selectAll, focusEditor,
    getPageContents, getActivePageContent,
    insertNode, insertBlockNode, insertHTML, insertText, insertParagraphAfter,
    toggleInlineTag, applyInlineStyle, clearInlineStyle, insertImage,
    setBlockTag, setAlignment, toggleList, indent, outdent, insertHorizontalRule,
    copy, cut, pastePlainText, queryState, getCurrentBlock, normalizeEditor, getRange
  };
})();
