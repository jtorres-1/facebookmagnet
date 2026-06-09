require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const SESSION_PATH = "./session.json";
const POSTED_PATH = "./fb_posted_groups.json";
const BANNED_PATH = "./fb_banned_groups.json";

const MAX_POSTS_PER_CYCLE = 30;
const MAX_POSTS_PER_HOUR = 4;
const MIN_DELAY_MS = 14 * 60 * 1000;
const MAX_DELAY_MS = 18 * 60 * 1000;
const POST_COOLDOWN_DAYS = 3;

const DEVHIRE_QUERIES = [
  "web developer needed",
  "hire a developer",
  "need a website",
  "small business website",
  "website help small business",
];

const MAPZAP_QUERIES = [
  "small business owners",
  "entrepreneurs network",
  "lead generation marketing",
  "cold outreach sales",
  "marketing agency owners",
  "restaurant owners network",
  "real estate agents network",
  "insurance agents group",
  "roofing contractors",
  "sales prospecting",
];

const DEVHIRE_POSTS = [
  `Hey everyone, putting this out there — I'm a developer based in LA with some availability this week.

I build websites, scrapers, automation tools, and AI integrations. All production ready, fast turnaround.

If you or anyone you know needs something built, feel free to DM me. Flat fee, 48 hour delivery on most projects.

Portfolio: https://casa-fuego-demo.netlify.app`,

  `Hi all, I'm a Python developer available for freelance work right now.

Stuff I've shipped: business websites, Google Maps scrapers, email outreach pipelines, automation bots. All running in production.

Looking for a project this week. DM me a scope and I'll tell you if I can build it. Flat fee only, no hourly.`,

  `Hey, hope this is okay to share here. I'm a freelance developer in LA looking for work this week.

I specialize in Python, Node.js, web apps, and automation. Fast turnaround, flat pricing, no surprises.

If you need a website or any kind of automation built, send me a DM.`,
];

const MAPZAP_POSTS = [
  `Hey everyone, I built something that might be useful for anyone doing cold outreach or prospecting.

It pulls 100 local business leads from Google Maps in about 60 seconds. You type a business type and city, get a CSV with names, phone numbers, addresses, and websites instantly.

$49 per month, unlimited searches. Free preview at mapzap.org if you want to try it before paying.

Happy to answer any questions.`,

  `Sharing something I built that's been saving me hours on lead research.

MapZap pulls local business leads from Google Maps — name, phone, address, website — as a downloadable CSV. Takes about a minute per search.

Monthly subscription at $49 gets you unlimited searches. There's also a $99/month tier that includes business emails.

Free trial at mapzap.org`,

  `Built a tool for anyone who does cold calling or outreach prospecting.

Type any business niche and city, get 100 leads as a CSV in 60 seconds. Google Maps data, always fresh.

$49/month unlimited searches. Try 5 leads free first with no credit card.

mapzap.org`,
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function loadPosted() {
  if (!fs.existsSync(POSTED_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(POSTED_PATH)); } catch { return {}; }
}

function savePosted(posted) {
  fs.writeFileSync(POSTED_PATH, JSON.stringify(posted, null, 2));
}

function loadBanned() {
  if (!fs.existsSync(BANNED_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(BANNED_PATH)); } catch { return []; }
}

function saveBanned(banned) {
  fs.writeFileSync(BANNED_PATH, JSON.stringify(banned, null, 2));
}

function wasPostedRecently(posted, groupUrl) {
  if (!posted[groupUrl]) return false;
  const last = new Date(posted[groupUrl]);
  const now = new Date();
  const diffDays = (now - last) / (1000 * 60 * 60 * 24);
  return diffDays < POST_COOLDOWN_DAYS;
}

function log(tag, msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${tag}: ${msg}`);
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
  log("SEARCH", `Searching groups for: "${query}"`);
  const url = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(rand(3000, 5000));

  // Scroll to load more groups
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await sleep(rand(1500, 2500));
  }

  const groups = await page.evaluate(() => {
    const results = [];
    const links = Array.from(document.querySelectorAll('a[href*="/groups/"]'));
    for (const link of links) {
      const href = link.href.split('?')[0];
      if (
        href.match(/facebook\.com\/groups\/[a-zA-Z0-9._]+\/?$/) &&
        !href.includes('/groups/feed') &&
        !href.includes('/groups/discover') &&
        !href.includes('/groups/joins')
      ) {
        const text = link.innerText?.trim() || '';
        if (!results.find(r => r.url === href)) {
          results.push({ url: href, name: text });
        }
      }
    }
    return results.slice(0, 10);
  });

  log("SEARCH", `Found ${groups.length} groups for "${query}"`);
  return groups;
}

async function joinGroup(page, groupUrl) {
  try {
    await page.goto(groupUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(rand(2000, 3000));

    const isPrivate = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('private group') || text.includes('private · group');
    });

    if (isPrivate) {
      log("SKIP", "Private group: " + groupUrl);
      return "private";
    }

    const joined = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="button"]'));
      const joinBtn = btns.find(b =>
        b.innerText?.toLowerCase().trim() === 'join group' ||
        b.innerText?.toLowerCase().trim() === 'join'
      );
      if (joinBtn) { joinBtn.click(); return true; }
      return false;
    });

    if (!joined) return "already_member";
    await sleep(rand(3000, 5000));
    log("JOINED", groupUrl);
    return "joined";

  } catch (err) {
    log("ERROR", "Join failed " + groupUrl + ": " + err.message);
    return "error";
  }
}

async function postToGroup(page, groupUrl, postText) {
  try {
    await page.goto(groupUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(rand(3000, 5000));

    // Check if join button exists — if so not a member
    const hasJoinBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="button"]'));
      return !!btns.find(b =>
        b.innerText?.toLowerCase().trim() === 'join group' ||
        b.innerText?.toLowerCase().trim() === 'join'
      );
    });

    if (hasJoinBtn) {
      log("SKIP", `Not a member of ${groupUrl}`);
      return "not_member";
    }

    // Click the post composer
    const composer = await page.evaluate(() => {
      // Try style-clipped span with Write something text
      const allSpans = Array.from(document.querySelectorAll('span[style*="webkit-line-clamp"]'));
      const writeSpan = allSpans.find(s => s.textContent?.includes('Write something'));
      if (writeSpan) { writeSpan.click(); return "webkit-span"; }
      // Try any span containing Write something
      const anySpan = Array.from(document.querySelectorAll('span')).find(s => s.textContent?.trim() === 'Write something...');
      if (anySpan) { anySpan.click(); return "any-span"; }
      // Try pagelet
      const pagelet = document.querySelector('[data-pagelet="GroupInlineComposer"]');
      if (pagelet) { pagelet.click(); return "pagelet"; }
      return false;
    });

    console.log("Composer result:", composer);

    if (!composer) {
      log("SKIP", `No composer found at ${groupUrl}`);
      return "no_composer";
    }

    await sleep(rand(2000, 3000));

    // Click the active contenteditable that appears after composer opens
    await page.evaluate(() => {
      const el = document.querySelector('[contenteditable="true"][role="textbox"]') ||
                 document.querySelector('[contenteditable="true"]');
      if (el) el.click();
    });

    await sleep(rand(1000, 2000));

    // Type post text
    await page.keyboard.type(postText, { delay: rand(20, 50) });
    await sleep(rand(2000, 3000));

    // Click Post button
    const posted = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="button"]'));
      const postBtn = btns.find(b => {
        const text = b.innerText?.trim();
        return (text === 'Post' || b.querySelector('span')?.innerText?.trim() === 'Post') &&
               b.offsetParent !== null;
      });
      if (postBtn) { postBtn.click(); return true; }
      return false;
    });

    if (!posted) {
      log("ERROR", `Could not click Post button at ${groupUrl}`);
      return "no_post_btn";
    }

    await sleep(rand(3000, 5000));
    log("POSTED", groupUrl);
    return "posted";

  } catch (err) {
    log("ERROR", `${groupUrl}: ${err.message}`);
    return "error";
  }
}

async function runCycle() {
  const posted = loadPosted();
  const banned = loadBanned();
  let postsThisCycle = 0;

  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

  try {
    await loadSession(page);

    const allQueries = [
      ...DEVHIRE_QUERIES.map(q => ({ query: q, type: "DEVHIRE" })),
      ...MAPZAP_QUERIES.map(q => ({ query: q, type: "MAPZAP" })),
    ];

    for (const { query, type } of allQueries) {
      if (postsThisCycle >= MAX_POSTS_PER_CYCLE) {
        log("INFO", `Hit max posts per cycle (${MAX_POSTS_PER_CYCLE}). Stopping.`);
        break;
      }

      const groups = await searchGroups(page, query);

      for (const group of groups) {
        if (postsThisCycle >= MAX_POSTS_PER_CYCLE) break;
        if (!group.url) continue;
        if (banned.includes(group.url)) continue;
        if (wasPostedRecently(posted, group.url)) {
          log("SKIP", `Already posted to ${group.url} recently`);
          continue;
        }

        const postText = type === "DEVHIRE" ? pick(DEVHIRE_POSTS) : pick(MAPZAP_POSTS);
        const result = await postToGroup(page, group.url, postText);

        if (result === "posted") {
          posted[group.url] = new Date().toISOString();
          savePosted(posted);
          postsThisCycle++;
          log("INFO", `${postsThisCycle}/${MAX_POSTS_PER_CYCLE} posts this cycle. Waiting ${Math.round(MIN_DELAY_MS / 60000)} to ${Math.round(MAX_DELAY_MS / 60000)}min...`);
          await sleep(rand(MIN_DELAY_MS, MAX_DELAY_MS));
        } else if (result === "not_member") {
          const joinResult = await joinGroup(page, group.url);
          if (joinResult === "joined") {
            await sleep(rand(3000, 5000));
            const postText2 = type === "DEVHIRE" ? pick(DEVHIRE_POSTS) : pick(MAPZAP_POSTS);
            const postResult2 = await postToGroup(page, group.url, postText2);
            if (postResult2 === "posted") {
              posted[group.url] = new Date().toISOString();
              savePosted(posted);
              postsThisCycle++;
              log("INFO", postsThisCycle + "/" + MAX_POSTS_PER_CYCLE + " posts this cycle.");
              await sleep(rand(MIN_DELAY_MS, MAX_DELAY_MS));
            }
          }
        } else if (result === "error" || result === "no_composer") {
          banned.push(group.url);
          saveBanned(banned);
        }

        await sleep(rand(3000, 6000));
      }

      await sleep(rand(5000, 10000));
    }

  } catch (err) {
    log("ERROR", `Cycle failed: ${err.message}`);
  }

  await browser.close();
  log("INFO", `Cycle complete. Posted to ${postsThisCycle} groups.`);
}

(async () => {
  console.log("=".repeat(60));
  console.log("FacebookPoster -- Group Poster");
  console.log("=".repeat(60));

  while (true) {
    await runCycle();
    const delay = rand(4 * 60 * 60 * 1000, 6 * 60 * 60 * 1000);
    log("INFO", `Next cycle in ${Math.round(delay / 3600000)} hours.`);
    await sleep(delay);
  }
})();
