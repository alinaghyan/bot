const path = require('path');
const ejs = require('ejs');

async function main() {
  const file = path.join(__dirname, '..', 'views', 'logs.ejs');
  const html = await ejs.renderFile(
    file,
    {
      user: 'test',
      logFile: 'c:\\\\path\\\\to\\\\app.log',
      entries: [
        { ts: new Date().toISOString(), level: 'info', message: 'hello', meta: { a: 1 } },
        { ts: new Date().toISOString(), level: 'error', message: 'boom', meta: { error: { message: 'x' } } }
      ]
    },
    { async: true, filename: file }
  );

  if (!html || !html.includes('لاگ سیستم')) throw new Error('Logs render failed');
  console.log('Logs render OK. html length:', html.length);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

