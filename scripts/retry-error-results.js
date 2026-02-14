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

async function analyze(text, keyword, url, provider) {
  const prompt = `محتوای «${text}» که در لینک این پست «${url}» مشاهده می شود را بررسی کن و از بین گزینه های «تایید / بی ارتباط / مخالف»  با توجه به کلمه کلیدی «${keyword}» نتیجه را به من بگو \nهمچنین اگر عدد ۱۰ را خنثی در نظر بگیریم شدید ترین نوع تایید ۲۰ و شدید ترین نوع مخالفت ۰ است. امتیاز مورد نظر خود را بعد از بررسی متن پست به من بگو. این نتیجه را به صورت json و با کلیدهای زیر ارسال کن : \nanalyse_result: approve / not related / reject \nanalyse_score: (0 to 20)\nفقط JSON خالص برگردان.`;
  const url2 = buildChatCompletionsUrl(provider.base_url, provider.api_key);
  const res = await axios.post(
    url2,
    { model: provider.model, messages: [{ role: 'user', content: prompt }], temperature: 0.2 },
    { headers: { Authorization: `Bearer ${provider.api_key}`, 'Content-Type': 'application/json' }, timeout: 20000 }
  );
  const content = res?.data?.choices?.[0]?.message?.content || '';
  const cleaned = String(content).replace(/```json|```/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const jsonText = firstBrace >= 0 && lastBrace >= 0 ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;
  const obj = JSON.parse(jsonText);
  const result = (obj.analyse_result || obj.analysis_result || obj.result || '').toString().trim().toLowerCase();
  const score = Number(obj.analyse_score ?? obj.analysis_score ?? obj.score ?? 0);
  const normalized =
    result === 'approve' ? 'approve' : result === 'reject' ? 'reject' : result === 'not related' ? 'not related' : 'error';
  return { analysis_result: normalized, analysis_score: Math.max(0, Math.min(20, Math.round(Number.isFinite(score) ? score : 0))) };
}

async function main() {
  const [[camp]] = await db.query('SELECT id, ai_provider_id FROM campaigns ORDER BY id DESC LIMIT 1');
  if (!camp) throw new Error('No campaign found');
  const [[provider]] = await db.query('SELECT * FROM ai_providers WHERE id = ?', [camp.ai_provider_id]);
  if (!provider) throw new Error('No provider assigned to latest campaign');
  const [kwRows] = await db.query('SELECT keyword FROM keywords WHERE campaign_id = ? ORDER BY id ASC', [camp.id]);
  const keywordFallback = (kwRows[0] && kwRows[0].keyword) || '';

  const [rows] = await db.query(
    "SELECT id, post_text, post_url, keyword FROM results WHERE campaign_id = ? AND analysis_result = 'error' ORDER BY checked_at DESC LIMIT 10",
    [camp.id]
  );
  if (rows.length === 0) {
    console.log('No error results to retry.');
    return;
  }

  let ok = 0;
  for (const r of rows) {
    const kw = r.keyword || keywordFallback;
    const out = await analyze(r.post_text || '', kw, r.post_url || '', provider);
    await db.query('UPDATE results SET analysis_result=?, analysis_score=?, checked_at=? WHERE id=?', [
      out.analysis_result,
      out.analysis_score,
      new Date(),
      r.id
    ]);
    if (out.analysis_result !== 'error') ok++;
  }
  console.log('Retried:', rows.length, 'ok:', ok);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.response?.data || e.message || e);
    process.exit(1);
  });

