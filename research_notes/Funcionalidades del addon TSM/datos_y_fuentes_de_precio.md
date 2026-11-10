# TradeSkillMaster (TSM): data model, price sources, custom price strings, Desktop App and website realm pages (focus: WoW: Forever)

Research date: 2026-11-09. Pages were checked live where noted ("observed"). Forever launched on November 4, 2026, and TSM support for it is new (addon 4.15 beta), so a lot of TSM documentation is still written for Retail/Classic and does not mention Forever.

## 1. What is AuctionDB, how does it collect data, and how often does it update (Forever/Classic)?

### Takeaway
AuctionDB is the TSM module that holds Auction House price data. Today that data is computed on TSM's servers from Blizzard API Auction House snapshots, not from in-game scans. The TSM Desktop App downloads it into the addon. Realm data updates every few hours and region data daily. For WoW: Forever, the public CSV timestamps on 2026-11-09 fit that pattern: realm updated at 21:16 UTC, region at 08:25 UTC.

### Cited Findings
- DBMinBuyout is "the lowest auction on your realm's AH as of the last update from Blizzard's API". It is not real-time and can be 30+ minutes old. This shows AuctionDB realm data comes from Blizzard API snapshots. — [TSM Help: Which Price Sources can I use](https://support.tradeskillmaster.com/custom-strings/which-price-sources-can-i-use-and-what-do-they-mean)
- DBRecent "is only applied to the latest price snap shot processed by TSM". Data is processed in discrete snapshots. — [TSM Help: Which Price Sources](https://support.tradeskillmaster.com/custom-strings/which-price-sources-can-i-use-and-what-do-they-mean); [TSM Help: AuctionDB Market Value](https://support.tradeskillmaster.com/tsm-addon-documentation/auctiondb-market-value)
- Once set up, the Desktop App keeps TSM_AuctionDB prices up to date with no user input, pulling from TSM servers that constantly process new Blizzard data. For Classic Era, SoD, Hardcore and Fresh, it supplies data for whichever Classic realms you play on with no manual configuration. In-game, a tooltip timestamp next to "TSM AuctionDB" within about the last hour means setup is working. — [TSM Help: How do I set up the TSM Desktop Application](https://support.tradeskillmaster.com/tsm-desktop-application/how-do-i-set-up-the-tsm-desktop-application)
- Public data cadence: realm and commodity files change "every few hours"; region files update daily. `updatedAt` is the upstream scan time, not the file generation time. — [TSM Public Pricing Data](https://tradeskillmaster.com/public-data)
- Observed 2026-11-09:
  - `public-data.tradeskillmaster.com/forever/us/realm/pvp-horde/items.csv` had `updatedAt = 2026-11-09T21:16:24Z` on every row.
  - `forever/us/region/items.csv` had `updatedAt = 2026-11-09T08:25:55Z`.
  - [realm CSV](https://public-data.tradeskillmaster.com/forever/us/realm/pvp-horde/items.csv); [region CSV](https://public-data.tradeskillmaster.com/forever/us/region/items.csv)
- TSM 4.15 (beta announced November 1, 2026) adds WoW: Forever support. TSM is meant to be usable from Forever's launch day, November 4, and the full release is planned to coincide with that launch. — [TSM News: TSM 4.15 brings WoW: Forever Support, plus New Desktop app](https://tradeskillmaster.com/news/tsm-4-15-brings-wow-forever-support-plus-new-desktop-app-1180)
  - Note: the news index shows this article as "November 11th, 2026", while the realm page says "Posted 8 days ago" (≈ Nov 1). The index appears to have a date-rendering bug where every article's day equals its month number (e.g. "September 9, 2024", "June 6, 2024", "August 8, 2023"). — [TSM News index](https://tradeskillmaster.com/news)
- New Desktop App (with 4.15):
  - Rebuilt from scratch for Windows, Mac and Linux, because the old app "couldn't keep up with new game versions, different realm types, and varying levels of Auction House price data support".
  - Features: guided setup, Discord login, fast processing of incoming price data, automatic backups of addon data, a migration wizard from the old app, and self-updates.
  - [TSM 4.15 article](https://tradeskillmaster.com/news/tsm-4-15-brings-wow-forever-support-plus-new-desktop-app-1180)
- The Desktop App's realm count depends on plan: Free supports 10 realms, Gold up to 25, Platinum unlimited. — [TSM Premium page](https://tradeskillmaster.com/premium)
- Unofficial: an open-source Linux client marks realm data fresh under 2 h, stale at 2–6 h and old over 6 h, and describes region data as roughly daily. Not official TSM guidance. — [newreleases.io: exceptionptr/tsm-app-linux v1.1.0](https://newreleases.io/project/github/exceptionptr/tsm-app-linux/release/v1.1.0)
- Blizzard-side gaps can stall data. One undated third-party post said Blizzard stopped providing AH snapshots for EU SoD realms for a while. — [Patreon post](https://www.patreon.com/posts/98109347)

### Inferences
- A web app built on the CSV can only be as fresh as TSM's snapshots. Realm values change every few hours and region values about once a day, so polling more often than hourly gains nothing. The public-data page itself says Google Sheets `IMPORTDATA` refreshes about hourly.
- Per-realm-scan data for Forever is TSM server-side; the addon no longer needs in-game scans to fill AuctionDB. In-game scans still feed the user's own Auctioning and Shopping decisions.

### Gaps
- No official statement on the exact snapshot interval for Forever realms (for example "every 60 min"). Only "every few hours" (public data) and "within ~1 hour" (tooltip check, Classic/Retail) were found.
- The 4.15 article gives no technical detail of the new app's sync protocol.
- TSM's statements on whether Blizzard's API covers every Forever realm type were not found.

## 2. Exact definitions of price and value sources, and which exist for Forever (realm vs region)

### Takeaway
Realm AuctionDB sources are DBMinBuyout, DBMarket, DBRecent and DBHistorical, plus the new DBNumAuctions. Region sources are DBRegionMarketAvg, DBRegionHistorical, DBRegionSaleAvg, DBRegionSaleRate and DBRegionSoldPerDay. Personal and addon sources (Crafting, matPrice, Destroy, vendor, Accounting, Operations) need the in-game addon. For Forever US, the public CSVs and the website item page show all four realm sources and all five region sources.

### Cited Findings

**AuctionDB: Realm** — [TSM Help: Which Price Sources](https://support.tradeskillmaster.com/custom-strings/which-price-sources-can-i-use-and-what-do-they-mean)
- **DBMinBuyout:** lowest auction on the realm AH as of the last Blizzard API update. Not real-time, and it does not move to the next-cheapest auction when you buy one. Invalid if there are no auctions.
- **DBMarket:** weighted 14-day average of realm listings, favoring the most recent 3 days. It reflects listing prices, not sale prices.
- **DBRecent:** like DBMarket but not averaged over time. It applies only the first three steps of the Market Value algorithm to the latest snapshot. Introduced in November 2022 (TSM 4.12) as a reagent-cost alternative to min buyout; see the [search snippet referencing the TSM blog archive, Nov 2022](https://blog.tradeskillmaster.com/2022/11).
- **DBHistorical:** 60-day average of DBMarket.

**DBMarket / DBRecent algorithm** — [TSM Help: AuctionDB Market Value](https://support.tradeskillmaster.com/tsm-addon-documentation/auctiondb-market-value)
1. **Outlier cut by price jumps and volume.** Sort auctions by unit price. Always keep the lowest 15%. After that, if the price rises 20% or more from one auction to the next, drop that auction and every higher-priced one. Never consider more than the lowest 30% of auctions.
2. **Standard-deviation filter.** Compute the mean and standard deviation of the remaining set; the worked example uses the sample std dev, n−1. Drop values more than 1.5 × std dev from the mean.
3. **Current scan value.** Average the survivors. This is the "recent" value: DBRecent uses steps 1–3.
4. **Daily value and moving average.** Within a day, scans are stored individually. The next day, they are combined into one daily value with a simple average. DBMarket is a weighted average of today's value and the previous 14 daily values, weighted toward recent days with a half-life of "a little over 2 days". The exact per-day weights are only shown in a graph.
- Worked example from the article: 24 auctions. A simple average gives 25.79. The algorithm keeps the lowest 7 (30%), giving {5,13,13,15,15,15,16}. Mean 13.143, sd 3.761, so 5 is removed. Result: {13,13,15,15,15,16}, value 14.5.

**AuctionDB: Region** — [TSM Help: Which Price Sources](https://support.tradeskillmaster.com/custom-strings/which-price-sources-can-i-use-and-what-do-they-mean)
- **DBRegionMarketAvg:** average of DBMarket across all realms in the region.
- **DBRegionHistorical:** 60-day average of DBRegionMarketAvg.
- **DBRegionSaleAvg:** average sale and purchase price in the region, built from users' TSM Accounting data uploaded through the Desktop App (crowd-sourced, not from Blizzard).
- **DBRegionMinBuyoutAvg:** retired.

**Value sources** (return numbers, not money) — [TSM Help: Which Value Sources](https://support.tradeskillmaster.com/custom-strings/which-value-sources-can-i-use-and-what-do-they-mean)
- **DBRegionSaleRate:** decimal, the average sell-through rate across all AHs in the region. 0.4 means about 40% of postings sell.
- **DBRegionSoldPerDay:** decimal, the average quantity sold per AH per day in the region. Both are "via TSM App".
- **NumExpires:** times the item expired or was cancelled since your last sale.
- **SaleRate:** your personal sell-through rate.
- **NumInventory:** how many you own.
- **ItemLevel, ItemQuality, RequiredLevel:** item attributes. ItemQuality is numeric; 4 = epic in TSM's own example, and 1 = common is used in `ifgte(ItemQuality, 1, …)`. See [TSM News: Logic Functions & Value Sources](https://tradeskillmaster.com/news/tsm4-deep-dive-logic-functions-value-sources-163).

**New in 4.15** — [TSM 4.15 article](https://tradeskillmaster.com/news/tsm-4-15-brings-wow-forever-support-plus-new-desktop-app-1180)
- **DBNumAuctions:** number of auctions (not items) as of the last snapshot.
- **Alternative-market sources:** DBAltMarket, DBAltRecent, DBAltHistorical, DBAltMinBuyout and DBAltNumAuctions. They read a user-chosen "alternative market realm" defined in addon settings and added via the Desktop App.

**Addon and personal sources** — [TSM Help: Which Price Sources](https://support.tradeskillmaster.com/custom-strings/which-price-sources-can-i-use-and-what-do-they-mean)
- **Crafting:** sum of matPrice of each reagent in the recipe. Only available if you know the recipe.
- **matPrice:** material cost, set by the Crafting "Default Price Settings" or overridden per material.
  - A Wowhead article reports that `first(dbminbuyout, dbmarket) * 0.95`-style strings are used in crafting settings. — [Wowhead Economy Weekly Wrap-Up 186](https://www.wowhead.com/news/wowhead-economy-weekly-wrap-up-186-legendary-stock-tracker-brutosaur-container-323446)
- **Destroy:** average value of what you get from milling, prospecting or disenchanting. Uses DBMarket by default; configurable.
- **VendorBuy:** vendor purchase price. Only known after visiting a vendor that sells the item.
- **VendorSell:** vendor sell price.
- **Accounting:**
  - AvgBuy and AvgSell: averages of your purchases and sales.
  - MaxBuy, MinBuy, MaxSell, MinSell: extremes of the same.
  - **SmartAvgBuy:** average of your last X purchases, where X is the quantity you currently hold. Invalid if you hold none. Added in 4.10, replacing the old "Smart Averages" option.
- **Operations (4.10+):** AuctioningOpMin, AuctioningOpNormal and AuctioningOpMax (from the group's first Auctioning operation), ShoppingOpMax, SniperOpMax.
- The in-game command `/tsm sources` lists all available sources. — [TSM Help: What are Custom Strings](https://support.tradeskillmaster.com/addon/what-are-custom-strings)

**Observed Forever availability**
- The public CSV for Forever US realm `pvp-horde` has columns `itemId,name,marketValue,minBuyout,recent,historical,updatedAt`, which map to DBMarket, DBMinBuyout, DBRecent and DBHistorical. — [realm CSV](https://public-data.tradeskillmaster.com/forever/us/realm/pvp-horde/items.csv)
- The Forever US region CSV has columns `itemId,name,marketValue,historical,avgSalePrice,saleRate,soldPerDay,updatedAt`, which map to DBRegionMarketAvg, DBRegionHistorical, DBRegionSaleAvg, DBRegionSaleRate and DBRegionSoldPerDay. — [region CSV](https://public-data.tradeskillmaster.com/forever/us/region/items.csv)
- The Forever item page (US PvP, item 4436 Jewel-encrusted Sash, observed) shows "Auction Stats" with these labels:
  - Available Quantity (3), Min Buyout (15s), Market Value (19s, ↓ -7.61%), Historical Price (20s)
  - Region Market Value Avg (18s, ↓ -12%), Region Historical Price (32s), Region Sale Avg (18s)
  - Region Sale Rate (0.454), Region Avg Daily Sold (1.362)
  - These match the CSV row `4436,Jewel-encrusted Sash,1947,1500,1500,2075` in copper (19s47c market, 15s min buyout).
  - [TSM item page](https://tradeskillmaster.com/forever/us/pvp-horde/items/4436)

### Inferences
- The project's CSV (realm file) already covers the four realm sources. Importing the Forever US region CSV as well would add DBRegionMarketAvg, DBRegionHistorical, DBRegionSaleAvg, DBRegionSaleRate and DBRegionSoldPerDay. Those are the inputs most TSM strings use for "will it sell" checks.
- DBNumAuctions, the Alt* sources and personal sources (Accounting, Crafting, matPrice, Destroy, vendor) are not in the public CSVs.
  - A web app would need its own data for them: recipes and reagent lists, vendor prices from a game DB such as Wowhead or a Classic DB, and user-entered transactions.
  - Exception: the item page shows "Available Quantity", which may be the website's equivalent of auction or item counts, but it is not exported in the CSV.
- To reproduce DBMarket-style smoothing from raw snapshots, apply the 4-step algorithm above. Since the CSV already contains `marketValue`, `recent` and `historical`, re-deriving them is unnecessary. A web app could instead keep its own history of hourly CSV pulls to chart trends.
- Sale-based sources come from crowd-sourced Accounting uploads. Early in Forever's life (launched Nov 4, 2026) they will be sparse or noisy. Many Forever region rows observed show `saleRate` 0 and `soldPerDay` 0.

### Gaps
- No official list was found stating per game version (Retail, Classic, Progression, Forever) which sources are valid. Forever availability above is inferred from the observed CSVs and item page.
- The exact 14-day weight vector for DBMarket is only in an image.
- No precise definition of DBRegionSaleAvg's time window (for example 60 days) was found.
- The item page header showed "Market 28s, Trend ↓ -11.97%" while "Auction Stats → Market Value" showed 19s. The header figure may be a different metric or a chart point; this could not be resolved.

## 3. Custom price string syntax (operators, functions, literals, references) with examples

### Takeaway
A TSM custom string is an arithmetic expression over price sources, value sources, gold literals and functions. Sources can take an item argument. "Invalid" values propagate unless a function skips them. The parser was rewritten in 4.13 (August 2023).

### Cited Findings

**Building blocks** — [TSM Help: What are Custom Strings](https://support.tradeskillmaster.com/addon/what-are-custom-strings)
- **Price sources** return money: DBMarket, Crafting, AvgBuy, VendorBuy, ShoppingOpMax.
- **Value sources** return numbers: DBRegionSaleRate, SaleRate, ItemLevel, RequiredLevel, NumExpires.
- **Functions** "cannot be used in isolation".
- **Fixed gold literals** use g/s/c suffixes: `100g`, `50s20c`, `1000g2c`.
- **Custom Sources** are user-named, reusable strings, usable like variables.
- A third-party web editor exists at directive.io/tsm-editor.

**Functions** — [TSM Help: Which Functions can I use](https://support.tradeskillmaster.com/custom-strings/which-functions-can-i-use-and-what-do-they-mean)
- **Arithmetic:** `+ - * / ^` and nested parentheses, e.g. `dbmarket + 5g`, `((dbmarket + 10g) + (dbhistorical + 10g)) * 2`. Dividing by `0.95` accounts for the 5% AH cut.
- **Percent:** `%` is shorthand for `/100 *`, e.g. `50% dbmarket`. A bare source means 100%.
- **min(a, b, …)**, **max(…)**, **first(…)**, **avg(…)**: lowest, highest, first valid, and mean of the valid arguments. Invalid arguments are ignored unless all are invalid.
  - `min(50% dbmarket, 100g)`
  - `max(vendorsell, dbminbuyout, avgsell, 20g)`
  - `first(dbmarket, dbregionmarketavg)`
  - `first(avgsell, crafting, 100g)`
  - `avg(crafting, avgbuy)`
- **check(a, b, c):** if a > 0 returns b, otherwise c. An invalid a makes the result invalid. Example: `check(dbmarket - 1000g, 95% dbmarket, 50% dbmarket)`.
- **ifgt / ifgte / iflt / iflte / ifeq (a, b, c[, d]):** compare a to b; return c if true, d otherwise. If d is omitted and the condition is false, the result is invalid.
  - `ifgt(dbmarket, 100g, 50% dbmarket, 20g)`
  - `ifgte(numinventory, 2000, 50% avgsell)`
  - `iflte(salerate, 0.5, 500, 5000)`
  - `ifeq(numinventory, 10, 50g)`
- **round(a[, b]) / roundup / rounddown:** round to the nearest multiple of b; without b, to the nearest copper. Example: `round(crafting, 10s)`.
- **convert(source[, item]):** lowest cost via conversions (milling, prospecting, transforms, vendor ink trades). The argument must be a plain source. Examples: `convert(dbmarket)`, `dbmarket + convert(dbminbuyout, item:79251)`.
- **Item arguments:** any source can take an item link or item string, e.g. `dbminbuyout([Ghost Iron Ore])`, `matprice([Ink of Dreams])`, `item:79251`. By default the item being evaluated is used.

**Examples from TSM's logic-functions article** — [TSM News: TSM4 Deep Dive: Logic Functions & Value Sources](https://tradeskillmaster.com/news/tsm4-deep-dive-logic-functions-value-sources-163)
- `iflt(DBRegionSoldPerDay, 100, DBMarket, DBRegionMarketAvg)`
- `round(DBRegionMarketAvg, ifeq(ItemQuality, 4, 1000g, 1g))`
- `ifgte(ItemQuality, 1, <sniper string>)` restricts a string to common quality or better.

**Parser rewrite**
- The 4.13 parser rewrite was announced as "New Custom String Parsing" (August 2023). The article's URL was not retrievable (404 on a guessed slug), so only its title is confirmed. — [TSM News index](https://tradeskillmaster.com/news)

### Inferences
- A web reimplementation needs:
  - a case-insensitive tokenizer for identifiers, numbers, gold literals (`\d+g`, `\d+s`, `\d+c` combined) and `%`;
  - a recursive-descent parser with precedence: `^` > `*` `/` > `+` `-`, with `%` acting as a multiplier on the following term;
  - functions;
  - a NaN/null-style "invalid" value that propagates through arithmetic, while min, max, first and avg skip it.
- Source names map directly to CSV columns:
  - DBMarket → realm `marketValue`
  - DBMinBuyout → `minBuyout`
  - DBRecent → `recent`
  - DBHistorical → `historical`
  - DBRegionMarketAvg → region `marketValue`
  - DBRegionHistorical → region `historical`
  - DBRegionSaleAvg → `avgSalePrice`
  - DBRegionSaleRate → `saleRate`
  - DBRegionSoldPerDay → `soldPerDay`
- An item argument like `dbmarket(item:2589)` maps to a lookup of another row by itemId. `[Item Name]` would need name resolution against the CSV `name` column; some rows have empty names, for example item 253664 in the realm CSV.

### Gaps
- No formal grammar or operator-precedence table was found in TSM docs. Operator precedence for `%` and `^` is not documented explicitly.
- Whether newer functions (for example string-level `min`/`max` over custom sources, or any functions added in 4.13–4.15) exist beyond the list above was not confirmed.

## 4. What the TSM website realm page shows (e.g. /forever/eu/pvp-horde), and free vs Premium

### Takeaway
A Forever realm dashboard shows a Premium promo banner, a publicly visible, drill-down **Auction House Heatmap**, and News. Ledger and Groups are separate sections. Item pages show free price stats, a price chart, region market value history, and hour-by-weekday price and quantity heatmaps. Personal data (Ledger, Inventory, Posted, Accounting, Goldmaking Activity) is locked behind Premium, mostly Platinum.

### Cited Findings

**Realm dashboard** (observed 2026-11-09, page title "Dashboard | PvP | EU | TradeSkillMaster") — [TSM Forever EU PvP](https://tradeskillmaster.com/forever/eu/pvp-horde)
- Header navigation: Home, News, Ledger, Groups. A game selector offers Retail (/retail/us), Classic (/classic/us), Mists of Pandaria (/classic-progression/us) and Forever (/forever/us).
- Breadcrumb: Home / Europe / PvP.
- A Premium banner reads "Improve your goldmaking with accessible data and powerful tools" with a "Get Started" button.
- A News block shows the 4.15 / Forever article.
- A notice says new Terms of Service and Privacy Policy take effect December 1, 2026.

**Auction House Heatmap** (observed, viewable without signing in) — [TSM Forever EU PvP](https://tradeskillmaster.com/forever/eu/pvp-horde)
- It is a treemap. Top level: Consumables, Armor, Reagents, Quest Items, Weapons, Miscellaneous, Recipes, Containers, Gems, Battle Pets, Item Enhancements, Glyphs, Profession Equipment, WoW Token.
- Each subcategory and item tile shows a % change (e.g. Potions -15.7%, Bandages 8.8%, Spotted Yellowtail -60.9%, Frog Leg Stew 669.0%). Tiles are colored green or red by change.
- Clicking drills down (All → Consumables → Food & Drink → items). Hover shows "N Available", e.g. "Potions 21,656.3 Available", "Spotted Yellowtail 2,807.55 Available".
- TSM's September 2024 announcement describes the heatmap as market-value trends (red declining, green increasing) with square size proportional to auction volume, for realm or region. That post associated the data with Premium, but it was publicly visible on the Forever realm page today. — [TSM blog: Announcing the new TSM Website and Premium Plans](https://blog.tradeskillmaster.com/?p=1072)

**Item page** (observed; URL pattern `/forever/us/pvp-horde/items/{itemId}`) — [TSM item 4436](https://tradeskillmaster.com/forever/us/pvp-horde/items/4436)
- Header: item name and class/subclass (Armor / Cloth), Market (28s), Trend (↓ -11.97%), Quantity (3). Inventory and Posted are Platinum-only.
- Tabs: Overview, Alerts, Price & Quantity.
- A price chart covers roughly the last 5 days.
- "Region Market Value" chart with 1W / 1M / 3M / 6M ranges.
- **Price Heatmap** and **Quantity Heatmap**: weekday × hour-of-day (12am–11pm) grids.
- "Goldmaking Activity" and a "7-Day Ledger Summary" (sales/purchases/profit) are Platinum.
- "Item Statistics" is a tooltip-style block: item level, stats, required level, vendor sell price, drop source and drop chance.
- "Auction Stats" fields are listed in section 2.
- The "TSM Accounting" fields are all Platinum: Total Purchased, Purchase Price, Last Purchased, Total Sold, Sold Price, Last Sold.

**Premium plans** — [TSM Premium](https://tradeskillmaster.com/premium)
- **Free ($0):** fully featured in-game addon, Desktop App for 10 realms, Discord support, "basic market research tools on the website".
- **Gold ($3/mo billed annually):** basic Ledger analysis of recent sales and purchases, BMAH auctions on the website, cloud-synced addon-settings backups, email alerts for items and BMAH, Desktop App up to 25 realms, Great Deals synced to the addon, Premium Discord role, priority beta access.
- **Platinum ($7.50/mo billed annually):** extensive Ledger analysis, goldmaking performance tracking on the dashboard and item pages, sale price and quantity graphs over time on item pages, unlimited Desktop App realms, Discord alerts, exclusive Discord channels and roadmap.
- Yearly billing saves 25%.
- The Premium page names no Forever-specific plan features. Premium users also got immediate 4.15 beta access. — [TSM 4.15 article](https://tradeskillmaster.com/news/tsm-4-15-brings-wow-forever-support-plus-new-desktop-app-1180)
- When the 2024 plans launched, existing subscribers got 6 months of Platinum, then moved to Gold. — [TSM Help: subscription after new plans](https://support.tradeskillmaster.com/en_US/tsm-website/what-happens-to-my-subscription-after-the-new-tsm-premium-plans-are-announced)
- **Groups:** a public directory of shared TSM group imports was re-introduced in November 2024. — [TSM News index](https://tradeskillmaster.com/news)

### Inferences
- Website features a web app can reproduce from public CSVs alone:
  - category treemap or heatmap of % change, by storing successive CSV snapshots and computing change in marketValue;
  - per-item stats card;
  - region-vs-realm comparisons;
  - sale rate and sold-per-day indicators.
- Hour × weekday price and quantity heatmaps need the app's own stored snapshot history, because the CSV is only the latest snapshot.
- Item category and subclass, and quantity available, are not in the CSV. A category taxonomy must come from an item database.

### Gaps
- The time window behind the heatmap's % change, and the exact meaning of "N Available" (fractional values suggest an average quantity or a gold value), are not documented in anything found.
- Ledger and Groups pages for Forever were not opened (they require sign-in or were out of scope). No Premium content was accessed.

## 5. Public pricing data CSV files: realm vs region, columns, cadence, terms

### Takeaway
TSM publishes free, static CSVs per game type, region and realm at `public-data.tradeskillmaster.com`, with no API key, sign-in or rate limit. Prices are in copper. Realm files carry realm AuctionDB values and update every few hours. Region files carry region averages and sale statistics and update daily.

### Cited Findings
- From the public-data page — [TSM Public Pricing Data](https://tradeskillmaster.com/public-data)
  - The files are "static and public with no API key, sign-in, or rate limits".
  - URL patterns:
    - `{gameType}/{regionSlug}/realm/{realmSlug}/items.csv` (and `pets.csv`)
    - `{gameType}/{regionSlug}/region/items.csv` (and `pets.csv`)
    - `{gameType}/{regionSlug}/commodities.csv`
  - Slugs match the website URLs. Example: `retail/us/realm/area-52/items.csv`.
  - Game types: Retail, Classic, Mists of Pandaria, Forever. Pet files exist only for Retail and MoP; commodity files only for Retail.
  - All prices are in copper (1g = 10,000c).
  - `updatedAt` is the same for every row in a file and reflects the upstream scan time.
  - Cadence: realm and commodity files every few hours; region files daily.
  - The page gives Google Sheets examples (`IMPORTDATA`, `VLOOKUP` on column 3 = market value) and links to the site Terms of Service.
- Observed Forever files:
  - **Realm** `forever/us/realm/pvp-horde/items.csv`. Header: `itemId,name,marketValue,minBuyout,recent,historical,updatedAt`. Sample row: `4436,Jewel-encrusted Sash,1947,1500,1500,2075,2026-11-09T21:16:24Z`. The file is about 310 KB. — [realm CSV](https://public-data.tradeskillmaster.com/forever/us/realm/pvp-horde/items.csv)
  - **Region** `forever/us/region/items.csv`. Header: `itemId,name,marketValue,historical,avgSalePrice,saleRate,soldPerDay,updatedAt`. Sample row: `1378,Frayed Pants,160,100,100,0.186,0.372,2026-11-09T08:25:55Z`. The file is about 359 KB. — [region CSV](https://public-data.tradeskillmaster.com/forever/us/region/items.csv)
  - Some rows have an empty `name`, e.g. `253664,,535,500,500,534,…`. — [realm CSV](https://public-data.tradeskillmaster.com/forever/us/realm/pvp-horde/items.csv)

### Inferences
- The project already uses the realm file. Adding `public-data.tradeskillmaster.com/forever/us/region/items.csv`, joined on `itemId`, would enable region comparisons and "sells / doesn't sell" filters (saleRate, soldPerDay) at no cost.
- The EU equivalent should follow the same pattern: `forever/eu/realm/pvp-horde/items.csv` and `forever/eu/region/items.csv`. This was not fetched directly, but the EU website slug `pvp-horde` was confirmed.

### Gaps
- The Terms of Service text (attribution, caching and redistribution rules for the CSVs) was not read; the public-data page only links to /terms. New terms take effect December 1, 2026, per the site banner.
- The exact row counts of the Forever CSVs were not determined (fetch output was truncated).
- The column-definition tables on the public-data page did not render in the text extraction. Column meanings above are inferred from the names and checked against the item page.
