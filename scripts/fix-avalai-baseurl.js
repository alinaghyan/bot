const db = require('../database');

async function main() {
  const [rows] = await db.query(
    "SELECT id,name,provider_type,model,base_url,api_key FROM ai_providers WHERE (base_url IS NULL OR base_url = '')"
  );

  const toUpdate = rows.filter((r) => {
    const key = String(r.api_key || '').trim().toLowerCase();
    const name = String(r.name || '').toLowerCase();
    return key.startsWith('aa-') || name.includes('aval');
  });

  if (toUpdate.length === 0) {
    console.log('No providers to update.');
    return;
  }

  for (const r of toUpdate) {
    await db.query('UPDATE ai_providers SET base_url = ? WHERE id = ?', ['https://api.avalai.ir/v1', r.id]);
  }

  console.log('Updated providers:', toUpdate.map((r) => r.id).join(', '));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

