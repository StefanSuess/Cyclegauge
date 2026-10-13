import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';
import { defaultSource, defaultStorage, inside } from '../../src/paths.ts';

test('empty and relative platform directory overrides never select the working directory', () => {
 const keys = ['APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'];
 const original = keys.map(key => process.env[key]);
 try {
  for (const value of ['', 'synthetic-relative']) {
   for (const key of keys) process.env[key] = value;
   assert.ok(isAbsolute(defaultSource())); assert.ok(isAbsolute(defaultStorage()));
   assert.ok(!defaultSource().includes('synthetic-relative')); assert.ok(!defaultStorage().includes('synthetic-relative'));
  }
 } finally { keys.forEach((key, i) => { if (original[i] === undefined) delete process.env[key]; else process.env[key] = original[i]; }); }
});
test('native path containment rejects sibling prefixes and preserves Windows case semantics', () => {
 assert.equal(inside('/synthetic/root-other', '/synthetic/root'), false);
 assert.equal(inside('/synthetic/root/child ü', '/synthetic/root'), true);
 if (process.platform === 'win32') {
  assert.equal(inside('C:\\synthetic\\ROOT\\child', 'c:\\synthetic\\root'), true);
  assert.equal(inside('D:\\synthetic\\root', 'C:\\synthetic\\root'), false);
 }
});
