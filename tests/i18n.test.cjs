const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('language switch translates static and changing UI text in both directions', () => {
  const text = { nodeType: 3, nodeValue: '开始识别' };
  const input = {
    nodeType: 1,
    childNodes: [],
    attrs: { placeholder: '未设置时直接使用原文' },
    closest: () => null,
    hasAttribute(name) { return name in this.attrs; },
    getAttribute(name) { return this.attrs[name]; },
    setAttribute(name, value) { this.attrs[name] = value; }
  };
  const body = {
    nodeType: 1,
    childNodes: [text, input],
    closest: () => null,
    hasAttribute: () => false
  };
  text.parentElement = body;
  const selector = { value: 'zh-CN' };
  const document = {
    body,
    documentElement: { lang: 'zh-CN' },
    querySelectorAll: () => [selector]
  };
  const context = {
    document,
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    MutationObserver: class { observe() {} }
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n.js'), 'utf8');
  vm.runInNewContext(`${source}\nglobalThis.i18n = { setLanguage, translateNode };`, context);

  context.i18n.setLanguage('en');
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(selector.value, 'en');
  assert.equal(text.nodeValue, 'Start recognition');
  assert.equal(input.attrs.placeholder, 'Uses raw captions until configured');

  text.nodeValue = '监听中';
  context.i18n.translateNode(text);
  assert.equal(text.nodeValue, 'Listening');

  context.i18n.setLanguage('zh-CN');
  assert.equal(text.nodeValue, '监听中');
  assert.equal(input.attrs.placeholder, '未设置时直接使用原文');
});
