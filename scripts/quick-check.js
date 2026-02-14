const db = require('../database');

async function main() {
  const [providers] = await db.query(
    'SELECT id,name,provider_type,model,base_url,is_active,created_at FROM ai_providers ORDER BY id DESC LIMIT 10'
  );
  console.log('\nAI providers (last 10):');
  console.table(providers);

  const [campaigns] = await db.query(
    'SELECT id,title,status,ai_provider_id,network,frequency,start_date,end_date,created_at FROM campaigns ORDER BY id DESC LIMIT 10'
  );
  console.log('\nCampaigns (last 10):');
  console.table(campaigns);

  if (campaigns[0]) {
    const campaignId = campaigns[0].id;
    const [kw] = await db.query('SELECT keyword FROM keywords WHERE campaign_id = ? ORDER BY id ASC', [campaignId]);
    console.log(`\nKeywords for latest campaign (${campaignId}):`, kw.map(r => r.keyword));
    const [[cnt]] = await db.query('SELECT COUNT(*) as c FROM results WHERE campaign_id = ?', [campaignId]);
    console.log(`\nResults count for latest campaign (${campaignId}):`, cnt.c);

    const [latest] = await db.query(
      'SELECT analysis_result,analysis_score,is_reportage,checked_at,channel_name,post_url FROM results WHERE campaign_id=? ORDER BY checked_at DESC LIMIT 5',
      [campaignId]
    );
    console.log('\nLatest 5 results:');
    console.table(latest);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
