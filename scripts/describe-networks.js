const db = require('../database');

async function main() {
  try {
    const [tables] = await db.query("SHOW TABLES LIKE 'networks'");
    if (tables.length === 0) {
      console.log('networks table: MISSING');
      return;
    }
    console.log('networks table: OK');
    const [cols] = await db.query('DESCRIBE networks');
    console.log(cols.map((c) => `${c.Field}\t${c.Type}\t${c.Null}\t${c.Default ?? ''}`).join('\n'));
    const [rows] = await db.query('SELECT * FROM networks ORDER BY id ASC');
    console.log('\nrows:', rows);
  } catch (e) {
    console.error('ERROR:', e.message);
  }
}

main().then(() => process.exit(0));

