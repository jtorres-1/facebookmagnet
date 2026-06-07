require("dotenv").config();
const puppeteer = require("puppeteer");
const csv = require("csv-parser");
const fs = require("fs");

const SESSION_PATH = "./session.json";
const LEADS_PATH = "./fb_leads.csv";
const SENT_PATH = "./fb_sent.json";

const MAX_DMS_PER_SESSION = 100;
const MIN_DELAY_MS = 30000;
const MAX_DELAY_MS = 60000;
const PROFILE_LOAD_WAIT = 4000;
const POST_CLICK_WAIT = 4000;
const SEARCH_WAIT = 4000;

const SELLER_SIGNALS = [
  "i build", "i develop", "hire me", "my services", "i offer",
  "available for hire", "for hire", "my portfolio", "i specialize",
  "check out my", "i am a developer", "i am a web", "i create",
  "i code", "i design", "my rates", "i do freelance", "i provide",
  "offering my services", "i am available", "years of experience"
];

const DM_MESSAGE = `hey! saw your post. i'm a python developer based in LA available immediately. i build websites, scrapers, bots, ai integrations, and automation pipelines. 48 hour delivery, flat fee.

recent work:
restaurant site: https://casa-fuego-demo.netlify.app
cleaning business: https://claudiascleaningla.com
church site: https://iphavp.org
lead scraper saas: https://mapzap.org

linkedin: https://www.linkedin.com/in/jesse-torres11/
github: https://github.com/jtorres-1

dm me a scope.`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function loadSent() {
  if (!fs.existsSync(SENT_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(SENT_PATH)); } catch { return {}; }
}

function saveSent(data) {
  fs.writeFileSync(SENT_PATH, JSON.stringify(data, null, 2));
}

function alreadySent(sent, author) {
  if (!author) return true;
  return !!sent[author.toLowerCase()];
}

function isSeller(lead) {
  const text = ((lead.Keyword || '') + ' ' + (lead.Author || '')).toLowerCase();
  return SELLER_SIGNALS.some(s => text.includes(s));
}

function loadLeads() {
  return new Promise(resolve => {
    if (!fs.existsSync(LEADS_PATH)) return resolve([]);
    const rows = [];
    fs.createReadStream(LEADS_PATH)
      .pipe(csv())
      .on('data', row => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', () => resolve(rows));
  });
}

async function loadSession(page) {
  if (!fs.existsSync(SESSION_PATH)) throw new Error("No session. Run manual_login.cjs first.");
  const cookies = JSON.parse(fs.readFileSync(SESSION_PATH));
  await page.setCookie(...cookies);
  await page.goto("https://www.facebook.com", { waitUntil: "networkidle2" });
  if (page.url().includes("login")) throw new Error("Session expired. Run manual_login.cjs again.");
  console.log("Session loaded.");
}

async function getProfileFromSearch(page, name) {
  try {
    await page.goto(
      `https://www.facebook.com/search/people/?q=${encodeURIComponent(name)}`,
      { waitUntil: "networkidle2", timeout: 30000 }
    );
    await sleep(SEARCH_WAIT);
    return await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="facebook.com"]'));
      for (const a of links) {
        const href = a.href.split('&__cft__')[0].split('&__tn__')[0];
        if (
          (href.match(/facebook\.com\/[a-zA-Z0-9._]{3,}$/) ||
           href.match(/facebook\.com\/profile\.php\?id=/)) &&
          !href.includes('/groups/') &&
          !href.includes('/search/') &&
          !href.includes('/events/')
        ) {
          const name = a.innerText?.trim();
          if (name && name !== 'Facebook' && name.length > 1) return href;
        }
      }
      return null;
    });
  } catch {
    return null;
  }
}

async function sendDM(page, profile, name, keyword, score) {
  try {
    await page.goto(profile, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(PROFILE_LOAD_WAIT + rand(0, 2000));

    // Find Message button on profile page only
    const msgBtn = await page.$('[aria-label="Message"]') ||
                   await page.$('[aria-label="Send message"]');

    if (!msgBtn) {
      console.log(`SKIP — no message button for ${name}`);
      return 'no_button';
    }

    await msgBtn.click();
    await sleep(POST_CLICK_WAIT + rand(0, 1500));

    // Wait for messenger chat popup specifically — not comment box
    const msgBox = await page.waitForSelector(
      'div[data-lexical-editor="true"]',
      { visible: true, timeout: 8000 }
    ).catch(() => null);

    if (!msgBox) {
      console.log(`SKIP — messenger popup did not open for ${name}`);
      return 'no_box';
    }

    await msgBox.click();
    await sleep(rand(800, 1500));
    await page.keyboard.type(DM_MESSAGE, { delay: rand(18, 45) });
    await sleep(rand(800, 1500));
    await page.keyboard.press("Enter");
    await sleep(rand(1500, 3000));

    console.log(`SENT → ${name} | ${keyword} | score:${score}`);
    return 'sent';
  } catch (err) {
    console.log(`ERROR — DM failed for ${name}: ${err.message}`);
    return 'error';
  }
}

(async () => {
  const sent = loadSent();
  const leads = await loadLeads();

  if (!leads.length) {
    console.log("No leads. Run fb_scraper.cjs first.");
    process.exit(0);
  }

  const unsent = leads
    .filter(l => l.Author && !alreadySent(sent, l.Author))
    .sort((a, b) => parseInt(b.Score || 0) - parseInt(a.Score || 0));

  console.log(`${unsent.length} uncontacted leads. Starting DMs (max ${MAX_DMS_PER_SESSION} today)...`);

  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  await loadSession(page);

  let totalSent = 0;
  let totalSkipped = 0;

  for (const lead of unsent) {
    if (totalSent >= MAX_DMS_PER_SESSION) {
      console.log(`\nDaily limit of ${MAX_DMS_PER_SESSION} DMs reached. Stopping safely.`);
      break;
    }

    const key = lead.Author.toLowerCase();

    if (alreadySent(sent, lead.Author)) {
      console.log(`SKIP — already DMed ${lead.Author}`);
      continue;
    }

    // Skip sellers
    if (isSeller(lead)) {
      console.log(`SKIP — seller detected: ${lead.Author}`);
      totalSkipped++;
      continue;
    }

    let profileUrl = lead.Profile && lead.Profile.length > 10 ? lead.Profile : null;
    if (!profileUrl) {
      console.log(`Searching for ${lead.Author}...`);
      profileUrl = await getProfileFromSearch(page, lead.Author);
      if (!profileUrl) {
        console.log(`SKIP — could not find profile for ${lead.Author}`);
        totalSkipped++;
        continue;
      }
    }

    const result = await sendDM(page, profileUrl, lead.Author, lead.Keyword, lead.Score);

    if (result === 'sent') {
      sent[key] = {
        name: lead.Author,
        profile: profileUrl,
        keyword: lead.Keyword,
        score: lead.Score,
        sent_at: new Date().toISOString()
      };
      saveSent(sent);
      totalSent++;
      const delay = rand(MIN_DELAY_MS, MAX_DELAY_MS);
      console.log(`Waiting ${Math.round(delay / 1000)}s... (${totalSent}/${MAX_DMS_PER_SESSION} sent)`);
      await sleep(delay);
    } else {
      if (result === 'no_button') {
        sent[key] = {
          name: lead.Author,
          profile: profileUrl,
          skipped: true,
          reason: 'no_message_button',
          sent_at: new Date().toISOString()
        };
        saveSent(sent);
      }
      totalSkipped++;
      await sleep(rand(3000, 6000));
    }
  }

  console.log(`\nDone. ${totalSent} DMs sent. ${totalSkipped} skipped.`);
  await browser.close();
})();
