#!/usr/bin/env node
// ============================================================================
// PHASE 9 / PHASE 1 — SIMULATION PLAN GENERATOR
// ----------------------------------------------------------------------------
// Emits ../simulation_plan.json: a fully explicit, row-by-row description of
// six months of VIPSAR CRM activity. Deterministic (fixed PRNG seed) — running
// this twice produces a byte-identical plan.
//
// WHY A GENERATOR AND NOT A HAND-WRITTEN JSON:
//   Phase 6's Auditor computes the expected ledger from simulation_plan.json
//   ALONE, without touching the database. That only works if the plan is
//   complete down to the individual row — every lead, activity, stage change,
//   follow-up, target and loss reason. ~2,000 rows is not writable by hand, and
//   an incomplete plan would force the Seeder to improvise, which destroys the
//   firewall the whole exercise depends on.
//
// WHAT THIS FILE IS NOT:
//   It computes NO business aggregates. No per-exec totals, no conversion
//   rates, no attention buckets. Those are the Auditor's job, derived from the
//   raw rows here. `plan_summary` carries table row counts only — deliberately
//   not per-employee breakdowns, which would leak ledger answers into the plan.
//
// KEY CONSTRAINTS ENCODED HERE (all verified live in Phase 0):
//   - Every record carries `authored_by`: the employee ref whose authenticated
//     session must perform the insert. This is load-bearing, not metadata —
//     RLS, the entered_by_role lock, and logged_by_employee_id all follow from
//     WHO writes the row.
//   - stage_history INSERT is owner-or-team-SC only, and lead stage changes are
//     blocked for sales_executive by enforce_owner_only_stage_change().
//   - Timestamps are stored as naive UTC wall clock (schema uses TIMESTAMP
//     without time zone on a UTC database). Working hours are generated in IST
//     and converted, so they render correctly through parseTimestamp().
// ============================================================================

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'simulation_plan.json')

// ---------------------------------------------------------------------------
// Deterministic PRNG
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const SEED = 20260812
const rnd = mulberry32(SEED)
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1)) // inclusive
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const chance = (p) => rnd() < p
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------
const REFERENCE_DATE = '2026-08-12' // "today" for the whole simulation
const WINDOW_START = '2026-02-12'

const MS_DAY = 86400000
const d0 = (s) => new Date(`${s}T00:00:00Z`)
const REF = d0(REFERENCE_DATE)
const START = d0(WINDOW_START)

const isoDate = (dt) => dt.toISOString().slice(0, 10)
const addDays = (dt, n) => new Date(dt.getTime() + n * MS_DAY)
const daysBefore = (n) => addDays(REF, -n)
const dayDiff = (a, b) => Math.round((a.getTime() - b.getTime()) / MS_DAY)

// Indian public holidays falling inside the window (Delhi observance).
// Approximate for the lunar dates — flagged as such in the plan's assumptions.
const HOLIDAYS = new Set([
  '2026-03-03', // Holika Dahan
  '2026-03-04', // Holi
  '2026-03-20', // Id-ul-Fitr (approx)
  '2026-03-26', // Ram Navami
  '2026-03-31', // Mahavir Jayanti
  '2026-04-03', // Good Friday
  '2026-04-14', // Ambedkar Jayanti
  '2026-05-01', // Buddha Purnima
  '2026-05-27', // Id-ul-Zuha / Bakrid (approx)
  '2026-06-26', // Muharram (approx)
])

function isSunday(dt) {
  return dt.getUTCDay() === 0
}
function isSaturday(dt) {
  return dt.getUTCDay() === 6
}
function isHoliday(dt) {
  return HOLIDAYS.has(isoDate(dt))
}
// A day a rep would realistically log work on. Sundays and holidays are out
// entirely; Saturdays are half-strength, decided by the caller.
function isWorkingDay(dt) {
  return !isSunday(dt) && !isHoliday(dt)
}
function nextWorkingDay(dt) {
  let d = dt
  let guard = 0
  while (!isWorkingDay(d) && guard++ < 20) d = addDays(d, 1)
  return d
}
// Move a candidate day onto one somebody would realistically log work on.
// Deliberately different from nextWorkingDay(): rolling every blocked day
// forward by exactly one lands the entire Sunday population on Monday, which
// produced a visible Monday spike (314 vs ~180 on other weekdays) in the first
// build. Sundays and holidays scatter across the next day or two, and most —
// not all — Saturdays roll to Monday, so Saturday stays genuinely lighter than
// a weekday instead of matching it.
function settleDay(dt) {
  let d = dt
  let guard = 0
  // Scatter across the next three days rather than always +1, and send some
  // Saturdays backwards to Friday instead of every one forward to Monday —
  // otherwise Monday absorbs the whole weekend and reads as a 2.6x spike.
  while ((isSunday(d) || isHoliday(d)) && guard++ < 20) {
    const r = rnd()
    d = addDays(d, r < 0.4 ? 1 : r < 0.75 ? 2 : 3)
  }
  if (isSaturday(d)) {
    const r = rnd()
    if (r < 0.35) d = addDays(d, -1)
    else if (r < 0.7) d = addDays(d, 2)
  }
  while ((isSunday(d) || isHoliday(d)) && guard++ < 30) d = addDays(d, 1)
  return d
}
function prevWorkingDay(dt) {
  let d = dt
  let guard = 0
  while (!isWorkingDay(d) && guard++ < 20) d = addDays(d, -1)
  return d
}
// settleDay's backwards twin — same Saturday thinning, so a date pushed into
// the past does not quietly rebuild the Saturday bulge settleDay removes.
function settleDayBack(dt) {
  let d = dt
  let guard = 0
  while ((isSunday(d) || isHoliday(d)) && guard++ < 20) {
    const r = rnd()
    d = addDays(d, r < 0.45 ? -1 : r < 0.8 ? -2 : -3)
  }
  if (isSaturday(d) && chance(0.62)) d = addDays(d, -1)
  while ((isSunday(d) || isHoliday(d)) && guard++ < 30) d = addDays(d, -1)
  return d
}

// Month-to-month volume variance — deliberately not flat. Feb and Aug are
// partial months at the window edges; May dips (peak summer + Bakrid), Jun/Jul
// run hot (pre-monsoon fit-out season for windows and doors).
const MONTH_WEIGHT = {
  '2026-02': 0.45, // partial: 12th onward
  '2026-03': 0.95,
  '2026-04': 1.15,
  '2026-05': 0.7,
  '2026-06': 1.25,
  '2026-07': 1.3,
  '2026-08': 0.5, // partial: to the 12th
}

// IST working-hours timestamp, stored as naive UTC wall clock.
// The schema's TIMESTAMP columns hold UTC with no zone marker (see CLAUDE.md's
// Day Review "Timestamps" note), so an activity meant to read as 10:00 am IST
// must be stored as 04:30. Generating in IST then subtracting 5h30m keeps every
// seeded time inside plausible working hours once rendered.
function workTimestamp(dt, hourIstLo = 9, hourIstHi = 18) {
  const istHour = ri(hourIstLo, hourIstHi)
  const istMin = pick([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
  const istMs = d0(isoDate(dt)).getTime() + istHour * 3600000 + istMin * 60000
  const utc = new Date(istMs - (5 * 60 + 30) * 60000)
  return utc.toISOString().slice(0, 19)
}

// A working timestamp on `dt` that is guaranteed to fall strictly AFTER
// `minTs`. Both the lead and its first activity get an independent random hour,
// so on a same-day touch the activity could otherwise be stamped hours before
// the lead it belongs to — 122 such rows in the first build. A child record
// timestamped before its parent is not a realism nicety: Day Review, the
// activity timeline and every days-since calculation read these directly.
// The IST calendar date a stored (naive UTC) timestamp falls on. DATE columns
// like quote_sent_at record the IST day, so they must be derived this way
// rather than by slicing the UTC string.
function istDateOf(tsStr) {
  return new Date(new Date(`${tsStr}Z`).getTime() + (5 * 60 + 30) * 60000).toISOString().slice(0, 10)
}

function workTimestampAfter(dt, minTs) {
  const t = workTimestamp(dt)
  if (!minTs || t > minTs) return t
  const bumped = new Date(new Date(`${minTs}Z`).getTime() + ri(20, 180) * 60000)
  return bumped.toISOString().slice(0, 19)
}

// Pick a working day inside the window, weighted by month and thinned on
// Saturdays. Returns a Date.
function randomWorkingDay() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const span = dayDiff(REF, START)
    const cand = addDays(START, ri(0, span))
    const key = isoDate(cand).slice(0, 7)
    const w = MONTH_WEIGHT[key] ?? 1
    if (!isWorkingDay(cand)) continue
    if (isSaturday(cand) && !chance(0.45)) continue
    if (!chance(Math.min(1, w))) continue
    return cand
  }
  return prevWorkingDay(addDays(REF, -ri(1, 120)))
}

// ---------------------------------------------------------------------------
// Reference data — areas and products are BOTH EMPTY at baseline (Phase 0
// finding, contradicting the Phase 9 brief), so both catalogues are built from
// scratch here and teardown must remove every row.
// ---------------------------------------------------------------------------
const AREAS = [
  { ref: 'area_gk', area_name: 'Greater Kailash', city: 'New Delhi' },
  { ref: 'area_vasantkunj', area_name: 'Vasant Kunj', city: 'New Delhi' },
  { ref: 'area_dwarka', area_name: 'Dwarka', city: 'New Delhi' },
  { ref: 'area_rohini', area_name: 'Rohini', city: 'New Delhi' },
  { ref: 'area_pitampura', area_name: 'Pitampura', city: 'New Delhi' },
  { ref: 'area_saket', area_name: 'Saket', city: 'New Delhi' },
  { ref: 'area_ggn56', area_name: 'Sector 56', city: 'Gurugram' },
  { ref: 'area_golfcourse', area_name: 'Golf Course Road', city: 'Gurugram' },
  { ref: 'area_sohnaroad', area_name: 'Sohna Road', city: 'Gurugram' },
  { ref: 'area_noida128', area_name: 'Sector 128', city: 'Noida' },
  { ref: 'area_noida93', area_name: 'Sector 93A', city: 'Noida' },
  { ref: 'area_indirapuram', area_name: 'Indirapuram', city: 'Ghaziabad' },
  { ref: 'area_faridabad21', area_name: 'Sector 21', city: 'Faridabad' },
]

const PRODUCTS = [
  { ref: 'prod_casement_w', name: 'Casement Window', category: 'Window' },
  { ref: 'prod_sliding_w', name: 'Sliding Window', category: 'Window' },
  { ref: 'prod_fixed_w', name: 'Fixed Glass Window', category: 'Window' },
  { ref: 'prod_ventilator', name: 'Ventilator', category: 'Window' },
  { ref: 'prod_sliding_d', name: 'Sliding Door', category: 'Door' },
  { ref: 'prod_casement_d', name: 'Casement Door', category: 'Door' },
  { ref: 'prod_liftslide_d', name: 'Lift & Slide Door', category: 'Door' },
  { ref: 'prod_folding_d', name: 'Folding Door', category: 'Door' },
  { ref: 'prod_curtainwall', name: 'Curtain Wall', category: 'Facade' },
]

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
const OWNER = {
  ref: 'emp_owner',
  existing: true,
  id: 3,
  auth_user_id: '1c1c072a-51d5-4027-a592-c79e3c3d46f8',
  name: 'Raywant',
  role: 'owner',
}

const EMPLOYEES = [
  {
    ref: 'sc_north',
    name: 'Neha Malhotra',
    role: 'sales_coordinator',
    mobile: '9810244501',
    email: 'neha.malhotra@vipsar-sim.test',
    office_location: 'Delhi HO',
    coordinator_ref: null,
    is_active: true,
  },
  {
    ref: 'sc_south',
    name: 'Vikram Sethi',
    role: 'sales_coordinator',
    mobile: '9810244502',
    email: 'vikram.sethi@vipsar-sim.test',
    office_location: 'Gurugram Showroom',
    coordinator_ref: null,
    is_active: true,
  },
  {
    ref: 'ex_rohit',
    name: 'Rohit Sharma',
    role: 'sales_executive',
    mobile: '9810244511',
    email: 'rohit.sharma@vipsar-sim.test',
    office_location: 'Delhi HO',
    coordinator_ref: 'sc_north',
    is_active: true,
    profile: 'strong performer',
  },
  {
    ref: 'ex_priya',
    name: 'Priya Nair',
    role: 'sales_executive',
    mobile: '9810244512',
    email: 'priya.nair@vipsar-sim.test',
    office_location: 'Delhi HO',
    coordinator_ref: 'sc_north',
    is_active: true,
    profile: 'solid mid',
  },
  {
    ref: 'ex_imran',
    name: 'Imran Qureshi',
    role: 'sales_executive',
    mobile: '9810244513',
    email: 'imran.qureshi@vipsar-sim.test',
    office_location: 'Noida Showroom',
    coordinator_ref: 'sc_north',
    is_active: true,
    profile: 'mid — REASSIGNED between coordinators mid-period (exception 3)',
    coordinator_ref_initial: 'sc_south',
    coordinator_reassigned_on: '2026-06-01',
  },
  {
    ref: 'ex_ananya',
    name: 'Ananya Deshpande',
    role: 'sales_executive',
    mobile: '9810244514',
    email: 'ananya.deshpande@vipsar-sim.test',
    office_location: 'Gurugram Showroom',
    coordinator_ref: 'sc_south',
    is_active: true,
    profile: 'strong mid',
  },
  {
    ref: 'ex_karan',
    name: 'Karan Bhatia',
    role: 'sales_executive',
    mobile: '9810244515',
    email: 'karan.bhatia@vipsar-sim.test',
    office_location: 'Gurugram Showroom',
    coordinator_ref: 'sc_south',
    is_active: true,
    profile: 'clear underperformer — low volume, zero wins, heavy staleness',
  },
  {
    ref: 'ex_sunita',
    name: 'Sunita Rawat',
    role: 'sales_executive',
    mobile: '9810244516',
    email: 'sunita.rawat@vipsar-sim.test',
    office_location: 'Faridabad Showroom',
    coordinator_ref: 'sc_south',
    is_active: true,
    profile: 'mid',
  },
]

const EXECS = EMPLOYEES.filter((e) => e.role === 'sales_executive').map((e) => e.ref)
const scOf = (execRef) => EMPLOYEES.find((e) => e.ref === execRef).coordinator_ref

// Explicit per-exec outcome counts. Integers rather than rates so the totals
// are exact and the plan is auditable at a glance.
const EXEC_PLAN = {
  ex_rohit: { total: 38, won: 8, lost: 5, on_hold: 2, actLo: 5, actHi: 11 },
  ex_priya: { total: 27, won: 4, lost: 5, on_hold: 2, actLo: 4, actHi: 8 },
  ex_imran: { total: 22, won: 2, lost: 4, on_hold: 1, actLo: 3, actHi: 7 },
  ex_ananya: { total: 30, won: 5, lost: 5, on_hold: 2, actLo: 4, actHi: 9 },
  ex_karan: { total: 12, won: 0, lost: 4, on_hold: 1, actLo: 1, actHi: 4 },
  ex_sunita: { total: 21, won: 2, lost: 3, on_hold: 1, actLo: 3, actHi: 7 },
}

// ---------------------------------------------------------------------------
// Name pools — plausible Delhi-region residential and commercial customers
// ---------------------------------------------------------------------------
const FIRST = ['Rajesh','Sunil','Meera','Anil','Kavita','Deepak','Nisha','Sanjay','Pooja','Vivek','Ritu','Manoj','Shalini','Arun','Geeta','Harsh','Divya','Naveen','Swati','Ashok','Rekha','Gaurav','Anjali','Prakash','Lata','Vinod','Sneha','Rakesh','Bhavna','Yogesh','Tanya','Mukesh','Payal','Alok','Seema','Nitin','Charu','Sameer','Ruchi','Devendra','Aarti','Jatin','Madhu','Kunal','Preeti','Rohan','Shruti','Girish','Neetu','Varun']
const LAST = ['Aggarwal','Bhardwaj','Chopra','Dhawan','Gupta','Jain','Kapoor','Khanna','Malik','Mehra','Nagpal','Oberoi','Puri','Rastogi','Saxena','Sethi','Tandon','Verma','Wadhwa','Yadav','Bansal','Goel','Sood','Chadha','Grover','Bhatt','Mittal','Arora','Bakshi','Sachdeva']
const FIRM_WORDS = [
  'Studio Aangan','Aakriti Design Associates','Brick & Beam Architects','Nirman Consultants','Vastu Vista Architects',
  'Urban Nest Studio','Sthapati Design Works','Aravalli Architects','Grid Line Design','Trikon Associates',
]
const BUILDER_FIRMS = ['Shakti Buildcon','Rudra Infrastructure','Ansal Greens Projects','Elite Structures','Ridgeview Builders']
const PMC_FIRMS = ['Cornerstone PMC','Axis Project Managers','Benchmark PMC','Meridian Project Services']
const LOCALITIES = ['Block A','Block B','Block C','Block D','Pocket 4','Pocket 9','Sector Road','Main Market Lane','Green Avenue','Park View Lane','Ridge Enclave','Palm Grove','Sunrise Enclave','Central Park Lane']
const SITE_KIND = ['independent house','builder floor','villa','duplex','farmhouse plot','row house','penthouse','apartment renovation','showroom fit-out','clinic fit-out']

let mobileCounter = 9000100000
function newMobile() {
  mobileCounter += ri(7, 91)
  return String(mobileCounter)
}
function personName() {
  return `${pick(FIRST)} ${pick(LAST)}`
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------
const parties = []
const sites = []
const siteContacts = []
const leads = []
const stageHistory = []
const activities = []
const followUps = []
const targets = []
const lossReasons = []
const leadOwnerHistory = []
const execTouches = [] // post-insert UPDATEs that flip entered_by_role
const scEdits = [] // SC edits on still-unlocked records

let seq = 0
const nextRef = (p) => `${p}_${String(++seq).padStart(4, '0')}`

function addParty(o) {
  const ref = o.ref ?? `party_${String(parties.length + 1).padStart(4, '0')}`
  const row = {
    ref,
    party_type: o.party_type,
    name: o.name,
    mobile: o.mobile ?? null,
    address: o.address ?? null,
    city: o.city ?? null,
    area_ref: o.area_ref ?? null,
    firm_name: o.firm_name ?? null,
    relationship_status: o.relationship_status ?? null,
    verification_status: o.verification_status ?? 'unverified',
    notes: o.notes ?? null,
    created_by_ref: o.created_by_ref,
    created_at: o.created_at,
    authored_by: o.authored_by ?? o.created_by_ref,
  }
  parties.push(row)
  return row
}

// ---------------------------------------------------------------------------
// EXCEPTION 6 — parties sharing a mobile number (household / family / firm),
// which is exactly what the "no UNIQUE on parties.mobile" decision exists for.
// Three clusters, seven parties, three numbers.
// ---------------------------------------------------------------------------
const SHARED_MOBILES = [
  { mobile: '9811070301', label: 'father and son, same Greater Kailash property' },
  { mobile: '9811070302', label: 'husband and wife, joint Noida booking' },
  { mobile: '9811070303', label: 'architect and two colleagues on one firm landline' },
]
const sharedMobileAssignments = [] // filled while building client parties

// ---------------------------------------------------------------------------
// Non-client parties: architects, builders, PMCs, firms, others
// ---------------------------------------------------------------------------
const architectParties = []
const otherRoleParties = []

function seedSupportingParties() {
  const creators = shuffle([...EXECS, ...EXECS, 'sc_north', 'sc_south'])
  let ci = 0
  const nextCreator = () => creators[ci++ % creators.length]

  FIRM_WORDS.forEach((firm, i) => {
    const created = randomWorkingDay()
    const creator = nextCreator()
    // Cluster 3 of the shared-mobile exception lives here: three architects on
    // one firm landline.
    let mobile = newMobile()
    if (i === 0 || i === 1 || i === 2) mobile = SHARED_MOBILES[2].mobile
    const p = addParty({
      party_type: 'architect',
      name: personName(),
      mobile,
      firm_name: firm,
      city: pick(['New Delhi', 'Gurugram', 'Noida']),
      relationship_status: chance(0.5) ? 'permanent' : 'temporary',
      verification_status: chance(0.6) ? 'verified' : 'unverified',
      area_ref: pick(AREAS).ref,
      created_by_ref: creator,
      created_at: workTimestamp(created),
    })
    architectParties.push(p)
    if (i < 3) sharedMobileAssignments.push({ cluster: 3, party_ref: p.ref, mobile })
  })
  // A few more architects without the shared number
  for (let i = 0; i < 7; i++) {
    const created = randomWorkingDay()
    const p = addParty({
      party_type: 'architect',
      name: personName(),
      mobile: newMobile(),
      firm_name: pick(FIRM_WORDS),
      city: pick(['New Delhi', 'Gurugram', 'Noida']),
      relationship_status: chance(0.4) ? 'permanent' : 'temporary',
      area_ref: pick(AREAS).ref,
      created_by_ref: nextCreator(),
      created_at: workTimestamp(created),
    })
    architectParties.push(p)
  }
  BUILDER_FIRMS.forEach((firm) => {
    const created = randomWorkingDay()
    otherRoleParties.push(
      addParty({
        party_type: 'builder',
        name: personName(),
        mobile: newMobile(),
        firm_name: firm,
        city: pick(['New Delhi', 'Gurugram', 'Ghaziabad']),
        area_ref: pick(AREAS).ref,
        created_by_ref: nextCreator(),
        created_at: workTimestamp(created),
      })
    )
  })
  PMC_FIRMS.forEach((firm) => {
    const created = randomWorkingDay()
    otherRoleParties.push(
      addParty({
        party_type: 'pmc',
        name: personName(),
        mobile: newMobile(),
        firm_name: firm,
        city: pick(['New Delhi', 'Gurugram']),
        area_ref: pick(AREAS).ref,
        created_by_ref: nextCreator(),
        created_at: workTimestamp(created),
      })
    )
  })
  const COMMERCIAL_FIRMS = [
    { name: 'Saffron Hospitality Pvt Ltd', firm: 'Saffron Hospitality' },
    { name: 'Northline Retail Pvt Ltd', firm: 'Northline Retail' },
  ]
  for (let i = 0; i < COMMERCIAL_FIRMS.length; i++) {
    const created = randomWorkingDay()
    otherRoleParties.push(
      addParty({
        party_type: 'firm',
        name: COMMERCIAL_FIRMS[i].name,
        mobile: newMobile(),
        firm_name: COMMERCIAL_FIRMS[i].firm,
        city: 'New Delhi',
        area_ref: pick(AREAS).ref,
        created_by_ref: nextCreator(),
        created_at: workTimestamp(created),
      })
    )
  }
  for (let i = 0; i < 3; i++) {
    const created = randomWorkingDay()
    otherRoleParties.push(
      addParty({
        party_type: 'other',
        name: personName(),
        mobile: newMobile(),
        notes: 'Site caretaker contact',
        city: pick(['New Delhi', 'Noida']),
        created_by_ref: nextCreator(),
        created_at: workTimestamp(created),
      })
    )
  }
}
seedSupportingParties()

// ---------------------------------------------------------------------------
// Lead construction
// ---------------------------------------------------------------------------
const FUNNEL_STAGES = [
  'calling',
  'presentation',
  'joinery_follow_up',
  'measurements',
  'design_discussion',
  'rfq',
  'quote_submission',
  'negotiation',
]
const STAGE_INDEX = Object.fromEntries(FUNNEL_STAGES.map((s, i) => [s, i]))

// Weighted: scanning dominates (reps in the field), lixil is the second feed.
const SOURCE_POOL = [
  ...Array(38).fill('scanning'),
  ...Array(24).fill('lixil'),
  ...Array(18).fill('referral_architect'),
  ...Array(9).fill('referral_other'),
  ...Array(11).fill('showroom_walkin'),
]

const LOSS_REASON_POOL = [
  ...Array(9).fill('price'),
  ...Array(7).fill('competitor'),
  ...Array(4).fill('timeline'),
  ...Array(4).fill('budget_cut'),
  ...Array(3).fill('site_delay'),
  ...Array(2).fill('other'),
]
const COMPETITORS = ['Fenesta', 'Aluplast', 'Encraft', 'Local fabricator', 'Alumil']

// Build the flat list of lead "slots" with their final outcome, then decorate.
function buildLeadSlots() {
  const slots = []
  for (const execRef of EXECS) {
    const p = EXEC_PLAN[execRef]
    const openCount = p.total - p.won - p.lost - p.on_hold
    const outcomes = [
      ...Array(p.won).fill('won'),
      ...Array(p.lost).fill('lost'),
      ...Array(p.on_hold).fill('on_hold'),
      ...Array(openCount).fill('open'),
    ]
    for (const o of shuffle(outcomes)) slots.push({ execRef, outcome: o })
  }
  return shuffle(slots)
}

// Open leads get spread across the eight funnel stages, weighted so the top of
// the funnel is fuller than the bottom (the realistic shape).
const OPEN_STAGE_POOL = [
  ...Array(20).fill('calling'),
  ...Array(14).fill('presentation'),
  ...Array(10).fill('joinery_follow_up'),
  ...Array(12).fill('measurements'),
  ...Array(11).fill('design_discussion'),
  ...Array(10).fill('rfq'),
  ...Array(12).fill('quote_submission'),
  ...Array(8).fill('negotiation'),
]

const slots = buildLeadSlots()

// ---- freshness assignment (drives every attention/red-flag bucket) ---------
// Deliberate margins: nothing is placed within a day of a threshold, so the
// simulation still classifies the same way if the user demos a few days later.
//   fresh      : last touch 0-6 days ago   -> no bucket
//   cooling    : 9-12 days ago             -> "reads as stale" (7) but NOT queued (14)
//   stale      : 17-33 days ago            -> queued
//   very_stale : 38-95 days ago            -> queued, badly
const FRESHNESS_POOL = [
  ...Array(52).fill('fresh'),
  ...Array(6).fill('cooling'),
  ...Array(30).fill('stale'),
  ...Array(18).fill('very_stale'),
]
function freshnessAge(kind) {
  if (kind === 'fresh') return ri(0, 6)
  if (kind === 'cooling') return ri(9, 12)
  if (kind === 'stale') return ri(17, 33)
  return ri(38, 95)
}

// ---------------------------------------------------------------------------
// Site + party creation helpers for a lead
// ---------------------------------------------------------------------------
function makeSite(area, execRef, createdAt, discoveredVia, opts = {}) {
  const ref = `site_${String(sites.length + 1).padStart(4, '0')}`
  const row = {
    ref,
    area_ref: area.ref,
    house_no: `${pick(['A', 'B', 'C', 'D', 'E', ''])}${ri(1, 480)}`,
    locality: pick(LOCALITIES),
    pincode: String(ri(110001, 122018)),
    nickname: `${pick(SITE_KIND)} near ${pick(['the main market', 'the metro station', 'the community park', 'the temple', 'the school', 'the water tank', 'the DDA park'])}, ${area.area_name}`,
    plot_area_sqyds: pick([100, 150, 200, 250, 300, 350, 400, 500, 750, 1000]),
    site_stage: opts.site_stage ?? pick(['foundation', 'structure', 'finishing', 'completed', null]),
    primary_contact_party_ref: null,
    discovered_via: discoveredVia,
    discovered_by_ref: execRef,
    created_at: createdAt,
    authored_by: opts.authored_by ?? execRef,
  }
  sites.push(row)
  return row
}

// ---------------------------------------------------------------------------
// Which leads carry which exceptions. Chosen up front by index so the
// catalogue is deterministic and auditable rather than emergent.
// ---------------------------------------------------------------------------
const N_LEADS = slots.length // 150
const idxAll = [...Array(N_LEADS).keys()]
const shuffledIdx = shuffle(idxAll)

// Draws from a ROTATING cursor into the shuffled index list rather than
// restarting at the head each time. Without this every exception set is drawn
// from the same first few dozen leads, so they stack on top of each other
// instead of spreading across the population — the first build of this file
// put all six stage-skip leads inside the site-only set and all ten SC-entered
// leads inside the party-only set. `claimed` stops one lead soaking up several
// exceptions unless a caller explicitly allows it.
let takeCursor = 0
const claimed = new Set()
const take = (n, filterFn = () => true, { exclusive = true } = {}) => {
  const out = []
  for (let pass = 0; pass < 2 && out.length < n; pass++) {
    for (let k = 0; k < shuffledIdx.length && out.length < n; k++) {
      const i = shuffledIdx[(takeCursor + k) % shuffledIdx.length]
      if (out.includes(i)) continue
      if (exclusive && pass === 0 && claimed.has(i)) continue
      if (!filterFn(i)) continue
      out.push(i)
    }
  }
  takeCursor = (takeCursor + n * 3) % shuffledIdx.length
  if (exclusive) out.forEach((i) => claimed.add(i))
  return out
}

// Exception 1 — site-anchored only (no party). Only sensible for `scanning`.
const SITE_ONLY = new Set(take(12, (i) => slots[i].outcome === 'open' || slots[i].outcome === 'on_hold'))
// Exception 2 — party-anchored only (no site). Sensible for lixil/referral.
const PARTY_ONLY = new Set(take(22, (i) => !SITE_ONLY.has(i)))
// Exception 7 — created by an SC on behalf of the exec.
const SC_ENTERED = new Set(take(10, (i) => !SITE_ONLY.has(i)))
// ...of which these are later saved by the exec, flipping entered_by_role.
const SC_ENTERED_THEN_EXEC_TOUCHED = new Set([...SC_ENTERED].slice(0, 5))
// Exception 4 — lost, then reopened and progressed further.
const REOPENED = new Set(take(3, (i) => slots[i].outcome === 'open' && !SITE_ONLY.has(i)))
// Exception 11 — parked in one stage for an unusually long time.
const LONG_STALL = new Set(take(4, (i) => slots[i].outcome === 'open' && !REOPENED.has(i)))
// Exception 12 — stage progression that skips intermediate stages. Needs a
// lead that actually got deep enough for a skip to be visible.
const STAGE_SKIP = new Set(
  take(6, (i) => {
    const o = slots[i].outcome
    return o === 'won' || o === 'lost' || (o === 'open' && !SITE_ONLY.has(i))
  })
)
// NOTE: the open-lead-with-order_value anomaly and the silent-quote bucket are
// both selected in POST-PASSES after the main loop — they depend on facts
// (final stage, quote reached, last activity date) that do not exist yet here.
// Exception 3b — leads reassigned between execs ACROSS teams (writes
// lead_owner_history, unlike the coordinator reassignment which records
// nothing). Only a still-live deal makes narrative sense to hand over.
const CROSS_TEAM_REASSIGNED = take(
  2,
  (i) => slots[i].execRef === 'ex_karan' && (slots[i].outcome === 'open' || slots[i].outcome === 'on_hold')
)
// Exception 6 — the four leads whose client parties share a household number.
// Chosen explicitly from leads that HAVE a client party: the first build drew
// them by raw shuffled position, which landed on site-only leads with no party
// to attach a number to, so two of the three clusters silently never existed.
const SHARED_MOBILE_LEADS = take(4, (i) => !SITE_ONLY.has(i))

const freshnessPool = shuffle(FRESHNESS_POOL)
const openStagePool = shuffle(OPEN_STAGE_POOL)
const sourcePool = shuffle(SOURCE_POOL)
const lossPool = shuffle(LOSS_REASON_POOL)
let freshCursor = 0
let openStageCursor = 0
let sourceCursor = 0
let lossCursor = 0

// ---------------------------------------------------------------------------
// Build every lead
// ---------------------------------------------------------------------------
slots.forEach((slot, i) => {
  const leadRef = `lead_${String(i + 1).padStart(4, '0')}`
  const execRef = slot.execRef
  const isScEntered = SC_ENTERED.has(i)
  const authorRef = isScEntered ? scOf(execRef) : execRef

  // ---- source -------------------------------------------------------------
  let source = sourcePool[sourceCursor++ % sourcePool.length]
  if (SITE_ONLY.has(i)) source = 'scanning'
  if (PARTY_ONLY.has(i) && source === 'scanning') source = pick(['lixil', 'referral_architect', 'showroom_walkin'])

  // ---- created ------------------------------------------------------------
  // Older leads for deeper stages: a negotiation-stage deal did not start last
  // week. Windows and doors run multi-week to multi-month cycles.
  let createdDay = randomWorkingDay()
  let createdAt = workTimestamp(createdDay)

  // ---- final stage --------------------------------------------------------
  let finalStage
  if (slot.outcome === 'won') finalStage = 'won'
  else if (slot.outcome === 'lost') finalStage = 'lost'
  else if (slot.outcome === 'on_hold') finalStage = 'on_hold'
  else finalStage = openStagePool[openStageCursor++ % openStagePool.length]
  // Exception 4 needs a funnel deep enough for a lost-and-revived arc to be
  // visible partway along it. A lead still sitting at 'calling' has no path to
  // interrupt, and the reopen would have to be appended after the fact — which
  // is what produced stage rows running backwards in time.
  if (REOPENED.has(i) && slot.outcome === 'open') finalStage = pick(['quote_submission', 'negotiation'])

  // ---- the stage the funnel reached (for on_hold/won/lost, the pre-exit one)
  let reachedIdx
  if (finalStage === 'won') reachedIdx = STAGE_INDEX['negotiation']
  else if (finalStage === 'lost') reachedIdx = ri(1, 7)
  else if (finalStage === 'on_hold') reachedIdx = ri(1, 6)
  else reachedIdx = STAGE_INDEX[finalStage]

  // ---- freshness / last touch --------------------------------------------
  const isClosed = finalStage === 'won' || finalStage === 'lost'
  let lastTouchAge
  if (isClosed) {
    lastTouchAge = ri(3, 110)
  } else {
    let kind = freshnessPool[freshCursor++ % freshnessPool.length]
    // Karan's book is deliberately neglected — the underperformer signal.
    if (execRef === 'ex_karan' && kind === 'fresh' && chance(0.7)) kind = 'very_stale'
    if (LONG_STALL.has(i)) kind = 'very_stale'
    lastTouchAge = freshnessAge(kind)
  }
  let lastTouchDay = settleDayBack(daysBefore(lastTouchAge))
  if (lastTouchDay < createdDay) lastTouchDay = settleDay(createdDay)

  // Windows and doors are a multi-week to multi-month sale. createdDay and
  // lastTouchDay are drawn independently, so they can land days apart on a lead
  // that reached negotiation — producing eight funnel stages compressed into a
  // single afternoon, which is neither realistic nor a usable test of
  // days-in-stage. Require roughly a week per stage reached and pull the
  // creation date BACK to make room (moving lastTouchDay forward instead would
  // wreck the deliberate staleness bands).
  const minSpanDays = reachedIdx <= 1 ? 4 : reachedIdx * 7 + ri(0, 21)
  if (dayDiff(lastTouchDay, createdDay) < minSpanDays) {
    let pulled = addDays(lastTouchDay, -minSpanDays)
    if (pulled < START) pulled = START
    createdDay = settleDay(pulled)
    if (createdDay > lastTouchDay) createdDay = lastTouchDay
    createdAt = workTimestamp(createdDay)
  }

  // ---- parties / sites ----------------------------------------------------
  const area = pick(AREAS)
  let clientParty = null
  let site = null
  let otherParty = null
  let referredByRef = null

  if (!SITE_ONLY.has(i)) {
    let mobile = newMobile()
    // Exception 6 clusters 1 and 2 — two client parties on one number each.
    const smPos = SHARED_MOBILE_LEADS.indexOf(i)
    if (smPos === 0 || smPos === 1) {
      mobile = SHARED_MOBILES[0].mobile
      sharedMobileAssignments.push({ cluster: 1, lead_ref: leadRef, mobile })
    } else if (smPos === 2 || smPos === 3) {
      mobile = SHARED_MOBILES[1].mobile
      sharedMobileAssignments.push({ cluster: 2, lead_ref: leadRef, mobile })
    }
    clientParty = addParty({
      party_type: 'client',
      name: personName(),
      mobile,
      address: `${pick(['H.No.', 'Flat', 'Plot'])} ${ri(1, 320)}, ${pick(LOCALITIES)}`,
      city: area.city,
      area_ref: area.ref,
      verification_status: chance(0.45) ? 'verified' : 'unverified',
      created_by_ref: execRef,
      created_at: createdAt,
      authored_by: authorRef,
    })
  }

  if (!PARTY_ONLY.has(i)) {
    site = makeSite(area, execRef, createdAt, source, { authored_by: authorRef })
    if (clientParty) site.primary_contact_party_ref = clientParty.ref
  }

  // An "other" party for referral sources — architect for referral_architect.
  if (source === 'referral_architect') {
    otherParty = pick(architectParties)
    if (clientParty) referredByRef = otherParty.ref
  } else if (source === 'referral_other' && chance(0.8)) {
    otherParty = pick(otherRoleParties)
  }

  // ---- site_contacts ------------------------------------------------------
  if (site) {
    if (clientParty) {
      siteContacts.push({
        ref: nextRef('sc'),
        site_ref: site.ref,
        party_ref: clientParty.ref,
        role: 'owner',
        discovered_at: createdAt,
        authored_by: authorRef,
      })
    }
    if (otherParty && chance(0.7)) {
      siteContacts.push({
        ref: nextRef('sc'),
        site_ref: site.ref,
        party_ref: otherParty.ref,
        role: otherParty.party_type === 'architect' ? 'architect' : otherParty.party_type === 'builder' ? 'builder' : otherParty.party_type === 'pmc' ? 'project_manager' : 'other',
        discovered_at: workTimestampAfter(settleDay(addDays(createdDay, ri(2, 20))), createdAt),
        authored_by: authorRef,
      })
    }
    if (chance(0.18)) {
      const extra = pick(otherRoleParties)
      siteContacts.push({
        ref: nextRef('sc'),
        site_ref: site.ref,
        party_ref: extra.ref,
        role: 'site_staff',
        discovered_at: workTimestampAfter(settleDay(addDays(createdDay, ri(5, 40))), createdAt),
        authored_by: authorRef,
      })
    }
  }

  // ---- money + flags, consistent with how far the funnel got --------------
  const rfqReached = reachedIdx >= STAGE_INDEX['rfq'] || finalStage === 'won'
  const quoteReached = reachedIdx >= STAGE_INDEX['quote_submission'] || finalStage === 'won'

  const baseValue = pick([180000, 240000, 320000, 450000, 520000, 680000, 750000, 920000, 1150000, 1400000, 1850000, 2400000, 3100000])
  const quoteValue = quoteReached ? baseValue + ri(0, 40) * 1000 : null

  // Dates along the path
  const spanDays = Math.max(4, dayDiff(lastTouchDay, createdDay))
  const at = (frac) => {
    const d = settleDay(addDays(createdDay, Math.round(spanDays * frac)))
    return d > lastTouchDay ? lastTouchDay : d
  }

  // ---- stage path and its dates ------------------------------------------
  // Computed BEFORE the date columns below, because rfq_raised_at and
  // quote_sent_at are derived FROM this timeline. Generating them independently
  // (at fixed 0.55 / 0.75 fractions) let a lead show an RFQ raised weeks after
  // the stage history said the quote had already gone out — the sort of
  // internal contradiction that reads as a CRM bug during reconciliation.
  //
  // stage_history logs the DESTINATION of an explicit change only. A lead
  // sitting at its 'calling' default has zero rows — that is correct, and is
  // exactly the gap SalesFunnelCard works around.
  // A coordinator may only write stage history for their OWN team. For a lead
  // that later moves across teams, "own team" depends on whether the seeder has
  // already run the reassignment — a hidden ordering dependency. Authoring
  // those as the owner removes it: the owner can write any lead's history at
  // any point in the sequence.
  const stageAuthor =
    CROSS_TEAM_REASSIGNED.includes(i) || chance(0.55) ? 'emp_owner' : scOf(execRef)
  const path = []
  if (STAGE_SKIP.has(i)) {
    // Skip intermediate stages — permitted, nothing enforces sequence.
    const jump = Math.max(1, Math.min(reachedIdx, ri(3, 6)))
    if (reachedIdx >= 1) path.push(FUNNEL_STAGES[jump])
    if (reachedIdx > jump) path.push(FUNNEL_STAGES[reachedIdx])
  } else {
    for (let s = 1; s <= reachedIdx; s++) path.push(FUNNEL_STAGES[s])
  }

  const stageDates = []
  const nSteps = path.length + (finalStage === 'won' || finalStage === 'lost' || finalStage === 'on_hold' ? 1 : 0)
  for (let k = 0; k < nSteps; k++) {
    const frac = nSteps === 1 ? 0.8 : (k + 1) / (nSteps + 0.35)
    stageDates.push(at(frac))
  }
  // settleDay() jitters each date independently by up to three days, which can
  // invert two adjacent steps — producing a lead whose RFQ is dated a day after
  // the quote it produced. A funnel must only ever move forward in time.
  for (let k = 1; k < stageDates.length; k++) {
    if (stageDates[k] < stageDates[k - 1]) stageDates[k] = stageDates[k - 1]
  }

  // Date of a given stage in this lead's own path, if it appears there.
  const dateOfStage = (stage) => {
    const k = path.indexOf(stage)
    return k === -1 ? null : stageDates[k]
  }
  const quoteStageDay = dateOfStage('quote_submission')
  const rfqStageDay = dateOfStage('rfq')

  // quote_sent_at: the day the quote_submission stage was reached, when that
  // stage is in the path. A skipped/won path that never logged it falls back to
  // a fraction of the timeline.
  const quoteSentDay = quoteReached ? (quoteStageDay ?? at(0.75)) : null
  // rfq_raised_at: the rfq stage day when present; otherwise it must still
  // precede the quote, so it is anchored a week or two BEFORE the quote day
  // rather than at an unrelated fraction.
  let rfqRaisedDay = null
  if (rfqReached) {
    if (rfqStageDay) rfqRaisedDay = rfqStageDay
    else if (quoteSentDay) {
      rfqRaisedDay = settleDayBack(addDays(quoteSentDay, -ri(5, 18)))
      if (rfqRaisedDay < createdDay) rfqRaisedDay = settleDay(createdDay)
    } else rfqRaisedDay = at(0.55)
  }
  const rfqRaisedAt = rfqRaisedDay ? isoDate(rfqRaisedDay) : null
  const quoteSentAt = quoteSentDay ? isoDate(quoteSentDay) : null

  let orderValue = null
  if (finalStage === 'won') orderValue = Math.round((quoteValue ?? baseValue) * (0.86 + rnd() * 0.16))
  // NOTE: the open-lead-with-order_value anomaly is applied in a POST-PASS
  // below, not here. Choosing those leads up front picked them before their
  // stage was assigned, so most turned out never to have reached a quote and
  // got no order_value at all — 1 of the intended 3 survived.

  const closureProbability = quoteReached
    ? pick([30, 40, 50, 60, 70, 80])
    : reachedIdx >= STAGE_INDEX['design_discussion'] && chance(0.5)
      ? pick([20, 30, 40])
      : null

  // estimated_close_date — some in the past on still-open leads (the "slipped"
  // bucket), some ahead (the closure forecast).
  let estimatedCloseDate = null
  if (closureProbability != null || quoteReached) {
    const slip = !isClosed && chance(0.42)
    estimatedCloseDate = slip
      ? isoDate(daysBefore(ri(6, 55)))
      : isoDate(addDays(REF, ri(4, 120)))
  }

  // next_followup_date — some overdue on open leads (the "follow-ups overdue"
  // bucket, which reads leads.next_followup_date, NOT the follow_ups table).
  // Kept to roughly a fifth of open leads: at 0.34 it swallowed 41 of 103 open
  // leads, which makes the bucket the loudest thing on the dashboard and
  // crowds out the signal the other four buckets carry.
  let nextFollowupDate = null
  if (!isClosed) {
    if (chance(0.2)) nextFollowupDate = isoDate(daysBefore(ri(4, 40))) // overdue
    else if (chance(0.5)) nextFollowupDate = isoDate(addDays(REF, ri(1, 45)))
  }

  const productRef = chance(0.82) ? pick(PRODUCTS).ref : null

  const lead = {
    ref: leadRef,
    site_ref: site ? site.ref : null,
    party_ref: clientParty ? clientParty.ref : null,
    product_ref: productRef,
    owner_employee_ref: execRef,
    source_type: source,
    referred_by_party_ref: referredByRef,
    other_party_ref: otherParty ? otherParty.ref : null,
    external_reference_id: source === 'lixil' ? `LX-2026-${String(ri(10000, 99999))}` : null,
    lead_generated_at: isoDate(createdDay),
    current_stage: finalStage,
    rfq_raised: rfqReached,
    rfq_raised_at: rfqRaisedAt,
    quote_sent: quoteReached,
    quote_sent_at: quoteSentAt,
    quote_value: quoteValue,
    order_value: orderValue,
    closure_probability: closureProbability,
    estimated_close_date: estimatedCloseDate,
    next_followup_date: nextFollowupDate,
    created_at: createdAt,
    // --- seeding directives -------------------------------------------------
    authored_by: authorRef,
    expected_entered_by_role: isScEntered
      ? SC_ENTERED_THEN_EXEC_TOUCHED.has(i)
        ? 'sales_executive'
        : null
      : 'sales_executive',
    expected_created_by_employee_ref: authorRef,
    exceptions: [
      SITE_ONLY.has(i) ? 'ex1_site_anchored_only' : null,
      PARTY_ONLY.has(i) ? 'ex2_party_anchored_only' : null,
      REOPENED.has(i) ? 'ex4_lost_then_reopened' : null,
      finalStage === 'won' ? 'ex5_won' : null,
      isScEntered ? 'ex7_sc_entered_on_behalf' : null,
      SC_ENTERED_THEN_EXEC_TOUCHED.has(i) ? 'ex7b_exec_took_over_locked' : null,
      LONG_STALL.has(i) ? 'ex11_long_stall_in_stage' : null,
      STAGE_SKIP.has(i) ? 'ex12_stage_skip' : null,
      // anomaly_open_lead_with_order_value and bucket_silent_quote are tagged
      // by the post-passes, which is the only place that knows whether the
      // lead actually qualifies. Tagging here as well left 3 leads carrying
      // the anomaly label with no order_value on them.
      CROSS_TEAM_REASSIGNED.includes(i) ? 'ex3b_lead_reassigned_across_teams' : null,
    ].filter(Boolean),
  }
  leads.push(lead)

  // ---- stage_history rows (path + dates were computed above) --------------
  // Each row is chained after the PREVIOUS stage's timestamp, not merely after
  // the lead's creation. Clamping only the dates still left two same-day steps
  // with independent random clock times, so a lead could show negotiation at
  // 10:48 and the quote_submission that preceded it at 11:50.
  //
  // EXCEPTION 4 (lost then reopened) is woven INTO this loop rather than
  // appended after it. The deal is declared lost partway along the funnel and
  // revived, so the 'lost' row belongs chronologically between two funnel
  // steps. Appending it afterwards left three leads whose stage history ran
  // backwards in time.
  const reopenCut = REOPENED.has(i) && path.length >= 3 ? Math.max(1, Math.floor(path.length / 2)) : -1
  let reopenLostTs = null
  let quoteEmittedTs = null
  let rfqEmittedTs = null
  let prevStageTs = createdAt
  path.forEach((stage, k) => {
    if (k === reopenCut) {
      const lostTs = workTimestampAfter(stageDates[k - 1], prevStageTs)
      prevStageTs = lostTs
      reopenLostTs = lostTs
      stageHistory.push({
        ref: nextRef('sh'),
        lead_ref: leadRef,
        stage: 'lost',
        changed_by_ref: stageAuthor,
        changed_at: lostTs,
        authored_by: stageAuthor,
        note: 'exception 4 — declared lost here, later reopened and progressed',
      })
    }
    const changedAt = workTimestampAfter(stageDates[k], prevStageTs)
    prevStageTs = changedAt
    if (stage === 'quote_submission') quoteEmittedTs = changedAt
    if (stage === 'rfq') rfqEmittedTs = changedAt
    stageHistory.push({
      ref: nextRef('sh'),
      lead_ref: leadRef,
      stage,
      changed_by_ref: stageAuthor,
      changed_at: changedAt,
      authored_by: stageAuthor,
      ...(reopenCut !== -1 && k === reopenCut
        ? { note: 'exception 4 — reopened at this stage after having been lost' }
        : {}),
    })
  })
  // Re-derive the date columns from the timestamps ACTUALLY emitted. Chaining
  // each step after the previous one can nudge a stage past midnight, which
  // would leave quote_sent_at a day adrift of the stage change it records.
  if (quoteEmittedTs) lead.quote_sent_at = istDateOf(quoteEmittedTs)
  if (rfqEmittedTs) lead.rfq_raised_at = istDateOf(rfqEmittedTs)
  if (reopenLostTs) {
    // The loss reason is append-only and is NOT removed when the lead is
    // reopened — mirroring exactly what the app does, since nothing deletes it.
    lossReasons.push({
      ref: nextRef('loss'),
      lead_ref: leadRef,
      reason: 'budget_cut',
      competitor_name: null,
      lost_at: reopenLostTs.slice(0, 10),
      authored_by: stageAuthor,
      note: 'exception 4 — the lead was subsequently reopened; this row survives, so LossReasonsCard keeps counting it',
    })
  }

  let wonAt = null
  if (finalStage === 'won' || finalStage === 'lost' || finalStage === 'on_hold') {
    const exitDay = stageDates[stageDates.length - 1] ?? lastTouchDay
    const ts = workTimestampAfter(exitDay, prevStageTs)
    stageHistory.push({
      ref: nextRef('sh'),
      lead_ref: leadRef,
      stage: finalStage,
      changed_by_ref: stageAuthor,
      changed_at: ts,
      authored_by: stageAuthor,
    })
    if (finalStage === 'won') wonAt = ts
    if (finalStage === 'lost') {
      lossReasons.push({
        ref: nextRef('loss'),
        lead_ref: leadRef,
        reason: lossPool[lossCursor++ % lossPool.length],
        competitor_name: null, // filled just below when reason is 'competitor'
        lost_at: isoDate(exitDay),
        authored_by: stageAuthor,
      })
      const lr = lossReasons[lossReasons.length - 1]
      if (lr.reason === 'competitor') lr.competitor_name = pick(COMPETITORS)
    }
  }

  // (EXCEPTION 4 is emitted inline in the stage loop above, in chronological
  // order — see the reopenCut comment there.)

  // ---- activities ---------------------------------------------------------
  const p = EXEC_PLAN[execRef]
  let nAct = ri(p.actLo, p.actHi)
  if (reachedIdx >= 5) nAct += ri(1, 3)
  if (finalStage === 'won') nAct += ri(1, 3)
  if (SITE_ONLY.has(i)) nAct = Math.max(1, nAct - 2)

  const actDays = []
  for (let k = 0; k < nAct; k++) {
    const frac = nAct === 1 ? 0.5 : k / (nAct - 1)
    // Genuine gaps: jitter each touch by up to a fortnight rather than an even
    // cadence, which is what a long sales cycle actually looks like.
    let d = settleDay(addDays(createdDay, Math.round(spanDays * frac) + ri(-3, 6)))
    if (d < createdDay) d = settleDay(createdDay)
    if (d > lastTouchDay) d = lastTouchDay
    actDays.push(d)
  }
  actDays.sort((a, b) => a - b)
  // Guarantee the final touch lands exactly on lastTouchDay — the staleness
  // buckets are computed off this.
  if (actDays.length) actDays[actDays.length - 1] = lastTouchDay

  actDays.forEach((day, k) => {
    const frac = actDays.length === 1 ? 0.5 : k / (actDays.length - 1)
    let type
    if (frac < 0.2) type = chance(0.72) ? 'call' : 'site_visit'
    else if (frac < 0.55) type = chance(0.55) ? 'site_visit' : 'call'
    else if (frac < 0.75) type = rfqReached && chance(0.4) ? 'rfq_raised' : chance(0.5) ? 'site_visit' : 'call'
    else type = finalStage === 'won' && k === actDays.length - 1 ? 'booking_update' : chance(0.45) ? 'call' : 'site_visit'

    // SC-logged subset: the SC takes a phone call and logs it against the exec.
    const scLogs = isScEntered && k < 2
    activities.push({
      ref: nextRef('act'),
      employee_ref: execRef, // who it is CREDITED to
      party_ref: null,
      lead_ref: leadRef,
      activity_type: type,
      accompanied_by_ref:
        type === 'site_visit' && chance(0.12) ? pick(EXECS.filter((e) => e !== execRef)) : null,
      notes: null,
      leads_generated: null,
      created_at: workTimestampAfter(day, createdAt),
      authored_by: scLogs ? scOf(execRef) : execRef, // who LOGS it
      expected_logged_by_employee_ref: scLogs ? scOf(execRef) : execRef,
      expected_entered_by_role: scLogs ? null : 'sales_executive',
    })
  })

  // ---- EXCEPTION 7b: the exec takes over an SC-entered lead ---------------
  if (SC_ENTERED_THEN_EXEC_TOUCHED.has(i)) {
    execTouches.push({
      ref: nextRef('touch'),
      lead_ref: leadRef,
      authored_by: execRef,
      patch: { closure_probability: closureProbability ?? 35 },
      purpose:
        'Exec saves the SC-entered lead. stamp_entered_by_role() flips leads.entered_by_role to sales_executive, dropping the SC to view-only on every column except current_stage / next_followup_date / order_value.',
      expected_after: { entered_by_role: 'sales_executive' },
    })
  }

  // ---- EXCEPTION 7a: the SC edits a lead the exec has NOT yet touched -----
  // Applied to EVERY still-unlocked SC-entered lead rather than a random
  // subset: at chance(0.6) a PRNG shift left only one, which is too thin to
  // test the "SC may still correct its own entry" half of the lock.
  if (isScEntered && !SC_ENTERED_THEN_EXEC_TOUCHED.has(i)) {
    scEdits.push({
      ref: nextRef('scedit'),
      lead_ref: leadRef,
      authored_by: scOf(execRef),
      patch: { next_followup_date: isoDate(addDays(REF, ri(3, 20))) },
      purpose: 'SC corrects an entry that is still unlocked (entered_by_role IS NULL). Must succeed.',
      expected_after: { entered_by_role: null },
    })
  }

  lead._won_at = wonAt
  lead._last_touch_date = isoDate(lastTouchDay)
})

// ===========================================================================
// POST-PASSES — decisions that can only be made once every lead has its final
// stage, values and activity timeline. Selecting these up front picks leads
// before the facts they depend on exist.
// ===========================================================================

// --- The open-lead-with-order_value anomaly (needs a lead that reached quote)
const anomalyCandidates = leads.filter(
  (l) => !['won', 'lost'].includes(l.current_stage) && l.quote_sent && l.order_value == null
)
shuffle(anomalyCandidates)
  .slice(0, 3)
  .forEach((l) => {
    // The real process gap CLAUDE.md flags: a Booking Update was logged with a
    // value, but nobody flipped the stage to won. dealValueFor() must IGNORE
    // this order_value and report quote_value, because the lead is still open.
    l.order_value = Math.round(Number(l.quote_value) * 0.9)
    l.exceptions.push('anomaly_open_lead_with_order_value')
  })

// --- The "quote sent, nothing logged since" bucket -------------------------
// Every lead's final activity was pinned to its last-touch day, and the quote
// date was always derived at 75% of the timeline — so an activity ALWAYS
// landed on or after the quote and the silent-quotes bucket came out empty.
// Fix the real-world way round: for a subset, the quote went out by email
// AFTER the last logged touch and nothing was recorded since.
const lastActByLeadRef = new Map()
activities.forEach((a) => {
  if (!a.lead_ref) return
  const t = new Date(`${a.created_at}Z`).getTime()
  if (!lastActByLeadRef.has(a.lead_ref) || t > lastActByLeadRef.get(a.lead_ref)) {
    lastActByLeadRef.set(a.lead_ref, t)
  }
})
const silentCandidates = leads.filter((l) => {
  if (['won', 'lost'].includes(l.current_stage)) return false
  if (!l.quote_sent) return false
  const last = lastActByLeadRef.get(l.ref)
  if (!last) return false
  // Needs enough runway that quote_sent_at can sit after the last touch and
  // still be >= SILENT_QUOTE_DAYS (5) in the past.
  return Math.floor((REF.getTime() - last) / MS_DAY) >= 12
})
const silentPicked = shuffle(silentCandidates).slice(0, 11)
silentPicked.forEach((l) => {
  const lastMs = lastActByLeadRef.get(l.ref)
  const lastDay = d0(new Date(lastMs).toISOString().slice(0, 10))
  let qDay = settleDay(addDays(lastDay, ri(1, 4)))
  const maxDay = daysBefore(6) // keep it comfortably past the 5-day threshold
  if (qDay > maxDay) qDay = settleDayBack(maxDay)
  l.quote_sent_at = isoDate(qDay)
  l.exceptions.push('bucket_silent_quote')
})

// ---------------------------------------------------------------------------
// EXCEPTION 3b — cross-team lead reassignment (writes lead_owner_history)
// ---------------------------------------------------------------------------
const REASSIGN_DATE = '2026-06-20'
CROSS_TEAM_REASSIGNED.forEach((idx) => {
  const lead = leads[idx]
  const oldOwner = lead.owner_employee_ref
  const newOwner = 'ex_rohit' // Karan's stalled deals handed to the strong performer
  // owner_employee_ref is the FINAL owner; original_owner_employee_ref is who
  // held it at insert time. The seeder MUST insert as the original owner (an
  // exec can only insert a lead they own — RLS WITH CHECK) and only then have
  // the owner perform the reassignment UPDATE. authored_by therefore stays the
  // original exec on purpose.
  lead.original_owner_employee_ref = oldOwner
  lead.owner_employee_ref = newOwner
  lead.reassignment = {
    from: oldOwner,
    to: newOwner,
    on: REASSIGN_DATE,
    seed_as: 'insert with original_owner_employee_ref, then UPDATE as emp_owner',
  }
  lead.exceptions.push('ex3b_reassigned_from_' + oldOwner)
  leadOwnerHistory.push({
    ref: nextRef('loh'),
    lead_ref: lead.ref,
    old_owner_ref: oldOwner,
    new_owner_ref: newOwner,
    changed_by_ref: 'emp_owner',
    changed_at: workTimestamp(d0(REASSIGN_DATE)),
    authored_by: 'emp_owner',
    note: 'Cross-team reassignment: SC-South exec -> SC-North exec. Activities logged before this date keep employee_id = the original exec, so activity credit and lead credit deliberately diverge. The ledger must decide which side each metric falls on.',
  })
})

// ---------------------------------------------------------------------------
// Standalone activities: office days and architect meetings
// ---------------------------------------------------------------------------
// office_day — the one activity type with no anchor at all.
EXECS.forEach((execRef) => {
  const weeks = 26
  for (let w = 0; w < weeks; w++) {
    if (!chance(execRef === 'ex_karan' ? 0.45 : 0.72)) continue
    let day = addDays(START, w * 7 + ri(0, 5))
    if (day > REF) continue
    day = nextWorkingDay(day)
    if (day > REF) continue
    activities.push({
      ref: nextRef('act'),
      employee_ref: execRef,
      party_ref: null,
      lead_ref: null,
      activity_type: 'office_day',
      accompanied_by_ref: null,
      notes: 'Office day — follow-up calls and paperwork.',
      leads_generated: ri(0, 4),
      created_at: workTimestamp(day),
      authored_by: execRef,
      expected_logged_by_employee_ref: execRef,
      expected_entered_by_role: 'sales_executive',
    })
  }
})

// architect_meeting — anchored on a PARTY, never a lead. Targetable metric.
EXECS.forEach((execRef) => {
  const n = execRef === 'ex_karan' ? ri(1, 3) : ri(4, 9)
  for (let k = 0; k < n; k++) {
    const day = randomWorkingDay()
    activities.push({
      ref: nextRef('act'),
      employee_ref: execRef,
      party_ref: pick(architectParties).ref,
      lead_ref: null,
      activity_type: 'architect_meeting',
      accompanied_by_ref: null,
      notes: 'Catalogue walkthrough and specification discussion.',
      leads_generated: null,
      created_at: workTimestamp(day),
      authored_by: execRef,
      expected_logged_by_employee_ref: execRef,
      expected_entered_by_role: 'sales_executive',
    })
  }
})

// ---------------------------------------------------------------------------
// FOLLOW-UPS (exception 8) — the real reminder table. NOT `plans`.
// ---------------------------------------------------------------------------
const FU_TITLES = [
  'Call back about the quote',
  'Share revised drawing',
  'Confirm measurement slot',
  'Send hardware options',
  'Collect advance cheque',
  'Site visit with the architect',
  'Follow up on the RFQ',
  'Reconfirm delivery timeline',
  'Discuss glass specification',
  'Chase pending approval',
]

const openLeads = leads.filter((l) => !['won', 'lost'].includes(l.current_stage))

// A follow-up is created BEFORE its due date, never at a fixed offset from
// today. Anchoring created_at to "a few days ago" while due_date sat months
// back produced 34 reminders completed before they existed.
function createdBeforeDue(dueDateStr) {
  let d = settleDayBack(addDays(d0(dueDateStr), -ri(2, 18)))
  if (d < START) d = settleDay(START)
  return workTimestamp(d)
}

function addFollowUp(o) {
  followUps.push({
    ref: nextRef('fu'),
    assigned_to_ref: o.assigned_to_ref,
    created_by_ref: o.created_by_ref,
    party_ref: o.party_ref ?? null,
    lead_ref: o.lead_ref ?? null,
    activity_type: o.activity_type ?? 'call',
    title: o.title,
    notes: o.notes ?? null,
    due_date: o.due_date,
    due_time: o.due_time ?? null,
    is_done: o.is_done,
    done_at: o.done_at ?? null,
    notified_at: null,
    created_at: o.created_at,
    authored_by: o.created_by_ref,
    category: o.category,
  })
}

// Personal reminders an exec sets for themselves.
const personalPool = shuffle(openLeads).slice(0, 46)
personalPool.forEach((lead, k) => {
  const execRef = lead.owner_employee_ref
  let category, dueDate, isDone, doneAt
  const m = k % 10
  if (m <= 3) {
    // done, on time
    category = 'done_on_time'
    const due = daysBefore(ri(8, 70))
    dueDate = isoDate(due)
    isDone = true
    doneAt = workTimestamp(prevWorkingDay(due))
  } else if (m === 4) {
    category = 'done_late'
    const due = daysBefore(ri(20, 60))
    dueDate = isoDate(due)
    isDone = true
    doneAt = workTimestamp(nextWorkingDay(addDays(due, ri(3, 9))))
  } else if (m <= 6) {
    category = 'missed_overdue' // due in the past, still not done
    dueDate = isoDate(daysBefore(ri(5, 45)))
    isDone = false
    doneAt = null
  } else if (m === 7) {
    category = 'due_today'
    dueDate = REFERENCE_DATE
    isDone = false
    doneAt = null
  } else if (m === 8) {
    category = 'due_tomorrow'
    dueDate = isoDate(addDays(REF, 1))
    isDone = false
    doneAt = null
  } else {
    category = 'future'
    dueDate = isoDate(addDays(REF, ri(3, 30)))
    isDone = false
    doneAt = null
  }
  addFollowUp({
    assigned_to_ref: execRef,
    created_by_ref: execRef,
    party_ref: lead.party_ref,
    lead_ref: lead.ref,
    activity_type: pick(['call', 'site_visit', 'rfq_raised', 'other']),
    title: pick(FU_TITLES),
    notes: null,
    due_date: dueDate,
    due_time: chance(0.5) ? pick(['10:00:00', '11:30:00', '15:00:00', '16:30:00']) : null,
    is_done: isDone,
    done_at: doneAt,
    created_at: createdBeforeDue(dueDate),
    category,
  })
})

// SC-ASSIGNED reminders: created_by = the SC, assigned_to = the exec.
// This is the assignment feature the Phase 8 spec nearly routed through `plans`.
const scPool = shuffle(openLeads).slice(0, 28)
scPool.forEach((lead, k) => {
  const execRef = lead.owner_employee_ref
  const scRef = scOf(execRef)
  let category, dueDate, isDone, doneAt
  const m = k % 7
  if (m <= 1) {
    category = 'sc_assigned_done_on_time'
    const due = daysBefore(ri(10, 55))
    dueDate = isoDate(due)
    isDone = true
    doneAt = workTimestamp(prevWorkingDay(due))
  } else if (m === 2) {
    category = 'sc_assigned_done_late'
    const due = daysBefore(ri(18, 50))
    dueDate = isoDate(due)
    isDone = true
    doneAt = workTimestamp(nextWorkingDay(addDays(due, ri(4, 11))))
  } else if (m <= 4) {
    category = 'sc_assigned_missed' // RED FLAG: past due, not done
    dueDate = isoDate(daysBefore(ri(6, 38)))
    isDone = false
    doneAt = null
  } else if (m === 5) {
    category = 'sc_assigned_due_today'
    dueDate = REFERENCE_DATE
    isDone = false
    doneAt = null
  } else {
    category = 'sc_assigned_future'
    dueDate = isoDate(addDays(REF, ri(2, 21)))
    isDone = false
    doneAt = null
  }
  addFollowUp({
    assigned_to_ref: execRef,
    created_by_ref: scRef,
    party_ref: lead.party_ref,
    lead_ref: lead.ref,
    activity_type: pick(['call', 'site_visit', 'other']),
    title: pick(FU_TITLES),
    notes: 'Assigned by coordinator.',
    due_date: dueDate,
    due_time: chance(0.4) ? pick(['09:30:00', '12:00:00', '17:00:00']) : null,
    is_done: isDone,
    done_at: doneAt,
    created_at: createdBeforeDue(dueDate),
    category,
  })
})

// A couple of owner-assigned ones too, so "Assigned by" is exercised for the
// owner path and not only the SC path.
shuffle(openLeads)
  .slice(0, 4)
  .forEach((lead) => {
    const fuDue = isoDate(addDays(REF, ri(1, 10)))
    addFollowUp({
      assigned_to_ref: lead.owner_employee_ref,
      created_by_ref: 'emp_owner',
      party_ref: lead.party_ref,
      lead_ref: lead.ref,
      activity_type: 'call',
      title: 'Owner review — update me on this deal',
      notes: null,
      due_date: fuDue,
      due_time: null,
      is_done: false,
      done_at: null,
      created_at: createdBeforeDue(fuDue),
      category: 'owner_assigned_future',
    })
  })

// ---------------------------------------------------------------------------
// TARGETS (exception 10) — deliberately spanning week / month / quarter so the
// same activity counts toward several overlapping period attributions.
// ---------------------------------------------------------------------------
const MONTHS = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']
const QUARTERS = ['2026-Q1', '2026-Q2', '2026-Q3']

// ISO week strings for the last five complete-ish weeks before the reference.
function isoWeekValue(dt) {
  const d = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}
const RECENT_WEEKS = [0, 1, 2, 3].map((n) => isoWeekValue(daysBefore(n * 7)))

const ORDER_TARGET_BY_EXEC = {
  ex_rohit: 2600000,
  ex_priya: 1800000,
  ex_imran: 1500000,
  ex_ananya: 2200000,
  ex_karan: 1500000,
  ex_sunita: 1600000,
}

function addTarget(execRef, periodType, periodValue, metric, value) {
  targets.push({
    ref: nextRef('tgt'),
    employee_ref: execRef,
    period_type: periodType,
    period_value: periodValue,
    metric_name: metric,
    target_value: value,
    authored_by: 'emp_owner',
  })
}

EXECS.forEach((execRef) => {
  // Monthly order_value for all six months
  MONTHS.forEach((m) => addTarget(execRef, 'month', m, 'order_value', ORDER_TARGET_BY_EXEC[execRef]))
  // Monthly activity targets for the last three months only
  ;['2026-06', '2026-07', '2026-08'].forEach((m) => {
    addTarget(execRef, 'month', m, 'site_visit', ri(14, 22))
    // DELIBERATE GAP: Karan has no August `call` target, so the dashboard must
    // render "no target set" rather than treating it as a zero.
    if (!(execRef === 'ex_karan' && m === '2026-08')) {
      addTarget(execRef, 'month', m, 'call', ri(30, 48))
    }
  })
  // Quarterly order_value — Q2 full, Q3 partial, Q1 straddles the window start
  QUARTERS.forEach((q) =>
    addTarget(execRef, 'quarter', q, 'order_value', ORDER_TARGET_BY_EXEC[execRef] * 3)
  )
})

// Weekly site_visit targets for four execs only (two have none — another
// "no target set" path, and it keeps the week view from looking uniform).
;['ex_rohit', 'ex_priya', 'ex_ananya', 'ex_karan'].forEach((execRef) => {
  RECENT_WEEKS.forEach((w) => addTarget(execRef, 'week', w, 'site_visit', ri(3, 6)))
})

// A monthly rfq_raised target for three execs in July only
;['ex_rohit', 'ex_ananya', 'ex_sunita'].forEach((execRef) =>
  addTarget(execRef, 'month', '2026-07', 'rfq_raised', ri(4, 9))
)

// won_count (Bookings) for the current month, all six
EXECS.forEach((execRef) => addTarget(execRef, 'month', '2026-08', 'won_count', ri(1, 3)))

// architect_meeting monthly target for the current month
EXECS.forEach((execRef) => addTarget(execRef, 'month', '2026-08', 'architect_meeting', ri(2, 4)))

// ---------------------------------------------------------------------------
// lead_change_log: cannot be backdated through the app (AFTER trigger stamps
// now()). Record the intended timestamps so Phase 2 can correct them via SQL.
// ---------------------------------------------------------------------------
const leadChangeLogCorrections = leads.flatMap((l) => {
  const rows = [{ lead_ref: l.ref, field: 'created', intended_changed_at: l.created_at }]
  if (l.quote_value != null && l.quote_sent_at) {
    rows.push({ lead_ref: l.ref, field: 'quote_value', intended_changed_at: workTimestamp(d0(l.quote_sent_at)) })
  }
  if (l.order_value != null && l._won_at) {
    rows.push({ lead_ref: l.ref, field: 'order_value', intended_changed_at: l._won_at })
  }
  return rows
})

// Strip internal helper fields before emitting.
// _last_touch_date goes too: "days since last activity" is one of the derived
// figures Phase 6 is required to compute FROM the activity rows. Shipping it
// precomputed would hand the Auditor an answer it is supposed to derive.
leads.forEach((l) => {
  delete l._won_at
  delete l._last_touch_date
})

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------
const plan = {
  _readme:
    'PHASE 9 SIMULATION PLAN — the single source of truth for Phase 2 (Seeder) and Phase 6 (Auditor). The Auditor computes expected_ledger.json from THIS FILE ALONE, without querying the database. Every row is explicit. No business aggregate is precomputed here; plan_summary carries table row counts only.',
  meta: {
    generated_by: 'phase9/generate_plan.mjs',
    prng_seed: SEED,
    deterministic: true,
    reference_date: REFERENCE_DATE,
    window_start: WINDOW_START,
    window_days: dayDiff(REF, START),
    supabase_project_ref: 'xbwgubovgrzbndjvwipv',
    branch: 'phase9-audit',
  },

  conventions: {
    refs:
      'Every row carries a `ref` (e.g. "lead_0042"). Real integer primary keys are assigned by Postgres at insert time; Phase 2 records the ref -> id mapping in seed_manifest.json. All cross-row links in this file use *_ref, never an id.',
    authored_by:
      'The employee ref whose AUTHENTICATED SESSION must perform the insert. This is load-bearing, not metadata: RLS scoping, leads/activities.entered_by_role (the SC edit lock) and activities.logged_by_employee_id are all derived by triggers from who writes the row. Seeding as the wrong identity silently produces different data.',
    timestamps:
      'All *_at values are naive UTC wall clock, matching this schema TIMESTAMP-without-time-zone columns on a UTC database. They were generated as IST working hours (09:00-18:xx) and shifted by -5h30m, so parseTimestamp() renders them back as plausible IST working times. DATE columns (due_date, quote_sent_at, lost_at, ...) are plain local calendar dates and are NOT shifted.',
    money: 'INR, plain rupees (not paise). DECIMAL(14,2) in the schema.',
  },

  assumptions: [
    'REFERENCE_DATE is 2026-08-12. Every relative figure (staleness, overdue follow-ups) is computed against it. Records were placed with margin around thresholds so the classification survives a demo a few days later — but the "due_today"/"due_tomorrow" follow-ups are inherently absolute and WILL drift. See time_sensitivity below.',
    'STALENESS THRESHOLDS — CONFIRMED BY THE OWNER 2026-08-12: a lead untouched for 7 days READS AS STALE (STALE_DAYS, labels and colour only); a lead untouched for 14 days ENTERS NEEDS ATTENTION (ATTENTION_DAYS, the queue). This matches attention.js exactly — nothing was changed. The Phase 9 brief specifies a 10-day red-flag threshold; that figure does NOT exist in the application and was retired on 2026-08-10. This plan targets 14 and additionally seeds a 9-12 day "cooling" band whose only purpose is to DISCRIMINATE: those leads read as stale but must NOT appear in any queue. If they do, either the constants were collapsed back together or a 10-day rule crept in.',
    'Indian public holiday dates for the lunar festivals (Holi, Id-ul-Fitr, Bakrid, Muharram) are approximate. They affect only activity clustering realism, nothing computed.',
    'order_value is written only on won leads, EXCEPT three deliberate anomaly leads (tagged anomaly_open_lead_with_order_value) that carry an order_value while still open. This reproduces the real process gap CLAUDE.md flags. dealValueFor() must ignore order_value for these and use quote_value.',
    'push_subscriptions is NOT seeded. A row requires a genuine browser push endpoint and VAPID keypair; a fabricated one is unverifiable and would break the Edge Function. Recorded as an accepted gap.',
    'plans is NOT seeded, per the Phase 0 product decision. Zero code references, no UI, nothing verifiable downstream.',
  ],

  open_questions_for_the_user: [
    {
      id: 'Q-P1-1',
      status: 'RESOLVED 2026-08-12 — confirmed by the owner, no change',
      question:
        'The brief asks for red flags at 10 days of no activity. The app retired that figure in favour of ATTENTION_DAYS = 14 (DECISIONS.md, pinned by attention.test.js). This plan targets 14 and seeds a 9-12 day band as a negative control. Confirm 14 is correct, or say if the pilot should actually move to 10.',
      answer:
        'Owner restated the rule verbatim: leads untouched for 7 days are STALE, leads untouched for 14 days fall under NEEDS ATTENTION. That is exactly what attention.js already implements, so nothing changed. THERE IS NO 10-DAY THRESHOLD — do not reintroduce one from the Phase 9 brief. Recorded in DECISIONS.md (Staleness section) and CLAUDE.md (Needs Attention bullet).',
      consequence_for_later_phases:
        'Phase 6 computes the stale bucket at >= 14 days and must leave the 9-12 day negative-control band OUT of every queue. Phase 7 treats any of those leads appearing in a queue, red flag or Today work queue as a real defect, not a seeding artefact.',
    },
    {
      id: 'Q-P1-2',
      status: 'RESOLVED 2026-08-12 — owner chose to keep current behaviour',
      question:
        'The mid-period coordinator reassignment (exception 3) is NOT recoverable from the database — coordinator_id stores current state only and no history table records it (DECISIONS.md states this explicitly and deliberately). Team aggregates therefore snap wholesale to the new coordinator, retroactively. Confirm that is the intended product behaviour before Phase 6 encodes it as the expected answer.',
      answer:
        'KEEP AS-IS. History follows the person: a coordinator always sees their current team full history, including work done while that exec reported to a different coordinator. This is INTENDED BEHAVIOUR, not a defect. The alternative (a coordinator_history table plus time-aware team-scoped queries on every SC screen) is a real build for a rare event and was declined for the pilot.',
      consequence_for_later_phases:
        'Phase 6 computes every SC team aggregate from FINAL coordinator_id only — one answer, not two. Phase 7 must NOT report Imran history appearing under SC-North as a mismatch; that is the expected result. The genuine finding to watch for is the opposite: any of his rows still appearing under SC-South.',
      known_limitation_accepted:
        'A coordinator historical team report is not stable over time — re-running "SC-South last quarter" after an exec moves away returns a smaller number than it did at the time. Accepted for the pilot.',
    },
    {
      id: 'Q-P1-3',
      status: 'DEFERRED to Phase 7 by the owner — ledger must carry BOTH answers',
      question:
        'Exception 4 (lost then reopened): the loss_reasons row is append-only and is NOT removed when a lead is reopened, so LossReasonsCard keeps counting it even though the lead is no longer lost. Is that intended, or should "Why we lose" exclude reopened leads?',
      answer:
        'NOT YET DECIDED, deliberately. The owner will choose in Phase 7 with the real figures visible rather than in the abstract.',
      consequence_for_later_phases:
        'Phase 6 MUST emit two candidate loss counts and NOT collapse them: (A) loss-EVENT count — every loss_reasons row, including the 3 reopened leads, which is what the app does today; (B) currently-lost-LEAD count — only rows whose lead current_stage is still lost. Phase 7 reports the CRM figure against both and marks the comparison as awaiting a product decision, NOT as a mismatch. The visible symptom either way is that "Why we lose" totals 3 higher than the lost count on Pipeline-by-stage.',
    },
  ],

  time_sensitivity: {
    note:
      'These rows are pinned to REFERENCE_DATE and will misclassify if the demo happens much later. Everything else was seeded with a margin.',
    absolute_rows: [
      'follow_ups with category due_today (becomes overdue the next day)',
      'follow_ups with category due_tomorrow (becomes due-today, then overdue)',
      'leads with next_followup_date set to REFERENCE_DATE + 1..45 (the nearest few slide into overdue)',
    ],
    mitigation:
      'If the demo slips more than ~5 days, re-run a small SQL date shift on follow_ups.due_date and leads.next_followup_date rather than reseeding. Phase 2 should emit that script alongside the lead_change_log correction.',
  },

  exception_catalogue: {
    '1_site_anchored_only': {
      count: SITE_ONLY.size,
      how: 'leads.party_id IS NULL, site_id set. Source forced to scanning (a plot spotted with the owner unknown). Proves lead_needs_an_anchor holds on the site side.',
    },
    '2_party_anchored_only': {
      count: PARTY_ONLY.size,
      how: 'leads.site_id IS NULL, party_id set. Lixil / referral / walk-in sources. Proves the constraint holds on the party side.',
    },
    '3_coordinator_reassignment': {
      employee: 'ex_imran (Imran Qureshi)',
      from: 'sc_south (Vikram Sethi)',
      to: 'sc_north (Neha Malhotra)',
      narrative_date: '2026-06-01',
      finding:
        'INVESTIGATED. Historical data does NOT stay with the old coordinator — it moves wholesale and retroactively. employees.coordinator_id holds current state only, is_my_team_member() reads only that, and DECISIONS.md records the deliberate decision that no history table exists for it. lead_owner_history does NOT change this: it tracks LEAD ownership, and Imran own leads never changed owner. Consequence: the instant the reassignment lands, every lead and activity Imran ever logged appears in SC-North team aggregates and vanishes from SC-South ones. The narrative_date above is unobservable in the database.',
      ruling:
        'CONFIRMED INTENDED by the owner 2026-08-12 (Q-P1-2). History follows the person. This is the expected result, not a defect — Phase 7 must not report it as a mismatch.',
      ledger_rule: 'Compute SC team aggregates from FINAL coordinator_id only. One answer, not two.',
    },
    '3b_cross_team_lead_reassignment': {
      count: CROSS_TEAM_REASSIGNED.length,
      leads: CROSS_TEAM_REASSIGNED.map((i) => leads[i].ref),
      from: 'ex_karan (SC-South)',
      to: 'ex_rohit (SC-North)',
      date: REASSIGN_DATE,
      how: 'A real leads.owner_employee_id UPDATE plus a lead_owner_history row — the one reassignment the database DOES record. Added because exception 3 alone leaves lead_owner_history untested.',
      ledger_note:
        'Activities logged before the handover keep employee_id = ex_karan, so ACTIVITY credit stays with Karan while LEAD credit moves to Rohit. Every per-exec figure must be checked for which side it falls on.',
    },
    '4_lost_then_reopened': {
      count: REOPENED.size,
      leads: [...REOPENED].map((i) => leads[i].ref),
      how: 'The lost row is woven into the stage history partway along the funnel, then the lead progresses again. The loss_reasons row stays (append-only, no delete grant or policy for anyone, including the owner).',
      ledger_rule:
        'UNDECIDED BY DESIGN (Q-P1-3, deferred to Phase 7). Phase 6 must emit TWO loss counts and must not collapse them: (A) every loss_reasons row — what the app does today; (B) only rows whose lead is still at current_stage = lost. Phase 7 reports the CRM figure against both and marks it awaiting a product decision rather than a mismatch.',
    },
    '5_won': {
      count: leads.filter((l) => l.current_stage === 'won').length,
      how: 'won_date is derivable only from the most recent stage_history row with stage = won. leads has no won_date column.',
    },
    '6_shared_mobile_numbers': {
      clusters: SHARED_MOBILES,
      assignments: sharedMobileAssignments,
      parties_sharing: Object.entries(
        parties.reduce((m, p) => (p.mobile ? ((m[p.mobile] = (m[p.mobile] ?? 0) + 1), m) : m), {})
      )
        .filter(([, n]) => n > 1)
        .map(([mobile, n]) => ({ mobile, party_count: n })),
      how: 'No UNIQUE on parties.mobile, by design. Exercises search-before-create dedup where the number matches but the person does not.',
    },
    '7_sc_entered_on_behalf': {
      sc_entered_leads: SC_ENTERED.size,
      of_which_exec_took_over: SC_ENTERED_THEN_EXEC_TOUCHED.size,
      sc_logged_activities: activities.filter((a) => a.expected_entered_by_role === null).length,
      how: 'entered_by_role is written ONLY by stamp_entered_by_role() and follows from who writes the row — so it is produced by choosing the seeding identity, never by setting a column. SC-authored => NULL (still editable by the SC). A later exec save => sales_executive (SC drops to view-only except current_stage / next_followup_date / order_value).',
    },
    '8_follow_ups_assigned_by_sc': {
      total_follow_ups: followUps.length,
      by_category: followUps.reduce((m, f) => ((m[f.category] = (m[f.category] ?? 0) + 1), m), {}),
    },
    '9_no_activity_red_flag': {
      rule_confirmed_by_owner_2026_08_12:
        '7 days untouched = STALE (reads as neglected: labels/colour only). 14 days untouched = NEEDS ATTENTION (enters the queue).',
      threshold_for_the_queue: 'ATTENTION_DAYS = 14',
      threshold_for_the_label: 'STALE_DAYS = 7',
      brief_10_day_figure: 'DOES NOT EXIST in the application. Retired 2026-08-10. Do not reintroduce.',
      discriminator_band:
        '9-12 days ("cooling") — these leads MUST read as stale and MUST NOT appear in any queue, red flag or Today work queue. Negative control.',
    },
    '10_targets_spanning_periods': {
      count: targets.length,
      how: 'week + month + quarter targets deliberately overlap, so one activity counts toward several period attributions. Includes two deliberate gaps: ex_karan has no 2026-08 call target, and ex_imran / ex_sunita have no weekly targets — both must render "no target set", never a zero.',
      quarters: QUARTERS,
      months: MONTHS,
      weeks: RECENT_WEEKS,
    },
    '11_long_stall_in_stage': {
      count: LONG_STALL.size,
      leads: [...LONG_STALL].map((i) => leads[i].ref),
    },
    '12_stage_skipping': {
      count: STAGE_SKIP.size,
      permitted: true,
      constraint_documented:
        'Nothing enforces stage SEQUENCE — current_stage is free text and no trigger checks ordering. What IS enforced: enforce_owner_only_stage_change() rejects any stage change unless current_employee_role() is owner or sales_coordinator, and the stage_history INSERT policy is owner-only OR the SC-team branch. So a sales_executive can never author a stage move at all, skipped or not. Every stage_history row in this plan is therefore authored by emp_owner or by the lead owner CURRENT coordinator.',
    },
  },

  seeding_order: [
    '1. auth.users for the 8 new employees (service_role Admin API) — record every UUID in seed_manifest.json',
    '2. employees rows (as owner). IMPORTANT: create the two sales_coordinator rows FIRST, then the execs with coordinator_id set — validate_employee_role_assignment() rejects a coordinator_id pointing at a non-SC.',
    '3. areas, products (as owner)',
    '4. parties, sites (as the authored_by employee — created_by / discovered_by must be the exec, not the seeder)',
    '5. site_contacts',
    '6. leads (as authored_by: the exec, or the SC for the SC-entered subset). Insert current_stage at its FINAL value — enforce_owner_only_stage_change() is a BEFORE UPDATE trigger and does not fire on INSERT, so this avoids needing an owner session per stage step.',
    '7. exec_touches and sc_edits (the UPDATEs that exercise the entered_by_role lock) — AFTER the leads exist',
    '8. activities (as authored_by), follow_ups (as created_by), stage_history (as owner or team SC), loss_reasons',
    '9. lead_owner_history + the matching leads.owner_employee_id UPDATE (as owner)',
    '10. targets (as owner)',
    '11. POST-SEED SQL in the Supabase SQL Editor: correct lead_change_log.changed_at from post_seed_corrections.lead_change_log. The AFTER trigger stamps now() and the app cannot supply it.',
  ],

  verification_probes: {
    _note:
      'NOT seed data. Writes that must be ATTEMPTED and are expected to FAIL, proving the guard rails are real. Deferred to Phase 3 (flows) and Phase 5 (security). Listed here so the plan records them rather than leaving them to be reinvented.',
    probes: [
      'As a sales_executive: UPDATE leads SET current_stage — must raise check_violation (enforce_owner_only_stage_change).',
      'As a sales_executive: INSERT into stage_history — must be rejected by RLS.',
      'As an SC, on a lead whose entered_by_role = sales_executive: UPDATE any column other than current_stage / next_followup_date / order_value — must raise check_violation (enforce_coordinator_lock).',
      'As an SC, on the same lead: UPDATE current_stage — must SUCCEED (the grant and the lock are a deliberate pair).',
      'As SC-North: read/update/delete any SC-South lead, activity, follow_up, party, site by direct id — must return nothing / affect 0 rows.',
      'As any authenticated employee: UPDATE stage_history or DELETE lead_owner_history — the grant layer permits it (Phase 0 finding) and only the absence of a policy blocks it. Must affect 0 rows.',
      'An RLS-rejected UPDATE with no .select() returns {data: null, error: null} — 0 rows matched, no exception. Every probe must RE-READ the row, never trust the absence of an error.',
    ],
  },

  plan_summary: {
    _note: 'Table row counts only. Per-employee and per-metric breakdowns are deliberately absent — deriving those is Phase 6 job.',
    areas: AREAS.length,
    products: PRODUCTS.length,
    employees_new: EMPLOYEES.length,
    employees_preserved: 1,
    parties: parties.length,
    sites: sites.length,
    site_contacts: siteContacts.length,
    leads: leads.length,
    stage_history: stageHistory.length,
    activities: activities.length,
    follow_ups: followUps.length,
    targets: targets.length,
    loss_reasons: lossReasons.length,
    lead_owner_history: leadOwnerHistory.length,
    exec_touches: execTouches.length,
    sc_edits: scEdits.length,
    lead_change_log_corrections: leadChangeLogCorrections.length,
    plans: 0,
    push_subscriptions: 0,
  },

  owner: OWNER,
  employees: EMPLOYEES,
  areas: AREAS,
  products: PRODUCTS,
  parties,
  sites,
  site_contacts: siteContacts,
  leads,
  exec_touches: execTouches,
  sc_edits: scEdits,
  stage_history: stageHistory,
  activities,
  follow_ups: followUps,
  targets,
  loss_reasons: lossReasons,
  lead_owner_history: leadOwnerHistory,
  post_seed_corrections: { lead_change_log: leadChangeLogCorrections },
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(plan, null, 2))

// ---------------------------------------------------------------------------
// Console sanity report (NOT written to the plan)
// ---------------------------------------------------------------------------
const byExec = {}
for (const l of leads) {
  byExec[l.owner_employee_ref] ??= { total: 0, won: 0, lost: 0, on_hold: 0 }
  byExec[l.owner_employee_ref].total++
  if (l.current_stage === 'won') byExec[l.owner_employee_ref].won++
  if (l.current_stage === 'lost') byExec[l.owner_employee_ref].lost++
  if (l.current_stage === 'on_hold') byExec[l.owner_employee_ref].on_hold++
}
console.log(`\nWrote ${OUT}`)
console.log(`\nRow counts:`)
for (const [k, v] of Object.entries(plan.plan_summary)) {
  if (k.startsWith('_')) continue
  console.log(`  ${k.padEnd(28)} ${v}`)
}
console.log(`\nLeads per exec (sanity only — not in the plan):`)
for (const [k, v] of Object.entries(byExec)) {
  console.log(`  ${k.padEnd(12)} total ${String(v.total).padStart(3)}  won ${v.won}  lost ${v.lost}  on_hold ${v.on_hold}`)
}
const anchorViolations = leads.filter((l) => !l.site_ref && !l.party_ref)
const bothAnchors = leads.filter((l) => l.site_ref && l.party_ref)
console.log(`\nAnchor check: ${anchorViolations.length} leads with NO anchor (must be 0); ${bothAnchors.length} with both.`)
console.log(`Date range: ${WINDOW_START} .. ${REFERENCE_DATE} (${plan.meta.window_days} days)`)
