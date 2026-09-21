import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputHistory } from '../src/input-history.js';

test('record assigns increasing sequence numbers', () => {
  const history = new InputHistory();
  const seq0 = history.record({ dx: 1 }, 16);
  const seq1 = history.record({ dx: -1 }, 16);
  assert.equal(seq0, 0);
  assert.equal(seq1, 1);
  assert.equal(history.size, 2);
});

test('acknowledge drops everything up to and including the given seq', () => {
  const history = new InputHistory();
  history.record('a', 16);
  history.record('b', 16);
  history.record('c', 16);
  history.acknowledge(1);
  assert.equal(history.size, 1);
  assert.equal(history.all[0].input, 'c');
});

test('acknowledge with -1 keeps everything', () => {
  const history = new InputHistory();
  history.record('a', 16);
  history.record('b', 16);
  history.acknowledge(-1);
  assert.equal(history.size, 2);
});
