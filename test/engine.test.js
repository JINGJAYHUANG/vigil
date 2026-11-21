import test from 'node:test';
import assert from 'node:assert/strict';

import { federalHolidaysOf, isFederalHoliday, addWorkDays, skippedDays } from '../src/engine/holidays.js';
import { computeClocks, euLatestDate, nextDue, isSettled, normalizeCriteria } from '../src/engine/clocks.js';
import { poissonTail, trendSignals } from '../src/engine/trend.js';

const BOTH = ['US', 'EU'];
const crit = (o) => ({
  death: 'no', seriousInjury: 'no', malfunction: 'no', couldCauseSeriousInjury: 'no', publicHealthThreat: 'no',
  unanticipated: 'no', remedialAction: 'no', fdaRequest: 'no', expectedSideEffect: 'no', causality: 'possible', ...o,
});
const byId = (clocks) => Object.fromEntries(clocks.requirements.map((r) => [r.id, r]));

test('federal holidays match the OPM schedules for 2026 and 2027 (observed dates)', () => {
  assert.deepEqual(federalHolidaysOf(2026).map((h) => h.date), [
    '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03',
    '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25',
  ]);
  assert.deepEqual(federalHolidaysOf(2027).map((h) => h.date), [
    '2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31', '2027-06-18', '2027-07-05',
    '2027-09-06', '2027-10-11', '2027-11-11', '2027-11-25', '2027-12-24',
  ]);
  // 1 January 2028 is a Saturday, so it is observed on Friday 31 December 2027.
  assert.equal(isFederalHoliday('2027-12-31'), true);
  assert.equal(isFederalHoliday('2026-11-27'), false);
});

test('5 work days skip weekends and federal holidays (21 CFR 803.3)', () => {
  assert.equal(addWorkDays('2026-11-12', 5), '2026-11-19');
  assert.deepEqual(skippedDays('2026-11-12', '2026-11-19'), ['2026-11-14', '2026-11-15']);
  assert.equal(addWorkDays('2026-11-23', 5), '2026-12-01'); // Thanksgiving, 26 Nov
  assert.equal(addWorkDays('2026-11-09', 3), '2026-11-13'); // Veterans Day, 11 Nov
});

test('EU limits: plain day count, with the Regulation 1182/71 extension reported as a note', () => {
  assert.deepEqual(euLatestDate('2026-11-02', 15), { nominal: '2026-11-17', end: '2026-11-17', note: '' });
  const sat = euLatestDate('2026-11-06', 15);
  assert.equal(sat.nominal, '2026-11-21');
  assert.equal(sat.end, '2026-11-23');
  assert.match(sat.note, /Sat 21 Nov 2026.*Mon 23 Nov 2026/);
  assert.equal(euLatestDate('2026-11-13', 2).end, '2026-11-17'); // Friday: Sunday moves to Monday, then two working days
  assert.equal(euLatestDate('2026-11-12', 2).end, '2026-11-16');
  assert.equal(euLatestDate('2026-12-10', 15, ['2026-12-25']).end, '2026-12-28');
});

test('serious injury, anticipated in the risk file: FDA 30 days and EU 15 days', () => {
  const clocks = computeClocks({
    markets: BOTH, today: '2026-11-13',
    assessment: { awarenessDate: '2026-11-02', criteria: crit({ seriousInjury: 'yes', malfunction: 'yes', couldCauseSeriousInjury: 'yes' }) },
  });
  const r = byId(clocks);
  assert.equal(r.FDA.report, '30-day MDR');
  assert.equal(r.FDA.dueDate, '2026-12-02');
  assert.equal(r.FDA.status, 'open');
  assert.match(r.FDA.reason, /803\.50\(a\)\(1\)/);
  assert.equal(r.EU.dueDate, '2026-11-17');
  assert.equal(r.EU.cite, 'MDR Art. 87(3)');
  assert.equal(r.EU.status, 'open');
  assert.equal(clocks.overall.regulator, 'EU');
  assert.equal(nextDue(clocks), '2026-11-17');
});

test('serious injury not yet confirmed as anticipated uses the 10-day EU limit', () => {
  const clocks = computeClocks({
    markets: BOTH, today: '2026-11-13',
    assessment: { awarenessDate: '2026-11-02', criteria: crit({ seriousInjury: 'yes', unanticipated: 'unknown' }) },
  });
  const eu = byId(clocks).EU;
  assert.equal(eu.dueDate, '2026-11-12');
  assert.equal(eu.status, 'overdue');
  assert.equal(eu.cite, 'MDR Art. 87(5)');
});

test('death with causality not established: report anyway (Art. 87(7)), FDA 30 days', () => {
  const clocks = computeClocks({
    markets: BOTH, today: '2026-11-13',
    assessment: { awarenessDate: '2026-11-10', criteria: crit({ death: 'yes', causality: 'unknown' }) },
  });
  const r = byId(clocks);
  assert.equal(r.EU.dueDate, '2026-11-20');
  assert.match(r.EU.reason, /87\(7\)/);
  assert.equal(r.FDA.dueDate, '2026-12-10');
});

test('malfunction with no possible serious harm: not reportable, counts towards trends', () => {
  const clocks = computeClocks({ markets: BOTH, today: '2026-11-13', assessment: { awarenessDate: '2026-11-05', criteria: crit({ malfunction: 'yes' }) } });
  const r = byId(clocks);
  assert.equal(r.FDA.status, 'not-required');
  assert.equal(r.EU.status, 'not-required');
  assert.match(r.EU.reason, /Art\. 88/);
  assert.equal(clocks.overall.status, 'not-required');
  assert.equal(isSettled(clocks), true);
  assert.equal(nextDue(clocks), null);
});

test('remedial action: FDA 5-day report over a weekend; EU serious incident because it might lead to harm', () => {
  const clocks = computeClocks({
    markets: BOTH, today: '2026-11-13',
    assessment: {
      awarenessDate: '2026-11-12', remedialDate: '2026-11-12',
      criteria: crit({ malfunction: 'yes', couldCauseSeriousInjury: 'yes', remedialAction: 'yes' }),
    },
  });
  const r = byId(clocks);
  assert.equal(r.FDA.report, '5-day report');
  assert.equal(r.FDA.dueDate, '2026-11-19');
  assert.match(r.FDA.reason, /Sat 14 Nov 2026, Sun 15 Nov 2026/);
  assert.equal(r['FDA-5'], undefined);
  assert.equal(r.EU.dueDate, '2026-11-27');
  assert.match(r.EU.reason, /might lead/);
});

test('remedial need found late: separate 5-day report after the 30-day one', () => {
  const clocks = computeClocks({
    markets: ['US'], today: '2026-11-13',
    assessment: { awarenessDate: '2026-10-01', remedialDate: '2026-11-09', criteria: crit({ seriousInjury: 'yes', remedialAction: 'yes' }) },
  });
  const r = byId(clocks);
  assert.equal(r.FDA.report, '30-day MDR');
  assert.equal(r.FDA.dueDate, '2026-10-31');
  assert.equal(r.FDA.status, 'overdue');
  assert.equal(r['FDA-5'].dueDate, '2026-11-17'); // Tue 10, (Veterans Day), Thu 12, Fri 13, Mon 16, Tue 17
});

test('no assessment yet: provisional clocks from the creation date', () => {
  const clocks = computeClocks({ markets: BOTH, today: '2026-11-13', provisionalAwareness: '2026-11-06' });
  const r = byId(clocks);
  assert.equal(clocks.provisional, true);
  assert.equal(r.FDA.status, 'needs-assessment');
  assert.equal(r.FDA.dueDate, '2026-12-06');
  assert.equal(r.EU.dueDate, '2026-11-21');
  assert.match(r.EU.reason, /Mon 23 Nov 2026/);
  assert.equal(clocks.overall.status, 'needs-assessment');
});

test('submissions and the 803.56 supplemental clock', () => {
  const clocks = computeClocks({
    markets: BOTH, today: '2026-11-26',
    assessment: {
      awarenessDate: '2026-11-02', newInfoDate: '2026-11-25',
      criteria: crit({ seriousInjury: 'yes' }),
      submissions: { FDA: { on: '2026-11-20', ref: '3001234567-2026-00012' }, EU: { on: '2026-11-18', ref: 'MIR-2026-0042' } },
    },
  });
  const r = byId(clocks);
  assert.equal(r.FDA.status, 'submitted');
  assert.equal(r.EU.status, 'submitted-late');
  assert.equal(r['FDA-SUPP'].dueDate, '2026-12-25');
  assert.equal(clocks.overall.regulator, 'FDA');
});

test('expected side-effect and excluded causality', () => {
  const side = byId(computeClocks({ markets: BOTH, today: '2026-11-13', assessment: { awarenessDate: '2026-11-02', criteria: crit({ seriousInjury: 'yes', expectedSideEffect: 'yes' }) } }));
  assert.equal(side.EU.status, 'not-required');
  assert.match(side.EU.reason, /87\(1\)\(a\)/);
  assert.equal(side.FDA.report, '30-day MDR');
  const excluded = byId(computeClocks({ markets: BOTH, today: '2026-11-13', assessment: { awarenessDate: '2026-11-02', criteria: crit({ seriousInjury: 'yes', causality: 'excluded' }) } }));
  assert.equal(excluded.FDA.status, 'not-required');
  assert.equal(excluded.EU.status, 'not-required');
});

test('reportability found on new information: the EU period starts then (MDCG 2023-3 Q14 example)', () => {
  const clocks = computeClocks({
    markets: ['EU'], today: '2022-07-05',
    assessment: { awarenessDate: '2022-06-01', reportabilityDate: '2022-07-01', criteria: crit({ seriousInjury: 'yes' }) },
  });
  const eu = byId(clocks).EU;
  assert.equal(eu.dueDate, '2022-07-16');
  assert.equal(clocks.clockStart, '2022-07-01');
});

test('only the configured markets get clocks', () => {
  const clocks = computeClocks({ markets: ['EU'], today: '2026-11-13', assessment: { awarenessDate: '2026-11-02', criteria: crit({ death: 'yes' }) } });
  assert.deepEqual(clocks.requirements.map((r) => r.id), ['EU']);
  assert.equal(normalizeCriteria({ death: { value: 'Yes' }, causality: 'reasonably possible' }).causality, 'possible');
});

test('Poisson tail and trend signals (MDR Art. 88)', () => {
  assert.ok(Math.abs(poissonTail(4, 0.8) - 0.00908) < 1e-4);
  assert.ok(Math.abs(poissonTail(5, 1) - 0.00366) < 1e-4);
  assert.equal(poissonTail(0, 2), 1);
  const incidents = [
    { key: 'CMP-4', code: 'occlusion-alarm-delay', date: '2026-10-20', serious: false },
    { key: 'CMP-5', code: 'occlusion-alarm-delay', date: '2026-10-29', serious: false },
    { key: 'CMP-6', code: 'occlusion-alarm-delay', date: '2026-11-04', serious: false },
    { key: 'CMP-7', code: 'occlusion-alarm-delay', date: '2026-11-11', serious: false },
    { key: 'CMP-1', code: 'occlusion-alarm-delay', date: '2026-11-02', serious: true },
    { key: 'CMP-0', code: 'occlusion-alarm-delay', date: '2026-09-01', serious: false },
    { key: 'CMP-3', code: 'battery-door', date: '2026-11-05', serious: false },
  ];
  const codes = [
    { code: 'occlusion-alarm-delay', name: 'Occlusion alarm delayed', expected: 0.8, windowDays: 30 },
    { code: 'battery-door', name: 'Battery door damage', expected: 1.5, windowDays: 30 },
  ];
  const [occ, door] = trendSignals({ incidents, codes, today: '2026-11-13' });
  assert.equal(occ.observed, 4);
  assert.equal(occ.signal, true);
  assert.deepEqual(occ.keys, ['CMP-4', 'CMP-5', 'CMP-6', 'CMP-7']);
  assert.match(occ.reason, /p = 0\.009/);
  assert.equal(door.observed, 1);
  assert.equal(door.signal, false);
});
