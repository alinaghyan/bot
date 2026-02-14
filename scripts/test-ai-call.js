const db = require('../database');
const axios = require('axios');

function buildChatCompletionsUrl(baseUrl, apiKey) {
  if (!baseUrl) {
    if (apiKey && String(apiKey).trim().toLowerCase().startsWith('aa-')) {
      baseUrl = 'https://api.avalai.ir/v1';
    } else {
      return 'https://api.openai.com/v1/chat/completions';
    }
  }
  let u = String(baseUrl).trim();
  if (!u) return 'https://api.openai.com/v1/chat/completions';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  u = u.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(u)) return u;
  if (!/\/v1$/i.test(u)) u = `${u}/v1`;
  return `${u}/chat/completions`;
}

async function main() {
  const providerId = Number(process.argv[2] || 1);
  const [rows] = await db.query('SELECT * FROM ai_providers WHERE id = ?', [providerId]);
  if (rows.length === 0) throw new Error('Provider not found');
  const p = rows[0];
  const url = buildChatCompletionsUrl(p.base_url, p.api_key);
  const model = p.model || 'gpt-3.5-turbo';

  const res = await axios.post(
    url,
    { model, messages: [{ role: 'user', content: 'Say Hello!' }], max_tokens: 20 },
    { headers: { Authorization: `Bearer ${p.api_key}`, 'Content-Type': 'application/json' }, timeout: 20000 }
  );

  console.log('OK', { providerId, url, model, status: res.status });
  console.log('sample:', res?.data?.choices?.[0]?.message?.content || '');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    const status = e?.response?.status;
    const data = e?.response?.data;
    console.error('FAILED', { status, data: data || e.message });
    process.exit(1);
  });

