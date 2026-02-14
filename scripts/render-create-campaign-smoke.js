const path = require('path');
const ejs = require('ejs');

async function main() {
  const file = path.join(__dirname, '..', 'views', 'create_campaign.ejs');
  const html = await ejs.renderFile(
    file,
    {
      user: 'test',
      providers: [{ id: 1, name: 'p1', provider_type: 'openai', model: 'gpt-4o' }],
      networks: [{ id: 1, name: 'ایتا', base_url: 'web.eitaa.com', is_active: 1 }],
      campaign: null,
      keywords: []
    },
    { async: true, filename: file }
  );

  if (!html || !html.includes('لیست کلمات کلیدی')) throw new Error('Create campaign render failed');
  console.log('Create campaign render OK. html length:', html.length);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

