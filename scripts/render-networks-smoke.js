const path = require('path');
const ejs = require('ejs');

async function main() {
  const file = path.join(__dirname, '..', 'views', 'networks.ejs');
  const html = await ejs.renderFile(
    file,
    {
      user: 'test',
      networks: [
        { id: 1, name: 'ایتا', base_url: 'web.eitaa.com', api_base_url: null, is_active: 1 },
        { id: 2, name: 'نمونه', base_url: 'example.com', api_base_url: 'https://api.example.com/v1', is_active: 0 }
      ]
    },
    { async: true, filename: file }
  );

  if (!html || !html.includes('شبکه‌های مجازی')) throw new Error('Networks render failed');
  console.log('Networks render OK. html length:', html.length);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

