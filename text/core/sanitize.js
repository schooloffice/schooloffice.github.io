'use strict';
/* core/sanitize.js — безпечне очищення HTML */

const ArtSanitize = (() => {
  function clean(dirty = '') {
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(dirty, {
        ALLOWED_TAGS: [
          'p','br','div','span','strong','b','em','i','u','s','strike',
          'h1','h2','h3','h4','blockquote','ul','ol','li',
          'table','thead','tbody','tr','th','td','hr','a','img'
        ],
        ALLOWED_ATTR: ['style','href','target','rel','colspan','rowspan','src','alt'],
        ALLOW_DATA_ATTR: false,
        FORBID_TAGS: ['script','style','iframe','object','embed','svg','math','form','input','button','textarea','select'],
        FORBID_ATTR: [/^on/i]
      });
    }

    const template = document.createElement('template');
    template.innerHTML = String(dirty);
    template.content.querySelectorAll('script,style,iframe,object,embed,svg,math,form,input,button,textarea,select').forEach(el => el.remove());
    template.content.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        const value = attr.value || '';
        if (name.startsWith('on')) el.removeAttribute(attr.name);
        if (name === 'href' && /^\s*javascript:/i.test(value)) el.removeAttribute(attr.name);
      });
    });
    return template.innerHTML;
  }

  return { clean };
})();
