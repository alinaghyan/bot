const axios = require('axios');
const db = require('../database');
const { buildChatCompletionsUrl } = require('../ai-provider-utils');

function safeParse(content) {
  if (!content) return { analyse_result: 'error', analyse_score: 0 };
  const cleaned = String(content).replace(/```json|```/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const jsonText = firstBrace >= 0 && lastBrace >= 0 ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;
  try {
    const obj = JSON.parse(jsonText);
    const result = obj.analyse_result ?? obj.analyze_result ?? obj.analysis_result ?? obj.result;
    const score = obj.analyse_score ?? obj.analyze_score ?? obj.analysis_score ?? obj.score;
    const s = String(result || '').trim().toLowerCase();
    const normalized =
      s === 'approve' ? 'approve' : s === 'reject' ? 'reject' : s.replace(/[_-]/g, ' ') === 'not related' ? 'not related' : 'error';
    const n = Number(score);
    const clamped = Number.isFinite(n) ? Math.max(0, Math.min(20, Math.round(n))) : 0;
    return { analyse_result: normalized, analyse_score: clamped };
  } catch {
    return { analyse_result: 'error', analyse_score: 0 };
  }
}

function redact(s) {
  const str = String(s ?? '');
  if (!str) return str;
  if (str.length <= 8) return '[REDACTED]';
  return `${str.slice(0, 3)}…${str.slice(-3)}`;
}

async function main() {
  const keyword = process.argv[2] || 'پزشکیان';
  const text = process.argv[3] || 'این یک متن تست درباره پزشکیان است.';
  const url = process.argv[4] || 'https://example.com/post/1';

  const [providers] = await db.query('SELECT * FROM ai_providers WHERE is_active = 1 ORDER BY id DESC LIMIT 1');
  if (!providers.length) {
    console.log('No active provider found.');
    return;
  }
  const provider = providers[0];
  const apiUrl = buildChatCompletionsUrl(provider.base_url, provider);

  const prompt = `محتوای «${text}» که در لینک این پست «${url}» مشاهده می شود را بررسی کن و از بین گزینه های «تایید / بی ارتباط / مخالف»  با توجه به کلمه کلیدی «${keyword}» نتیجه را به من بگو 
همچنین اگر عدد ۱۰ را خنثی در نظر بگیریم شدید ترین نوع تایید ۲۰ و شدید ترین نوع مخالفت ۰ است. امتیاز مورد نظر خود را بعد از بررسی متن پست به من بگو. این نتیجه را به صورت json و با کلیدهای زیر ارسال کن : 
analyse_result: approve / not related / reject 
analyse_score: (0 to 20)
فقط JSON خالص برگردان.`;

  const payload = {
    model: provider.model || 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2
  };

  console.log('[AI][request]', JSON.stringify({ apiUrl, model: payload.model, provider: { id: provider.id, name: provider.name, base_url: provider.base_url }, api_key: redact(provider.api_key), keyword, text, url }, null, 2));

  const res = await axios.post(apiUrl, payload, {
    headers: { Authorization: `Bearer ${provider.api_key}`, 'Content-Type': 'application/json' },
    timeout: 20000
  });

  const content = res?.data?.choices?.[0]?.message?.content || '';
  console.log('[AI][response]', JSON.stringify({ status: res.status, content }, null, 2));
  console.log('[AI][parsed]', JSON.stringify(safeParse(content), null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[AI][error]', e?.response?.status, e?.response?.data || e?.message);
    process.exit(1);
  });
