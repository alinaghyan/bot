const http = require('http');
const https = require('https');

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/http-get.js <url>');
  process.exit(1);
}

const client = url.startsWith('https://') ? https : http;

client
  .get(url, (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => {
      console.log('status', res.statusCode);
      console.log(data);
    });
  })
  .on('error', (e) => {
    console.error('error', e.message);
    process.exit(1);
  });

