require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");

const SESSION_PATH = "./session.json";
const COMMENTED_PATH = "./fb_commented_posts.json";
const JOINED_PATH = "./fb_joined_groups.json";
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

const AGENCYHIRE_QUERIES = [
  "struggling to scale my agency",
  "need more clients for my agency",
  "agency outreach help",
  "smma outreach",
  "how to get clients for my agency",
  "agency lead generation",
  "marketing agency growth",
  "need outreach for my agency",
  "automate my agency outreach",
  "agency owner need help with outreach",
];

const CALLDONE_QUERIES = [
  "small business owners Los Angeles",
  "restaurant owners group",
  "salon owners network",
  "contractors business owners",
  "plumbers electricians contractors",
  "home services business owners",
  "missing calls small business",
  "need a receptionist small business",
];

const DEVHIRE_COMMENTS = [
  `i can help with this — python developer in LA, flat fee, 48 hour delivery. built mapzap.org (live SaaS) and claudiascleaningla.com. websites, scrapers, bots, AI integrations. DM me a scope`,
  `python dev available now. websites, automation, scrapers, AI integrations. flat fee, 48hr turnaround. $500 websites, $800 automation. DM me what you need built`,
  `this is what i do — python and node.js developer in LA. websites, bots, scrapers, automation, AI integrations. flat fee, 48 hour delivery. DM me a scope`,
  `available for this. python dev, LA based. recent work: mapzap.org and claudiascleaningla.com. flat fee, 48hr delivery. DM me what you need`,
];

const MAPZAP_COMMENTS = [
  `this might help — mapzap.org pulls 100 local business leads from Google Maps in 60 seconds as a CSV. name, phone, address, website. $49/month unlimited, free preview no card needed`,
  `built something for this — mapzap.org scrapes 100 local businesses in 60 seconds. type a niche and city, get a CSV instantly. $49/month unlimited, free to try first`,
  `mapzap.org might solve this. 100 local business leads from Google Maps in 60 seconds. CSV with name, phone, address, website. $49/month unlimited searches`,
  `i built mapzap.org for exactly this. type any business type and city, get 100 leads as a CSV in 60 seconds. $49/month unlimited, free preview available`,
];

const CALLDONE_COMMENTS = [
  `this is exactly what calldone.org solves — AI receptionist that answers every call 24/7, handles FAQs, captures leads, texts you a summary after every call. $500/month no setup fee. call the demo: (563) 287-1146`,
  `calldone.org might help — AI receptionist answers your business calls 24/7, sounds like a real person, captures every lead, texts you instantly. $500/month flat, cancel anytime. demo: (563) 287-1146`,
  `built calldone.org for this exact problem. AI answers every call 24/7, trained on your business, texts you after every call. $500/month no contracts. hear it live: (563) 287-1146`,
  `calldone.org answers this — AI receptionist for your business, 24/7, no missed calls ever. captures leads, handles questions, texts you a summary. $500/month, live in 48hrs. demo: (563) 287-1146`,
];

const AGENCYHIRE_COMMENTS = [
  `i automate exactly this — built an outreach system that sends 1000+ targeted messages per day across Reddit, Facebook, Discord, and X to your ideal clients. set it up on your agency in 48 hours, flat fee $1,500. $500/month to keep it running. deposit to start: https://buy.stripe.com/9B6eVd7vteL23kedQ22Ry0d DM me if interested`,
  `this is solvable with automation — i run an outreach stack that hits Reddit, Facebook, Discord, and X simultaneously. finds your ideal clients, messages them automatically, 1000+ per day. deploy it for your agency in 48hrs for $1,500 flat. retainer $500/month. https://buy.stripe.com/9B6eVd7vteL23kedQ22Ry0d`,
  `built an automated outreach system for exactly this — Reddit DMs, Facebook group comments, Discord posts, X replies, all running 24/7 targeting your niche. $1,500 setup, 48 hour delivery, $500/month retainer. works while you sleep. DM me a scope: https://buy.stripe.com/9B6eVd7vteL23kedQ22Ry0d`,
  `scale your agency outreach without hiring — i deploy a full automated system on your accounts. Reddit, Facebook, Discord, X. 1000+ targeted messages per day to verified buyers in your niche. $1,500 flat to set up, $500/month to maintain. deposit here: https://buy.stripe.com/9B6eVd7vteL23kedQ22Ry0d`,
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

function classifyQuery(query) {
  if (DEVHIRE_QUERIES.includes(query)) return "DEVHIRE";
  if (MAPZAP_QUERIES.includes(query)) return "MAPZAP";
  if (AGENCYHIRE_QUERIES.includes(query)) return "AGENCYHIRE";
  return "CALLDONE";
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

      // Try to find post age from nearby timestamp text
      let ageOk = true;
      let el = a;
      for (let i = 0; i < 8; i++) {
        if (!el.parentElement) break;
        el = el.parentElement;
        const text = el.innerText || '';
        // Facebook timestamps: "Just now", "Xm", "Xh", "Xd", "X hours ago"
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

  // Wait for comment box
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
      ...DEVHIRE_QUERIES,
      ...MAPZAP_QUERIES,
      ...CALLDONE_QUERIES,
      ...AGENCYHIRE_QUERIES,
    ];

    // Shuffle queries so we don't always hit the same ones
    allQueries.sort(() => Math.random() - 0.5);

    for (const query of allQueries) {
      if (commentsThisCycle >= MAX_COMMENTS_PER_CYCLE) break;

      const product = DEVHIRE_QUERIES.includes(query) ? "DEVHIRE" :
                      MAPZAP_QUERIES.includes(query) ? "MAPZAP" : "CALLDONE";

      const groupUrls = await searchGroups(page, query);

      for (const groupUrl of groupUrls) {
        if (commentsThisCycle >= MAX_COMMENTS_PER_CYCLE) break;

        // Join if not already joined
        if (!joined[groupUrl]) {
          const joinResult = await joinGroup(page, groupUrl);
          joined[groupUrl] = joinResult;
          saveJoined(joined);
          if (joinResult === "error") continue;
          await sleep(rand(3000, 5000));
        }

        const postUrls = await getRecentPostUrls(page, groupUrl);

        for (const postUrl of postUrls) {
          if (commentsThisCycle >= MAX_COMMENTS_PER_CYCLE) break;
          if (commented[postUrl]) continue;

          let commentText;
          if (product === "DEVHIRE") commentText = pick(DEVHIRE_COMMENTS);
          else if (product === "MAPZAP") commentText = pick(MAPZAP_COMMENTS);
          else commentText = pick(CALLDONE_COMMENTS);

          log("MATCH", `[${product}] ${postUrl.substring(0, 70)}`);

          try {
            const success = await commentOnPost(page, postUrl, commentText);
            if (!success) {
              log("SKIP", `Could not comment on ${postUrl.substring(0, 60)}`);
              continue;
            }

            commented[postUrl] = new Date().toISOString();
            saveCommented(commented);
            commentsThisCycle++;
            log("COMMENTED", `[${product}] ${commentsThisCycle}/${MAX_COMMENTS_PER_CYCLE} — ${postUrl.substring(0, 60)}`);
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

