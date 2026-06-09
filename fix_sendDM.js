const fs = require('fs');
let code = fs.readFileSync('./fb_dmbot.cjs', 'utf8');

const oldSelector = `const msgBox = await page.waitForSelector(
      'div[data-lexical-editor="true"]',
      { visible: true, timeout: 8000 }
    ).catch(() => null);`;

const newSelector = `// Wait for messenger popup to fully open
    await sleep(rand(2000, 3000));
    
    // Target the chat input inside the popup specifically — not comment box
    const msgBox = await page.waitForSelector(
      'div[aria-label^="Write to"][data-lexical-editor="true"], div[aria-label^="Message"][data-lexical-editor="true"]',
      { visible: true, timeout: 8000 }
    ).catch(() => null);`;

code = code.replace(oldSelector, newSelector);
fs.writeFileSync('./fb_dmbot.cjs', code);
console.log('Fixed');
