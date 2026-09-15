import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderAnswer } from '../extension/answer-markdown.mjs';

test('business answers render paragraphs, emphasis, lists, code and scrollable tables', () => {
  const dom = new JSDOM('<main></main>'), { document } = dom.window;
  const text = '# Discount\n\nThe discount is **12%** for *Actual*.\n\n- Retailer A\n- Retailer B\n\n3. Check data\n4. Compare\n\n| Period | Value |\n| --- | ---: |\n| Jan | **12%** |\n\n```text\n<raw data>\n```\n\nUse `TPR` for [details](https://example.com).';
  document.querySelector('main').append(renderAnswer(document, text));
  assert.equal(document.querySelector('h3').textContent, 'Discount');
  assert.equal(document.querySelector('strong').textContent, '12%');
  assert.equal(document.querySelector('ul').children.length, 2); assert.equal(document.querySelector('ol').start, 3);
  assert.equal(document.querySelector('table td strong').textContent, '12%');
  assert.equal(document.querySelector('.answer-table').tabIndex, 0);
  assert.equal(document.querySelector('pre').textContent, '<raw data>');
  assert.equal(document.querySelector('a').rel, 'noopener noreferrer');
  dom.window.close();
});

test('answer formatting treats HTML and executable links as text and never loads images', () => {
  const dom = new JSDOM('<main></main>'), { document } = dom.window;
  const text = '<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[Run](javascript:alert) [Data](data:text/html,script) ![image](https://example.com/image.png)';
  const main = document.querySelector('main'); main.append(renderAnswer(document, text));
  assert.equal(main.querySelectorAll('script,img,iframe,style').length, 0);
  assert.match(main.textContent, /onerror/);
  assert.equal(main.querySelectorAll('a').length, 1);
  assert.equal(main.querySelector('a').protocol, 'https:');
  dom.window.close();
});
