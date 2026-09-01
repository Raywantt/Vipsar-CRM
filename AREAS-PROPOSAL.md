# Areas — proposed list, derived from real data

**Status: report only. Nothing has been written to the database.** This is
Step 1 of Section C — query, normalize, propose, then wait for the owner to
edit this list before anything is inserted (Step 2).

Query method: read `sites.locality` for all 259 sites (via an authenticated
owner session, no schema changes), joined to `leads.site_id` for a lead
count per site. Both counts are shown per group below.

## Headline numbers

| | Count |
|---|---:|
| Total sites | 259 |
| Total leads | 262 |
| Sites with a **null or empty** `locality` | **58** (22% of all sites) |
| Distinct raw `locality` values (sites with one) | **110** |
| Distinct after trim/case-fold/whitespace normalization only | 108 |
| Distinct after also grouping obvious variants (below) | **91** |

**91 is well past the ~15 the task flagged as the threshold.** Even
generous, confident grouping barely dents this — the long tail (below) is
genuinely ~65 different one-off places, not 65 typos of a smaller set. This
means the native `<select>` in `SiteDetailsSection.jsx:64-75` (and the
matching one in the now-dead `SiteSearchOrCreate.jsx`) **needs a searchable
replacement once areas are populated** — a plain dropdown with 90 options is
unusable. Logging this as a design-brief requirement, not fixing it here.

## Normalization methodology

Two passes, both shown so nothing is hidden:

1. **Mechanical** (trim, case-fold, collapse whitespace, strip trailing
   punctuation) — barely moves the number (110 → 108). Almost none of the
   "duplicates" in this data are case/whitespace issues.
2. **Semantic** (the real work) — most of what looks like 110 distinct
   places is actually far fewer real neighborhoods, written inconsistently:
   - **House/plot numbers prefixed onto the area name** — `6 mahavir
     enclave`, `47 mahavir enclave`, `178 mahavir enclave`, `203 mahavir
     enclave`, `#89 mahavir enclave`, `150 Mahavir enclave` are six rows,
     one real place (Mahavir Enclave). Stripped a leading number/`#`/`H no.
     X-X,` fragment before grouping.
   - **Block letters prefixed onto the area name** — `B - AGGAR NAGAR`,
     `B BRS NAGAR`, `C - BRS NAGAR` are sub-blocks of Aggar Nagar / BRS
     Nagar, not different places. Stripped a leading single letter.
   - **Genuine spelling variants** — `CARTOON WOODS` / `CARLTON WOODS` (one
     is almost certainly a typo for the other — "Carlton" is the real place
     name); `GURDEV NAGAR` / `GURUDEV NAGAR`; `NEW KHANNA EXT` / `KHANNA
     EXTENSION`. Merged by hand, listed below so you can veto any of these.
   - **What I deliberately did NOT merge**, because the shared word is a
     landmark/road, not the same neighborhood: `32A CHD ROAD` / `TEJ ENCLAVE
     CHD ROAD` / `39 SEC CHD ROAD` (three different colonies that all cite
     Chandigarh Road); `MERIDIAN LANE, PAKHOWAL ROAD` / `AANAND ENCLAVE,
     PAKHOWAL ROAD` (same reasoning); `BASANT CITY` / `BASANT AVENUE` /
     `BASANT VATIKA` (three real, distinct Ludhiana colonies that happen to
     share a first word); `PROFESSOR COLONY` / `NEW PROFESSOR COLONY`
     (a "New X" colony is usually a genuinely separate, later-built extension
     of "X", not a typo of it). **These are judgment calls — I don't have
     reliable local knowledge of Ludhiana geography, your reps do. Correct
     any of these you know are wrong.**

## Proposed areas — clusters with 2+ sites (26 areas, 174 of 259 sites)

All in Ludhiana unless noted. `area_name` is a suggestion — edit freely.

| area_name | city | sites | leads | raw localities merged |
|---|---|---:|---:|---|
| Solitaire Homes | Ludhiana | 19 | 19 | SOLITAIRE HOMES; 2108, 2109 solitaire homes |
| SBS Nagar (F Block) | Ludhiana | 12 | 12 | F SBS NAGAR; SBS NAGAR; GOBIND NAGAR, SBS NAGAR *(judgment call — F Block is the dominant cluster; confirm plain "SBS Nagar" belongs with it)* |
| Mahavir Enclave | Ludhiana | 10 | 10 | MAHAVIR ENCLAVE + 6 house-numbered variants (6/47/150/178/203/#89) |
| Aggar Nagar | Ludhiana | 6 | 6 | AGGAR NAGAR; B - AGGAR NAGAR; 502 B AGGAR NAGAR |
| Sarabha Nagar | Ludhiana | 6 | 6 | SARABHA NAGAR |
| Eldeco | Ludhiana | 6 | 6 | ELDECO |
| Vardhman Park | Ludhiana | 6 | 6 | VARDHMAN PARK |
| Dream City | Ludhiana | 6 | 6 | DREAM CITY; AIPL / DREAM CITY *(AIPL is likely the builder — confirm same project)* |
| Sunview | Ludhiana | 9 | 9 | SUNVIEW 1/2/3; 694 sunview; BAINS OPP. SUNVIEW *(judgment call — merged 3 numbered phases into one area; split back out if the phases matter to you)* |
| Rajguru Nagar | Ludhiana | 4 | 4 | RAJGURU NAGAR; H no. 7-1, rajguru nagar |
| Sukhmani Enclave | Ludhiana | 4 | 4 | SUKHMANI ENCLAVE |
| BRS Nagar | Ludhiana | 4 | 4 | BRS NAGAR; B BRS NAGAR; C - BRS NAGAR |
| New Khanna Extension | Ludhiana | 4 | 4 | NEW KHANNA EXT; KHANNA EXTENSION |
| Friends Colony | Ludhiana | 4 | 4 | FRIENDS COLONY *(NEW FRIENDS COLONY kept separate — see long tail)* |
| Basant City | Ludhiana | 3 | 3 | BASANT CITY (+1 lowercase dup) |
| Gurdev Nagar | Ludhiana | 3 | 3 | GURDEV NAGAR; GURUDEV NAGAR |
| Guru Amardas Nagar | Ludhiana | 3 | 3 | Guru Amardas Nagar |
| Meridian Lane (Pakhowal Road) | Ludhiana | 3 | 3 | MERIDIAN LANE, PAKHOWAL ROAD |
| Basant Avenue | Ludhiana | 3 | 3 | BASANT AVENUE |
| Central Town | Ludhiana | 3 | 3 | CENTRAL TOWN |
| Model Town | Ludhiana | 4 | 4 | MODEL TOWN; PRITAM NAGAR, MODEL TOWN *(Pritam Nagar is a real sub-locality of Model Town)* |
| Carlton Woods | Ludhiana | 2 | 2 | CARLTON WOODS; CARTOON WOODS |
| Canal View | Ludhiana | 2 | 2 | CANAL VIEW |
| Aanand Enclave (Pakhowal Road) | Ludhiana | 2 | 2 | AANAND ENCLAVE, PAKHOWAL ROAD |
| Ekta Vihar | Ludhiana | 5 | 5 | EKTA VIHAR 2; EKTA VIHAR *(judgment call — merged phase 2 into the base name; split if the phase matters)* |
| Green Enclave | Ludhiana | 2 | 2 | GREEN ENCLAVE |
| New Khanna City | Ludhiana | 2 | 2 | NEW KHANNA CITY *(kept separate from New Khanna Extension — different project)* |
| Palm City | Ludhiana | 2 | 2 | PALM CITY |
| Imperial Homes | Ludhiana | 2 | 2 | IMPERIAL HOMES |
| Tej Enclave (CHD Road) | Ludhiana | 2 | 2 | TEJ ENCLAVE CHD ROAD |

## Long tail — 65 localities with exactly 1 site each (85 sites total)

This is the real decision. Examples: Aryan Enclave, Dugri, Sector 8,
Jagraon, Civil Lines, Jawaddi, Professor Colony, Palm Vihar, West Country
Homes, Mullanpur, Sahnewal, Victoria Enclave, Avtar Nagar, Dhuri, Nabha,
Mandi Gobindgarh, Kulgarhi Village (Ferozpur)... **full raw list available
on request** — not reproduced here to keep this readable, since none of
them merge with anything else.

A handful of these are genuinely **outside Ludhiana** and should probably
get their own `city` rather than defaulting to Ludhiana: **Jagraon,
Mullanpur, Sahnewal, Dhuri, Nabha, Mandi Gobindgarh** (Fatehgarh Sahib
district), and **Kulgarhi Village, Ferozpur** (Ferozpur district, the
farthest out) are real towns, not Ludhiana neighborhoods.

Three options, your call:
1. **Create all 65 as their own single-site areas.** Most accurate, but
   pushes the total area count to ~91 and means most areas will only ever
   have one site — heavier on the searchable picker for little reporting
   value.
2. **Leave the long tail as "Not set"** (i.e. only insert the 26 clusters
   above) and let these 85 sites' `LeadsByCategoryCard`/dashboard rows keep
   reading "No area set" until a real second site shows up nearby to justify
   creating that area. Simplest, and matches how the app already treats a
   genuinely-unset area.
3. **A recommendation, not a build**: some kind of lightweight "add an area
   inline while filling in Site details" flow would let real usage grow the
   list organically instead of it being front-loaded now — flagging this for
   the design brief, not building it in this pass.

## What I need from you

Edit the 26-row table above directly — rename anything, split/re-merge any
of the flagged judgment calls, fix the city on any of the long-tail towns if
you want them included, and tell me how to handle the long tail (option 1,
2, or 3). Once you confirm, Step 2 inserts exactly the areas you've approved
and proposes the `sites.area_id` backfill — a separate approval, since
that's a write to production.
