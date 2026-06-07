require("dotenv").config();
const { createObjectCsvWriter } = require("csv-writer");
const puppeteer = require("puppeteer");
const fs = require("fs");

const SESSION_PATH = "./session.json";
const LEADS_PATH = "./fb_leads.csv";
const SENT_PATH = "./fb_sent.json";

// TIGHT buyer-only queries — only phrases a BUYER would use, not a developer
const SEARCH_QUERIES = [
  "need a website for my business",
  "need someone to build my website",
  "looking for someone to build my website",
  "need a website built for my",
  "how much does a website cost",
  "need a landing page built",
  "need an ecommerce website",
  "need a shopify store built",
  "need a wordpress site built",
  "need a mobile app built",
  "need an app built for my business",
  "looking to hire a developer",
  "need to hire a developer",
  "need someone to build an app",
  "need a chatbot for my business",
  "need automation for my business",
  "need a scraper built",
  "need a bot built for",
  "need api integration",
  "need someone to code",
  "will pay for website",
  "will pay for developer",
  "paying for website development",
  "budget for website",
  "budget for developer",
  "need a web developer urgently",
  "need a developer asap",
  "need a freelancer to build",
  "looking for a freelancer to build",
  "need tech help for my business",
  "need someone to automate",
  "need workflow automation",
  "need a python script built",
];

// Strong seller signals — skip anyone who looks like a developer selling
const SELLER_SIGNALS = [
  "i offer", "i build", "i provide", "my services", "check out my",
  "i am a developer", "i am a web developer", "i specialize in",
  "hire me", "my portfolio", "i can build", "i develop", "i create",
  "i code", "i design websites", "years of experience", "dm me for work",
  "contact me for", "i am available for", "i am offering", "my rates are",
  "i am an expert", "message me for work", "whatsapp me", "i do freelance",
  "offering my services", "available for hire", "for hire",
  "i have experience in", "i work as a", "i am a programmer",
  "i am a coder", "i am a freelancer", "my work includes",
  "i just launched", "i just built", "i recently built",
  "check my profile", "check my github", "upwork", "fiverr",
  "toptal", "freelancer.com", "looking for clients", "seeking clients",
  "looking for projects", "open to projects", "taking on projects",
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

async function searchPosts(page, query) {
  console.log(`\nSearching: "${query}"`);
  const leads = {};

  try {
    const url = `https://www.facebook.com/search/posts/?q=${encodeURIComponent(query)}&filters=eyJyZWNlbnRseVNlZW4iOiJ7XCJuYW1lXCI6XCJjcmVhdGlvbl90aW1lXCIsXCJhcmdzXCI6XCIwXCJ9In0%3D`;
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(rand(4000, 6000));

    let emptyScrolls = 0;

    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollBy(0, 1200));
      await sleep(rand(2000, 3000));

      const found = await page.evaluate((query, sellerSignals) => {
        const results = {};
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

          // Skip sellers hard
          const isSeller = sellerSignals.some(s => text.includes(s));
          if (isSeller) return;

          // Must look like a buyer — post should contain question or need language
          const buyerSignals = [
            "need", "looking for", "hire", "want", "help me", "how much",
            "budget", "will pay", "paying", "urgent", "asap", "anyone",
            "recommend", "suggest", "can someone", "who can", "where can i find"
          ];
          const isBuyer = buyerSignals.some(s => text.includes(s));
          if (!isBuyer) return;

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

          // Get post permalink
          const allLinks = Array.from(container.querySelectorAll('a[href*="facebook.com"]'));

          const postLink = allLinks.find(a =>
            a.href.includes('/posts/') ||
            a.href.includes('/permalink/') ||
            a.href.includes('story_fbid')
          );

          // Get profile link
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

          // Need at least a post URL to be useful
          if (!postUrl && !profileUrl) return;

          if (!results[authorName] || score > results[authorName].score) {
            results[authorName] = {
              author: authorName,
              postUrl: postUrl || '',
              profileUrl: profileUrl || '',
              keyword: query,
              score
            };
          }
        });

        return results;
      }, query, SELLER_SIGNALS);

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
    console.log(`Found ${sorted.length} leads for "${query}"`);
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

  for (const query of SEARCH_QUERIES) {
    const leads = await searchPosts(page, query);

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
      dmed: 'false'
    })));
  }

  console.log(`\nScrape complete. ${totalLeads} new leads saved to fb_leads.csv`);
  await browser.close();
})();
