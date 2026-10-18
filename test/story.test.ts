import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storyHtml, readingMinutes } from '../src/render/story.ts';

test('párrafos, títulos y listas', () => {
  const html = storyHtml('## The story\n\nFirst line\ncontinues.\n\n- one\n- two\n\n## Why go\nShort.');
  assert.equal(
    html,
    '<h3>The story</h3><p>First line continues.</p><ul><li>one</li><li>two</li></ul><h3>Why go</h3><p>Short.</p>',
  );
});

test('el texto se escapa', () => {
  assert.equal(storyHtml('<b>x</b> & y'), '<p>&lt;b&gt;x&lt;/b&gt; &amp; y</p>');
});

test('minutos de lectura', () => {
  assert.equal(readingMinutes('word'), 1);
  assert.equal(readingMinutes(Array(500).fill('w').join(' ')), 3);
});
