require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const SESSION_PATH = "./session.json";
const POSTED_PATH = "./fb_posted_groups.json";
const BANNED_PATH = "./fb_banned_groups.json";

const MAX_POSTS_PER_CYCLE = 30;
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

const FLOWMATE_QUERIES = [
  "contractors business owners",
  "plumbers electricians contractors",
  "home services business owners",
  "HVAC company owners",
  "roofing contractors group",
  "local service business owners",
  "small business owners Los Angeles",
  "losing leads slow response",
  "GoHighLevel agency owners",
];

const AUTOSUB_QUERIES = [
  "how to automate outreach",
  "Reddit marketing for business",
  "lead generation automation",
  "cold outreach tools",
  "outreach for agency owners",
  "entrepreneur outreach strategy",
];

const DEVHIRE_POSTS = [
  `Hey everyone, putting this out there. I am a developer based in LA with some availability this week.

I build websites, scrapers, automation tools, and AI integrations. All production ready, fast turnaround.

If you or anyone you know needs something built, feel free to DM me. Flat fee, 48 hour delivery on most projects.`,

  `Hi all, I am a Python developer available for freelance work right now.

Stuff I have shipped: business websites, Google Maps scrapers, email outreach pipelines, automation bots. All running in production.

Looking for a project this week. DM me a scope and I will tell you if I can build it. Flat fee only, no hourly.`,

  `Hey, hope this is okay to share here. I am a freelance developer in LA looking for work this week.

I specialize in Python, Node.js, web apps, and automation. Fast turnaround, flat pricing, no surprises.

If you need a website or any kind of automation built, send me a DM.`,
];

const MAPZAP_POSTS = [
  `Hey everyone, I built something that might be useful for anyone doing cold outreach or prospecting.

It pulls 100 local business leads from Google Maps in about 60 seconds. You type a business type and city, get a CSV with names, phone numbers, addresses, websites, and emails where available instantly.

$19.99 per month, unlimited searches. Free preview at mapzap.org if you want to try it before paying.

Happy to answer any questions.`,

  `Sharing something I built that has been saving me hours on lead research.

MapZap pulls local business leads from Google Maps. Name, phone, address, website, and email as a downloadable CSV. Takes about a minute per search.

$19.99 per month gets you unlimited searches.

Free trial at mapzap.org`,

  `Built a tool for anyone who does cold calling or outreach prospecting.

Type any business niche and city, get 100 leads as a CSV in 60 seconds, emails included where available. Google Maps data, always fresh.

$19.99/month unlimited searches. Try 5 leads free first with no credit card.

mapzap.org`,
];

const FLOWMATE_POSTS = [
  `Hey everyone, sharing something I built for local service business owners who lose leads to slow follow up.

It is called FlowMate. Roughly 78% of customers go with whoever responds first, so if a lead sits for even a few minutes you're probably losing it. FlowMate automatically texts and emails every new lead within 60 seconds, runs 24/7 in the background.

I build it and run it for you, nothing for you to learn or manage. Works for plumbers, HVAC, roofers, electricians, and any local service business getting leads from ads or Google.

$297 for the first month to test it, $797/month after that if it's working for you.

flowmate.live`,

  `If you run a local service business and aren't responding to leads within a minute or two, you're losing most of them to competitors.

I built FlowMate to fix that. Automated text and email follow up on every new lead within 60 seconds, done for you, runs 24/7.

Think of it like a GoHighLevel setup except I build and run it for you instead of you learning new software.

$297 first month, $797/month ongoing.

flowmate.live`,

  `Sharing something for contractors, plumbers, HVAC, roofers, anyone running a local service business.

FlowMate automatically follows up with every new lead by text and email within 60 seconds of them coming in. No more losing business because you were on a job and couldn't respond fast enough.

I set it up and run it for you. $297 for the first month, $797/month after.

flowmate.live`,
];

const AUTOSUB_POSTS = [
  `Hey everyone, sharing something I built for anyone who does outreach on Reddit.

It is called AutoSub. You connect your Reddit account, set your offer and target keywords, and it finds people posting about needing what you sell and DMs them automatically 24/7.

200+ targeted messages per day. Live dashboard showing all activity. Cancel anytime.

$19.99 per month at autosub.online`,

  `Built a tool that automates Reddit DM outreach. If you sell anything and want to reach buyers on Reddit without doing it manually, this might help.

AutoSub connects to your Reddit account, scrapes globally for posts matching your buyer keywords, and sends your DM automatically. Set it up once and it runs forever.

$19.99/month. autosub.online`,

  `Sharing something useful for agency owners, freelancers, and founders doing outreach.

AutoSub automates your Reddit outreach. You write your offer and set your target keywords. It finds people actively looking for what you sell and DMs them automatically 24/7.

$19.99/month, no setup fee, cancel anytime.

autosub.online`,
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

async function searchAndJoinGroups(page, query) {
  log("SEARCH", `Searching groups for: "${query}"`);
  const url = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(rand(3000, 5000));

  try {
    const toggled = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('span'));
      const publicLabel = labels.find(s => s.innerText?.trim() === 'Public groups');
      if (!publicLabel) return false;
      let el = publicLabel;
      for (let i = 0; i < 5; i++) {
        if (!el.parentElement) break;
        el = el.parentElement;
        const toggle = el.querySelector('[role="switch"]') || el.querySelector('input[type="checkbox"]');
        if (toggle) {
          const isOn = toggle.getAttribute('aria-checked') === 'true' || toggle.checked;
          if (!isOn) toggle.click();
          return true;
        }
      }
      return false;
    });
    if (toggled) await sleep(rand(2000, 3000));
  } catch(e) {}

  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await sleep(rand(1200, 2000));
  }

  const joined = await page.evaluate(() => {
    const results = [];
    const seen = new Set();
    const links = Array.from(document.querySelectorAll('a[href*="/groups/"]'));

    for (const link of links) {
      const href = link.href.split('?')[0];
      if (
        !href.match(/facebook\.com\/groups\/[a-zA-Z0-9._]+\/?$/) ||
        href.includes('/groups/feed') ||
        href.includes('/groups/discover') ||
        href.includes('/groups/joins') ||
        seen.has(href)
      ) continue;
      seen.add(href);

      let card = link;
      let foundCard = null;
      for (let i = 0; i < 10; i++) {
        if (!card.parentElement) break;
        card = card.parentElement;
        if (card.innerText?.includes('Public') && card.innerText?.includes('members')) {
          foundCard = card;
          break;
        }
      }

      if (!foundCard) continue;
      const cardText = foundCard.innerText || '';

      if (cardText.includes('Joined') || cardText.includes('Member')) {
        results.push({ url: href, name: href });
        continue;
      }

      const allBtns = Array.from(foundCard.querySelectorAll('[role="button"]'));
      const joinBtn = allBtns.find(b => {
        const t = b.innerText?.trim().toLowerCase();
        return t === 'join' || t === 'join group';
      });

      if (joinBtn) {
        joinBtn.click();
        results.push({ url: href, name: href });
      }
    }

    return results;
  });

  log("SEARCH", `Found ${joined.length} groups for "${query}"`);
  await sleep(rand(3000, 5000));
  return joined;
}

async function joinGroup(page, groupUrl) {
  try {
    await page.goto(groupUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(rand(2000, 3000));

    const isPrivate = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('private group') || text.includes('private · group');
    });

    if (isPrivate) return "private";

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

function pickPostForType(type) {
  if (type === "DEVHIRE") return pick(DEVHIRE_POSTS);
  if (type === "FLOWMATE") return pick(FLOWMATE_POSTS);
  if (type === "AUTOSUB") return pick(AUTOSUB_POSTS);
  return pick(MAPZAP_POSTS);
}

async function postToGroup(page, groupUrl, postText) {
  try {
    await page.goto(groupUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(rand(3000, 5000));

    const memberStatus = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="button"]'));
      const joinedBtn = btns.find(b => b.innerText?.toLowerCase().includes('joined'));
      const joinBtn = btns.find(b => b.innerText?.toLowerCase().trim() === 'join group');
      if (joinedBtn) return "member";
      if (joinBtn) return "not_member";
      return "unknown";
    });

    if (memberStatus === "not_member") {
      log("SKIP", `Not a member of ${groupUrl}`);
      return "not_member";
    }

    const composerHandle = await page.evaluateHandle(() => {
      const allSpans = Array.from(document.querySelectorAll('span'));
      const span = allSpans.find(s =>
        s.textContent?.trim() === 'Write something...' &&
        s.getAttribute('style')?.includes('webkit-line-clamp')
      );
      if (span) return span;
      return null;
    });

    const composer = composerHandle.asElement();
    if (!composer) {
      log("SKIP", "No composer found at " + groupUrl);
      return "no_composer";
    }

    await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), composer);
    await sleep(1500);
    await composer.click();
    await sleep(rand(2000, 3000));

    const modalClicked = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog) {
        const editable = dialog.querySelector('[contenteditable="true"]');
        if (editable) { editable.click(); editable.focus(); return "dialog-editable"; }
        const spans = Array.from(dialog.querySelectorAll('span'));
        const ph = spans.find(s => s.textContent?.includes('Create a public post') || s.textContent?.includes('Write something'));
        if (ph) { ph.click(); return "dialog-span"; }
      }
      const editable = document.querySelector('[contenteditable="true"]');
      if (editable) { editable.click(); editable.focus(); return "editable"; }
      return false;
    });

    await sleep(rand(1000, 1500));
    await page.keyboard.type(postText, { delay: rand(20, 50) });
    await sleep(rand(2000, 3000));

    const posted = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const searchIn = dialog || document;
      const btns = Array.from(searchIn.querySelectorAll('[role="button"]'));
      const postBtn = btns.find(b => b.innerText?.trim() === 'Post' && b.offsetParent !== null);
      if (postBtn) { postBtn.click(); return true; }
      return false;
    });

    if (!posted) {
      log("ERROR", `Could not click Post button at ${groupUrl}`);
      return "no_post_btn";
    }

    await sleep(rand(5000, 8000));
    const confirmed = await page.evaluate(() => {
      const posts = Array.from(document.querySelectorAll('[data-ad-comet-preview="message"]'));
      return posts.length > 0;
    });

    if (!confirmed) {
      log("PENDING", `Post may be pending approval at ${groupUrl}`);
      return "pending";
    }

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
      ...FLOWMATE_QUERIES.map(q => ({ query: q, type: "FLOWMATE" })),
      ...AUTOSUB_QUERIES.map(q => ({ query: q, type: "AUTOSUB" })),
    ];

    for (const { query, type } of allQueries) {
      if (postsThisCycle >= MAX_POSTS_PER_CYCLE) {
        log("INFO", `Hit max posts (${MAX_POSTS_PER_CYCLE}). Stopping.`);
        break;
      }

      const groups = await searchAndJoinGroups(page, query);

      for (const group of groups) {
        if (postsThisCycle >= MAX_POSTS_PER_CYCLE) break;
        if (!group.url) continue;
        if (banned.includes(group.url)) continue;
        if (wasPostedRecently(posted, group.url)) {
          log("SKIP", `Already posted to ${group.url} recently`);
          continue;
        }

        const postText = pickPostForType(type);
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
            await sleep(rand(5000, 8000));
            const postText2 = pickPostForType(type);
            const postResult2 = await postToGroup(page, group.url, postText2);
            if (postResult2 === "posted") {
              posted[group.url] = new Date().toISOString();
              savePosted(posted);
              postsThisCycle++;
              log("INFO", `${postsThisCycle}/${MAX_POSTS_PER_CYCLE} posts this cycle.`);
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
