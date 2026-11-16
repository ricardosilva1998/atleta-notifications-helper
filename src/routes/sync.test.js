'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const realLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && /routes[\\/]sync\.js$/.test(parent.filename)) {
    if (request === '../config') return { app: { syncSecret: 's3cret' } };
    if (request === '../db') return {};
  }
  return realLoad.call(this, request, parent, ...rest);
};
const { secretMatches } = require('./sync');
Module._load = realLoad;
void path;

describe('sync secret', () => {
  test('accepts only the exact secret', () => {
    assert.equal(secretMatches('s3cret', 's3cret'), true);
    assert.equal(secretMatches('s3cre', 's3cret'), false);
    assert.equal(secretMatches('s3cret2', 's3cret'), false);
    assert.equal(secretMatches(undefined, 's3cret'), false);
  });
  test('an unset secret never matches', () => {
    assert.equal(secretMatches('', ''), false);
    assert.equal(secretMatches('x', undefined), false);
    assert.equal(secretMatches(undefined, undefined), false);
  });
});
