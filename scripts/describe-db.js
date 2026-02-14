const db = require('../database');

async function main() {
  const tables = ['campaigns', 'keywords', 'results', 'ai_providers', 'users'];
  for (const t of tables) {
    try {
      const [rows] = await db.query(`DESCRIBE ${t}`);
      console.log(`\n=== ${t} ===`);
      for (const r of rows) {
        console.log(`${r.Field}\t${r.Type}\t${r.Null}\t${r.Key}\t${r.Default ?? ''}\t${r.Extra ?? ''}`);
      }
    } catch (e) {
      console.log(`\n=== ${t} ===`);
      console.log(`ERROR: ${e.message}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

