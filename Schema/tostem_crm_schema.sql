-- ============================================================
-- TOSTEM DEALERSHIP CRM — DATABASE SCHEMA (consolidated)
-- Built in dependency order. Every table has its own surrogate
-- `id` primary key — that never changes, regardless of which
-- foreign keys are nullable.
--
-- CORE PRINCIPLE running through this whole schema:
-- whatever a human might type inconsistently (names, addresses)
-- is NEVER used as a key or a hard uniqueness rule. It's always
-- just a searchable column. Duplicate-checking happens by
-- searching before creating a new row (app-side), not by the
-- database refusing entries. See notes throughout.
-- ============================================================


-- ---------- STEP 1: EMPLOYEES ----------
CREATE TABLE employees (
  id              SERIAL PRIMARY KEY,
  auth_user_id    UUID UNIQUE,   -- links to Supabase's auth.users(id)
  name            TEXT NOT NULL,
  mobile          TEXT,
  office_location TEXT,
  role            TEXT NOT NULL DEFAULT 'sales_executive'
                    CHECK (role IN ('owner','sales_executive','sales_coordinator')),
  -- Which sales_coordinator this employee reports to. NULL for an owner, for
  -- a coordinator (they report to the owner, not to each other), and for an
  -- unassigned exec. INTEGER, not UUID — this references employees.id, which
  -- is SERIAL. Enforced by validate_employee_role_assignment(), a trigger
  -- rather than a CHECK because the rule is cross-row: see
  -- Schema/migration_sales_coordinator.sql STEP 3.
  coordinator_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  is_active       BOOLEAN DEFAULT true,   -- deactivate, never delete a person with history
  created_at      TIMESTAMP DEFAULT now()
);

-- ON DELETE SET NULL, not CASCADE: if a login is ever removed, the employee
-- record and their full history (activities, leads they own, etc.) should
-- survive with auth_user_id cleared — not get deleted along with it.
ALTER TABLE employees
  ADD CONSTRAINT fk_auth_user FOREIGN KEY (auth_user_id)
  REFERENCES auth.users(id) ON DELETE SET NULL;

-- A third role, 'sales_coordinator', was added this way in Phase 8 — see
-- Schema/migration_sales_coordinator.sql. It turned out NOT to be the
-- one-line change this comment predicted: an oversight role needs a team
-- link (coordinator_id above), a cross-row validation trigger, and its own
-- OR'd branch on ~15 policies. A fourth role scoped to individual rows would
-- be similarly involved; one that only reads company-wide really would be
-- one line.
--
-- Row Level Security policies: see Schema/rls_policies.sql — the
-- "own data or owner role" pattern for activities, leads, parties, and plans,
-- plus the table-level GRANTs that have to accompany it.


-- ---------- STEP 2: STANDALONE MASTER TABLES ----------

CREATE TABLE areas (
  id        SERIAL PRIMARY KEY,
  area_name TEXT NOT NULL,
  city      TEXT
);

CREATE TABLE products (
  id       SERIAL PRIMARY KEY,
  name     TEXT NOT NULL,   -- e.g. 'Casement Window', 'Sliding Door'
  category TEXT             -- e.g. 'Window', 'Door', 'Facade'
);


-- ---------- STEP 3: PARTIES ----------
-- Every human/firm you deal with — client, architect, builder,
-- project manager, site staff. One row per person, ever.
-- NOTE: no UNIQUE constraint on mobile — shared household/family
-- numbers are common and a hard constraint would reject valid
-- entries. Duplicate-checking is a search-before-create habit,
-- not a database rule.
CREATE TABLE parties (
  id                  SERIAL PRIMARY KEY,
  party_type          TEXT NOT NULL CHECK (party_type IN
                        ('client','architect','builder','firm','other','pmc')),
  name                TEXT NOT NULL,
  mobile              TEXT,               -- often unknown for Lixil/referral leads — fine, nullable
  address             TEXT,
  city                TEXT,
  area_id             INTEGER REFERENCES areas(id),
  firm_name           TEXT,               -- architects often work under a firm
  relationship_status TEXT,               -- 'temporary' / 'permanent' — mainly for architects
  verification_status TEXT DEFAULT 'unverified'
                        CHECK (verification_status IN ('unverified','verified')),
  notes               TEXT,
  created_by          INTEGER REFERENCES employees(id),
  created_at          TIMESTAMP DEFAULT now()
);


-- ---------- STEP 4: SITES ----------
-- A physical property/project. Independent of Party — can be
-- created with zero known contacts (pure scanning discovery).
CREATE TABLE sites (
  id                     SERIAL PRIMARY KEY,
  area_id                INTEGER REFERENCES areas(id),
  house_no               TEXT,
  locality               TEXT,
  pincode                TEXT,
  nickname               TEXT,     -- rep's own plain-language description for recall
                                    -- (e.g. 'site in front of Verka factory in Sarabha Nagar'),
                                    -- separate from the structured locality/house_no/pincode fields
  plot_area_sqyds        NUMERIC,
  site_stage             TEXT,     -- 'foundation','structure','finishing' — free text, dealer-defined
  primary_contact_party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL,
  discovered_via         TEXT CHECK (discovered_via IN
                            ('scanning','lixil','referral_architect','referral_other','showroom_walkin')),
  discovered_by          INTEGER REFERENCES employees(id),
  created_at             TIMESTAMP DEFAULT now()
);


-- ---------- STEP 5: SITE_CONTACTS ----------
-- Links parties to sites, many-to-many, with a role. Fills in
-- progressively as contacts are discovered — zero rows for a
-- brand-new scanned site is a normal, valid state.
CREATE TABLE site_contacts (
  id             SERIAL PRIMARY KEY,
  site_id        INTEGER NOT NULL REFERENCES sites(id),
  party_id       INTEGER NOT NULL REFERENCES parties(id),
  role           TEXT NOT NULL CHECK (role IN
                    ('owner','architect','builder','project_manager','site_staff','other')),
  discovered_at  TIMESTAMP DEFAULT now(),
  UNIQUE (site_id, party_id, role)   -- same person can hold >1 role at a site, but not the same role twice
);


-- ---------- STEP 6: LEADS ----------
-- One row per opportunity. Needs EITHER a site OR a party to
-- exist — never both required at creation. Whichever is known
-- first (per source) gets set; the other fills in later.
CREATE TABLE leads (
  id                   SERIAL PRIMARY KEY,
  site_id              INTEGER REFERENCES sites(id),
  party_id             INTEGER REFERENCES parties(id),
  product_id           INTEGER REFERENCES products(id),
  owner_employee_id    INTEGER REFERENCES employees(id),

  source_type          TEXT NOT NULL CHECK (source_type IN
                          ('scanning','lixil','referral_architect','referral_other','showroom_walkin')),
  referred_by_party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL,  -- who gets referral credit
  other_party_id       INTEGER REFERENCES parties(id) ON DELETE SET NULL,
                        -- the "other" party captured at quick-capture intake,
                        -- if any, regardless of source_type or whether they
                        -- became the referrer above. Purely for traceability —
                        -- e.g. surfacing them as a suggested site_contacts
                        -- link later — not a business/reporting field like
                        -- referred_by_party_id is.
  external_reference_id TEXT,   -- Lixil's own case/lead number, if given

  lead_generated_at    DATE,
  current_stage        TEXT DEFAULT 'new',   -- free text, standardize the list at the app layer

  -- SC edit lock, NOT an audit field. NULL = the assigned exec has never
  -- saved this row, so the sales_coordinator who entered it may still edit
  -- it; 'sales_executive' = the exec has taken it over and the SC drops to
  -- view-only. Written only by the stamp_entered_by_role() trigger, never by
  -- app code. Full rationale: migration_sales_coordinator.sql STEP 4.
  entered_by_role      TEXT CHECK (entered_by_role IS NULL OR entered_by_role IN
                          ('owner','sales_executive','sales_coordinator')),

  rfq_raised           BOOLEAN DEFAULT false,
  rfq_raised_at        DATE,
  quote_sent           BOOLEAN DEFAULT false,
  quote_sent_at        DATE,
  quote_value          DECIMAL(14,2),
  order_value          DECIMAL(14,2),

  closure_probability  SMALLINT CHECK (closure_probability BETWEEN 0 AND 100),
  estimated_close_date DATE,
  next_followup_date   DATE,

  created_at           TIMESTAMP DEFAULT now(),

  CONSTRAINT lead_needs_an_anchor CHECK (site_id IS NOT NULL OR party_id IS NOT NULL)
);


-- ---------- STEP 7: ACTIVITY / PLANNING / HISTORY ----------

-- Append-only activity log — replaces the DPR sheet.
-- Needs EITHER a party OR a lead — same "at least one anchor" rule —
-- except 'office_day', which isn't tied to any one party/lead and can
-- leave both NULL.
CREATE TABLE activities (
  id              SERIAL PRIMARY KEY,
  employee_id     INTEGER NOT NULL REFERENCES employees(id),
  party_id        INTEGER REFERENCES parties(id),
  lead_id         INTEGER REFERENCES leads(id),
  activity_type   TEXT NOT NULL CHECK (activity_type IN
                    ('site_visit','call','rfq_raised','office_day','booking_update','architect_meeting')),
  accompanied_by  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  notes           TEXT,
  leads_generated INTEGER,   -- only used for 'office_day' entries
  -- Same SC edit lock as leads.entered_by_role above — see that comment.
  entered_by_role TEXT CHECK (entered_by_role IS NULL OR entered_by_role IN
                     ('owner','sales_executive','sales_coordinator')),
  created_at      TIMESTAMP DEFAULT now(),

  CONSTRAINT activity_needs_an_anchor CHECK (
    activity_type = 'office_day' OR party_id IS NOT NULL OR lead_id IS NOT NULL
  )
);

-- Forward-looking plan — replaces the Monthly Plans sheet.
CREATE TABLE plans (
  id                 SERIAL PRIMARY KEY,
  employee_id        INTEGER NOT NULL REFERENCES employees(id),
  plan_date          DATE NOT NULL,
  area_id            INTEGER REFERENCES areas(id),
  party_id           INTEGER REFERENCES parties(id),
  planned_work_type  TEXT,
  remarks            TEXT
);

-- Every stage change on a lead gets logged here — enables
-- sales-cycle-time and funnel reporting.
CREATE TABLE stage_history (
  id          SERIAL PRIMARY KEY,
  lead_id     INTEGER NOT NULL REFERENCES leads(id),
  stage       TEXT NOT NULL,
  changed_by  INTEGER REFERENCES employees(id),
  changed_at  TIMESTAMP DEFAULT now()
);

-- Every owner reassignment on a lead gets logged here — same
-- append-only shape as stage_history, for the Lead Profile's
-- "Reassign owner" action and its ownership-history list.
-- old_owner_id is nullable (a lead can be unassigned at creation);
-- new_owner_id is not, since a reassignment always sets someone.
CREATE TABLE lead_owner_history (
  id            SERIAL PRIMARY KEY,
  lead_id       INTEGER NOT NULL REFERENCES leads(id),
  old_owner_id  INTEGER REFERENCES employees(id),
  new_owner_id  INTEGER NOT NULL REFERENCES employees(id),
  changed_by    INTEGER REFERENCES employees(id),
  changed_at    TIMESTAMP DEFAULT now()
);


-- ---------- STEP 8: SUPPORTING TABLES ----------

-- Replaces Weekly Update / Monthly Prospects / Yearly Performance
-- target rows — one flexible table instead of three hardcoded sheets.
CREATE TABLE targets (
  id            SERIAL PRIMARY KEY,
  employee_id   INTEGER NOT NULL REFERENCES employees(id),
  period_type   TEXT NOT NULL CHECK (period_type IN ('week','month','quarter','year')),
  period_value  TEXT NOT NULL,     -- e.g. '2026-07', '2026-W28', or '2026-Q3'
  metric_name   TEXT NOT NULL,     -- matches activities.activity_type
                                    -- ('site_visit','call','rfq_raised',
                                    -- 'office_day','booking_update') plus
                                    -- 'order_value' — the Dashboard only
                                    -- knows how to compute an "actual" for
                                    -- these six, so the app-layer form keeps
                                    -- the list closed instead of free text
  target_value  DECIMAL(14,2) NOT NULL
);

-- Doesn't exist in any current sheet — captures why a lead was lost.
CREATE TABLE loss_reasons (
  id               SERIAL PRIMARY KEY,
  lead_id          INTEGER NOT NULL REFERENCES leads(id),
  reason           TEXT,     -- 'price','competitor','timeline','budget_cut','site_delay', etc.
  competitor_name  TEXT,
  lost_at          DATE DEFAULT now()
);


-- ---------- STEP 9: FOLLOW-UPS ----------
-- Personal + owner-assigned reminders (self-service, not tied to any one
-- activity). assigned_to is who it's for; created_by is who set it — for a
-- self-reminder both are the same employee, for an owner-assigned one
-- they differ. party_id is the only user-facing link (picked via
-- PartySearchOrCreate); lead_id is auto-resolved app-side from that
-- party's most recent lead (same fetchLeadsByParty/mostRecentLeadByParty
-- helper PartiesCard already uses) and, when it resolves, the app also
-- writes the same due_date onto that lead's next_followup_date so this
-- doesn't create a second, out-of-sync "when's the next touch" field.
CREATE TABLE follow_ups (
  id             SERIAL PRIMARY KEY,
  assigned_to    INTEGER NOT NULL REFERENCES employees(id),
  created_by     INTEGER NOT NULL REFERENCES employees(id),
  party_id       INTEGER REFERENCES parties(id),
  lead_id        INTEGER REFERENCES leads(id),
  activity_type  TEXT CHECK (activity_type IS NULL OR activity_type IN
                    ('site_visit','call','rfq_raised','office_day','booking_update','architect_meeting','other')),
  title          TEXT NOT NULL,
  notes          TEXT,
  due_date       DATE NOT NULL,
  due_time       TIME,
  is_done        BOOLEAN NOT NULL DEFAULT false,
  done_at        TIMESTAMP,
  notified_at    TIMESTAMP,   -- set by the push-sending Edge Function once sent
  created_at     TIMESTAMP DEFAULT now()
);

-- One row per subscribed browser/device — an employee can have several
-- (phone + desktop). Populated client-side via the Web Push API, read by
-- the Edge Function (service_role, bypasses RLS) to know where to send.
CREATE TABLE push_subscriptions (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMP DEFAULT now()
);


-- ============================================================
-- INDEXES — speed up the lookups you'll run constantly.
-- Plain indexes help exact/prefix matches. Note: ILIKE '%text%'
-- searches (used for "search before create") won't fully benefit
-- from these — that's fine at small scale; if search ever feels
-- slow as data grows, that's the moment to add the pg_trgm
-- extension we deliberately skipped for this version.
-- ============================================================
CREATE INDEX idx_parties_mobile        ON parties(mobile);
CREATE INDEX idx_parties_name          ON parties(name);
CREATE INDEX idx_leads_site            ON leads(site_id);
CREATE INDEX idx_leads_party           ON leads(party_id);
-- own_data_or_owner_role RLS policies compare leads.owner_employee_id /
-- activities.employee_id on every row of every leads/activities query —
-- without these, each such query is a sequential scan.
CREATE INDEX idx_leads_owner           ON leads(owner_employee_id);
CREATE INDEX idx_activities_party      ON activities(party_id);
CREATE INDEX idx_activities_lead       ON activities(lead_id);
CREATE INDEX idx_activities_employee   ON activities(employee_id, created_at);
CREATE INDEX idx_site_contacts_site    ON site_contacts(site_id);
CREATE INDEX idx_site_contacts_party   ON site_contacts(party_id);
CREATE INDEX idx_stage_history_lead    ON stage_history(lead_id);
-- fetchWonStageHistory (targetQueries.js) filters on stage = 'won' and
-- sorts by changed_at desc against the whole table (unbounded, no date
-- filter at the query level) — this composite index covers both.
CREATE INDEX idx_stage_history_stage_changed ON stage_history(stage, changed_at);
-- Phase 8 (sales_coordinator). idx_employees_coordinator drives
-- is_my_team_member(), called by every team-scoped policy. The other four
-- back the EXISTS lookups that parties/sites SELECT now runs per row, once
-- an exec's read is narrowed from company-wide to own-leads-only —
-- see migration_sales_coordinator.sql STEP 6.
CREATE INDEX idx_employees_coordinator ON employees(coordinator_id);
CREATE INDEX idx_parties_created_by    ON parties(created_by);
CREATE INDEX idx_sites_discovered_by   ON sites(discovered_by);
CREATE INDEX idx_leads_referred_by     ON leads(referred_by_party_id);
CREATE INDEX idx_leads_other_party     ON leads(other_party_id);
CREATE INDEX idx_follow_ups_assigned_due ON follow_ups(assigned_to, due_date) WHERE is_done = false;
CREATE INDEX idx_follow_ups_due_notify   ON follow_ups(due_date, due_time) WHERE is_done = false AND notified_at IS NULL;
CREATE INDEX idx_push_subscriptions_employee ON push_subscriptions(employee_id);
