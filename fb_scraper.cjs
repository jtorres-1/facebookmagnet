require("dotenv").config();
const { createObjectCsvWriter } = require("csv-writer");
const puppeteer = require("puppeteer");
const fs = require("fs");

const SESSION_PATH = "./session.json";
const LEADS_PATH = "./fb_leads.csv";
const SENT_PATH = "./fb_sent.json";

const MAX_POST_AGE_DAYS = 3;

const DEVHIRE_QUERIES = [
  "need a website for my business",
  "need someone to build my website",
  "looking for someone to build my website",
  "need a website built for my",
  "how much does a website cost",
  "need a landing page built",
  "need an ecommerce website built",
  "need a shopify store built",
  "need a wordpress site built",
  "need a mobile app built for my",
  "need an app built for my business",
  "looking to hire a developer for my",
  "need to hire a developer for",
  "need someone to build an app",
  "need a chatbot for my business",
  "need automation for my business",
  "need a bot built for my",
  "need api integration for my",
  "need someone to automate my",
  "need workflow automation for",
  "will pay for website",
  "will pay for developer",
  "paying for website development",
  "budget for website",
  "budget for developer",
  "need a developer asap",
  "need a web developer urgently",
  "need a freelancer to build my",
  "need tech help for my business",
  "need a python script for my",
  "need a custom website",
];

const MAPZAP_QUERIES = [
  "need leads for my business",
  "looking for business leads",
  "how to find more customers",
  "need more clients for my business",
  "where to find leads",
  "need a lead list",
  "need local business leads",
  "how to get more customers for my",
  "need more sales leads",
  "cold outreach help",
  "need to find prospects",
  "looking for potential clients",
  "how do I find new clients",
  "need customer leads",
  "struggling to find clients",
];

const DEV_AGENCY_SIGNALS = [
  "i offer", "i build", "i provide", "my services", "check out my",
  "i am a developer", "i am a web developer", "i specialize in",
  "hire me", "my portfolio", "i can build", "i develop", "i create",
  "i code", "i design websites", "years of experience",
  "available for hire", "for hire", "i do freelance",
  "offering my services", "i am a programmer", "i am a coder",
  "i am a freelancer", "looking for clients", "seeking clients",
  "looking for projects", "open to projects", "taking on projects",
  "upwork", "fiverr", "toptal", "freelancer.com",
  "web design agency", "web development agency", "software agency",
  "digital agency", "our team", "our developers", "we build",
  "we develop", "we offer", "we specialize", "we provide",
  "our services", "our portfolio", "our clients", "we have built",
  "agency owner", "software company", "tech company", "it company",
  "web studio", "design studio", "development studio",
  "we are a", "our company", "founded in", "est.", "established",
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const csvWriter = createObjectCsvWriter({
  path: LEADS_PATH,
  header: [
    { id: "time", title: "Time" },
    { id: "author", title: "Author" },
    { id: "postUrl", title: "PostURL" },
    { id: "profileUrl", title: "ProfileURL" },
    { id: "keyword", title: "Keyword" },
    { id: "score", title: "Score" },
    { id: "product", title: "Product" },
    { id: "dmed", title: "DMed" },
  ],
  append: fs.existsSync(LEADS_PATH)
});

function loadSent() {
  if (!fs.existsSync(SENT_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(SENT_PATH)); } catch { return {}; }
}

async function loadSession(page) {
  if (!fs.existsSync(SESSION_PATH)) throw new Error("No session. Run manual_login.cjs first.");
  const cookies = JSON.parse(fs.readFileSync(SESSION_PATH));
  await page.setCookie(...cookies);
  await page.goto("https://www.facebook.com", { waitUntil: "networkidle2" });
  if (page.url().includes("login")) throw new Error("Session expired. Run manual_login.cjs again.");
  console.log("Session loaded.");
}

async function searchPosts(page, query, product) {
  console.log(`\nSearching: "${query}" [${product}]`);
  const leads = {};

  try {
    const url = `https://www.facebook.com/search/posts/?q=${encodeURIComponent(query)}&filters=eyJyZWNlbnRseVNlZW4iOiJ7XCJuYW1lXCI6XCJjcmVhdGlvbl90aW1lXCIsXCJhcmdzXCI6XCIwXCJ9In0%3D`;
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(rand(4000, 6000));

    let emptyScrolls = 0;

    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollBy(0, 1200));
      await sleep(rand(2000, 3000));

      const found = await page.evaluate((query, product, devAgencySignals, maxAgeDays) => {
        const results = {};
        const now = Date.now();
        const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

        const actionBtns = Array.from(document.querySelectorAll('[aria-label^="Actions for this post by"]'));

        actionBtns.forEach(btn => {
          const authorName = btn.getAttribute('aria-label').replace('Actions for this post by ', '').trim();
          if (!authorName || authorName.length < 2) return;

          let container = btn;
          for (let i = 0; i < 15; i++) {
            container = container.parentElement;
            if (!container) break;
            if (container.innerText?.length > 200) break;
          }
          if (!container) return;

          const text = (container.innerText || '').toLowerCase();

          // Extract post timestamp and check age
          const timeEl = container.querySelector('a[href*="/posts/"] abbr, abbr[data-utime], a[role="link"] span[id]');
          let postTimestamp = null;

          // Try to get timestamp from abbr data-utime
          const abbrEl = container.querySelector('abbr[data-utime]');
          if (abbrEl) {
            postTimestamp = parseInt(abbrEl.getAttribute('data-utime')) * 1000;
          }

          // Try to parse from relative time text
          if (!postTimestamp) {
            const timeTexts = container.innerText.match(/(\d+)\s*(minute|hour|min|hr|second|sec)s?\s*ago/i);
            if (timeTexts) {
              const num = parseInt(timeTexts[1]);
              const unit = timeTexts[2].toLowerCase();
              let ms = 0;
              if (unit.startsWith('sec')) ms = num * 1000;
              else if (unit.startsWith('min')) ms = num * 60 * 1000;
              else if (unit.startsWith('hour') || unit.startsWith('hr')) ms = num * 60 * 60 * 1000;
              postTimestamp = now - ms;
            }
          }

          // Try to parse "X days ago"
          if (!postTimestamp) {
            const dayMatch = container.innerText.match(/(\d+)\s*days?\s*ago/i);
            if (dayMatch) {
              postTimestamp = now - parseInt(dayMatch[1]) * 24 * 60 * 60 * 1000;
            }
          }

          // Try to parse "Yesterday"
          if (!postTimestamp && container.innerText.toLowerCase().includes('yesterday')) {
            postTimestamp = now - 24 * 60 * 60 * 1000;
          }

          // If we found a timestamp, check age
          if (postTimestamp) {
            const ageMs = now - postTimestamp;
            if (ageMs > maxAgeMs) return; // Too old — skip
          }

          // For DEVHIRE — block developers and agencies
          if (product === 'DEVHIRE') {
            const isDev = devAgencySignals.some(s => text.includes(s));
            if (isDev) return;

            const buyerSignals = [
              "need", "looking for", "hire", "want someone to",
              "how much", "budget", "will pay", "paying", "urgent",
              "asap", "anyone know", "recommend", "can someone",
              "who can", "where can i find", "help me build",
              "need help with my website", "need help building"
            ];
            const isBuyer = buyerSignals.some(s => text.includes(s));
            if (!isBuyer) return;
          }

          // Score
          let score = 3;
          if (text.includes("budget")) score += 5;
          if (text.includes("will pay")) score += 5;
          if (text.includes("paying")) score += 4;
          if (text.includes("urgent") || text.includes("asap")) score += 4;
          if (text.includes("how much")) score += 3;
          if (text.includes("quote") || text.includes("price")) score += 3;
          if (text.includes("this week") || text.includes("today")) score += 3;
          if (text.includes("immediately")) score += 3;
          if (text.includes("hire")) score += 2;
          if (text.includes("project")) score += 2;
          if (text.includes("paid") || text.includes("payment")) score += 2;
          if (text.includes("business")) score += 2;
          if (product === 'MAPZAP') {
            if (text.includes("leads")) score += 3;
            if (text.includes("clients")) score += 3;
            if (text.includes("customers")) score += 2;
          }

          // Boost score for very fresh posts
          if (postTimestamp) {
            const ageHours = (now - postTimestamp) / (60 * 60 * 1000);
            if (ageHours < 6) score += 5;
            else if (ageHours < 24) score += 3;
            else if (ageHours < 48) score += 1;
          }

          const allLinks = Array.from(container.querySelectorAll('a[href*="facebook.com"]'));
          const postLink = allLinks.find(a =>
            a.href.includes('/posts/') ||
            a.href.includes('/permalink/') ||
            a.href.includes('story_fbid')
          );

          const profileLink = allLinks.find(a => {
            const href = a.href.split('?')[0];
            return (href.match(/facebook\.com\/[a-zA-Z0-9._]{3,}$/) ||
                    href.match(/facebook\.com\/profile\.php\?id=/)) &&
                   !href.includes('/groups/') &&
                   !href.includes('/events/') &&
                   !href.includes('/photo') &&
                   !href.includes('/posts/');
          });

          const postUrl = postLink ? postLink.href.split('&__cft__')[0] : null;
          const profileUrl = profileLink ? profileLink.href.split('&__cft__')[0].split('&__tn__')[0] : null;

          if (!postUrl && !profileUrl) return;

          if (!results[authorName] || score > results[authorName].score) {
            results[authorName] = {
              author: authorName,
              postUrl: postUrl || '',
              profileUrl: profileUrl || '',
              keyword: query,
              score,
              product,
              postTimestamp: postTimestamp || null
            };
          }
        });

        return results;
      }, query, product, DEV_AGENCY_SIGNALS, MAX_POST_AGE_DAYS);

      const count = Object.keys(found).length;
      Object.assign(leads, found);

      if (count === 0) {
        emptyScrolls++;
        if (emptyScrolls >= 3) {
          console.log(`No results after ${i+1} scrolls. Moving on.`);
          break;
        }
      } else {
        emptyScrolls = 0;
      }
    }

    const sorted = Object.values(leads).sort((a, b) => b.score - a.score);
    console.log(`Found ${sorted.length} leads for "${query}" [${product}]`);
    return sorted;
  } catch (err) {
    console.log(`Error searching "${query}": ${err.message}`);
    return [];
  }
}

(async () => {
  const sent = loadSent();
  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

  await loadSession(page);

  let totalLeads = 0;
  const allLeads = {};

  for (const query of DEVHIRE_QUERIES) {
    const leads = await searchPosts(page, query, 'DEVHIRE');
    for (const lead of leads) {
      const key = lead.author.toLowerCase();
      if (sent[key]) continue;
      if (allLeads[key]) continue;
      allLeads[key] = lead;
      totalLeads++;
    }
    await sleep(rand(3000, 5000));
  }

  for (const query of MAPZAP_QUERIES) {
    const leads = await searchPosts(page, query, 'MAPZAP');
    for (const lead of leads) {
      const key = lead.author.toLowerCase();
      if (sent[key]) continue;
      if (allLeads[key]) continue;
      allLeads[key] = lead;
      totalLeads++;
    }
    await sleep(rand(3000, 5000));
  }

  // Sort by score descending — freshest highest scored leads first
  const sorted = Object.values(allLeads).sort((a, b) => b.score - a.score);

  if (sorted.length > 0) {
    await csvWriter.writeRecords(sorted.map(l => ({
      time: new Date().toISOString(),
      author: l.author,
      postUrl: l.postUrl || '',
      profileUrl: l.profileUrl || '',
      keyword: l.keyword,
      score: l.score,
      product: l.product,
      dmed: 'false'
    })));
  }

  console.log(`\nScrape complete. ${totalLeads} new leads saved to fb_leads.csv`);
  await browser.close();
})();
