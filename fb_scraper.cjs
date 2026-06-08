require("dotenv").config();
const { createObjectCsvWriter } = require("csv-writer");
const puppeteer = require("puppeteer");
const fs = require("fs");

const SESSION_PATH = "./session.json";
const LEADS_PATH = "./fb_leads.csv";
const SENT_PATH = "./fb_sent.json";

const MAX_POST_AGE_DAYS = 3;

const DEVHIRE_QUERIES = [
  "I need a website for my business",
  "I need someone to build my website",
  "I need a website built",
  "I'm looking for a developer",
  "I am looking for a developer",
  "I need to hire a developer",
  "I'm hiring a developer",
  "I need an app built for my business",
  "I need a developer for my project",
  "I need a freelancer to build",
  "I will pay for a website",
  "I have a budget for a website",
  "I have a budget for a developer",
  "I need a web developer urgently",
  "I need a developer asap",
  "I need someone to build my app",
  "I need a chatbot for my business",
  "I need automation for my business",
  "I need a bot built",
  "I need a scraper built",
  "I need AI integration for my business",
  "I need a landing page built",
  "I need a shopify store built",
  "I need a wordpress site built",
  "I need a mobile app built",
  "I need coding help for my business",
  "I need a python developer",
  "I need a full stack developer",
  "I'm looking to hire a freelancer",
  "I need tech help for my business",
];

const MAPZAP_QUERIES = [
  "I need leads for my business",
  "I need more clients for my business",
  "I need local business leads",
  "I need a lead list",
  "how do I find leads for my business",
  "I'm struggling to find clients",
  "I need more customers for my business",
  "I need business leads",
  "how do I get more clients",
  "I need to find more customers",
  "I need prospects for my business",
  "I need to generate leads",
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
  "does your business need",
  "does your company need",
  "does your brand need",
  "is your website",
  "is your business",
  "are you looking for a developer",
  "are you in need of",
  "do you need a website",
  "do you need a developer",
  "do you need help with",
  "looking for businesses",
  "i help businesses",
  "i help companies",
  "i help small business",
  "we help businesses",
  "we help companies",
  "we help small",
  "we help your",
  "we help you",
  "transform your business",
  "grow your business",
  "boost your",
  "we boost",
  "we grow",
  "take your business",
  "elevate your",
  "scale your business with",
  "get your business",
  "get a website for",
  "get you noticed",
  "get more clients",
  "get more customers",
  "visitors into customers",
  "leads into clients",
  "affordable websites",
  "professional websites",
  "custom websites starting",
  "websites starting at",
  "starting from",
  "get in touch",
  "contact us today",
  "dm us",
  "message us",
  "link in bio",
  "check our portfolio",
  "visit our website",
  "free consultation",
  "free quote",
  "limited slots",
  "limited spots",
  "taking on new clients",
  "accepting new clients",
  "now accepting",
  "open for work",
  "open to work",
  "currently available",
  "slots available",
  "spots available",
  "we build websites",
  "we create",
  "we design",
  "we deliver",
  "we offer websites",
  "we provide websites",
  "your success",
  "your business grow",
  "your brand",
  "business consultant",
  "business coach",
  "business support",
  "marketing consultant",
  "growth consultant",
  "social media manager",
  "seo specialist",
  "seo agency",
  "digital marketing",
  "online marketing",
  "we are here to help",
  "here to help your",
  "book a call",
  "book a free",
  "book now",
  "schedule a call",
  "schedule a consultation",
  "strategy call",
  "discovery call",
  "follow us",
  "follow our page",
  "check out our page",
  "visit our page",
  "testimonials",
  "case studies",
  "success stories",
  "proven results",
  "results driven",
  "results guaranteed",
  "satisfaction guaranteed",
  "money back",
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
          let postTimestamp = null;

          const abbrEl = container.querySelector('abbr[data-utime]');
          if (abbrEl) {
            postTimestamp = parseInt(abbrEl.getAttribute('data-utime')) * 1000;
          }

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

          if (!postTimestamp) {
            const dayMatch = container.innerText.match(/(\d+)\s*days?\s*ago/i);
            if (dayMatch) {
              postTimestamp = now - parseInt(dayMatch[1]) * 24 * 60 * 60 * 1000;
            }
          }

          if (!postTimestamp && container.innerText.toLowerCase().includes('yesterday')) {
            postTimestamp = now - 24 * 60 * 60 * 1000;
          }

          if (postTimestamp) {
            const ageMs = now - postTimestamp;
            if (ageMs > maxAgeMs) return;
          }

          // Block all seller and agency signals
          const isDev = devAgencySignals.some(s => text.includes(s));
          if (isDev) return;

          // Must contain first person buyer language
          const firstPersonBuyerSignals = [
            "i need", "i'm looking", "i am looking", "i want",
            "i have a budget", "i will pay", "i need to hire",
            "i'm hiring", "i am hiring", "i need help with",
            "i need someone to", "i'm searching", "i am searching",
            "i need a developer", "i need a website", "i need an app",
            "how do i", "how can i", "i need more clients",
            "i need leads", "i need customers", "i need prospects",
            "i need to find", "i need to generate",
          ];
          const isFirstPerson = firstPersonBuyerSignals.some(s => text.includes(s));
          if (!isFirstPerson) return;

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

          // Boost score for fresh posts
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
