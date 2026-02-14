const db = require('../database');

async function main() {
  const [rows] = await db.query("SELECT id,name,model,api_key FROM ai_providers");
  const toUpdate = rows.filter((r) => {
    const key = String(r.api_key || '').trim().toLowerCase();
    const model = String(r.model || '').trim();
    return key.startsWith('aa-') && (!model || model === 'gpt-3.5-turbo');
  });

  if (toUpdate.length === 0) {
    console.log('No providers to update.');
    return;
  }

  for (const r of toUpdate) {
    await db.query('UPDATE ai_providers SET model = ? WHERE id = ?', ['gpt-4o', r.id]);
  }

  console.log('Updated providers:', toUpdate.map((r) => r.id).join(', '));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

