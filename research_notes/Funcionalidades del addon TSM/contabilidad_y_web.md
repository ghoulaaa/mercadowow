# TSM Accounting/Ledger, Dashboard, Inventory, Desktop App and tradeskillmaster.com web features (as of Nov 2026)

Research date: 2026-11-09. Public sources only; no sign-in, no Premium content accessed. Realm pages are JavaScript-rendered; what the fetcher could read is noted.

## 1. Accounting / Ledger module: what it records, how profit and sale rate are computed, export, Ledger UI

### Takeaway
The in-game Ledger (TSM Accounting) builds its records mainly from mailbox collection (auction sales, auction purchases, expired and cancelled auctions), plus trades, COD mail and vendor transactions. It presents them as Inventory, Revenue (Sales / Other / Resale), Expenses (Purchases / Other) and Failed Auctions (Expired / Cancelled). Profit is shown per item by matching buy and sell records ("Resale"). "Sale rate" is a personal ratio of sales to postings. The docs describe no official in-game CSV export; third-party tools parse the SavedVariables file instead.

### Cited Findings
- **Data source:** "Data in the Ledger is based on collecting mail from your mailbox, such as sales, purchases, cancelled and expired auctions." The Ledger opens from the TSM Dashboard, the minimap icon, or `/tsm`. — [TSM Addon: Ledger](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-ledger)
- **Inventory section:** lists every item TSM knows you own, filterable by keyword or group. "Total Value" uses the **Value Price Source**, which you can change with a custom string, but only for the current session. Quantity columns, all sortable:
  1. Total across all characters on the same realm and faction
  2. Bags (current character)
  3. Bank (current character)
  4. Mail (current character)
  5. Other characters (their mail, bags, bank and Auction House)
  6. Guild banks accessible on the realm and faction
  7. Auctions posted by the current character
  8. Total value, blank if the price source is invalid for the item
  — [TSM Addon: Ledger](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-ledger)
- **Revenue > Sales:** shown by Type, Rarity and Time for the characters selected in a dropdown, with keyword and group filters. Sale types are **Auctions, Cash on Delivery mail, Trades, Vendors**. — [TSM Addon: Ledger](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-ledger)
- **Revenue > Other:** income from **Missions** (Draenor Garrison, Legion Order Hall, BfA Faction Campaign, Shadowlands Covenants) and **Money Transfers**, filterable by character and time range. Missions are Retail expansion content, so they don't apply to Forever or Classic. — [TSM Addon: Ledger](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-ledger)
- **Revenue > Resale (profit view):** items that have both purchase and sale records. Columns:
  - Quantity purchased
  - Average purchase price
  - Quantity sold
  - Average sale price
  - Average profit per item
  - Total profit
  - Average profit %

  Total profit and profit % are hidden by default and enabled via the table's context menu under "Hide Columns." — [TSM Addon: Ledger](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-ledger)
- **Item drill-down (Sale Data tab):** clicking an item shows quantity sold, average prices and total prices for **Total, last 7 days and last 30 days**. It also shows the top buyers (players who bought from you most often) and the full list of sale records. Right-click a record to remove it. — [TSM Addon: Ledger](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-ledger)
- **Expenses > Purchases:** same Type, Rarity and Time layout, with the same four types. **Expenses > Other:** Postage, Repair Bills, Money Transfers. The Purchase Data drill-down shows Total, 7-day and 30-day figures, top sellers to you, and the record list. — [TSM Addon: Ledger](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-ledger)
- **Failed Auctions:** two sections, **Expired** and **Cancelled** (both collected from mail), shown by Rarity and Time with keyword and group filters. Entries in these sections cannot be removed. — [TSM Addon: Ledger](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-ledger)
- **Accounting price sources usable in custom strings:**
  - **SaleRate:** "your personal Sale Rate of an item"; 0.4 means it sold 40% of the times you posted it.
  - **NumExpires:** the number of times an item has expired or been cancelled since its last sale.
  - **NumInventory:** total quantity you possess.
  - **DBRegionSaleRate:** region-wide average sale rate per Auction House.
  - **DBRegionSoldPerDay:** average volume sold per Auction House per day in the region.

  — [Which Value Sources can I use](https://support.tradeskillmaster.com/custom-strings/which-value-sources-can-i-use-and-what-do-they-mean)
- SaleRate was introduced in TSM 4.10 and is calculated from your own Accounting data. — [TSM 4.10: New Sources](https://blog.tradeskillmaster.com/tsm-4-10-new-sources/) (via search snippet)
- **TSM 4.15 (Nov 2026) Ledger change:** "Duplicate vendor transactions are no longer recorded in the ledger." The Dashboard gains an **Activity Feed** of recent sales, purchases, expirations and cancellations. — [TSM 4.15 news post](https://tradeskillmaster.com/news/tsm-4-15-brings-wow-forever-support-plus-new-desktop-app-1180)
- **Date-attribution caveat (user report, 2021):** the Ledger records events by date. Sales from reposted expired auctions therefore land in the later period, which skewed one blogger's fortnightly reports. — [Grahran's WoW Gold, "Flawed TSM Ledger Data"](https://grahranswowgold.com/tag/tsm/page/2)
- **CSV export:** no official export appears in the Ledger docs. Third-party tools convert the Accounting SavedVariables to CSV:
  - The Ruby gem `tsm-accounting` reads `TradeSkillMaster_Accounting.lua` and has a `to_csv` method. — [rubydoc tsm-accounting](https://www.rubydoc.info/gems/tsm-accounting/0.8.0)
  - The SourceForge "TSM Data Extractor" converts Accounting data to CSV for Excel. — [SourceForge tsmdataextract](https://sourceforge.net/p/tsmdataextract/)

### Inferences
- Event model for a web equivalent: each record holds item, quantity, unit price, counterparty, character, timestamp and type (auction/COD/trade/vendor). There are four record kinds (sale, buy, expire, cancel) plus non-item money flows (postage, repairs, transfers, mission income).
- Profit is computed per item by joining buys and sells: average sell minus average buy, times quantity. Sale rate is sales divided by (sales + expires + cancels) for the item.
- Inferred from the 7/30-day columns: the standard reporting windows are Total, 7d and 30d.
- An app with only aggregated price data (no addon data) cannot reproduce any of this personal data. It could offer manual or CSV entry of the user's own transactions, then compute the same Resale and profit tables valued against market prices.
- From memory, not verified this session: TSM4 stores accounting as CSV-formatted strings in SavedVariables (e.g. csvSales, csvBuys, csvExpired, csvCancelled), with columns like itemString, stackSize, quantity, price, otherPlayer, player, time, source. Confirm against an actual `TradeSkillMaster.lua` before relying on it.

### Gaps
- No official definition of the exact SaleRate formula (whether cancels count as failures; the time window). NumExpires does count cancels, which suggests SaleRate does too, but this is unconfirmed.
- The docs neither confirm nor rule out an in-game CSV export in TSM 4.x.
- The full list of in-game Ledger time-range options isn't documented (only the 7d and 30d windows).
- Data retention or purge settings were not found.

## 2. Dashboard: gold-over-time graph and summaries

### Takeaway
The in-game Dashboard is a "player gold" line chart for selected characters, with predefined ranges and drag-to-zoom. It is coloured green or red by net change, and range-dependent stat blocks sit below it (high/low gold, average sales and purchases, biggest sale and purchase, and Sales/Expenses/Profit totals, per-day averages and top item). TSM 4.15 adds an Activity Feed.

### Cited Findings
- **Top bar:**
  - News & Information: latest blog posts.
  - App Sync / Price Data status icon: green, yellow or red. Hovering shows the connected realm, the last sync time and the price-data age. "App can sync more often than pricing data updates."
  - Gold Count: the current character's gold. Hovering shows the total across characters on the same realm and faction.

  — [TSM Addon: Dashboard](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-dashboard)
- **Player Gold Chart:** total gold on hand for the characters chosen in a dropdown. You can pick a predefined timeframe or drag across the chart to select a range, after which "Reset Zoom" appears. The chart is green if ending gold is higher than starting gold, red if lower. — [TSM Addon: Dashboard](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-dashboard)
- **Middle stats (follow the chart range):**
  - Highest and lowest gold
  - Average number of sales and purchases
  - Highest individual sale and highest individual purchase

  — [TSM Addon: Dashboard](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-dashboard)
- **Bottom summaries (follow the chart range):**
  - **Sales:** total earned, average per day, and "Top Item" (highest total revenue)
  - **Expenses:** total spent, average per day, and Top Item (highest total purchase price)
  - **Profit:** total profit, average per day, and Top Item (highest total profit)

  — [TSM Addon: Dashboard](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-dashboard)
- Gold is tracked across factions, including in the Dashboard gold graph (search snippet from the Dashboard/FAQ results). — [TSM Addon: Dashboard (helpjuice mirror)](https://tradeskillmaster.helpjuice.com/en_US/tsm-addon-documentation/tsm-addon-dashboard)
- **4.15:** a new "Activity Feed" lists recent sales, purchases, expirations and cancellations, and the gold graph is more responsive. — [TSM 4.15 news post](https://tradeskillmaster.com/news/tsm-4-15-brings-wow-forever-support-plus-new-desktop-app-1180)

### Inferences
- The web equivalent is a time-series chart with range presets (e.g. 7d/30d/90d/1y/all, which are assumed, not confirmed), brush-zoom and conditional green/red colouring. Below it go KPI cards: max/min, average counts, top single transaction, and Sales/Expenses/Profit with per-day averages and top item.
- Without addon data, "gold over time" needs user-entered snapshots. A market-side analogue is the value over time of a watchlist or "virtual inventory" priced with historical market data.

### Gaps
- The exact predefined timeframe labels in the gold chart aren't documented in the article.
- How often gold snapshots are recorded (on login/logout, on change) isn't documented.

## 3. Inventory tracking across characters, bank and guild bank; inventory valuation

### Takeaway
TSM tracks quantities per location: bags, bank, mail and posted auctions for the current character, plus other characters and accessible guild banks on the same realm and faction. It values inventory with a user-selectable "Value Price Source" (a custom price string).

### Cited Findings
- Location columns are those listed in section 1. Total Value = quantity × Value Price Source, and the value is blank if the source is invalid for an item. — [TSM Addon: Ledger](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-ledger)
- NumInventory ("Total Inventory Quantity") is an integer for how many of an item you possess, usable in custom strings. — [Value Sources](https://support.tradeskillmaster.com/custom-strings/which-value-sources-can-i-use-and-what-do-they-mean)
- 4.15 Vendoring: "Potential Sale Value" updates in real time. — [TSM 4.15 news post](https://tradeskillmaster.com/news/tsm-4-15-brings-wow-forever-support-plus-new-desktop-app-1180)

### Inferences
- A web app can replicate valuation exactly: let the user choose a price basis from aggregated data (e.g. market value, minimum buyout, historical, region average) or a formula, then compute value = quantity × price per item and in total. The quantities would have to come from user input, since there is no addon data.

### Gaps
- The default Value Price Source wasn't confirmed in fetched docs (commonly believed to be DBMarket; unverified).
- The data-collection rules for guild banks (e.g. whether the bank must be opened to scan) weren't found.

## 4. TSM Desktop App and the web Ledger

### Takeaway
The Desktop App downloads AuctionDB price data into the addon and backs up addon data. It was rebuilt from scratch with TSM 4.15 (Nov 2026) for Windows, Mac and Linux. It also feeds personal Ledger data to the website's Ledger, which is a paid feature (Gold: basic, Platinum: extensive).

### Cited Findings
- **The 4.15 rebuild:**
  - Rebuilt "from the ground up" for Windows, Mac and Linux, because the old app could not handle new game versions, realm types or "varying levels of Auction House price data support."
  - Guided setup and Discord login.
  - Processes incoming price data as soon as it's available.
  - Automatic backups of addon data whenever it changes, plus a backups migration wizard.
  - Auto-updates.

  — [TSM 4.15 news post](https://tradeskillmaster.com/news/tsm-4-15-brings-wow-forever-support-plus-new-desktop-app-1180)
- **4.15 and WoW: Forever:** "the major 4.15 update does support WoW: Forever," usable "from launch day on November 4th." It was in beta at posting, with full release planned alongside Forever, and Premium users could access the beta early. — [TSM 4.15 news post](https://tradeskillmaster.com/news/tsm-4-15-brings-wow-forever-support-plus-new-desktop-app-1180)
- **New 4.15 price sources:**
  - DBNumAuctions.
  - Alt-market sources (DBAltMarket, DBAltRecent, DBAltHistorical, DBAltMinBuyout, DBAltNumAuctions), available once you add an alternative market realm in the Desktop App and the addon settings.

  — [TSM 4.15 news post](https://tradeskillmaster.com/news/tsm-4-15-brings-wow-forever-support-plus-new-desktop-app-1180)
- **Price data delivery:** the app keeps TSM_AuctionDB prices up to date, downloaded directly from TSM's servers. — [Desktop Application Overview](https://www.tradeskillmaster.com/app) (search snippet)
- **Older Premium benefits article (updated Aug 2021):**
  - "automated remote backups of all your TSM profiles, groups, operations and accounting data," with up to 20 backups kept permanently
  - "automatic syncing of Ledger data to the web-based Ledger tool"
  - In-game Great Deal searching
  - BMAH searches and alerts
  - 10 realms free, up to 40 additional realms

  — [What do I get with TSM Premium? (2021)](https://support.tradeskillmaster.com/what-are-the-benefits-of-tsm-premium)
- **2020 blog (dated):** Premium subscribers' Ledger data syncs automatically. Non-Premium users can upload "as-and-when" they log out. — [TSM blog p=723](https://blog.tradeskillmaster.com/?p=723) (search snippet; may be outdated)
- **Web Ledger history:** first launched at ledger.tradeskillmaster.com as "a powerful web-based analytics tool for your TSM Addon transactions, purchases and sales for Retail and Classic WoW," with graphing over days, weeks or months. The 2024 site relaunch integrated it into tradeskillmaster.com and added personal sales, purchases and sale rates to the Item Statistics section of item pages. — search snippets of [TSM blog Sept 2024 archive](https://blog.tradeskillmaster.com/2024/09/) and [blog p=723](https://blog.tradeskillmaster.com/?p=723)
- **Auction House Quantity trend chart:** item pages show auction volume over time, "coupled with your recent gold making actions pulled from your Ledger automatically, with TSM Premium (Platinum)." — search snippet of [TSM blog Sept 2024 archive](https://blog.tradeskillmaster.com/2024/09/)
- **Third-party Linux port (not official):** data-age colour thresholds are green under 2h, yellow 2–6h and red over 6h for realm data, with wider thresholds for region data (about daily). — [tsm-app-linux v1.1.0](https://newreleases.io/project/github/exceptionptr/tsm-app-linux/release/v1.1.0)

### Inferences
- In the web Ledger, the item page overlays the user's own buy and sell events on market price and quantity charts. This is the key "analytics" pattern: a market time series with personal transaction markers.
- For WoW Forever US PvP Horde, a web app with aggregated prices can show the market series. Personal markers would need manual or CSV import.

### Gaps
- The 2026 site's exact web Ledger views (tabs, columns) couldn't be seen without signing in. The Ledger nav link on the Forever page points to `/retail/us/ledger`, which suggests the Forever ledger may not be separately routed or that the nav is generic.
- The current (post-4.15) sync cadence for Ledger uploads isn't documented. Whether free users can still upload Ledger data in the 2026 app is also unconfirmed.

## 5. tradeskillmaster.com realm pages, Groups sharing, and Premium (2026)

### Takeaway
To an anonymous visitor, the Forever realm pages (`/forever/eu/pvp-horde`, `/forever/us/pvp-horde`) show only a shell: navigation (Home, News, Ledger, Groups), realm and game-version selectors, a Premium upsell banner that lists "Auction House Heatmap," and a news card. No prices or stats were visible to the fetcher. Groups are a free public directory of shareable item groups. Premium has three plans: Free, Gold ($3/mo billed annually) and Platinum ($7.50/mo billed annually).

### Cited Findings
- **EU realm page (title "Dashboard | PvP | EU | TradeSkillMaster"):**
  - Nav: Home, News, Ledger, Groups.
  - Selectors: "Select Realms" (Europe/Korea/North America/Taiwan) and a game type selector (Retail, Classic, Mists of Pandaria, Forever).
  - A "View Options" dropdown and Sign In.
  - Premium banner: "Improve your goldmaking with accessible data and powerful tools," with "Get Started" and "Unlock all features" buttons linking to /premium, and the feature "Auction House Heatmap" listed.
  - News: "TSM 4.15 brings WoW: Forever Support, plus New Desktop app."
  - No auction prices, market data or realm statistics visible.

  — [tradeskillmaster.com/forever/eu/pvp-horde](https://tradeskillmaster.com/forever/eu/pvp-horde)
- **US realm page:**
  - Same layout, title "Dashboard | PvP | US | TradeSkillMaster."
  - Ledger link → `/retail/us/ledger`, Groups → `/retail/groups`, and no URL for the Heatmap.
  - Footer: Download TSM, Get Premium, Privacy Policy, Terms, Public Pricing Data, Help, plus Reddit r/woweconomy, X @tsmaddon and Discord.
  - No data widgets visible.

  — [tradeskillmaster.com/forever/us/pvp-horde](https://tradeskillmaster.com/forever/us/pvp-horde)
- **Heatmap:** I found no public documentation of the "Auction House Heatmap" in the help center, blog or search results. It appears only as a name in the upsell banner. — [realm page](https://tradeskillmaster.com/forever/us/pvp-horde); searches returned nothing official.
- **Premium page (prices shown billed annually):**
  - **Free ($0):** "Fully featured in-game addon," "Support for 10 realms via the desktop app," "General support via Discord," "Basic market research tools on the website."
  - **Gold ($3.00/mo):** "Basic analysis of recent sales and purchases in Ledger on website," "View BMAH auctions on website," "Addon setting backups synced to the cloud," "Email alerts for items and BMAH auctions," "Up to 25 realms in Desktop App," "Great Deals synced to addon," Premium Discord role, priority beta.
  - **Platinum ($7.50/mo):** "Extensive analysis of sales and purchases in Ledger on website," "Track gold making performance on the dashboard and item pages," "View sale price and quantity graphed over time on the item pages," "Unlimited realms in the Desktop App," Discord alerts, exclusive Discord channels / roadmap insights.
  - Billing toggles: Annually, Biannually, Monthly, with "Save 25% on a yearly subscription." Monthly and biannual prices weren't rendered.

  — [tradeskillmaster.com/premium](https://tradeskillmaster.com/premium)
- **Tier history:** the two Premium tiers (Gold, Platinum) were introduced on Sep 4, 2024, alongside the rebuilt website. The site "includes a Groups tab for viewing in-game groups outside the game," and free access includes the desktop app with price data and "basic Auction House analysis on the website." Legacy subscribers got 6 months of Platinum, then Gold. — [blog p=1072 via search](https://blog.tradeskillmaster.com/?p=1072); [subscription FAQ](https://support.tradeskillmaster.com/en_US/tsm-website/what-happens-to-my-subscription-after-the-new-tsm-premium-plans-are-announced)
- **Groups sharing ("Re-introducing Public TSM Groups," Nov 2024):**
  - A public directory of shared group imports.
  - Searching and using groups is free and needs no Premium.
  - To publish, you paste an in-game export string via "My Published Groups" → "Import From String." Gold subscribers can publish directly from synced groups.
  - Publishing creates a shareable link and lists the group in the directory.
  - Discovery is through global search or the Groups menu (popular, recently viewed, view-all filtered by game version).
  - Planned: groups on item pages, ratings, and Premium desktop-app sync.

  — [Re-introducing Public TSM Groups](https://blog.tradeskillmaster.com/?p=1110) (via search summary)
- **Terms:** user-published content (e.g. groups) is licensed to TSM to host and distribute and to let other users import it. The license survives deletion for copies other users have already imported. — [TSM Terms of Service](https://tradeskillmaster.com/terms)

### Inferences
- The free/Premium split suggests a model: free = market research (prices, basic item info), paid = personal analytics (ledger analysis, performance tracking, price and quantity history graphs, alerts).
- "Heatmap" plausibly means activity by hour or day, or market movement. Treat that as speculation. If built, a weekday × hour grid of listing counts or price changes from scan timestamps would be a reasonable equivalent.
- Groups map to user-defined, shareable item lists (watchlists) with a public directory, export/import strings and links.

### Gaps
- The free item-page content for Forever realms couldn't be checked (no item pages were fetched, and the realm page rendered no data to the fetcher).
- Monthly and biannual prices weren't rendered.
- The Heatmap's actual function, and whether Premium web features cover Forever, aren't documented. The pricing page doesn't distinguish game versions.
- Date oddity: the /news list showed "November 11, 2026" for the 4.15 post, while the realm page said "8 days ago" (≈Nov 1, 2026) and the post refers to the Nov 4 Forever launch as upcoming. Other dates in the list also look mis-rendered (e.g. "September 9, 2024" for the Sep 4, 2024 launch post). Treat list dates as unreliable.

## 6. Public API and terms (beyond the public CSVs)

### Takeaway
As of 2026, TSM's sanctioned programmatic access is the static public CSV files at public-data.tradeskillmaster.com. They need no key, sign-in or rate limits, and they refresh every few hours (realm) or daily (region). The older key-based "Public Web API" docs now redirect to or describe the CSVs, and custom integrations are by email. The ToS forbids scrapers and bots except through the features provided for that purpose.

### Cited Findings
- **Public-data files:** at `https://public-data.tradeskillmaster.com`, with "no API key, sign-in, or rate limits." Patterns:
  - `{gameType}/{regionSlug}/realm/{realmSlug}/items.csv` (and `pets.csv`)
  - `{gameType}/{regionSlug}/commodities.csv`
  - `{gameType}/{regionSlug}/region/items.csv` (and `pets.csv`)

  Slugs match the realm page URLs. — [Public Pricing Data](https://tradeskillmaster.com/public-data)
- **Availability, units and refresh:**
  - Pet files exist only for versions with a battle pet market (Retail, MoP); commodities are Retail only.
  - Prices are in copper. `updatedAt` is the upstream scan time.
  - Realm and commodity files change every few hours; region files daily.
  - Google Sheets IMPORTDATA refreshes about hourly.

  — [Public Pricing Data](https://tradeskillmaster.com/public-data)
- **"TSM Public Web API" help article (updated July 5, 2026):** describes the static CSV files. For custom programmatic access, contact the team by email. — [TSM Public Web API](https://support.tradeskillmaster.com/api-documentation/tsm-public-web-api)
- **Legacy key-based API docs:** "All public API endpoints require an access token" obtained by exchanging your personal TSM API key with the auth API, with 429 responses when rate limits are exceeded. These are older and likely superseded. — [helpjuice mirror of Public Web API](https://tradeskillmaster.helpjuice.com/api-documentation/tsm-public-web-api) (search snippet); [New Public Web API blog](https://blog.tradeskillmaster.com/?p=868)
- **ToS (last updated Nov 1, 2026; effective for existing users Dec 1, 2026):**
  - You may not "access the Service with bots, scrapers or other automated tools, except through features we provide for that purpose," for example the public pricing data files.
  - Pricing data "is offered on the terms described with it."
  - The licence is "personal, non-exclusive, non-transferable." Reselling or sharing Premium access is prohibited.
  - Prices are estimates that may be "incomplete, delayed or wrong."
  - No attribution clause was found.

  — [TSM Terms of Service](https://tradeskillmaster.com/terms)
- There is also a separate "TSM Addon API" for other addons to read TSM data in-game. — [What is the TSM Addon API](https://support.tradeskillmaster.com/api-documentation/what-is-the-tsm-addon-api-and-how-do-i-use-it) (title only, not fetched)

### Inferences
- A web app for WoW Forever US PvP Horde should consume only the public CSVs, at a polling interval of no more than about hourly, since files change every few hours. It should not scrape realm or item pages, which the ToS prohibits.
- The CSV column tables didn't render, so the exact column set should be confirmed by downloading a file.

### Gaps
- The public-data page shows no explicit licence or redistribution terms. The ToS defers to "terms described with it," which weren't visible. Whether commercial redistribution is allowed is unclear, so ask admin@tradeskillmaster.com.
- The page's segment-values table didn't render, so it doesn't confirm that `forever` is a valid `gameType` slug for the data files. The site's URL /forever/us/pvp-horde suggests `forever/us/realm/pvp-horde/items.csv`, which is inferred and unverified here.
- The CSV column definitions weren't rendered.
