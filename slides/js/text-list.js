import { getTextFromContentEditable } from './utils.js';

export function createTextContainer(listType = 'none') {
  if (listType === 'bullet') return document.createElement('ul');
  if (listType === 'number') return document.createElement('ol');
  return document.createElement('div');
}

export function setTextContainerContent(node, content, listType = 'none') {
  const value = String(content || '');
  if (listType === 'none') {
    node.textContent = value;
    return;
  }

  node.textContent = '';
  const lines = value.split('\n');
  (lines.length ? lines : ['']).forEach(line => {
    const item = document.createElement('li');
    item.textContent = line;
    node.appendChild(item);
  });
}

export function getTextFromTextContainer(node, listType = 'none') {
  if (listType === 'none') return getTextFromContentEditable(node);
  return Array.from(node?.children || [])
    .filter(child => child.tagName === 'LI')
    .map(item => getTextFromContentEditable(item))
    .join('\n');
}

export function splitListItemAtSelection(listNode) {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const anchor = range?.startContainer?.nodeType === Node.ELEMENT_NODE
    ? range.startContainer
    : range?.startContainer?.parentElement;
  const item = anchor?.closest?.('li');
  if (!range || !item || item.parentElement !== listNode || !range.collapsed) return false;

  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(item);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const afterRange = document.createRange();
  afterRange.selectNodeContents(item);
  afterRange.setStart(range.startContainer, range.startOffset);
  const beforeText = beforeRange.toString();
  const afterText = afterRange.toString();

  item.textContent = beforeText;
  const nextItem = document.createElement('li');
  nextItem.textContent = afterText;
  item.after(nextItem);

  const caret = document.createRange();
  caret.selectNodeContents(nextItem);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  return true;
}
