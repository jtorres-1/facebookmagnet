require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");

const SESSION_PATH = "./session.json";
const COMMENTED_PATH = "./fb_commented_posts.json";
const LOG_PATH = "./fb_commenter.log";

const MAX_COMMENTS_PER_CYCLE = 8;
const MIN_DELAY_MS = 8 * 60 * 1000;
const MAX_DELAY_MS = 12 * 60 * 1000;
const CYCLE_INTERVAL_MS = 30 * 60 * 1000;
const POST_MAX_AGE_HOURS = 6;

const DEVHIRE_KEYWORDS = [
  "need a website","need a developer","need a web developer","need a dev",
  "looking for a developer","looking for a web developer","hire a developer",
  "need someone to build","need a programmer","need a coder",
  "need a website built","need my website built","need a landing page",
  "need an app built","need a bot built","need automation",
  "need a shopify","need a wordpress","need someone to code",
  "looking to hire a developer","want to hire a developer",
  "need help with my website","need help building",
  "anyone know a good developer","recommend a developer",
  "need a freelance developer","need a web app",
];

const MAPZAP_KEYWORDS = [
  "need more leads","need leads for my business","need more clients",
  "need more customers","struggling to find clients","need a lead list",
  "need business leads","how do i find leads","where do i find leads",
  "need prospects","need cold outreach","need outreach list",
  "need to generate leads","struggling to get customers",
  "how to get more clients","need more sales","need a prospect list",
  "need local business leads","need b2b leads","how to find customers",
];

const CALLDONE_KEYWORDS = [
  "miss calls","missing calls","missed calls","can't answer my phone",
  "can't answer calls","lose customers from missed calls",
  "need a receptionist","need an answering service","need someone to answer",
  "calls go to voicemail","losing customers because","after hours calls",
  "need 24/7 answering","phone keeps ringing","always busy on the phone",
  "need virtual receptionist","can't afford a receptionist",
  "need someone to answer my phone","unanswered calls",
  "customers complain i don't answer","need call answering",
  "miss calls when i'm working","miss calls when busy",
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

function saveCommented(commented) {
  fs.writeFileSync(COMMENTED_PATH, JSON.stringify(commented, null, 2));
}

function classifyPost(text) {
  const t = text.toLowerCase();
  if (CALLDONE_KEYWORDS.some(k => t.includes(k))) return "CALLDONE";
  if (DEVHIRE_KEYWORDS.some(k => t.includes(k))) return "DEVHIRE";
  if (MAPZAP_KEYWORDS.some(k => t.includes(k))) return "MAPZAP";
  return null;
}

async function loadSession(page) {
  if (!fs.existsSync(SESSION_PATH)) throw new Error("No session found.");
  const cookies = JSON.parse(fs.readFileSync(SESSION_PATH));
  await page.setCookie(...cookies);
  await page.goto("https://www.facebook.com", { waitUntil: "networkidle2", timeout: 30000 });
  if (page.url().includes("login")) throw new Error("Session expired.");
  log("INFO", "Session loaded.");
}

async function getFeedPosts(page) {
  log("INFO", "Loading groups feed...");
  await page.goto("https://www.facebook.com/groups/feed/", { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(rand(3000, 5000));

  // Scroll to load more posts
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await sleep(rand(1500, 2500));
  }

  const posts = await page.evaluate(() => {
    const results = [];
    const seen = new Set();

    const articles = Array.from(document.querySelectorAll('[role="article"]'));

    for (const article of articles) {
      try {
        const textEl = article.querySelector('[data-ad-comet-preview="message"], [data-ad-preview="message"]');
        const text = textEl?.innerText || article.innerText || "";
        if (text.length < 20) continue;

        // Get post permalink
        const timeEl = article.querySelector('a[href*="/posts/"], a[href*="?story_fbid="], a[href*="/permalink/"]');
        if (!timeEl) continue;
        const postUrl = timeEl.href.split('?')[0];
        if (!postUrl || seen.has(postUrl)) continue;
        seen.add(postUrl);

        results.push({ text: text.substring(0, 500), url: postUrl });
      } catch(e) {}
    }

    return results;
  });

  log("INFO", `Found ${posts.length} posts in feed`);
  return posts;
}

async function commentOnPost(page, postUrl, commentText) {
  try {
    await page.goto(postUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(rand(2000, 3000));

    // Find comment box
    const commentBox = await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('[contenteditable="true"]'));
      const commentBox = boxes.find(b => {
        const placeholder = b.getAttribute('aria-placeholder') || b.getAttribute('data-placeholder') || '';
        return placeholder.toLowerCase().includes('comment') || placeholder.toLowerCase().includes('write');
      });
      if (commentBox) { commentBox.click(); commentBox.focus(); return true; }

      // Try clicking "Write a comment" area
      const writeComment = Array.from(document.querySelectorAll('span')).find(s =>
        s.innerText?.toLowerCase().includes('write a comment')
      );
      if (writeComment) { writeComment.click(); return true; }
      return false;
    });

    if (!commentBox) {
      log("SKIP", `No comment box at ${postUrl}`);
      return false;
    }

    await sleep(rand(1000, 2000));

    // Click the comment input again to make sure it's focused
    await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('[contenteditable="true"]'));
      const box = boxes.find(b => {
        const p = b.getAttribute('aria-placeholder') || b.getAttribute('data-placeholder') || '';
        return p.toLowerCase().includes('comment') || p.toLowerCase().includes('write');
      });
      if (box) { box.click(); box.focus(); }
    });

    await sleep(rand(500, 1000));
    await page.keyboard.type(commentText, { delay: rand(20, 40) });
    await sleep(rand(1500, 2500));
    await page.keyboard.press('Enter');
    await sleep(rand(3000, 5000));

    log("COMMENTED", `${postUrl.substring(0, 60)}`);
    return true;

  } catch (err) {
    log("ERROR", `Comment failed at ${postUrl}: ${err.message}`);
    return false;
  }
}

async function runCycle() {
  const commented = loadCommented();
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
    const posts = await getFeedPosts(page);

    for (const post of posts) {
      if (commentsThisCycle >= MAX_COMMENTS_PER_CYCLE) {
        log("INFO", `Hit max comments (${MAX_COMMENTS_PER_CYCLE}). Stopping.`);
        break;
      }

      if (commented[post.url]) continue;

      const product = classifyPost(post.text);
      if (!product) continue;

      let commentText;
      if (product === "DEVHIRE") commentText = pick(DEVHIRE_COMMENTS);
      else if (product === "CALLDONE") commentText = pick(CALLDONE_COMMENTS);
      else commentText = pick(MAPZAP_COMMENTS);

      log("MATCH", `[${product}] "${post.text.substring(0, 60)}"`);

      const success = await commentOnPost(page, post.url, commentText);

      if (success) {
        commented[post.url] = new Date().toISOString();
        saveCommented(commented);
        commentsThisCycle++;
        log("INFO", `${commentsThisCycle}/${MAX_COMMENTS_PER_CYCLE} comments. Waiting ${Math.round(MIN_DELAY_MS/60000)} to ${Math.round(MAX_DELAY_MS/60000)}min...`);
        await sleep(rand(MIN_DELAY_MS, MAX_DELAY_MS));
      }

      await sleep(rand(2000, 3000));
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
