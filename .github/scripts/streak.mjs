// Draws the contribution streak card for the profile README.
// It reads the contribution calendar from GitHub's API (no outside service), works
// out the total, the current streak and the longest streak, and writes one SVG
// in the same dark card style as the rest of the README.
//
// Usage: GITHUB_TOKEN=... node .github/scripts/streak.mjs <username> <output.svg>
import fs from "node:fs";
import path from "node:path";

const [user, out] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!user || !out || !token) {
  console.error("Usage: GITHUB_TOKEN=... node streak.mjs <username> <output.svg>");
  process.exit(1);
}

async function graphql(query, variables) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (!response.ok || body.errors) throw new Error(JSON.stringify(body.errors ?? body));
  return body.data;
}

// Every day since the account was created, one year at a time (the API's limit).
const { user: account } = await graphql("query($login:String!){user(login:$login){createdAt}}", { login: user });
const days = new Map();
const today = new Date();
for (let start = new Date(account.createdAt); start < today; ) {
  const end = new Date(Math.min(today.getTime(), new Date(start).setUTCFullYear(start.getUTCFullYear() + 1) - 1000));
  const data = await graphql(
    `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`,
    { login: user, from: start.toISOString(), to: end.toISOString() },
  );
  for (const week of data.user.contributionsCollection.contributionCalendar.weeks)
    for (const day of week.contributionDays) days.set(day.date, day.contributionCount);
  start = new Date(end.getTime() + 1000);
}

const dates = [...days.keys()].sort();
const total = dates.reduce((sum, d) => sum + days.get(d), 0);

// Longest run of days with at least one contribution.
let longest = { length: 0, from: null, to: null };
let run = { length: 0, from: null };
for (const date of dates) {
  if (days.get(date) > 0) {
    run = run.length ? { length: run.length + 1, from: run.from } : { length: 1, from: date };
    if (run.length > longest.length) longest = { length: run.length, from: run.from, to: date };
  } else run = { length: 0, from: null };
}

// The current streak still counts if today has no contribution yet.
let i = dates.length - 1;
if (i >= 0 && days.get(dates[i]) === 0) i--;
let current = { length: 0, from: null, to: null };
for (let j = i; j >= 0 && days.get(dates[j]) > 0; j--)
  current = { length: current.length + 1, from: dates[j], to: dates[i] };

const fmt = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "–");
const range = (r) => (r.length ? `${fmt(r.from)} – ${r.length > 1 ? fmt(r.to) : "today"}` : "No streak yet");

// ---- The card ---------------------------------------------------------------
const W = 900;
const H = 200;
const FONT = "'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif";
const col = (x, value, label, sub, color, ring = false) => `
  <g transform="translate(${x} 0)">
    ${ring ? `<circle cx="0" cy="88" r="46" fill="none" stroke="${color}" stroke-opacity="0.25" stroke-width="7"/><circle cx="0" cy="88" r="46" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${Math.min(current.length / Math.max(longest.length, 1), 1) * 289} 289" transform="rotate(-90 0 88)"/>` : ""}
    <text x="0" y="${ring ? 100 : 98}" text-anchor="middle" font-size="${ring ? 34 : 40}" font-weight="800" fill="#f3f6f8">${value}</text>
    <text x="0" y="${ring ? 162 : 136}" text-anchor="middle" font-size="15" font-weight="700" letter-spacing="1.6" fill="${color}">${label}</text>
    <text x="0" y="${ring ? 184 : 160}" text-anchor="middle" font-size="13" fill="#8a97a3">${sub}</text>
  </g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#121a22"/><stop offset="1" stop-color="#0a0f14"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0" r="0.7"><stop offset="0" stop-color="#22c55e" stop-opacity="0.16"/><stop offset="1" stop-color="#22c55e" stop-opacity="0"/></radialGradient>
    <linearGradient id="edge" x1="0" x2="1"><stop offset="0" stop-color="#70c8c4"/><stop offset="1" stop-color="#ff3b30"/></linearGradient>
    <clipPath id="card"><rect width="${W}" height="${H}" rx="18"/></clipPath>
  </defs>
  <g clip-path="url(#card)">
    <rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#glow)"/>
    <rect width="${W}" height="3" fill="url(#edge)"/>
  </g>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="17.5" fill="none" stroke="#ffffff1c"/>
  <rect x="300" y="40" width="1" height="120" fill="#ffffff1a"/>
  <rect x="600" y="40" width="1" height="120" fill="#ffffff1a"/>
  ${col(150, total.toLocaleString("en-US"), "TOTAL CONTRIBUTIONS", `${fmt(dates[0])} – today`, "#70c8c4")}
  ${col(450, current.length, "CURRENT STREAK", range(current), "#22c55e", true)}
  ${col(750, longest.length, "LONGEST STREAK", range(longest), "#ff7a6e")}
</svg>`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, svg);
console.log(`total ${total}, current ${current.length} (${range(current)}), longest ${longest.length} (${range(longest)})`);
