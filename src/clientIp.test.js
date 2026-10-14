'use strict';

// clientIp(req): the visitor's address for the rate limits and the sign-in log.
// Requests reach the site through Cloudflare and Railway's edge; with
// 'trust proxy' 1, req.ip is the address that connected to Railway's edge.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { clientIp, isCloudflare, CLOUDFLARE_RANGES } = require('./clientIp');

// A request as Express hands it to a limiter: req.ip and the (lower-case) headers.
const req = (ip, cfConnectingIp) => ({ ip, headers: cfConnectingIp === undefined ? {} : { 'cf-connecting-ip': cfConnectingIp } });

const CF_V4 = '162.158.12.34'; // in 162.158.0.0/15
const CF_V6 = '2606:4700:10::6816:1234'; // in 2606:4700::/32
const VISITOR_V4 = '198.51.100.7';
const VISITOR_V6 = '2001:db8:85a3::8a2e:370:7334';

describe('clientIp', () => {
  test('a request through Cloudflare counts as the visitor in CF-Connecting-IP', () => {
    assert.equal(clientIp(req(CF_V4, VISITOR_V4)), VISITOR_V4);
    assert.equal(clientIp(req(CF_V4, VISITOR_V6)), VISITOR_V6);
    assert.equal(clientIp(req(CF_V6, VISITOR_V4)), VISITOR_V4, 'an IPv6 Cloudflare edge');
    assert.equal(clientIp(req(CF_V6, VISITOR_V6)), VISITOR_V6);
  });

  test('a request from anywhere else counts as its own address, whatever CF-Connecting-IP says', () => {
    assert.equal(clientIp(req(VISITOR_V4, '203.0.113.9')), VISITOR_V4);
    assert.equal(clientIp(req(VISITOR_V6, '203.0.113.9')), VISITOR_V6);
    assert.equal(clientIp(req('127.0.0.1', '203.0.113.9')), '127.0.0.1');
    assert.equal(clientIp(req('10.0.0.5', CF_V4)), '10.0.0.5', 'a header naming a Cloudflare address changes nothing either');
  });

  test('a Cloudflare edge with a missing or malformed CF-Connecting-IP counts as itself', () => {
    for (const header of [undefined, '', ' ', 'not-an-ip', '198.51.100.7, 203.0.113.9', '198.51.100.300', '<img src=x>', '1.2.3.4:5678']) {
      assert.equal(clientIp(req(CF_V4, header)), CF_V4, JSON.stringify(header));
    }
  });

  test('an IPv4 Cloudflare edge seen as ::ffff:a.b.c.d is still Cloudflare', () => {
    assert.equal(clientIp(req(`::ffff:${CF_V4}`, VISITOR_V4)), VISITOR_V4);
    assert.equal(clientIp(req(`::FFFF:${CF_V4}`, VISITOR_V4)), VISITOR_V4);
    assert.equal(clientIp(req(`::ffff:${VISITOR_V4}`, '203.0.113.9')), `::ffff:${VISITOR_V4}`, 'not Cloudflare: req.ip as it is');
  });

  test('surrounding spaces in CF-Connecting-IP are ignored', () => {
    assert.equal(clientIp(req(CF_V4, ` ${VISITOR_V4} `)), VISITOR_V4);
  });

  test('no address at all stays as it is', () => {
    assert.equal(clientIp(req(undefined, VISITOR_V4)), undefined);
    assert.equal(clientIp({ headers: {} }), undefined);
  });
});

describe('isCloudflare', () => {
  const v4 = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  const v4Number = (ip) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
  const inV4Range = (range, n) => {
    const [base, bits] = range.split('/');
    const start = v4Number(base);
    return n >= start && n < start + 2 ** (32 - Number(bits));
  };

  test('the first and last address of every IPv4 range are in, the ones just outside are not', () => {
    for (const range of CLOUDFLARE_RANGES.ipv4) {
      const [base, bits] = range.split('/');
      const first = v4Number(base);
      const last = first + 2 ** (32 - Number(bits)) - 1;
      assert.equal(isCloudflare(v4(first)), true, `${range} first`);
      assert.equal(isCloudflare(v4(last)), true, `${range} last`);
      // Just outside: in only if another published range happens to start there.
      const elsewhere = (n) => CLOUDFLARE_RANGES.ipv4.some((other) => other !== range && inV4Range(other, n));
      assert.equal(isCloudflare(v4(last + 1)), elsewhere(last + 1), `${range} next`);
      assert.equal(isCloudflare(v4(first - 1)), elsewhere(first - 1), `${range} previous`);
    }
  });

  test('IPv6 ranges', () => {
    assert.equal(isCloudflare('2400:cb00::1'), true);
    assert.equal(isCloudflare('2400:cb00:ffff:ffff:ffff:ffff:ffff:ffff'), true);
    assert.equal(isCloudflare('2400:cb01::1'), false);
    assert.equal(isCloudflare('2a06:98c0::1'), true);
    assert.equal(isCloudflare('2a06:98c7:ffff::1'), true, '/29 reaches 2a06:98c7');
    assert.equal(isCloudflare('2a06:98c8::1'), false);
    assert.equal(isCloudflare('2c0f:f248::1'), true);
    assert.equal(isCloudflare('2001:db8::1'), false);
  });

  test('anything that is not an address is not Cloudflare', () => {
    for (const value of [undefined, null, '', 'localhost', '162.158.0.0/15', 42, {}, ['162.158.1.1']]) {
      assert.equal(isCloudflare(value), false, String(value));
    }
  });

  test('the ranges are the ones Cloudflare publishes at https://www.cloudflare.com/ips/', () => {
    assert.deepEqual(CLOUDFLARE_RANGES.ipv4, [
      '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
      '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
      '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
    ]);
    assert.deepEqual(CLOUDFLARE_RANGES.ipv6, [
      '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
    ]);
  });
});
