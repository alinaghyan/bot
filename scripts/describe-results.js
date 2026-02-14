const db = require('../database');

async function main() {
  const [cols] = await db.query('DESCRIBE results');
  console.log(cols.map((c) => `${c.Field}\t${c.Type}\t${c.Null}\t${c.Default ?? ''}`).join('\n'));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

