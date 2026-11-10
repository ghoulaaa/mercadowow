# TSM addon: Crafting, Destroying, Vendoring, Mailing and Warehousing/Banking modules (functional description for a web re-implementation)

Context for the report writer: the target web app has recipes with reagents (from AHledger), aggregated TSM-style prices (DBMinBuyout, DBMarket, DBRecent, DBHistorical) and vendor sell prices for WoW Forever US PvP Horde. Researched 2026-11-09. Official TSM documentation (support.tradeskillmaster.com / tradeskillmaster.helpjuice.com, the same help center) is the primary source. It documents the *operations* well but documents several *settings panels* (Crafting default prices, Destroying) poorly. Where only community or remembered information exists, it is labeled.

## 1. Crafting module: crafting cost, crafted value, profit, queue/restock, UI, gathering, VendorBuy, multi-output, the "Crafting" price source

### Takeaway
TSM computes **Crafting cost = sum over reagents of (quantity x matPrice)**. Each reagent's `matPrice` comes from a global "Default Material Cost Method" custom string, historically `min(dbmarket, crafting, vendorbuy, convert(dbmarket))`, and can be overridden per material. **Crafted value** defaults to "min buyout, else market value", effectively `first(dbminbuyout, dbmarket)`. **Profit = crafted value - crafting cost.** The queue adds an item only when profit is at least the min profit (default 100g), and only enough to reach the max restock (default 20). Nothing is queued if that would be fewer than the min restock (default 10).

### Cited Findings
**Price sources and formulas**
- `Crafting` price source: "the sum of the material prices (matPrice) of each individual item used to craft the recipe". It is unavailable if no known recipe exists. — [TSM: Which Price Sources can I use](https://support.tradeskillmaster.com/custom-strings/which-price-sources-can-i-use-and-what-do-they-mean)
- `matPrice`: the material cost of an item. It exists only if a known recipe uses that item. The default calculation is set under Crafting > "Default Price Settings" and can be overridden per item in the Materials tab. — [TSM: Which Price Sources](https://support.tradeskillmaster.com/custom-strings/which-price-sources-can-i-use-and-what-do-they-mean)
- "The crafting cost is the sum of the material cost from each reagent in the recipe." If any reagent has an invalid material cost, crafting cost cannot be calculated. — [TSM: Why am I missing crafting costs or profits](https://support.tradeskillmaster.com/en_US/addon/why-am-i-missing-crafting-costs-or-profits-in-my-profession-window)
- Crafted item value: "By default, the crafted item value looks at the minimum buyout, then the market value" if min buyout is invalid. If both are invalid (the item was not posted in the last 14 days, or it is BoP), the value is invalid and profit cannot be computed. — [TSM: Why am I missing crafting costs or profits](https://support.tradeskillmaster.com/en_US/addon/why-am-i-missing-crafting-costs-or-profits-in-my-profession-window)
- Profit = Crafted Item Value - Crafting Cost. The Crafting operation can override Crafted Item Value (disabled by default). The override changes the profit shown in tooltips and is used in the min-profit check. — [TSM: Crafting Operations](https://tradeskillmaster.helpjuice.com/tsm-addon-documentation/1236068-tsm-addon-crafting-operations)
- Default Material Cost Method (community-reported):
  - A 2018 r/woweconomy user reported `min(dbmarket, crafting, vendorbuy, convert(dbmarket))`. This is from an old version, so treat it as historical. — [r/woweconomy weekly TSM thread, Aug 2018](https://lr.in.psf.lt/r/woweconomy/comments/9516i0/weekly_tradeskillmaster_thread/e4ce0wc/?context=3)
  - A Wowhead economy article describes the default as the minimum of market value, crafting, vendor buy and conversion. A newer variant adds a `max()` term with the player's own purchase history. — [Wowhead Economy Weekly Wrap-Up 191](https://cn.wowhead.com/news/wowhead-economy-weekly-wrap-up-191-korthite-crystal-market-crash-323878)
- Lazy Goldmaker: materials default to dbmarket for most tradeable mats and to vendorbuy for vendor-sold items. You can swap dbmarket for avgbuy to use your own purchase prices. The author targets a minimum sale price of 120% of crafting cost. — [The Lazy Goldmaker: Valuing your crafting materials](https://thelazygoldmaker.com/tsm-discussion-valuing-you-crafting-materials)
- Commenter strings on that page, tested on Classic, that cap outlier prices at 150% of market:
  - Material cost: `first(Ifgt(dbminbuyout, dbmarket * 1.5, dbmarket*1.5, dbminbuyout),min(dbmarket, crafting, vendorbuy, convert(dbmarket)))`
  - Crafted value: `first(Ifgt(dbminbuyout, dbmarket * 1.5, dbmarket*1.5, dbminbuyout), dbmarket)`
  - Source: [The Lazy Goldmaker (comments)](https://thelazygoldmaker.com/tsm-discussion-valuing-you-crafting-materials)
- Recursion: because `crafting` is a term inside matPrice, an intermediate reagent (e.g. a bar or thread the player can craft) is valued at the cheaper of buying it and crafting it. — [Wowhead Wrap-Up 191](https://cn.wowhead.com/news/wowhead-economy-weekly-wrap-up-191-korthite-crystal-market-crash-323878); [Lazy Goldmaker](https://thelazygoldmaker.com/tsm-discussion-valuing-you-crafting-materials) ("the rest of the string should stay intact so vendor items and intermediate crafts still work")

**Custom-string function semantics (needed to re-implement the strings)**
- `min`/`max`/`avg`/`first` ignore invalid parameters unless all are invalid.
- `first` returns the first valid parameter.
- `check(a,b,c)`: if a>0 then b, else c.
- `ifgt/ifgte/iflt/iflte/ifeq(a,b,c,d)`: d is optional. Omitting it makes the result invalid when the else branch is used.
- `N% source` is a percentage of a source.
- `convert(source)` returns the lowest cost across conversions (milling, prospecting, essence transforms, ink vendor trades) and requires a plain price source.
- `round/roundup/rounddown(a,b)` round a to a multiple of b.
- `source(item:ID)` evaluates a source for a specific item.
- `/ 0.95` is the usual way to account for the 5% AH cut.
- Source: [TSM: Which Functions can I use](https://support.tradeskillmaster.com/custom-strings/which-functions-can-i-use-and-what-do-they-mean)

**Price-source definitions (for mapping to the app's aggregated prices)**
- DBMinBuyout = lowest auction as of the last update. It may be invalid.
- DBMarket = weighted 14-day average of listings, favoring the last 3 days. It reflects listing prices, not sales.
- DBRecent = like DBMarket but only the latest snapshot.
- DBHistorical = 60-day average of DBMarket.
- Region equivalents: DBRegionMarketAvg, DBRegionHistorical, DBRegionSaleAvg.
- Accounting sources: avgBuy, avgSell, min/maxBuy, min/maxSell, SmartAvgBuy (TSM 4.10+).
- Source: [TSM: Which Price Sources](https://support.tradeskillmaster.com/custom-strings/which-price-sources-can-i-use-and-what-do-they-mean)

**VendorBuy handling**
- "By default any item will reference the vendorbuy price when it is available." TSM learns vendorBuy only when the player visits a vendor that sells the item. After an item-cache rebuild the vendor price can be lost; the fix is to revisit the vendor. A manual override is under Profession window > Reports > Materials. — [TSM: Why do my vendor items have wrong or missing material prices](https://tradeskillmaster.helpjuice.com/en_US/addon/why-do-my-vendor-items-have-wrong-or-missing-material-prices); [TSM: Which Price Sources (vendorBuy)](https://support.tradeskillmaster.com/custom-strings/which-price-sources-can-i-use-and-what-do-they-mean)
- Vendor buy only applies to items NPCs stock without limit (vials, threads, etc.). — [Wowhead Wrap-Up 191](https://cn.wowhead.com/news/wowhead-economy-weekly-wrap-up-191-korthite-crystal-market-crash-323878)

**Crafting operation (queue/restock) settings**
- Min restock quantity: if the operation would add fewer than this, it adds none.
- Max restock quantity: the target stock level. Nothing is queued if inventory is already at or above it.
- Both accept custom strings and must evaluate to 0–2000.
- "Set min profit" is enabled by default with a 100g threshold.
- Crafted Item Value override is disabled by default.
- Ignore-on-realm/character lists are available. The operation does not work on the Base Group.
- Source: [TSM: Crafting Operations](https://tradeskillmaster.helpjuice.com/tsm-addon-documentation/1236068-tsm-addon-crafting-operations)
- Default Crafting operation: min restock 10, max restock 20, min profit 100g. — [TSM: How do the #Default Operations work](https://support.tradeskillmaster.com/how-do-the-default-operations-work)
- An item is not restocked when:
  - it fails min profit;
  - it cannot reach min restock;
  - inventory is already at max restock (guild bank counts unless ignored in Crafting "Inventory Settings", which the article calls the most common cause);
  - no character knows the recipe.
  - The diagnostic command is `/tsm restock_help` with the item linked.
  - Source: [TSM: Why doesn't my crafted item get restocked](https://support.tradeskillmaster.com/addon/why-doesnt-my-crafted-item-get-restocked)
- The legacy (TSM2-era) Restock Queue button filled the queue with profitable items up to restock targets. That queue counted bags, bank and AH, but not mail. — [Engadget: Getting started with TSM Crafting (2012)](https://www.engadget.com/2012-07-26-addon-spotlight-getting-started-with-tradeskillmaster-crafting.html); [Engadget: Inventory balancing in TSM (2011)](https://www.engadget.com/2011-08-04-gold-capped-inventory-balancing-in-tradeskillmaster.html)

**UI**
- Recipe data is cached only when the player opens the profession in the TSM Crafting UI (via the "TSM4" button on the Blizzard profession window). Pricing requires the TSM Desktop App. — [TSM: Why am I missing crafting costs](https://support.tradeskillmaster.com/en_US/addon/why-am-i-missing-crafting-costs-or-profits-in-my-profession-window)
- The official module description reads: Crafting "shows which crafts sell profitably and lets you build a craft queue". Gathering is part of the Crafting window and helps find and acquire the materials needed. — [WoWInterface TSM page](https://wowinterface.com/downloads/info24165-TradeSkillMaster.html)
- The TSM tooltip's Crafting module has defaults `craftingCost = true`, `matPrice = false`, `detailedMats = false`. Crafting cost and profit show only for items the character can craft (`TSM.Crafting.CanCraftItem`). — [WoWInterface forum t-57717](https://www.wowinterface.com/forums/archive/index.php/t-57717.html)

### Inferences
- Web-app algorithm per recipe:
  - `matPrice(r) = min(valid: market(r), craftingCost(r) if r is craftable, vendorBuy(r) if vendor-sold)`
  - `craftingCost = Σ qty_r * matPrice(r)`
  - `value = first(minBuyout, market)`
  - `profit = value - craftingCost`. Optionally use `value * 0.95 - cost` to net out the AH cut; TSM's displayed profit does not net out the cut by default, per the formulas above.
  - `margin = profit / cost`
  - Guard against cycles in the recursive `crafting` term (TSM's min() just skips invalid values).
  - A "restock suggestion" can mimic the queue: `toCraft = max(0, maxRestock - owned)`, set to 0 if `toCraft < minRestock` or `profit < minProfit`.
- With the app's data, the "market" slot can be DBMarket, and DBRecent can stand in for a near-real-time minimum when DBMinBuyout is missing. The 150%-of-market cap from the Lazy Goldmaker strings is a good outlier guard.
- Vendor-sold reagents (vials, threads, flux, dyes) should take vendorBuy as their price. The app has vendor *sell* prices but needs a separate vendor *buy* list. vendorBuy is not equal to vendorSell; vendorSell is usually far lower than vendorBuy. If only vendor sell prices exist, a curated table of NPC-sold reagents with buy prices is needed.
- Multi-output recipes (e.g. a recipe producing several items, or random-count crafts): the cost per item should be the total reagent cost divided by the number of items produced (an average for ranges).

### Gaps
- No current official page states the exact default strings for "Default Material Cost Method" and "Default Craft Value Method" in TSM 4.x Classic. The official text confirms only "min buyout, then market" for crafted value. The `min(dbmarket, crafting, vendorbuy, convert(dbmarket))` string is community-reported and dated 2018.
- How TSM handles multi-output recipes (division by number made, procs) is not documented publicly. The division is an inference.
- There is no official documentation of the Gathering tab's options (sources such as vendor, AH, alts, bank, mail, crafting, destroying) or of the Crafting settings panel ("Inventory Settings", "Default Price Settings").
- How the queue counts inventory sources in TSM4 beyond the guild-bank toggle is not documented.

## 2. Destroying (disenchant / mill / prospect): the "Destroy" value and Destroying UI/settings

### Takeaway
`Destroy` is a TSM Core price source equal to the **average value of the items received from disenchanting, milling or prospecting**. Each output is valued with a configurable "Destroy Value Price Source", **default AuctionDB Market Value (DBMarket)**. The Destroying module itself is a bag-scanning UI that opens automatically when the bags hold destroyable items matching the player's criteria (non-soulbound, rarity up to Rare by default) and lets the player destroy them quickly.

### Cited Findings
- `Destroy`: "average value of the items you'd receive from milling, prospecting, or disenchanting". It defaults to DBMarket values and can be changed in the tooltip options. — [TSM: Which Price Sources](https://support.tradeskillmaster.com/custom-strings/which-price-sources-can-i-use-and-what-do-they-mean)
- The "Destroy Value Price Source" setting (Settings > Tooltip Settings) chooses how TSM values the results of disenchanting, prospecting or milling. "Default selection is AuctionDB - Market Value." — [TSM: Settings - Tooltip Settings](https://support.tradeskillmaster.com/tsm-addon-settings-tooltip-settings)
- The default destroy value is market value, "a weighted 14 day average". Users report that DE estimates can exceed actual yields because the value is an average. — [r/woweconomy weekly TSM thread](https://cal1.lr.ggtyler.dev/r/woweconomy/comments/1jnvn1j/weekly_tradeskillmaster_thread)
- Destroy window behavior:
  - It auto-shows at login when the inventory has items matching the Destroy criteria.
  - Soulbound items are "not considered by default, unless you enable it".
  - The default max rarity is Rare, so Epics are excluded unless enabled.
  - Criteria are configured in Settings > Destroying.
  - `/tsm destroy` opens the window.
  - Source: [TSM: How do I get the Destroy window to show up](https://support.tradeskillmaster.com/how-do-i-get-the-destroy-window-to-show-up)
- The official module description reads: "Destroying: Mills, prospects, and disenchants items" quickly. — [WoWInterface TSM page](https://wowinterface.com/downloads/info24165-TradeSkillMaster.html)
- Third-party addons (e.g. ProfitForge) use TSM's built-in destroy price source for expected disenchant value. — [CurseForge ProfitForge](https://www.curseforge.com/wow/addons/profit-forge/files/7577260)
- Classic disenchant expectation table (needed to compute `Destroy` for gear). Percentages are split evenly between quantity outcomes.
  - Uncommon armor:
    - iLvl 5–15: 80% Strange Dust 1–2, 20% Lesser Magic Essence 1–2.
    - iLvl 56–60: 75% Illusion Dust 1–2, 20% Greater Eternal Essence 1–2, 5% Large Brilliant Shard.
  - Uncommon weapons invert the dust/essence split, e.g. 20% dust / 75% essence / 5% shard.
  - Rare items give 100% of the shard for their level. At iLvl 56–65 that is Large Brilliant Shard 99.5%, Nexus Crystal 0.5%.
  - Epic items give 100% of their level's material. At iLvl 56–60 that is 1 Nexus Crystal; at 61+ it is 1–2 Nexus Crystals.
  - Caveat: the wiki marks the page as outdated (last edited 2021, pre-BfA).
  - Source: [Warcraft Wiki: Disenchanting tables](https://warcraft.wiki.gg/wiki/Disenchanting_tables)
- Disenchant results depend on item type (armor/weapon), quality and item level. — [Warcraft Wiki: Disenchanting tables](https://warcraft.wiki.gg/wiki/Disenchanting_tables)
- The `convert()` function covers milling, prospecting, essence transforms and ink vendor trades. It gives the lowest cost of obtaining an item via conversion, the reverse direction of `Destroy`. — [TSM: Which Functions](https://support.tradeskillmaster.com/custom-strings/which-functions-can-i-use-and-what-do-they-mean)

### Inferences
- Web-app formula for gear: `Destroy(item) = Σ_outputs P(output) * E[qty | output] * destroyPrice(output)`, where `destroyPrice` = DBMarket by default. For example, a 1–2x outcome has E[qty] = 1.5.
  - Worked example (uncommon armor, iLvl 56–60):
    `0.75*1.5*price(Illusion Dust) + 0.20*1.5*price(Greater Eternal Essence) + 0.05*1*price(Large Brilliant Shard)`
  - Only items with a known DE table entry, a disenchantable class (armor/weapon) and quality ≥ Uncommon get a value.
- Milling and prospecting work the same way per stack of 5 herbs/ore: `Destroy(per unit) = (Σ_outputs avg_qty_per_5 * price) / 5`. The yield tables were not collected here.
- Useful comparisons for the app:
  - Destroy vs vendorSell vs DBMarket per item, to answer "DE, vendor or post?".
  - `crafting cost - Destroy(output)`, to find "craft-to-disenchant" opportunities, e.g. cheap greens crafted and disenchanted.
- The "Max destroy value" filter in Vendoring (section 3) uses Destroy to stop vendoring items that are worth more destroyed.

### Gaps
- No public TSM documentation of its internal disenchant/mill/prospect yield tables, or of whether it uses expected quantities or another method.
- Milling (pigments per herb) and prospecting (gems per ore) yield tables for Classic were not collected. Sources like Wowhead item "milled from" / "prospected from" data would be needed. Note that in vanilla-era Classic, milling (Inscription, WotLK) and prospecting (Jewelcrafting, TBC) do not exist. Only disenchanting applies unless WoW Forever includes TBC/WotLK content. This is an inference from expansion history; WoW Forever's content scope was not checked.
- The exact names of the Settings > Destroying options in the current version (e.g. "deAbove price", ignore list, include soulbound, max rarity) are not documented publicly beyond the defaults above.

## 3. Vendoring: buy/sell rules, junk selling, "sell if below X" logic, Vendoring operations

### Takeaway
A Vendoring operation attached to an item group can **auto-buy** items from a vendor up to a restock quantity, and **auto-sell** group items to the vendor. Selling keeps a "keep quantity" and can be filtered: sell only if the item has expired at least N times on the AH (default 20), only if its market value ≤ a threshold, and only if its destroy value ≤ a threshold (both thresholds default 0c = disabled). Soulbound items are excluded by default.

### Cited Findings
- **Buy options:**
  - Enable buying (on by default).
  - Restock quantity: 0 = no maximum. It does not accept custom strings.
  - Sources to include for restock: which inventories count.
  - Source: [TSM: Vendoring Operations](https://support.tradeskillmaster.com/tsm-addon-documentation/tsm-addon-vendoring-operations)
- **Sell options:**
  - Enable Selling (on by default).
  - Keep quantity.
  - Min number of expires (default 20).
  - Market value (custom string) and Max market value (custom string, default 0c = disabled).
  - Destroy value (custom string) and Max destroy value (default 0c = disabled).
  - Sell soulbound items toggle.
  - Source: [TSM: Vendoring Operations](https://support.tradeskillmaster.com/tsm-addon-documentation/tsm-addon-vendoring-operations)
- Threshold logic:
  - Example: with Market value = "dbmarket" and Max market value = 1g, items with dbmarket ≤ 1g are vendored.
  - If both max thresholds are set, both conditions must be true.
  - If both are 0c, items sell regardless.
  - Source: [TSM: Vendoring Operations](https://support.tradeskillmaster.com/tsm-addon-documentation/tsm-addon-vendoring-operations)
- Default Vendoring operation: min expires 20, max market value and max destroy value unset, soulbound excluded. — [TSM: How do the #Default Operations work](https://support.tradeskillmaster.com/how-do-the-default-operations-work)
- Vendoring operations do not work on the Base Group. Ignore-by-realm/character options are available. — [TSM: Vendoring Operations](https://support.tradeskillmaster.com/tsm-addon-documentation/tsm-addon-vendoring-operations)
- The official module description reads: "Vendoring: Improves buying from vendors and selling items from your bags to them." — [WoWInterface TSM page](https://wowinterface.com/downloads/info24165-TradeSkillMaster.html)
- TradeSkillMaster_Vendor and TradeSkillMaster_TDAutoVendoring are third-party, *not official*, add-ons with their own soulbound/quality/level rules. — [CurseForge TradeSkillMaster_Vendor](https://www.curseforge.com/wow/addons/tradeskillmaster_vendor); [CurseForge TDAutoVendoring](https://www.curseforge.com/wow/addons/tradeskillmaster_tdautovendoring)

### Inferences
- There is no documented "sell if below X% of vendor" rule in the official operation. The equivalent is expressed through custom strings. For example, set Max market value to `vendorsell * 1.x`, or to `vendorsell / 0.95` to account for the AH cut and deposit, so an item is vendored when its AH value does not beat its vendor price by a margin.
- Web-app "vendor recommendation" rule:
  - Recommend vendoring when `vendorSell ≥ k * DBMarket` (or when DBMarket is invalid), and `Destroy < vendorSell`, and the item is not a reagent the user crafts with.
  - Optionally require low sell-through, the analogue of "min expires".
- Junk (grey) items: Retail and Classic players commonly rely on a "sell junk/greys" button in the TSM vendor UI. This is not confirmed in the fetched docs; see Gaps. For the web app, greys are simply valued at vendorSell.

### Gaps
- The fetched official docs did not cover the TSM Vendor UI tabs (Buy, Buyback, Sell, "Sell Junk/Greys", "Quick Sell"/"Sell Groups"), nor a "bad items"/junk list setting.
- The default custom strings in the "Market value" and "Destroy value" fields of the operation (likely `dbmarket` and `destroy`) are not stated in the doc.

## 4. Mailing and Warehousing/Banking (conceptual only for a web app)

### Takeaway
Mailing automates opening and collecting the mailbox and sending group items to a target alt by keep/max rules. Warehousing (the BankUI) moves item groups between bags, bank and guild bank by move/keep/restock quantities. Neither involves pricing math. Both matter for a web app only as "where is my stock" inventory concepts.

### Cited Findings
- **Mailing operation:**
  - Target character (Name-Realm for connected realms).
  - "Keep this amount" (keep in bags / minimum before sending).
  - "Set max quantity" (per send).
  - "Restock target to max quantity", plus the sources counted on the target.
  - Ignore-by-realm/character options.
  - Mailing operations do not work on the Base Group and are not included in group exports.
  - Source: [TSM: Mailing Operations](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-mailing-operations)
- Mailing module: "Empties your mailbox quickly and can send items to your other characters with one click." — [WoWInterface TSM page](https://wowinterface.com/downloads/info24165-TradeSkillMaster.html)
- **Warehousing operation:**
  - Move Quantity options: Quantity to move, Stack size multiple, Keep in bags quantity, Keep in bank quantity.
  - Restock options: Restock quantity (to bags), Stack size multiple (e.g. stacks of 5 for destroying), Keep in bank quantity.
  - All are disabled by default, and none accept custom strings.
  - It does not work on the Base Group.
  - Source: [TSM: Warehousing Operations](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-warehousing-operations)
- The default Warehousing operation does nothing. — [TSM: How do the #Default Operations work](https://support.tradeskillmaster.com/how-do-the-default-operations-work)
- "Banking/Warehousing: The BankUI moves predefined item groups between your bags, bank, and guild bank." — [WoWInterface TSM page](https://wowinterface.com/downloads/info24165-TradeSkillMaster.html)

### Inferences
- The web app cannot read in-game inventory unless a SavedVariables/export pipeline exists. These modules translate at most to "restock targets per alt" planning views (e.g. "send 20 Mithril Bars to the crafter alt").
- The relevant shared concept is TSM's **group + operation** model: rules are attached to item groups, not to single items. The web app could reuse this model for crafting restock, vendoring and shopping thresholds.

### Gaps
- No official list of Mailing UI features beyond operations (e.g. auto-open mail, send gold, "mail disenchantables to enchanter") in the fetched docs.

## 5. Classic/Forever vs Retail availability

### Takeaway
TSM 4.x ships one addon supporting Retail and Classic flavors. All five modules (Crafting with Gathering, Destroying, Vendoring, Mailing, Warehousing/BankUI) are listed as core features. No official source found marks any of these five modules as Retail-only. Expansion-dependent pieces are Retail-specific: quality tiers, optional/finishing reagents, crafting orders, and the region sale-rate data.

### Cited Findings
- The WoWInterface TSM listing covers Retail, "Classic & TBC" and TBC. It lists Crafting, Gathering, Destroying, Vendoring, Mailing, Banking/Warehousing and Accounting as features. The latest version on the page is v4.15.5, updated 11-09-26. — [WoWInterface TSM page](https://wowinterface.com/downloads/info24165-TradeSkillMaster.html)
- TSM's Classic release notes say Classic has its own TSM version and that the Desktop app supports Classic. — [TSM blog (Classic announcement, per search summary)](https://blog.tradeskillmaster.com/?p=434)
- The Lazy Goldmaker commenter tested the crafting-value strings on Classic, which indicates the Crafting price strings work there. — [The Lazy Goldmaker](https://thelazygoldmaker.com/tsm-discussion-valuing-you-crafting-materials)
- The price-source page does not mark any source as Retail-only. — [TSM: Which Price Sources](https://support.tradeskillmaster.com/custom-strings/which-price-sources-can-i-use-and-what-do-they-mean)

### Inferences
- Retail-only concepts the web app should *not* model for a Classic-like WoW Forever realm:
  - Dragonflight/TWW crafting quality ranks and optional/finishing reagents; the TSM Dragonflight update added quality-aware crafting.
  - Crafting orders.
  - Concentration.
  - Commodity (region-wide) AH pricing.
- Source for the Dragonflight update: [TSM blog: Dragonflight Update](https://blog.tradeskillmaster.com/?p=929). The page was surfaced in search but not fetched, so its contents are unverified.
- Milling and prospecting relevance depends on whether WoW Forever includes TBC (Jewelcrafting) and WotLK (Inscription) content.

### Gaps
- No source was found describing "WoW Forever" specifically, or which TSM flavor (Classic Era, Progression or Anniversary) it maps to. This should be confirmed separately.
- No official per-flavor feature matrix for TSM modules was found.
