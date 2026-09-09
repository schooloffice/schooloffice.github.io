export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function createNode(tagName, {
  id = '',
  className = '',
  text = null,
  attributes = {},
  properties = {},
  dataset = {}
} = {}, ...children) {
  const node = document.createElement(tagName);
  if (id) node.id = id;
  if (className) node.className = className;
  if (text !== null) node.textContent = String(text);
  Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, String(value)));
  Object.entries(properties).forEach(([name, value]) => { node[name] = value; });
  Object.entries(dataset).forEach(([name, value]) => { node.dataset[name] = String(value); });
  children.flat(Infinity).forEach(child => {
    if (child === null || child === undefined || child === false) return;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

export function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function debounce(fn, delay = 200) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  return debounced;
}

export function downloadTextFile(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function getTextFromContentEditable(node) {
  return (node?.textContent || '').replace(/\r/g, '');
}
