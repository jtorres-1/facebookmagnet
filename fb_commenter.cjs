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
  "miss calls","missing calls","missed calls","cant answer","can't answer",
  "lose customers","losing customers","need a receptionist",
  "need an answering service","need someone to answer",
  "calls go to voicemail","after hours","need 24/7",
  "phone keeps ringing","virtual receptionist","unanswered calls",
  "too busy to answer","always on a job","cant pick up","can't pick up",
  "small business owner","run my own business","i own a business",
  "plumber","plumbing","hvac","roofing","roofer","landscaping",
  "contractor","electrician","salon","dental","dentist","realtor",
  "real estate agent","insurance agent","auto shop","gym owner",
  "restaurant owner","law firm","attorney",
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

async function scanFeedAndComment(page, commented, maxComments) {
  let commentsThisCycle = 0;

  log("INFO", "Loading groups feed...");
  await page.goto("https://www.facebook.com/groups/feed/", { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(8000);

  const seen = new Set();
  let scrolls = 0;

  while (scrolls < 20 && commentsThisCycle < maxComments) {
    // Find original posts — they contain child articles (comments)
    const posts = await page.evaluate(() => {
      const results = [];
      const allArticles = Array.from(document.querySelectorAll('[role="article"]'));

      for (const article of allArticles) {
        // Original posts have child articles inside them
        const childArticles = article.querySelectorAll('[role="article"]');
        if (childArticles.length === 0) continue;

        // Get all text from direct children only (not from comment articles)
        // Remove comment articles first, then get text
        const clone = article.cloneNode(true);
        const commentArticles = clone.querySelectorAll('[role="article"]');
        commentArticles.forEach(c => c.remove());

        const text = clone.innerText?.trim() || "";
        if (text.length < 30) continue;

        // Get post URL
        const allLinks = Array.from(article.querySelectorAll('a[href]'));
        const postLink = allLinks.find(a =>
          a.href.includes('/posts/') ||
          a.href.includes('story_fbid') ||
          a.href.includes('/permalink/')
        );
        if (!postLink) continue;
        const postUrl = postLink.href.split('?')[0];
        if (!postUrl) continue;

        results.push({ text: text.substring(0, 600), url: postUrl });
      }
      return results;
    });

    log("INFO", `Scroll ${scrolls}: found ${posts.length} original posts`);
    if (posts.length > 0) log("SAMPLE", `"${posts[0].text.substring(0, 120)}"`);

    for (const post of posts) {
      if (commentsThisCycle >= maxComments) break;
      if (seen.has(post.url)) continue;
      seen.add(post.url);
      if (commented[post.url]) continue;

      const product = classifyPost(post.text);
      if (!product) {
        log("SKIP", `No match: "${post.text.substring(0, 60)}"`);
        continue;
      }

      let commentText;
      if (product === "DEVHIRE") commentText = pick(DEVHIRE_COMMENTS);
      else if (product === "CALLDONE") commentText = pick(CALLDONE_COMMENTS);
      else commentText = pick(MAPZAP_COMMENTS);

      log("MATCH", `[${product}] "${post.text.substring(0, 80)}"`);

      // Navigate to post and comment
      try {
        await page.goto(post.url, { waitUntil: "networkidle2", timeout: 60000 });
        await sleep(rand(3000, 5000));

        const clicked = await page.evaluate(() => {
          const box = document.querySelector('[aria-placeholder="Comment as Jesse"]') ||
                      document.querySelector('[aria-placeholder="Write a comment…"]') ||
                      document.querySelector('[data-lexical-editor="true"]');
          if (box) {
            box.scrollIntoView({ behavior: "smooth", block: "center" });
            box.click();
            box.focus();
            return true;
          }
          return false;
        });

        if (!clicked) {
          log("SKIP", `No comment box at ${post.url}`);
          await page.goto("https://www.facebook.com/groups/feed/", { waitUntil: "networkidle2", timeout: 60000 });
          await sleep(3000);
          continue;
        }

        await sleep(rand(1000, 2000));
        await page.evaluate(() => {
          const box = document.querySelector('[aria-placeholder="Comment as Jesse"]') ||
                      document.querySelector('[data-lexical-editor="true"]');
          if (box) { box.click(); box.focus(); }
        });
        await sleep(500);
        await page.keyboard.type(commentText, { delay: rand(25, 50) });
        await sleep(rand(2000, 3000));
        await page.keyboard.press('Enter');
        await sleep(rand(4000, 6000));

        commented[post.url] = new Date().toISOString();
        saveCommented(commented);
        commentsThisCycle++;
        log("COMMENTED", `[${product}] ${post.url.substring(0, 60)}`);
        log("INFO", `${commentsThisCycle}/${maxComments} comments. Waiting ${Math.round(MIN_DELAY_MS/60000)} to ${Math.round(MAX_DELAY_MS/60000)}min...`);
        await sleep(rand(MIN_DELAY_MS, MAX_DELAY_MS));

        // Return to feed
        await page.goto("https://www.facebook.com/groups/feed/", { waitUntil: "networkidle2", timeout: 60000 });
        await sleep(rand(3000, 5000));

      } catch (err) {
        log("ERROR", `Comment failed: ${err.message}`);
        await page.goto("https://www.facebook.com/groups/feed/", { waitUntil: "networkidle2", timeout: 60000 });
        await sleep(3000);
      }
    }

    await page.evaluate(() => window.scrollBy(0, 1200));
    await sleep(rand(2000, 3000));
    scrolls++;
  }

  return commentsThisCycle;
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
    commentsThisCycle = await scanFeedAndComment(page, commented, MAX_COMMENTS_PER_CYCLE);
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
