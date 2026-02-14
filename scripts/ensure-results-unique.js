const db = require('../database');

async function main() {
  const indexName = 'uq_results_post_channel';

  const [idx] = await db.query('SHOW INDEX FROM results WHERE Key_name = ?', [indexName]);
  if (idx.length > 0) {
    console.log('Unique index already exists:', indexName);
    return;
  }

  console.log('Removing duplicates (keeping newest by id)...');
  await db.query(`
    DELETE r1
    FROM results r1
    INNER JOIN results r2
      ON r1.post_id = r2.post_id
     AND r1.channel_id = r2.channel_id
     AND r1.id < r2.id
  `);

  console.log('Adding unique index...');
  await db.query(`ALTER TABLE results ADD UNIQUE KEY ${indexName} (post_id, channel_id)`);

  console.log('Done.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });

