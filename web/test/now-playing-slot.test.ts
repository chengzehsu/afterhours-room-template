import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_DECK, hiddenIds, land, released, takeOff, vacantIndices } from '../src/room/now-playing-slot.ts';

const wall = ['a', 'b', 'c', 'd'];

test('開場選 A：飛行中與落盤後，牆上 A 的位子都是空的', () => {
  const flying = takeOff(EMPTY_DECK, 'a');
  assert.deepEqual(vacantIndices(wall, flying), [0]);
  assert.deepEqual(vacantIndices(wall, land(flying)), [0]);
});

test('再播 B：B 起飛就空，A 要等 B 落盤才放回', () => {
  const onDeck = land(takeOff(EMPTY_DECK, 'a'));
  const flying = takeOff(onDeck, 'b');
  assert.deepEqual(vacantIndices(wall, flying), [0, 1], 'B 在飛、A 還在唱盤上');
  const landed = land(flying);
  assert.deepEqual(vacantIndices(wall, landed), [1]);
  assert.deepEqual(released(flying, landed), ['a']);
});

test('切時段後新牆上有 B：仍然空著；新牆沒有 B 就沒有空位', () => {
  const s = land(takeOff(land(takeOff(EMPTY_DECK, 'a')), 'b'));
  assert.deepEqual(vacantIndices(['x', 'y', 'b'], s), [2]);
  assert.deepEqual(vacantIndices(['x', 'y', 'z'], s), []);
});

test('放同一首不閃：狀態原樣、沒有放回的牌', () => {
  const onDeck = land(takeOff(EMPTY_DECK, 'a'));
  assert.equal(takeOff(onDeck, 'a'), onDeck);
  const flying = takeOff(onDeck, 'b');
  assert.equal(takeOff(flying, 'b'), flying);
  assert.deepEqual(released(onDeck, takeOff(onDeck, 'a')), []);
});

test('hiddenIds 與 released', () => {
  assert.deepEqual([...hiddenIds(EMPTY_DECK)], []);
  assert.deepEqual([...hiddenIds(takeOff(land(takeOff(EMPTY_DECK, 'a')), 'b'))].sort(), ['a', 'b']);
  assert.deepEqual(released(takeOff(EMPTY_DECK, 'a'), EMPTY_DECK), ['a']);
});
