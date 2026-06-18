require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");

const SESSION_PATH = "./session.json";
const COMMENTED_PATH = "./fb_commented_posts.json";
const JOINED_PATH = "./fb_joined_groups.json";
const BANNED_PATH = "./fb_banned_groups.json";
const LOG_PATH = "./fb_commenter.log";

const MAX_COMMENTS_PER_CYCLE = 15;
const MIN_DELAY_MS = 5 * 60 * 1000;
const MAX_DELAY_MS = 8 * 60 * 1000;
const CYCLE_INTERVAL_MS = 25 * 60 * 1000;
const MAX_POST_AGE_HOURS = 24;

const DEVHIRE_QUERIES = [
  "I need a website developer",
  "need a web developer",
  "hire a developer",
  "need a website built",
  "looking for a programmer",
  "need someone to build my website",
  "need a freelance developer",
];

const MAPZAP_QUERIES = [
  "need more leads for my business",
  "need business leads",
  "how to find more clients",
  "struggling to find customers",
  "need a lead list",
  "need more customers",
  "cold outreach leads",
];

const FLOWMATE_QUERIES = [
  "losing leads slow response",
  "need to follow up with leads faster",
  "contractors losing leads",
  "plumbers losing customers",
  "HVAC company losing leads",
  "small business owners Los Angeles",
  "home services business owners",
  "missing leads small business",
  "need automated follow up",
];

const AUTOSUB_QUERIES = [
  "how to automate outreach",
  "Reddit marketing for my business",
  "struggling with cold outreach",
  "need more leads for my agency",
  "how to get clients on Reddit",
  "outreach automation tools",
  "spending too much time on outreach",
  "how to scale my outreach",
];

const DEVHIRE_COMMENTS = [
  `i can help with this. python developer in LA, flat fee, 48 hour delivery. built mapzap.org (live SaaS) and claudiascleaningla.com. websites, scrapers, bots, AI integrations. DM me a scope`,
  `python dev available now. websites, automation, scrapers, AI integrations. flat fee, 48hr turnaround. $500 websites, $800 automation. DM me what you need built`,
  `this is what i do. python and node.js developer in LA. websites, bots, scrapers, automation, AI integrations. flat fee, 48 hour delivery. DM me a scope`,
  `available for this. python dev, LA based. recent work: mapzap.org and claudiascleaningla.com. flat fee, 48hr delivery. DM me what you need`,
];

const MAPZAP_COMMENTS = [
  `this might help. mapzap.org pulls 100 local business leads from Google Maps in 60 seconds as a CSV. name, phone, address, website, email where available. $19.99/month unlimited, free preview no card needed`,
  `built something for this. mapzap.org scrapes 100 local businesses in 60 seconds. type a niche and city, get a CSV instantly with emails included. $19.99/month unlimited, free to try first`,
  `mapzap.org might solve this. 100 local business leads from Google Maps in 60 seconds. CSV with name, phone, address, website, email. $19.99/month unlimited searches`,
  `i built mapzap.org for exactly this. type any business type and city, get 100 leads as a CSV in 60 seconds, emails included where available. $19.99/month unlimited, free preview available`,
];

const FLOWMATE_COMMENTS = [
  `this is a lead response problem. roughly 78% of customers go with whoever responds first. i built flowmate.live, it automatically texts and emails every new lead within 60 seconds, runs 24/7. $297 first month, $797/month after. flowmate.live`,
  `built flowmate.live for exactly this. auto texts and emails every new lead within 60 seconds so you stop losing business to whoever calls back first. i set it up and run it for you. $297 first month, $797/month after. flowmate.live`,
  `if you're getting leads and not responding instantly you're losing most of them. flowmate.live fixes that, automated text and email follow up within 60 seconds, no software to learn. $297 first month, $797/month after`,
  `this is solvable with automation. flowmate.live texts and emails every new lead within 60 seconds, 24/7, done for you. $297 to try the first month, $797/month if it's working for you. flowmate.live`,
];

const AUTOSUB_COMMENTS = [
  `this might help. built AutoSub, it automates your Reddit outreach. connect your Reddit account, set your keywords and offer, it finds people posting about needing what you sell and DMs them automatically 24/7. $19.99/month at autosub.online`,
  `built something for exactly this. AutoSub scrapes Reddit globally for posts matching your buyer keywords and sends your DM automatically. 200+ targeted messages per day, live dashboard. $19.99/month at autosub.online`,
  `AutoSub solves this. connect your Reddit account, set your offer and target keywords, it runs 24/7 finding buyers and DMing them automatically. $19.99/month. autosub.online`,
  `i built AutoSub for this. automated Reddit DM outreach. set it up once and it finds people looking for what you sell and messages them automatically. $19.99/month, no setup fee. autosub.online`,
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function log(tag, msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + "\n");
}

function loadCommented() {
  if (!fs.existsSync(COMMENTED_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(COMMENTED_PATH)); } catch { return {}; }
}

function saveCommented(c) {
  fs.writeFileSync(COMMENTED_PATH, JSON.stringify(c, null, 2));
}

function loadJoined() {
  if (!fs.existsSync(JOINED_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(JOINED_PATH)); } catch { return {}; }
}

function saveJoined(j) {
  fs.writeFileSync(JOINED_PATH, JSON.stringify(j, null, 2));
}

function loadBanned() {
  if (!fs.existsSync(BANNED_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(BANNED_PATH)); } catch { return []; }
}

function saveBanned(b) {
  fs.writeFileSync(BANNED_PATH, JSON.stringify(b, null, 2));
}

async function loadSession(page) {
  if (!fs.existsSync(SESSION_PATH)) throw new Error("No session found.");
  const cookies = JSON.parse(fs.readFileSync(SESSION_PATH));
  await page.setCookie(...cookies);
  await page.goto("https://www.facebook.com", { waitUntil: "networkidle2", timeout: 30000 });
  if (page.url().includes("login")) throw new Error("Session expired.");
  log("INFO", "Session loaded.");
}

async function searchGroups(page, query) {
  const url = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(rand(4000, 6000));
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await sleep(rand(1000, 1500));
  }

  const groups = await page.evaluate(() => {
    const seen = new Set();
    const results = [];
    Array.from(document.querySelectorAll('a[href*="/groups/"]')).forEach(a => {
      const href = a.href.split('?')[0];
      if (
        !href.match(/facebook\.com\/groups\/[a-zA-Z0-9._]+\/?$/) ||
        href.includes('/groups/feed') ||
        href.includes('/groups/discover') ||
        href.includes('/groups/joins') ||
        seen.has(href)
      ) return;
      seen.add(href);
      results.push(href);
    });
    return results;
  });

  log("INFO", `Found ${groups.length} groups for "${query}"`);
  return groups;
}

async function joinGroup(page, groupUrl) {
  try {
    await page.goto(groupUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(rand(3000, 4000));

    const result = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="button"]'));
      const joinBtn = btns.find(b => {
        const t = b.innerText?.toLowerCase().trim();
        return t === 'join group' || t === 'join';
      });
      if (joinBtn) { joinBtn.click(); return "joined"; }
      const joinedBtn = btns.find(b => b.innerText?.toLowerCase().includes('joined'));
      if (joinedBtn) return "already";
      return "not_found";
    });

    if (result === "joined") {
      log("JOINED", groupUrl);
      await sleep(rand(4000, 6000));
    }
    return result;
  } catch (err) {
    log("ERROR", `Join failed ${groupUrl}: ${err.message}`);
    return "error";
  }
}

async function getRecentPostUrls(page, groupUrl) {
  await page.goto(groupUrl, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(rand(6000, 8000));
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollBy(0, 700));
    await sleep(rand(800, 1200));
  }

  const postUrls = await page.evaluate((maxAgeHours) => {
    const seen = new Set();
    const results = [];

    Array.from(document.querySelectorAll('a[href*="/posts/"]')).forEach(a => {
      const base = a.href.split('?')[0];
      if (!base.includes('/posts/') || seen.has(base)) return;

      let ageOk = true;
      let el = a;
      for (let i = 0; i < 8; i++) {
        if (!el.parentElement) break;
        el = el.parentElement;
        const text = el.innerText || '';
        const hourMatch = text.match(/(\d+)\s*h(?:ours?)?/i);
        const dayMatch = text.match(/(\d+)\s*d(?:ays?)?/i);
        const minMatch = text.match(/(\d+)\s*m(?:in)?/i);
        if (dayMatch && parseInt(dayMatch[1]) >= 1) { ageOk = false; break; }
        if (hourMatch && parseInt(hourMatch[1]) > maxAgeHours) { ageOk = false; break; }
        if (hourMatch || minMatch || text.includes('Just now')) break;
      }

      if (ageOk) {
        seen.add(base);
        results.push(base);
      }
    });

    return results.slice(0, 10);
  }, MAX_POST_AGE_HOURS);

  log("INFO", `${groupUrl.split('/groups/')[1]}: found ${postUrls.length} recent post URLs`);
  return postUrls;
}

async function commentOnPost(page, postUrl, commentText) {
  await page.goto(postUrl, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(rand(4000, 5000));

  try {
    await page.waitForSelector(
      '[aria-placeholder="Write a comment…"], [aria-placeholder*="Comment as"], [data-lexical-editor="true"]',
      { timeout: 10000 }
    );
  } catch {
    log("SKIP", `No comment box loaded at ${postUrl.substring(0, 60)}`);
    return false;
  }

  const clicked = await page.evaluate(() => {
    const box =
      document.querySelector('[aria-placeholder="Write a comment…"]') ||
      document.querySelector('[aria-placeholder*="Comment as"]') ||
      document.querySelector('[data-lexical-editor="true"]');
    if (!box) return false;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    box.click();
    box.focus();
    return true;
  });

  if (!clicked) return false;

  await sleep(rand(1000, 1500));
  await page.keyboard.type(commentText, { delay: rand(25, 45) });
  await sleep(rand(1500, 2500));
  await page.keyboard.press('Enter');
  await sleep(rand(3000, 5000));
  return true;
}

async function runCycle() {
  const commented = loadCommented();
  const joined = loadJoined();
  const banned = loadBanned();
  let commentsThisCycle = 0;

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    userDataDir: './commenter_profile',
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

  try {
    await loadSession(page);

    const allQueries = [
      ...DEVHIRE_QUERIES.map(q => ({ query: q, type: "DEVHIRE" })),
      ...MAPZAP_QUERIES.map(q => ({ query: q, type: "MAPZAP" })),
      ...FLOWMATE_QUERIES.map(q => ({ query: q, type: "FLOWMATE" })),
      ...AUTOSUB_QUERIES.map(q => ({ query: q, type: "AUTOSUB" })),
    ].sort(() => Math.random() - 0.5);

    for (const { query, type } of allQueries) {
      if (commentsThisCycle >= MAX_COMMENTS_PER_CYCLE) break;

      const groupUrls = await searchGroups(page, query);

      for (const groupUrl of groupUrls) {
        if (commentsThisCycle >= MAX_COMMENTS_PER_CYCLE) break;
        if (banned.includes(groupUrl)) { log("SKIP", `Banned group ${groupUrl}`); continue; }

        if (!joined[groupUrl]) {
          const joinResult = await joinGroup(page, groupUrl);
          joined[groupUrl] = joinResult;
          saveJoined(joined);
          if (joinResult === "error") {
            if (!banned.includes(groupUrl)) { banned.push(groupUrl); saveBanned(banned); }
            continue;
          }
          await sleep(rand(3000, 5000));
        }

        const postUrls = await getRecentPostUrls(page, groupUrl);

        for (const postUrl of postUrls) {
          if (commentsThisCycle >= MAX_COMMENTS_PER_CYCLE) break;
          if (commented[postUrl]) continue;

          let commentText;
          if (type === "DEVHIRE") commentText = pick(DEVHIRE_COMMENTS);
          else if (type === "MAPZAP") commentText = pick(MAPZAP_COMMENTS);
          else if (type === "FLOWMATE") commentText = pick(FLOWMATE_COMMENTS);
          else commentText = pick(AUTOSUB_COMMENTS);

          log("MATCH", `[${type}] ${postUrl.substring(0, 70)}`);

          try {
            const success = await commentOnPost(page, postUrl, commentText);
            if (!success) {
              log("SKIP", `Could not comment on ${postUrl.substring(0, 60)}`);
              continue;
            }

            commented[postUrl] = new Date().toISOString();
            saveCommented(commented);
            commentsThisCycle++;
            log("COMMENTED", `[${type}] ${commentsThisCycle}/${MAX_COMMENTS_PER_CYCLE} ${postUrl.substring(0, 60)}`);
            log("INFO", `Waiting ${Math.round(MIN_DELAY_MS/60000)} to ${Math.round(MAX_DELAY_MS/60000)} min...`);
            await sleep(rand(MIN_DELAY_MS, MAX_DELAY_MS));

          } catch (err) {
            log("ERROR", `Comment failed: ${err.message}`);
          }
        }

        await sleep(rand(3000, 5000));
      }

      await sleep(rand(4000, 7000));
    }

  } catch (err) {
    log("ERROR", `Cycle failed: ${err.message}`);
  }

  await browser.close();
  log("INFO", `Cycle complete. Commented on ${commentsThisCycle} posts.`);
}

(async () => {
  console.log("=".repeat(60));
  console.log("FacebookCommenter -- Group Comment Bot");
  console.log("=".repeat(60));
  while (true) {
    await runCycle();
    log("INFO", `Next cycle in ${Math.round(CYCLE_INTERVAL_MS/60000)} minutes.`);
    await sleep(CYCLE_INTERVAL_MS);
  }
})();
