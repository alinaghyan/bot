const path = require('path');
const ejs = require('ejs');

async function main() {
  const file = path.join(__dirname, '..', 'views', 'report.ejs');
  const html = await ejs.renderFile(
    file,
    {
      user: 'test',
      campaign: { id: 1, title: 'کمپین تست' },
      results: [],
      stats: { approve: 0, reject: 0, 'not related': 0 },
      keywordTotals: [],
      keywordChannelRows: [],
      channelTotalsRows: []
    },
    { async: true, filename: file }
  );

  if (!html || !html.includes('گزارش کمپین')) {
    throw new Error('Report render failed');
  }
  console.log('Report render OK. html length:', html.length);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
