'use strict';

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function encodeToken(token) {
  return String(token || '')
    .toLowerCase()
    .replace(/^kn/, 'n')
    .replace(/^wr/, 'r')
    .replace(/^wh/, 'w')
    .replace(/ph/g, 'f')
    .replace(/gh/g, '')
    .replace(/ck/g, 'k')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/z/g, 's')
    .replace(/[aeiou]/g, '')
    .replace(/(.)\1+/g, '$1');
}

function doubleMetaphone(value) {
  const compact = normalize(value).replace(/\s+/g, '');
  if (!compact) {
    return [];
  }

  const encoded = encodeToken(compact).toUpperCase();
  return Array.from(new Set([encoded, encoded.slice(0, 6), encoded.slice(0, 4)].filter(Boolean)));
}

module.exports = {
  doubleMetaphone
};
