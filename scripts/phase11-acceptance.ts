import { randomUUID } from 'node:crypto';
import { config as loadEnvironment } from 'dotenv';
import pg from 'pg';

loadEnvironment({ path: '.env.local', quiet: true });

const databaseUrl = process.env.PHASE11_TEST_DATABASE_URL?.trim()
  || process.env.SECURITY_TEST_DATABASE_URL?.trim()
  || process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('PHASE11_TEST_DATABASE_URL, SECURITY_TEST_DATABASE_URL, or DATABASE_URL is required.');
const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!databaseName.endsWith('_test')) throw new Error('Phase 11 acceptance only runs against a database whose name ends in _test.');

Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  APP_DATA_MODE: 'database',
});

type Check = { scenario: string; expected: string; actual: string; pass: boolean; elapsedMs?: number };
type UserRole = 'admin' | 'ura_user' | 'report_viewer' | 'auditor';
type TestUser = { id: string; name: string; email: string; role: UserRole; is_active: boolean };

const runTag = randomUUID().replaceAll('-', '').slice(0, 12);
const marker = `phase11-${runTag}`;
const facilityCount = 10_000;
const results: Check[] = [];
const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 16,
  statement_timeout: 120_000,
  query_timeout: 121_000,
  application_name: 'provider-tracker-phase11',
});

function record(scenario: string, expected: string, actual: unknown, pass: boolean, elapsedMs?: number) {
  results.push({ scenario, expected, actual: String(actual), pass, ...(elapsedMs === undefined ? {} : { elapsedMs: Math.round(elapsedMs) }) });
}

function requireRow<T>(rows: T[], label: string): T {
  const row = rows[0];
  if (!row) throw new Error(`${label} did not return a row.`);
  return row;
}

function isoDate(daysAgo: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function principal(user: TestUser) {
  const now = new Date();
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.is_active,
    sessionId: randomUUID(),
    sessionCreatedAt: now,
    sessionUpdatedAt: now,
    sessionExpiresAt: new Date(now.valueOf() + 60 * 60_000),
  };
}

function metricValue(report: { metrics: Array<{ label: string; value: string }> }, label: string): number {
  const value = report.metrics.find((metric) => metric.label === label)?.value;
  if (value === undefined) throw new Error(`Report metric not found: ${label}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Report metric is not numeric: ${label}=${value}`);
  return parsed;
}

async function tableExists(name: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>('select to_regclass($1) is not null as exists', [`public.${name}`]);
  return result.rows[0]?.exists === true;
}

async function cleanup() {
  const userRows = await pool.query<{ id: string }>(
    `select id from users where email like $1`,
    [`phase11-${runTag}-%@example.invalid`],
  ).catch(() => ({ rows: [] }));
  const userIds = userRows.rows.map((row) => row.id);
  const facilityRows = await pool.query<{ id: string }>(
    `select id from facilities where source_metadata->>'phase11Run'=$1`,
    [marker],
  ).catch(() => ({ rows: [] }));
  const ids = facilityRows.rows.map((row) => row.id);
  if (ids.length) {
    await pool.query('delete from operational_change_events where facility_id=any($1::uuid[])', [ids]).catch(() => undefined);
    await pool.query('delete from facility_merge_records where survivor_facility_id=any($1::uuid[]) or merged_facility_id=any($1::uuid[])', [ids]).catch(() => undefined);
    await pool.query('delete from reverification_assignments where facility_id=any($1::uuid[])', [ids]).catch(() => undefined);
    await pool.query('delete from facility_contact_attempts where facility_id=any($1::uuid[])', [ids]).catch(() => undefined);
    await pool.query('delete from facility_verification_events where facility_id=any($1::uuid[])', [ids]).catch(() => undefined);
    await pool.query('delete from facility_diagnosis_capabilities where facility_id=any($1::uuid[])', [ids]).catch(() => undefined);
    await pool.query('delete from facility_specialties where facility_id=any($1::uuid[])', [ids]).catch(() => undefined);
    await pool.query('delete from operational_work_items where target_id=any($1::uuid[])', [ids]).catch(() => undefined);
    await pool.query(`delete from audit_events where entity_type='facility' and entity_id=any($1::text[])`, [ids]).catch(() => undefined);
    await pool.query('delete from facilities where id=any($1::uuid[])', [ids]).catch(() => undefined);
  }
  if (userIds.length) {
    await pool.query('delete from audit_events where actor_id=any($1::uuid[])', [userIds]).catch(() => undefined);
  }
  await pool.query(`delete from audit_events where metadata->>'phase11Run'=$1 or request_id=$1`, [marker]).catch(() => undefined);
  await pool.query(`delete from notifications where source=$1`, [marker]).catch(() => undefined);
  await pool.query(`delete from migration_runs where source_manifest->>'phase11Run'=$1`, [marker]).catch(() => undefined);
  await pool.query(`delete from specialties where normalized_name like $1`, [`phase11 ${runTag}%`]).catch(() => undefined);
  await pool.query(`delete from diagnoses where code like $1`, [`Q11-${runTag}%`]).catch(() => undefined);
  await pool.query(`delete from users where email like $1`, [`phase11-${runTag}-%@example.invalid`]).catch(() => undefined);
}

async function seedUsers(): Promise<Record<string, TestUser>> {
  const rows = await pool.query<TestUser>(`
    insert into users (name,email,display_name,initials,role,is_active,email_verified,role_assigned_at)
    values
      ('Phase 11 Admin',$1,'Phase 11 Admin','PA','admin',true,true,now()),
      ('Phase 11 URA One',$2,'Phase 11 URA One','U1','ura_user',true,true,now()),
      ('Phase 11 URA Two',$3,'Phase 11 URA Two','U2','ura_user',true,true,now()),
      ('Phase 11 URA Three',$4,'Phase 11 URA Three','U3','ura_user',true,true,now()),
      ('Phase 11 Reports',$5,'Phase 11 Reports','RV','report_viewer',true,true,now()),
      ('Phase 11 Auditor',$6,'Phase 11 Auditor','AU','auditor',true,true,now()),
      ('Phase 11 Disabled',$7,'Phase 11 Disabled','DU','ura_user',false,true,now())
    returning id,name,email,role,is_active`, [
      `phase11-${runTag}-admin@example.invalid`,
      `phase11-${runTag}-ura1@example.invalid`,
      `phase11-${runTag}-ura2@example.invalid`,
      `phase11-${runTag}-ura3@example.invalid`,
      `phase11-${runTag}-reports@example.invalid`,
      `phase11-${runTag}-auditor@example.invalid`,
      `phase11-${runTag}-disabled@example.invalid`,
    ]);
  const names = ['admin', 'ura1', 'ura2', 'ura3', 'reportViewer', 'auditor', 'disabled'];
  return Object.fromEntries(rows.rows.map((row, index) => [names[index], row]));
}

async function seedFacilities(users: Record<string, TestUser>) {
  const beforeBytes = Number(requireRow((await pool.query<{ bytes: string }>('select pg_database_size(current_database())::text as bytes')).rows, 'database size').bytes);
  const started = performance.now();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`
    insert into specialties (canonical_name,normalized_name,aliases)
    select 'Phase 11 Specialty '||g||' ${runTag}', 'phase11 ${runTag} specialty '||g, jsonb_build_array('Q11 specialty '||g)
    from generate_series(1,5) g`);
    await client.query(`
    insert into diagnoses (code,description,aliases)
    select 'Q11-${runTag}-'||g, 'Phase 11 diagnosis '||g, jsonb_build_array('Q11 diagnosis '||g)
    from generate_series(1,5) g`);
    await client.query(`
    insert into facilities (
      facility_name,city,normalized_name,normalized_city,display_key,facility_type,address_line_1,state_code,
      phone_raw,phone_normalized,postal_code,latitude,longitude,coordinate_quality,current_accepting_status,
      current_scheduling_status,current_urgent_referral_status,next_available_date,estimated_wait_days,
      accepting_verified_at,scheduling_verified_at,last_verified_at,active,data_quality_status,source_metadata
    )
    select
      case when g=1 then 'North Harbor Pediatric Truth ${runTag}' else 'Phase 11 Facility ${runTag} '||lpad(g::text,5,'0') end,
      (array['Portland','Bangor','Augusta','Lewiston','Brunswick','Biddeford'])[1+(g%6)],
      case when g=1 then 'north harbor pediatric truth ${runTag}' else 'phase11 facility ${runTag} '||lpad(g::text,5,'0') end,
      lower((array['Portland','Bangor','Augusta','Lewiston','Brunswick','Biddeford'])[1+(g%6)]),
      '${marker}|'||g,
      (array['Hospital','Clinic','Group practice','Specialty center'])[1+(g%4)],
      g||' Synthetic Test Way','ME','207-555-'||lpad((g%10000)::text,4,'0'),'207555'||lpad((g%10000)::text,4,'0'),
      case when g=2 then '04103' else lpad((4101+(g%320))::text,5,'0') end,
      43.1+((g%200)::double precision/100),-70.9+((g%180)::double precision/100),'address',
      (array['yes','no','unknown','not_asked','unable_to_verify','not_applicable'])[1+(g%6)]::verification_answer,
      (array['no','yes','unknown','unable_to_verify','not_asked','not_applicable'])[1+(g%6)]::verification_answer,
      (array['unknown','no','yes','not_asked','unable_to_verify','not_applicable'])[1+(g%6)]::verification_answer,
      case when g%7=0 then current_date+(g%60) else null end,
      case when g%7=0 then g%60 else null end,
      case when g%6 in (0,1,5) then now()-((g%120)||' days')::interval else null end,
      case when g%6 in (0,1,5) then now()-((g%120)||' days')::interval else null end,
      now()-((g%730)||' days')::interval,
      g%101<>0,
      case when g%17=0 then 'needs_review'::data_quality_status else 'clean'::data_quality_status end,
      jsonb_build_object('phase11Run',$1::text,'synthetic',true,'ordinal',g)
    from generate_series(1,$2::int) g`, [marker, facilityCount]);
    await client.query(`
    with numbered_facilities as (
      select id,row_number() over(order by display_key) as n from facilities where source_metadata->>'phase11Run'=$1
    ), numbered_specialties as (
      select id,row_number() over(order by normalized_name) as n from specialties where normalized_name like $2
    )
    insert into facility_specialties (facility_id,specialty_id,verification_status,last_confirmed_at,source_metadata)
    select f.id,s.id,case when f.n%5=0 then 'unknown' else 'yes' end::verification_answer,
      now()-((f.n%240)||' days')::interval,jsonb_build_object('phase11Run',$1::text)
    from numbered_facilities f join numbered_specialties s on s.n=1+((f.n-1)%5)`, [marker, `phase11 ${runTag}%`]);
    await client.query(`
    with numbered_facilities as (
      select id,row_number() over(order by display_key) as n from facilities where source_metadata->>'phase11Run'=$1
    ), numbered_diagnoses as (
      select id,row_number() over(order by code) as n from diagnoses where code like $2
    )
    insert into facility_diagnosis_capabilities (facility_id,diagnosis_id,status,last_verified_at,source_metadata)
    select f.id,d.id,case when f.n%4=0 then 'no' when f.n%7=0 then 'unknown' else 'yes' end::verification_answer,
      now()-((f.n%210)||' days')::interval,jsonb_build_object('phase11Run',$1::text)
    from numbered_facilities f join numbered_diagnoses d on d.n=1+((f.n-1)%5)`, [marker, `Q11-${runTag}%`]);
    await client.query(`
    insert into facility_verification_events (
      facility_id,verified_at,verified_by,method,confidence,accepting_status,scheduling_within_four_weeks,
      urgent_referral_status,comments,previous_state,resulting_state,source_metadata
    )
    select f.id,f.last_verified_at,$2,
      (array['phone','portal','website','email'])[1+((f.source_metadata->>'ordinal')::int%4)]::verification_method,
      'direct',f.current_accepting_status,f.current_scheduling_status,f.current_urgent_referral_status,
      'Synthetic baseline verification', '{}'::jsonb,
      jsonb_build_object('acceptingStatus',f.current_accepting_status,'schedulingStatus',f.current_scheduling_status),
      jsonb_build_object('phase11Run',$1::text)
    from facilities f where f.source_metadata->>'phase11Run'=$1`, [marker, users.admin.id]);
    await client.query(`
    insert into facility_verification_events (
      facility_id,verified_at,verified_by,method,confidence,accepting_status,comments,previous_state,resulting_state,source_metadata
    )
    select f.id,f.last_verified_at-interval '60 days',$2,'phone','direct','unknown','Earlier synthetic history','{}','{}',jsonb_build_object('phase11Run',$1::text)
    from facilities f where f.source_metadata->>'phase11Run'=$1 and (f.source_metadata->>'ordinal')::int%4=0`, [marker, users.ura1.id]);
    await client.query(`
    insert into facility_contact_attempts (facility_id,attempted_at,attempted_by,method,outcome,comments)
    select f.id,now()-(((f.source_metadata->>'ordinal')::int%90)||' days')::interval,$2,'phone',
      (array['no_answer','voicemail_left','disconnected','wrong_number','callback_requested','unable_to_verify'])[1+((f.source_metadata->>'ordinal')::int%6)]::contact_outcome,
      'Synthetic contact attempt'
    from facilities f where f.source_metadata->>'phase11Run'=$1 and (f.source_metadata->>'ordinal')::int%3=0`, [marker, users.ura1.id]);
    await client.query(`
    insert into reverification_assignments (facility_id,assigned_to,assigned_by,status,reason_codes)
    select f.id,case when (f.source_metadata->>'ordinal')::int%80=0 then $2::uuid else $3::uuid end,$4,'open','["stale"]'::jsonb
    from facilities f where f.source_metadata->>'phase11Run'=$1 and (f.source_metadata->>'ordinal')::int%40=0`, [marker, users.ura1.id, users.ura2.id, users.admin.id]);
    await client.query(`
    insert into operational_work_items (
      work_type,priority,target_type,target_id,due_at,reason_codes,status,assigned_to,assigned_by,created_by,source,deduplication_key
    )
    select 'reverify',(case when (f.source_metadata->>'ordinal')::int%100=0 then 'important' else 'attention' end)::notification_severity,
      'facility',f.id,now()+interval '2 days','["stale"]','assigned',
      case when (f.source_metadata->>'ordinal')::int%100=0 then $2::uuid else $3::uuid end,$4,$4,$1,$1||':work:'||f.id
    from facilities f where f.source_metadata->>'phase11Run'=$1 and (f.source_metadata->>'ordinal')::int%50=0`, [marker, users.ura1.id, users.ura2.id, users.admin.id]);
    await client.query(`
    insert into notifications (recipient_id,type,category,severity,title,message,target_path,source,deduplication_key)
    select case when g%2=0 then $2::uuid else $3::uuid end,'work-assigned','work','attention','Provider review assigned',
      'A synthetic provider review is ready.','/work',$1,$1||':notification:'||g
    from generate_series(1,40) g`, [marker, users.ura1.id, users.ura2.id]);
    await client.query(`
    insert into audit_events (actor_id,action,result,entity_type,entity_id,request_id,metadata)
    select $2,'facility.synthetic-read','success','facility',f.id::text,$1,jsonb_build_object('phase11Run',$1::text)
    from facilities f where f.source_metadata->>'phase11Run'=$1 limit 1000`, [marker, users.ura1.id]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const elapsed = performance.now() - started;
  const afterBytes = Number(requireRow((await pool.query<{ bytes: string }>('select pg_database_size(current_database())::text as bytes')).rows, 'database size').bytes);
  record('10,000-provider synthetic seed', `${facilityCount} facilities`, facilityCount, true, elapsed);
  record('Database growth is bounded', '< 250 MB', `${Math.round((afterBytes - beforeBytes) / 1024 / 1024)} MB`, afterBytes - beforeBytes < 250 * 1024 * 1024);
}

async function seedReportTruth(users: Record<string, TestUser>) {
  const facilities = await pool.query<{ id: string }>(`
    select id from facilities where source_metadata->>'phase11Run'=$1 order by (source_metadata->>'ordinal')::int limit 3`, [marker]);
  if (facilities.rows.length !== 3) throw new Error('Report truth facilities were not found.');
  const [first, second, boundary] = facilities.rows;
  const from = isoDate(10);
  const to = isoDate(6);
  await pool.query(`
    insert into facility_verification_events (facility_id,verified_at,verified_by,method,confidence,accepting_status,previous_state,resulting_state,comments,source_metadata)
    values
      ($1,$4::date+interval '6 hours',$6,'phone','direct','yes','{"acceptingStatus":"no"}','{"acceptingStatus":"yes"}','Report truth A1',jsonb_build_object('phase11Run',$7::text)),
      ($1,$4::date+interval '12 hours',$6,'phone','direct','no','{"acceptingStatus":"yes"}','{"acceptingStatus":"no"}','Report truth A2',jsonb_build_object('phase11Run',$7::text)),
      ($1,$4::date+interval '18 hours',$6,'phone','direct','yes','{"acceptingStatus":"no"}','{"acceptingStatus":"yes"}','Report truth A3',jsonb_build_object('phase11Run',$7::text)),
      ($2,$4::date+interval '8 hours',$6,'portal','authoritative','yes','{"acceptingStatus":"unknown"}','{"acceptingStatus":"yes"}','Report truth B1',jsonb_build_object('phase11Run',$7::text)),
      ($3,$4::date,$6,'email','direct','unknown','{}','{}','Inclusive boundary',jsonb_build_object('phase11Run',$7::text)),
      ($3,($5::date+interval '1 day'),$6,'email','direct','unknown','{}','{}','Exclusive boundary',jsonb_build_object('phase11Run',$7::text))
  `, [first.id, second.id, boundary.id, from, to, users.ura2.id, marker]);
  return { from, to, boundaryFacilityId: boundary.id };
}

async function seedMigrationTruth(users: Record<string, TestUser>) {
  const run = requireRow((await pool.query<{ id: string }>(`
    insert into migration_runs (
      importer_version,status,release_version,source_manifest,preview_counts,apply_counts,reconciliation,readiness,
      notification_baseline_at,previewed_by,approved_by,executed_by,approved_at,started_at,completed_at
    ) values ('phase11','reconciled','phase11',jsonb_build_object('phase11Run',$1::text),'{"rows":10000}','{"inserted":10000}',
      '{"sourceRows":10000,"reconciledRows":10000}','go',now(),$2,$2,$2,now(),now(),now()) returning id`, [marker, users.admin.id])).rows, 'migration run');
  await pool.query(`
    insert into migration_reconciliations (
      migration_run_id,source_rows,reconciled_rows,imported_rows,reconciliation_percent,relationship_counts,state_distribution,
      report_comparison,discrepancies,readiness
    ) values ($1,10000,10000,10000,100,'{"facilities":10000}','{"reconciled":10000}','{"match":true}','[]','go')`, [run.id]);
}

async function main() {
  const requiredTables = [
    'users', 'facilities', 'specialties', 'diagnoses', 'facility_specialties', 'facility_diagnosis_capabilities',
    'calls', 'facility_verification_events', 'facility_contact_attempts', 'reverification_assignments', 'audit_events',
    'notifications', 'operational_work_items', 'migration_runs', 'migration_reconciliations',
  ];
  const missing = [];
  for (const table of requiredTables) if (!(await tableExists(table))) missing.push(table);
  if (missing.length) throw new Error(`Phase 11 schema is incomplete: ${missing.join(', ')}. Run migrations or test:security first.`);

  const modules = await Promise.all([
    import('../src/lib/access-control'),
    import('../src/lib/provider-intelligence'),
    import('../src/server/database'),
    import('../src/server/facility-directory-service'),
    import('../src/server/notification-service'),
    import('../src/server/operational-service'),
    import('../src/server/provider-intelligence-service'),
    import('../src/server/provider-reporting-service'),
    import('../src/server/call-service'),
  ]);
  const [access, intelligence, database, directory, notification, operational, provider, reporting, callService] = modules;

  const users = await seedUsers();
  await seedFacilities(users);
  const reportTruth = await seedReportTruth(users);
  await seedMigrationTruth(users);

  const countRows = await pool.query<{
    facilities: number; active: number; archived: number; needs_review: number; verification_events: number;
    contact_attempts: number; assignments: number; work_items: number; notifications: number; states: number;
  }>(`
    with selected as (select * from facilities where source_metadata->>'phase11Run'=$1)
    select
      (select count(*)::int from selected) facilities,
      (select count(*)::int from selected where active) active,
      (select count(*)::int from selected where not active) archived,
      (select count(*)::int from selected where data_quality_status='needs_review') needs_review,
      (select count(*)::int from facility_verification_events where facility_id in (select id from selected)) verification_events,
      (select count(*)::int from facility_contact_attempts where facility_id in (select id from selected)) contact_attempts,
      (select count(*)::int from reverification_assignments where facility_id in (select id from selected)) assignments,
      (select count(*)::int from operational_work_items where target_id in (select id from selected)) work_items,
      (select count(*)::int from notifications where source=$1) notifications,
      (select count(distinct current_accepting_status)::int from selected) states`, [marker]);
  const counts = requireRow(countRows.rows, 'synthetic counts');
  record('Synthetic facility count', '10,000', counts.facilities, counts.facilities === facilityCount);
  record('Synthetic historical volume', '> 12,000 verification events', counts.verification_events, counts.verification_events > 12_000);
  record('Mixed lifecycle states', 'active, archived, review, six answer states', `${counts.active}/${counts.archived}/${counts.needs_review}/${counts.states}`, counts.active > 0 && counts.archived > 0 && counts.needs_review > 0 && counts.states === 6);
  record('Operational dataset coverage', 'contacts, assignments, work, notifications present', `${counts.contact_attempts}/${counts.assignments}/${counts.work_items}/${counts.notifications}`, counts.contact_attempts > 3_000 && counts.assignments > 200 && counts.work_items >= 200 && counts.notifications === 40);

  const roles: UserRole[] = ['admin', 'ura_user', 'report_viewer', 'auditor'];
  const permissionTruth: Record<UserRole, Record<string, boolean>> = {
    admin: { 'operations:read': true, 'operations:write': true, 'reports:read': true, 'admin:manage-users': true, 'audit:read': true },
    ura_user: { 'operations:read': true, 'operations:write': true, 'reports:read': true, 'admin:manage-users': false, 'audit:read': false },
    report_viewer: { 'operations:read': false, 'operations:write': false, 'reports:read': true, 'admin:manage-users': false, 'audit:read': false },
    auditor: { 'operations:read': false, 'operations:write': false, 'reports:read': true, 'admin:manage-users': false, 'audit:read': true },
  };
  let permissionMatches = 0;
  let permissionCases = 0;
  for (const role of roles) {
    for (const [permission, expected] of Object.entries(permissionTruth[role])) {
      permissionCases += 1;
      if (access.can(role, permission as Parameters<typeof access.can>[1]) === expected) permissionMatches += 1;
    }
  }
  record('Representative role permission matrix', `${permissionCases}/${permissionCases}`, `${permissionMatches}/${permissionCases}`, permissionMatches === permissionCases);

  const admin = principal(users.admin);
  const ura1 = principal(users.ura1);
  const ura2 = principal(users.ura2);
  const reportViewer = principal(users.reportViewer);
  const auditor = principal(users.auditor);

  const truthSearch = await directory.listFacilities(ura1, { query: `North Harbor Pediatric Truth ${runTag}`, pageSize: 10 });
  const falsePositive = await directory.listFacilities(ura1, { query: `NoSuchProvider-${runTag}`, pageSize: 10 });
  const activePage1 = await directory.listFacilities(ura1, { status: 'active', sort: 'name', page: 1, pageSize: 25 });
  const activePage2 = await directory.listFacilities(ura1, { status: 'active', sort: 'name', page: 2, pageSize: 25 });
  const pageOverlap = activePage1.rows.filter((left) => activePage2.rows.some((right) => right.facilityId === left.facilityId)).length;
  record('Directory truth result', 'one exact fixture', truthSearch.total, truthSearch.total === 1 && truthSearch.rows[0]?.facilityName.includes('North Harbor'));
  record('Directory false positive', 'zero results', falsePositive.total, falsePositive.total === 0);
  record('Directory paging and active filter', '25 + 25 distinct active rows', `${activePage1.rows.length}+${activePage2.rows.length}, overlap=${pageOverlap}`, activePage1.rows.length === 25 && activePage2.rows.length === 25 && pageOverlap === 0 && activePage1.rows.every((row) => row.recordStatus === 'Active'));
  const deterministicInput = {
    facilityId: 'truth', specialtyMatch: true, diagnosisMatch: true, acceptingStatus: 'yes' as const,
    schedulingStatus: 'yes' as const, urgentReferralStatus: 'no' as const, acceptingVerifiedAt: new Date(),
    distanceMiles: 5, estimatedWaitDays: 7, completeness: 1,
  };
  const rankA = intelligence.rankSearchResult(deterministicInput, new Date('2026-08-24T12:00:00Z'));
  const rankB = intelligence.rankSearchResult(deterministicInput, new Date('2026-08-24T12:00:00Z'));
  record('Search ranking determinism', 'same score and reasons', `${rankA.score}/${rankB.score}`, JSON.stringify(rankA) === JSON.stringify(rankB));
  record('Geographic distance sanity', 'Portland to Bangor > 100 miles', intelligence.haversineMiles(43.6591, -70.2568, 44.8012, -68.7778).toFixed(1), intelligence.haversineMiles(43.6591, -70.2568, 44.8012, -68.7778) > 100);

  const report = await reporting.getOperationalReport(reportViewer, { from: reportTruth.from, to: reportTruth.to });
  const rawReport = requireRow((await pool.query<{
    total: number; newly_accepting: number; became_unavailable: number; boundary_included: number;
  }>(`
    select
      (select count(*)::int from facility_verification_events where verified_at >= $1::date and verified_at < $2::date+interval '1 day') total,
      (select count(distinct facility_id)::int from facility_verification_events where verified_at >= $1::date and verified_at < $2::date+interval '1 day' and accepting_status='yes' and previous_state->>'acceptingStatus' in ('no','unknown','unable_to_verify')) newly_accepting,
      (select count(distinct facility_id)::int from facility_verification_events where verified_at >= $1::date and verified_at < $2::date+interval '1 day' and accepting_status='no' and previous_state->>'acceptingStatus'='yes') became_unavailable,
      (select count(*)::int from facility_verification_events where facility_id=$3 and verified_at >= $1::date and verified_at < $2::date+interval '1 day' and comments in ('Inclusive boundary','Exclusive boundary')) boundary_included`,
    [reportTruth.from, reportTruth.to, reportTruth.boundaryFacilityId])).rows, 'raw report');
  record('Report total vs raw rows', String(rawReport.total), report.total, report.total === rawReport.total && report.trend.reduce((total, day) => total + day.verifications, 0) === rawReport.total);
  record('Newly accepting summary truth', String(rawReport.newly_accepting), metricValue(report, 'Newly accepting'), metricValue(report, 'Newly accepting') === rawReport.newly_accepting);
  record('Unavailable summary truth', String(rawReport.became_unavailable), metricValue(report, 'Became unavailable'), metricValue(report, 'Became unavailable') === rawReport.became_unavailable);
  const acceptingDrilldown = await reporting.getOperationalReport(reportViewer, { from: reportTruth.from, to: reportTruth.to, drilldown: 'newly_accepting' });
  const unavailableDrilldown = await reporting.getOperationalReport(reportViewer, { from: reportTruth.from, to: reportTruth.to, drilldown: 'became_unavailable' });
  record('Report drill-down reconciliation', 'summary equals distinct facility rows', `${rawReport.newly_accepting}/${acceptingDrilldown.drilldown.length}; ${rawReport.became_unavailable}/${unavailableDrilldown.drilldown.length}`, rawReport.newly_accepting === acceptingDrilldown.drilldown.length && rawReport.became_unavailable === unavailableDrilldown.drilldown.length);
  record('Inclusive/exclusive period boundaries', 'one of two boundary fixtures', rawReport.boundary_included, rawReport.boundary_included === 1);

  const workflowFacility = requireRow((await pool.query<{ id: string; optimistic_lock_version: number; current_accepting_status: string; accepting_verified_at: Date | null }>(`
    select id,optimistic_lock_version,current_accepting_status,accepting_verified_at from facilities
    where source_metadata->>'phase11Run'=$1 order by (source_metadata->>'ordinal')::int offset 30 limit 1`, [marker])).rows, 'workflow facility');
  const verified = await provider.createVerificationEvent(ura1, workflowFacility.id, {
    expectedVersion: workflowFacility.optimistic_lock_version,
    verifiedAt: new Date(), method: 'phone', confidence: 'direct', acceptingStatus: 'yes',
    schedulingWithinFourWeeks: 'yes', urgentReferralStatus: 'no', estimatedWaitDays: 14,
    comments: 'Called the main line. Scheduling confirmed. سليم ✓',
  });
  record('Successful verification current-state update', 'yes with refreshed timestamps and history', verified.facility.currentAcceptingStatus, verified.facility.currentAcceptingStatus === 'yes' && verified.facility.acceptingVerifiedAt instanceof Date);
  const refreshedAt = verified.facility.acceptingVerifiedAt?.valueOf();
  const unknown = await provider.createVerificationEvent(ura1, workflowFacility.id, {
    expectedVersion: verified.facility.optimisticLockVersion,
    verifiedAt: new Date(), method: 'phone', confidence: 'direct', acceptingStatus: 'unknown', comments: 'Staff could not confirm today.',
  });
  record('Unknown-state timestamp integrity', 'status changes but known-answer timestamp does not', `${unknown.facility.currentAcceptingStatus}/${unknown.facility.acceptingVerifiedAt?.toISOString()}`, unknown.facility.currentAcceptingStatus === 'unknown' && unknown.facility.acceptingVerifiedAt?.valueOf() === refreshedAt);
  const knownAgain = await provider.createVerificationEvent(ura1, workflowFacility.id, {
    expectedVersion: unknown.facility.optimisticLockVersion,
    verifiedAt: new Date(), method: 'portal', confidence: 'direct', acceptingStatus: 'yes', comments: 'Portal confirmation restored a known state.',
  });
  record('Known state after unknown', 'yes and complete ordered history', knownAgain.facility.currentAcceptingStatus, knownAgain.facility.currentAcceptingStatus === 'yes');

  const failedCallAt = new Date(Date.now() - 60_000);
  const failedCallNotes = 'Left one callback message. <script>alert(1)</script>';
  const failedCall = await callService.createCallRecord(ura1, {
    callAt: failedCallAt,
    facilityId: workflowFacility.id,
    authorizationId: null,
    lobId: null,
    specialtyId: null,
    diagnosisId: null,
    phone: null,
    contactOutcome: 'voicemail_left',
    acceptingNewPatients: 'unknown',
    canTreatDiagnosis: 'unknown',
    canScheduleWithinFourWeeks: 'unknown',
    specialtyConfirmed: 'unknown',
    notes: failedCallNotes,
  });
  const attemptCount = Number(requireRow((await pool.query<{ count: number }>(`
    select count(*)::int as count from facility_contact_attempts where facility_id=$1 and attempted_by=$2 and attempted_at=$3 and outcome=$4 and related_call_id=$5`,
    [workflowFacility.id, ura1.id, failedCallAt, 'voicemail_left', failedCall.id])).rows, 'contact attempt count').count);
  const afterFailedContact = requireRow((await pool.query<{ status: string; verified_at: Date | null }>('select current_accepting_status as status,accepting_verified_at as verified_at from facilities where id=$1', [workflowFacility.id])).rows, 'failed contact state');
  record('Failed call creates contact history', 'one linked contact attempt', attemptCount, attemptCount === 1);
  record('Failed contact leaves availability unchanged', 'yes and accepting timestamp unchanged', `${afterFailedContact.status}/${afterFailedContact.verified_at?.toISOString()}`, afterFailedContact.status === 'yes' && afterFailedContact.verified_at?.valueOf() === knownAgain.facility.acceptingVerifiedAt?.valueOf());

  const detail = await provider.getFacilityDetail(ura2, workflowFacility.id);
  const workflowHistory = detail?.verifications ?? [];
  const textRoundTrip = Boolean(
    workflowHistory.some((event) => event.comments === 'Called the main line. Scheduling confirmed. سليم ✓')
      && detail?.contacts.some((attempt) => attempt.comments === failedCallNotes),
  );
  const orderedHistory = workflowHistory.every((event, index) => index === 0 || event.verifiedAt.valueOf() <= workflowHistory[index - 1]!.verifiedAt.valueOf());
  record('Database text round trip', 'Unicode, punctuation, and markup-shaped text preserved', textRoundTrip, textRoundTrip);
  record('Facility detail history ordering', 'newest first', workflowHistory.length, workflowHistory.length >= 3 && orderedHistory);

  const zipUpdated = await provider.updateFacility(ura1, workflowFacility.id, {
    expectedVersion: knownAgain.facility.optimisticLockVersion,
    postalCode: '04103', addressLine2: 'Suite 2 – Intake',
  });
  record('Leading-zero ZIP round trip', '04103 as text', zipUpdated.postalCode, zipUpdated.postalCode === '04103');

  const concurrencyFacility = requireRow((await pool.query<{ id: string; optimistic_lock_version: number }>(`
    select id,optimistic_lock_version from facilities where source_metadata->>'phase11Run'=$1 order by (source_metadata->>'ordinal')::int offset 50 limit 1`, [marker])).rows, 'concurrency facility');
  const edits = await Promise.allSettled([
    provider.updateFacility(ura1, concurrencyFacility.id, { expectedVersion: concurrencyFacility.optimistic_lock_version, addressLine2: 'Concurrent Suite A' }),
    provider.updateFacility(ura2, concurrencyFacility.id, { expectedVersion: concurrencyFacility.optimistic_lock_version, phoneRaw: '207-555-0199' }),
  ]);
  const successes = edits.filter((result) => result.status === 'fulfilled').length;
  const conflicts = edits.filter((result) => result.status === 'rejected' && result.reason instanceof provider.RecordConflictError).length;
  const concurrencyCurrent = requireRow((await pool.query<{ version: number }>('select optimistic_lock_version as version from facilities where id=$1', [concurrencyFacility.id])).rows, 'concurrency current');
  const retry = await provider.updateFacility(ura2, concurrencyFacility.id, { expectedVersion: concurrencyCurrent.version, phoneRaw: '207-555-0199' });
  record('Concurrent different-field edits', 'one conflict, retry preserves both edits', `${successes} success/${conflicts} conflict`, successes === 1 && conflicts === 1 && retry.phoneNormalized === '2075550199');
  const sameField = await Promise.allSettled([
    provider.updateFacility(ura1, concurrencyFacility.id, { expectedVersion: retry.optimisticLockVersion, city: 'Portland' }),
    provider.updateFacility(ura2, concurrencyFacility.id, { expectedVersion: retry.optimisticLockVersion, city: 'Bangor' }),
  ]);
  record('Concurrent same-field edits', 'one write and one visible conflict', sameField.map((item) => item.status).join('/'), sameField.filter((item) => item.status === 'fulfilled').length === 1 && sameField.filter((item) => item.status === 'rejected').length === 1);

  const rollbackFacility = requireRow((await pool.query<{ id: string; version: number; events: number }>(`
    select f.id,f.optimistic_lock_version as version,(select count(*)::int from facility_verification_events v where v.facility_id=f.id) events
    from facilities f where f.source_metadata->>'phase11Run'=$1 order by (f.source_metadata->>'ordinal')::int offset 70 limit 1`, [marker])).rows, 'rollback facility');
  let rollbackRejected = false;
  try {
    await provider.createVerificationEvent({ ...ura1, id: randomUUID() }, rollbackFacility.id, {
      expectedVersion: rollbackFacility.version, verifiedAt: new Date(), method: 'phone', confidence: 'direct', acceptingStatus: 'no',
    });
  } catch {
    rollbackRejected = true;
  }
  const rollbackAfter = requireRow((await pool.query<{ version: number; events: number }>(`
    select f.optimistic_lock_version as version,(select count(*)::int from facility_verification_events v where v.facility_id=f.id) events
    from facilities f where f.id=$1`, [rollbackFacility.id])).rows, 'rollback result');
  record('Transaction failure rollback', 'no version or history change', `${rollbackAfter.version}/${rollbackAfter.events}`, rollbackRejected && rollbackAfter.version === rollbackFacility.version && rollbackAfter.events === rollbackFacility.events);
  const invalidBefore = rollbackAfter.events;
  let invalidRejected = false;
  try {
    await provider.createVerificationEvent(ura1, rollbackFacility.id, {
      expectedVersion: rollbackFacility.version, verifiedAt: new Date(Date.now() + 86_400_000), method: 'phone', confidence: 'direct', acceptingStatus: 'yes',
    });
  } catch {
    invalidRejected = true;
  }
  const invalidAfter = Number(requireRow((await pool.query<{ count: number }>('select count(*)::int as count from facility_verification_events where facility_id=$1', [rollbackFacility.id])).rows, 'invalid result').count);
  record('Bad-input save rejection', 'rejected with no write', invalidAfter, invalidRejected && invalidAfter === invalidBefore);

  const ownNotifications = await notification.listNotifications(ura1, { limit: 100 });
  const otherNotification = requireRow((await pool.query<{ id: string }>('select id from notifications where source=$1 and recipient_id=$2 limit 1', [marker, ura2.id])).rows, 'other notification');
  let crossNotificationHidden = false;
  try { await notification.markNotificationRead(ura1, otherNotification.id); } catch (error) { crossNotificationHidden = error instanceof notification.NotificationNotFoundError; }
  record('Cross-user notification isolation', 'only own 20 rows; other id is hidden', `${ownNotifications.rows.length}/${crossNotificationHidden}`, ownNotifications.rows.length === 20 && ownNotifications.rows.every((row) => row.recipientId === ura1.id) && crossNotificationHidden);
  const ownWork = await operational.listOperationalWork(ura1, { assigned: 'mine', limit: 100 });
  const otherWorkVisible = ownWork.some((item) => item.assignedTo !== ura1.id);
  const adminWork = await operational.listOperationalWork(admin, { assigned: 'all', limit: 100 });
  record('Cross-user work isolation', 'URA sees own; admin can list assigned work', `${ownWork.length}/${adminWork.length}`, ownWork.length > 0 && !otherWorkVisible && adminWork.some((item) => item.assignedTo !== admin.id));

  let reportWriteDenied = false;
  let auditorWriteDenied = false;
  try {
    await callService.createCallRecord(reportViewer, {
      callAt: new Date(Date.now() - 120_000), facilityId: workflowFacility.id,
      authorizationId: null, lobId: null, specialtyId: null, diagnosisId: null, phone: null,
      contactOutcome: 'no_answer',
      acceptingNewPatients: 'unknown', canTreatDiagnosis: 'unknown', canScheduleWithinFourWeeks: 'unknown',
      specialtyConfirmed: 'unknown', notes: 'Permission boundary test.',
    });
  } catch (error) { reportWriteDenied = error instanceof Error && 'status' in error && error.status === 403; }
  try { await provider.updateFacility(auditor, workflowFacility.id, { expectedVersion: zipUpdated.optimisticLockVersion, city: 'Augusta' }); } catch (error) { auditorWriteDenied = error instanceof Error && 'status' in error && error.status === 403; }
  record('Read-only role mutation rejection', 'Report Viewer and Auditor denied', `${reportWriteDenied}/${auditorWriteDenied}`, reportWriteDenied && auditorWriteDenied);

  const orphanResult = requireRow((await pool.query<{ orphans: number }>(`
    with selected as (select id from facilities where source_metadata->>'phase11Run'=$1)
    select
      (select count(*) from facility_specialties x left join facilities f on f.id=x.facility_id where x.facility_id in (select id from selected) and f.id is null)
      +(select count(*) from facility_diagnosis_capabilities x left join facilities f on f.id=x.facility_id where x.facility_id in (select id from selected) and f.id is null)
      +(select count(*) from facility_verification_events x left join facilities f on f.id=x.facility_id where x.facility_id in (select id from selected) and f.id is null)
      +(select count(*) from facility_contact_attempts x left join facilities f on f.id=x.facility_id where x.facility_id in (select id from selected) and f.id is null) as orphans`, [marker])).rows, 'orphan count');
  record('Synthetic referential integrity', 'zero orphan rows', orphanResult.orphans, Number(orphanResult.orphans) === 0);
  const currentMismatch = Number(requireRow((await pool.query<{ count: number }>(`
    with selected as (select id,current_accepting_status from facilities where source_metadata->>'phase11Run'=$1),
    latest as (select distinct on (v.facility_id) v.facility_id,v.accepting_status from facility_verification_events v join selected s on s.id=v.facility_id where v.accepting_status is not null order by v.facility_id,v.verified_at desc,v.created_at desc)
    select count(*)::int as count from selected s join latest l on l.facility_id=s.id where s.current_accepting_status<>l.accepting_status`, [marker])).rows, 'state mismatch').count);
  record('Current state vs latest history', 'zero mismatches', currentMismatch, currentMismatch === 0);
  const migration = requireRow((await pool.query<{ source_rows: number; reconciled_rows: number; percent: number }>(`
    select r.source_rows,r.reconciled_rows,r.reconciliation_percent as percent from migration_reconciliations r
    join migration_runs m on m.id=r.migration_run_id where m.source_manifest->>'phase11Run'=$1`, [marker])).rows, 'migration reconciliation');
  record('Migration reconciliation truth', '10,000 of 10,000, 100%', `${migration.reconciled_rows}/${migration.source_rows}/${migration.percent}`, migration.source_rows === 10_000 && migration.reconciled_rows === 10_000 && migration.percent === 100);

  const queryTimings: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    const started = performance.now();
    await directory.listFacilities(ura1, { query: `Phase 11 Facility ${runTag}`, page: 1 + (index % 4), pageSize: 25, sort: index % 2 ? 'name' : 'city' });
    queryTimings.push(performance.now() - started);
  }
  queryTimings.sort((left, right) => left - right);
  const p95 = queryTimings[Math.ceil(queryTimings.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
  record('10,000-provider directory p95', '< 750 ms', `${p95.toFixed(1)} ms`, p95 < 750);
  const loadStarted = performance.now();
  const load = await Promise.allSettled(Array.from({ length: 50 }, (_, index) => directory.listFacilities(ura1, { page: 1 + (index % 10), pageSize: 25, sort: index % 2 ? 'freshness' : 'last_verified' })));
  const loadElapsed = performance.now() - loadStarted;
  record('Bounded concurrent directory load', '50/50 successful in < 15 seconds', `${load.filter((item) => item.status === 'fulfilled').length}/50 in ${Math.round(loadElapsed)} ms`, load.every((item) => item.status === 'fulfilled') && loadElapsed < 15_000);

  const persistedBefore = requireRow((await pool.query<{ facilities: number; events: number; checksum: string }>(`
    with selected as (select id,display_key,current_accepting_status from facilities where source_metadata->>'phase11Run'=$1)
    select count(*)::int facilities,
      (select count(*)::int from facility_verification_events where facility_id in (select id from selected)) events,
      md5(string_agg(display_key||':'||current_accepting_status::text,'|' order by display_key)) checksum from selected`, [marker])).rows, 'persistence before');
  await database.closeDatabasePool();
  const afterRestartPage = await directory.listFacilities(ura1, { query: `North Harbor Pediatric Truth ${runTag}`, pageSize: 10 });
  const reconnect = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const persistedAfter = requireRow((await reconnect.query<{ facilities: number; events: number; checksum: string }>(`
    with selected as (select id,display_key,current_accepting_status from facilities where source_metadata->>'phase11Run'=$1)
    select count(*)::int facilities,
      (select count(*)::int from facility_verification_events where facility_id in (select id from selected)) events,
      md5(string_agg(display_key||':'||current_accepting_status::text,'|' order by display_key)) checksum from selected`, [marker])).rows, 'persistence after');
  await reconnect.end();
  record('Application database reconnect persistence', 'counts and checksum unchanged', `${persistedAfter.facilities}/${persistedAfter.events}/${persistedAfter.checksum}`, afterRestartPage.total === 1 && JSON.stringify(persistedBefore) === JSON.stringify(persistedAfter));

  const forbiddenText = await pool.query<{ count: number }>(`
    select count(*)::int as count from facilities where source_metadata->>'phase11Run'=$1 and (facility_name ilike '%real member%' or source_metadata ? 'memberId')`, [marker]);
  record('Synthetic-data boundary', 'no real-member markers', forbiddenText.rows[0]?.count ?? -1, forbiddenText.rows[0]?.count === 0);

  const postgis = await pool.query<{ enabled: boolean }>(`select exists(select 1 from pg_extension where extname='postgis') as enabled`);
  record('PostGIS staging dependency', 'recorded for IT validation when unavailable', postgis.rows[0]?.enabled ? 'available' : 'not available locally', true);

  const failed = results.filter((result) => !result.pass);
  console.table(results);
  process.stdout.write(`${JSON.stringify({
    status: failed.length ? 'FAIL' : 'PASS',
    run: marker,
    facilityCount,
    checks: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    postgisAvailable: postgis.rows[0]?.enabled === true,
    data: counts,
    results,
  }, null, 2)}\n`);
  if (failed.length) process.exitCode = 1;
}

try {
  await cleanup();
  await main();
} finally {
  await cleanup();
  await pool.end();
}
