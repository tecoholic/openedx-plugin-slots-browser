import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractDescription } from './collect-plugins.js';

test('extracts first paragraph after Description heading', () => {
  const content = [
    '# Title',
    '',
    '## Description',
    'This is the description line.',
    '',
    'More details follow.',
  ].join('\n');

  assert.equal(extractDescription(content), 'This is the description line.');
});

test('ignores blank lines after heading', () => {
  const content = [
    '## Description',
    '',
    '   ',
    'First paragraph starts here.',
    '',
    'Second paragraph.',
  ].join('\n');

  assert.equal(extractDescription(content), 'First paragraph starts here.');
});

test('matches heading case-insensitively and at any level', () => {
  const content = [
    '### DESCRIPTION',
    'Line after heading.',
  ].join('\n');

  assert.equal(extractDescription(content), 'Line after heading.');
});

test('returns empty string when no description section exists', () => {
  const content = [
    '# Title',
    '',
    'Some intro text.',
  ].join('\n');

  assert.equal(extractDescription(content), '');
});

test('truncates description to 200 characters', () => {
  const longLine = 'a'.repeat(250);
  const content = [
    '## Description',
    longLine,
  ].join('\n');

  const result = extractDescription(content);
  assert.equal(result.length, 200);
  assert.equal(result, longLine.slice(0, 200));
});
