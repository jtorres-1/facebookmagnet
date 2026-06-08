require("dotenv").config();
const puppeteer = require("puppeteer");
const csv = require("csv-parser");
const fs = require("fs");

const SESSION_PATH = "./session.json";
const LEADS_PATH = "./fb_leads.csv";
const SENT_PATH = "./fb_sent.json";
const COMMENTED_PATH = "./fb_commented.json";

const MAX_DMS_PER_SESSION = 100;
const MIN_DELAY_MS = 30000;
const MAX_DELAY_MS = 60000;
const PROFILE_LOAD_WAIT = 4000;
const POST_CLICK_WAIT = 5000;
const POST_AGE_LIMIT_DAYS = 7;

const SELLER_SIGNALS = [
  "i offer", "i build", "i provide", "my services", "check out my",
  "i am a developer", "i am a web developer", "i specialize in",
  "hire me", "my portfolio", "i can build", "i develop", "i create",
  "i code", "i design websites", "years of experience",
  "available for hire", "for hire", "i do freelance",
  "offering my services", "i am a programmer", "i am a coder",
  "i am a freelancer", "looking for clients", "seeking clients",
  "looking for projects", "open to projects", "taking on projects",
  "upwork", "fiverr", "toptal",
];

const DEVHIRE_DM = `hey! saw your post. i'm a python developer based in LA available immediately. i build websites, scrapers, bots, ai integrations, and automation pipelines. 48 hour delivery, flat fee.

recent work:
restaurant site: https://casa-fuego-demo.netlify.app
cleaning business: https://claudiascleaningla.com
church site: https://iphavp.org
lead scraper saas: https://mapzap.org

linkedin: https://www.linkedin.com/in/jesse-torres11/
github: https://github.com/jtorres-1

dm me a scope.`;

const MAPZAP_MESSAGES = [
  `saw your post. i built a tool that pulls 100 local business leads as a CSV in about 60 seconds. type a business type and city, get names, phone numbers, and addresses instantly. $49 one time, no subscription. https://mapzap.org`,
  `i built mapzap, pulls 100 local business leads in 60 seconds. name, phone, address, CSV download. one time $49, no monthly fee. https://mapzap.org`,
  `built a tool that scrapes 100 local businesses in 60 seconds. type a niche and city, download a CSV with names, phones, addresses. $49 once. https://mapzap.org`,
];

const DEVHIRE_COMMENT = `python developer in LA available immediately. i build websites, scrapers, bots and automation. 48 hour delivery flat fee. dm me a scope`;

const MAPZAP_COMMENT = `i built a tool that pulls 100 local business leads as a CSV in 60 seconds. any niche any city. dm me if you want to check it out`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function loadSent() {
  if (!fs.existsSync(SENT_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(SENT_PATH)); } catch { return {}; }
}

function saveSent(data) {
  fs.writeFileSync(SENT_PATH, JSON.stringify(data, null, 2));
}

function loadCommented() {
  if (!fs.existsSync(COMMENTED_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(COMMENTED_PATH)); } catch { return {}; }
}

function saveCommented(data) {
  fs.writeFileSync(COMMENTED_PATH, JSON.stringify(data, null, 2));
}

function alreadySent(sent, author) {
  if (!author) return true;
  return !!sent[author.toLowerCase()];
}

function isSeller(lead) {
  const text = ((lead.Keyword || '') + ' ' + (lead.Author || '')).toLowerCase();
  return SELLER_SIGNALS.some(s => text.includes(s));
}

function isPostFresh(lead) {
  if (!lead.Time) return true;
  try {
    const postTime = new Date(lead.Time);
    const ageMs = Date.now() - postTime.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return ageDays <= POST_AGE_LIMIT_DAYS;
  } catch {
    return true;
  }
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

async function getProfileFromPost(page, postUrl, authorName) {
  try {
    await page.goto(postUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(rand(3000, 5000));

    return await page.evaluate((authorName) => {
      const links = Array.from(document.querySelectorAll('a[href*="facebook.com"]'));
      for (const a of links) {
        const text = a.innerText?.trim();
        const href = a.href.split('&__cft__')[0].split('&__tn__')[0];
        if (
          text === authorName &&
          (href.match(/facebook\.com\/[a-zA-Z0-9._]{3,}$/) ||
           href.match(/facebook\.com\/profile\.php\?id=/)) &&
          !href.includes('/groups/') &&
          !href.includes('/events/') &&
          !href.includes('/photo') &&
          !href.includes('/posts/')
        ) {
          return href;
        }
      }
      return null;
    }, authorName);
  } catch {
    return null;
  }
}

async function commentOnPost(page, postUrl, commentText, authorName) {
  try {
    await page.goto(postUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(rand(3000, 5000));

    // Find and click comment box
    const commentBox = await page.waitForSelector(
      'div[aria-placeholder^="Comment as"][data-lexical-editor="true"], div[aria-placeholder^="Write a comment"][data-lexical-editor="true"], div[aria-placeholder^="Answer as"][data-lexical-editor="true"]',
      { visible: true, timeout: 8000 }
    ).catch(() => null);

    if (!commentBox) {
      console.log(`SKIP COMMENT — no comment box for post by ${authorName}`);
      return false;
    }

    await commentBox.click();
    await sleep(rand(1000, 2000));
    await page.keyboard.type(commentText, { delay: rand(18, 45) });
    await sleep(rand(800, 1500));
    await page.keyboard.press("Enter");
    await sleep(rand(2000, 3000));

    console.log(`COMMENTED → ${authorName} | ${commentText.substring(0, 50)}...`);
    return true;
  } catch (err) {
    console.log(`ERROR — comment failed for ${authorName}: ${err.message}`);
    return false;
  }
}

async function sendDM(page, profileUrl, name, message) {
  try {
    await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(PROFILE_LOAD_WAIT + rand(0, 2000));

    const msgBtn = await page.$('[aria-label="Message"]') ||
                   await page.$('[aria-label="Send message"]');

    if (!msgBtn) {
      console.log(`SKIP — no message button for ${name}`);
      return 'no_button';
    }

    await msgBtn.click();
    await sleep(POST_CLICK_WAIT + rand(0, 1500));
    await sleep(rand(2000, 3000));

    const msgBox = await page.waitForSelector(
      'div[aria-label^="Write to"][data-lexical-editor="true"], div[aria-label^="Message"][data-lexical-editor="true"]',
      { visible: true, timeout: 8000 }
    ).catch(() => null);

    if (!msgBox) {
      console.log(`SKIP — messenger popup did not open for ${name}`);
      return 'no_box';
    }

    await msgBox.click();
    await sleep(rand(800, 1500));
    await page.keyboard.type(message, { delay: rand(18, 45) });
    await sleep(rand(800, 1500));
    await page.keyboard.press("Enter");
    await sleep(rand(1500, 3000));

    console.log(`SENT → ${name}`);
    return 'sent';
  } catch (err) {
    console.log(`ERROR — DM failed for ${name}: ${err.message}`);
    return 'error';
  }
}

(async () => {
  const sent = loadSent();
  const commented = loadCommented();
  const leads = await loadLeads();

  if (!leads.length) {
    console.log("No leads. Run fb_scraper.cjs first.");
    process.exit(0);
  }

  const unsent = leads
    .filter(l => l.Author && !alreadySent(sent, l.Author))
    .sort((a, b) => parseInt(b.Score || 0) - parseInt(a.Score || 0));

  console.log(`${unsent.length} uncontacted leads. Starting DMs (max ${MAX_DMS_PER_SESSION} today)...`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    protocolTimeout: 60000
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  await loadSession(page);

  let totalSent = 0;
  let totalCommented = 0;
  let totalSkipped = 0;

  for (const lead of unsent) {
    if (totalSent >= MAX_DMS_PER_SESSION) {
      console.log(`\nDaily limit of ${MAX_DMS_PER_SESSION} DMs reached. Stopping safely.`);
      break;
    }

    const key = lead.Author.toLowerCase();
    const product = (lead.Product || 'DEVHIRE').toUpperCase();

    if (alreadySent(sent, lead.Author)) {
      console.log(`SKIP — already DMed ${lead.Author}`);
      continue;
    }

    if (isSeller(lead)) {
      console.log(`SKIP — seller detected: ${lead.Author}`);
      sent[key] = { name: lead.Author, skipped: true, reason: 'seller', sent_at: new Date().toISOString() };
      saveSent(sent);
      totalSkipped++;
      continue;
    }

    const message = product === 'MAPZAP' ? pick(MAPZAP_MESSAGES) : DEVHIRE_DM;
    const commentText = product === 'MAPZAP' ? MAPZAP_COMMENT : DEVHIRE_COMMENT;

    // Get profile URL from post first, fallback to scraped profile
    let profileUrl = null;

    if (lead.PostURL && lead.PostURL.length > 10) {
      console.log(`Loading post to find ${lead.Author}... [${product}]`);
      profileUrl = await getProfileFromPost(page, lead.PostURL, lead.Author);
    }

    if (!profileUrl && lead.ProfileURL && lead.ProfileURL.length > 10) {
      profileUrl = lead.ProfileURL;
    }

    if (!profileUrl) {
      // Try to comment on post as fallback if post is fresh
      if (lead.PostURL && lead.PostURL.length > 10 && isPostFresh(lead) && !commented[key]) {
        console.log(`No profile found — trying comment fallback for ${lead.Author} [${product}]`);
        const commentSuccess = await commentOnPost(page, lead.PostURL, commentText, lead.Author);
        if (commentSuccess) {
          commented[key] = {
            name: lead.Author,
            postUrl: lead.PostURL,
            product,
            commented_at: new Date().toISOString()
          };
          saveCommented(commented);
          totalCommented++;
        }
        sent[key] = { name: lead.Author, skipped: true, reason: 'no_profile_commented', sent_at: new Date().toISOString() };
        saveSent(sent);
      } else {
        console.log(`SKIP — could not find profile for ${lead.Author}`);
        totalSkipped++;
      }
      await sleep(rand(3000, 6000));
      continue;
    }

    const result = await sendDM(page, profileUrl, lead.Author, message);

    if (result === 'sent') {
      sent[key] = {
        name: lead.Author,
        profile: profileUrl,
        keyword: lead.Keyword,
        product,
        score: lead.Score,
        sent_at: new Date().toISOString()
      };
      saveSent(sent);
      totalSent++;
      const delay = rand(MIN_DELAY_MS, MAX_DELAY_MS);
      console.log(`Waiting ${Math.round(delay / 1000)}s... (${totalSent}/${MAX_DMS_PER_SESSION} sent) [${product}]`);
      await sleep(delay);
    } else {
      // DM failed — try comment fallback if post is fresh
      if (lead.PostURL && lead.PostURL.length > 10 && isPostFresh(lead) && !commented[key]) {
        console.log(`DM failed — trying comment fallback for ${lead.Author} [${product}]`);
        const commentSuccess = await commentOnPost(page, lead.PostURL, commentText, lead.Author);
        if (commentSuccess) {
          commented[key] = {
            name: lead.Author,
            postUrl: lead.PostURL,
            product,
            commented_at: new Date().toISOString()
          };
          saveCommented(commented);
          totalCommented++;
        }
      }

      if (result === 'no_button' || result === 'no_box') {
        sent[key] = {
          name: lead.Author,
          profile: profileUrl,
          skipped: true,
          reason: result,
          sent_at: new Date().toISOString()
        };
        saveSent(sent);
      }
      totalSkipped++;
      await sleep(rand(3000, 6000));
    }
  }

  console.log(`\nDone. ${totalSent} DMs sent. ${totalCommented} comments posted. ${totalSkipped} skipped.`);
  await browser.close();
})();
