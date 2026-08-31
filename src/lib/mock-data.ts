export const statCards = [
  { label: 'Calls this week', value: '148', tone: 'badge-positive' },
  { label: 'Open reviews', value: '31', tone: 'badge-warning' },
  { label: 'Duplicate warnings', value: '12', tone: 'badge-danger' },
  { label: 'Avg success rate', value: '76%', tone: 'badge-info' },
];

export const quickActions = [
  { label: 'Start authorization', href: '/authorization-summary', accent: 'bg-slate-900 text-white' },
  { label: 'Provider search', href: '/provider-search', accent: 'bg-sky-100 text-sky-900' },
  { label: 'Review queue', href: '/review-queue', accent: 'bg-amber-100 text-amber-900' },
];

export const providerResults = [
  {
    facility: 'Brunswick Clinic',
    city: 'Brunswick',
    specialty: 'Pulmonology',
    distance: '11.2 mi',
    phone: '(207) 725-2000',
    status: 'Accepting new patients',
    result: 'meets availability guidelines',
    nextStep: 'Call within 24 hours',
  },
  {
    facility: 'Midcoast Center',
    city: 'Bath',
    specialty: 'Cardiology',
    distance: '18.5 mi',
    phone: '(207) 442-1100',
    status: 'No current openings',
    result: 'does not meet availability guidelines',
    nextStep: 'Place on hold',
  },
  {
    facility: 'MaineHealth Cancer Care',
    city: 'Topsham',
    specialty: 'Oncology',
    distance: '24.0 mi',
    phone: '(207) 729-1000',
    status: 'Accepting new patients',
    result: 'meets availability guidelines - urgent referral required',
    nextStep: 'Urgent referral required',
  },
];

export const callLogRows = [
  { trackingId: 'PT-00000000-0000-4000-8000-000000000101', provider: 'Brunswick Clinic', outcome: 'meets availability guidelines', status: 'Review needed', date: '2026-05-04' },
  { trackingId: 'PT-00000000-0000-4000-8000-000000000102', provider: 'Topsham Specialty', outcome: 'unable to contact', status: 'Retry due', date: '2026-05-03' },
  { trackingId: 'PT-00000000-0000-4000-8000-000000000103', provider: 'MaineHealth Cancer Care', outcome: 'does not meet availability guidelines', status: 'Closed', date: '2026-05-02' },
];

export const reviewQueue = [
  { facility: 'Brunswick Clinic', caseId: 'PT-00000000-0000-4000-8000-000000000101', due: 'Due today', priority: 'warning', owner: 'DS' },
  { facility: 'Topsham Specialty', caseId: 'PT-00000000-0000-4000-8000-000000000102', due: 'Due in 3 days', priority: 'info', owner: 'AB' },
  { facility: 'Midcoast Center', caseId: 'PT-00000000-0000-4000-8000-000000000103', due: 'Overdue', priority: 'danger', owner: 'MR' },
];

export const facilityRows = [
  { name: 'Brunswick Clinic', city: 'Brunswick', type: 'Clinic', status: 'Active', specialty: 'Pulmonology' },
  { name: 'Topsham Specialty', city: 'Topsham', type: 'Specialty', status: 'Active', specialty: 'Cardiology' },
  { name: 'MaineHealth Cancer Care', city: 'Topsham', type: 'Cancer Center', status: 'Active', specialty: 'Oncology' },
  { name: 'Midcoast Center', city: 'Bath', type: 'Hospital', status: 'Needs review', specialty: 'Orthopedics' },
];

export const reportMetrics = [
  { label: 'Calls completed', value: '148', change: '+12%' },
  { label: 'Calls meeting criteria', value: '76', change: '+4.3%' },
  { label: 'Avg turnaround', value: '2.4d', change: '-0.6d' },
  { label: 'Import match rate', value: '96.8%', change: '+1.2%' },
];
