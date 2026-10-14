'use strict';

// The address a request comes from, as the rate limits (server.js) and the
// Racing sign-in log (routes/racing-auth.js) count it.
//
// Requests reach the site through Cloudflare, then Railway's edge. With
// 'trust proxy' 1 (server.js), req.ip is the address that connected to
// Railway's edge: for a request through Cloudflare, a Cloudflare edge server
// that many visitors share. Cloudflare sends the visitor's own address in the
// CF-Connecting-IP header, so that header is used when req.ip is one of
// Cloudflare's addresses and holds a valid address; any other request counts as
// req.ip, whatever headers it carries.

const net = require('net');

// Cloudflare's published ranges, https://www.cloudflare.com/ips/ (as listed on
// 2026-10-14). When Cloudflare adds a range, add it here: until then, requests
// through it count as the Cloudflare edge address.
const CLOUDFLARE_RANGES = Object.freeze({
  ipv4: Object.freeze([
    '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
    '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
    '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  ]),
  ipv6: Object.freeze([
    '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
  ]),
});

const cloudflare = new net.BlockList();
for (const family of ['ipv4', 'ipv6']) {
  for (const range of CLOUDFLARE_RANGES[family]) {
    const [address, prefix] = range.split('/');
    cloudflare.addSubnet(address, Number(prefix), family);
  }
}

// a.b.c.d for ::ffff:a.b.c.d (an IPv4 address as an IPv6 socket reports it).
function withoutV4Prefix(ip) {
  const v4 = /^::ffff:/i.test(ip) ? ip.slice('::ffff:'.length) : '';
  return net.isIPv4(v4) ? v4 : ip;
}

// Whether ip is one of Cloudflare's addresses.
function isCloudflare(ip) {
  if (typeof ip !== 'string') return false;
  const address = withoutV4Prefix(ip.trim());
  const family = net.isIP(address);
  if (family === 4) return cloudflare.check(address, 'ipv4');
  if (family === 6) return cloudflare.check(address, 'ipv6');
  return false;
}

// The visitor's address: CF-Connecting-IP for a request from a Cloudflare edge
// that names a valid address, otherwise req.ip.
function clientIp(req) {
  const peer = req.ip;
  if (isCloudflare(peer)) {
    const header = req.headers && req.headers['cf-connecting-ip'];
    const visitor = typeof header === 'string' ? header.trim() : '';
    if (net.isIP(visitor)) return visitor;
  }
  return peer;
}

module.exports = { clientIp, isCloudflare, CLOUDFLARE_RANGES };
