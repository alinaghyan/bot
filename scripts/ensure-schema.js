const db = require('../database');

async function main() {
  const [cols] = await db.query("SHOW COLUMNS FROM results LIKE 'keyword'");
  if (cols.length === 0) {
    await db.query("ALTER TABLE results ADD COLUMN keyword VARCHAR(255) NULL AFTER campaign_id");
    console.log('Added results.keyword');
  } else {
    console.log('results.keyword already exists');
  }

  const [tables] = await db.query("SHOW TABLES LIKE 'networks'");
  if (tables.length === 0) {
    await db.query(`
      CREATE TABLE networks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        base_url VARCHAR(255) NOT NULL,
        api_base_url VARCHAR(255) NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Created networks table');
  } else {
    console.log('networks table already exists');
  }

  const [[cnt]] = await db.query('SELECT COUNT(*) as c FROM networks');
  if ((cnt?.c || 0) === 0) {
    await db.query('INSERT INTO networks (name, base_url, api_base_url, is_active) VALUES (?,?,?,?)', [
      'ایتا',
      'web.eitaa.com',
      null,
      1
    ]);
    console.log('Inserted default network: Eitaa');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
