const assert = require('assert');

function parseNumber(txt) {
  if (!txt) return 0;
  const normalizeDigits = (s) =>
    String(s || '')
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

  const normalized = normalizeDigits(String(txt).replace(/\s+/g, ' '))
    .replace(/٬/g, ',')
    .replace(/،/g, ',')
    .replace(/٫/g, '.');

  const m = normalized.match(/([\d,.]+)\s*([KkMm])?/);
  if (!m) return 0;
  const raw = m[1].replace(/,/g, '');
  const suffix = (m[2] || '').toLowerCase();
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return 0;
  if (suffix === 'k') return Math.round(n * 1000);
  if (suffix === 'm') return Math.round(n * 1000000);
  const lower = normalized.toLowerCase();
  if (lower.includes('هزار')) return Math.round(n * 1000);
  if (lower.includes('میلیون')) return Math.round(n * 1000000);
  return Math.round(n);
}

assert.equal(parseNumber('۱۲۳'), 123);
assert.equal(parseNumber('١٢٣'), 123);
assert.equal(parseNumber('۱٬۲۳۴'), 1234);
assert.equal(parseNumber('۱،۲۳۴'), 1234);
assert.equal(parseNumber('۱٫۲k'), 1200);
assert.equal(parseNumber('2.5K'), 2500);
assert.equal(parseNumber('۳ هزار عضو'), 3000);
assert.equal(parseNumber('۲.۵ میلیون'), 2500000);

console.log('parseNumber tests OK');

