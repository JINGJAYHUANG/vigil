import test from 'node:test';
import assert from 'node:assert/strict';

import { parseProduct, parseProblemCodes, formatProblemCodes, problemCodeOf, isReportedIndividually, factSheet } from '../src/engine/settings.js';
import { computeClocks } from '../src/engine/clocks.js';
import { toEntity } from '../src/store/entity.js';

test('product settings are validated and normalized', () => {
  const { product } = parseProduct({
    key: 'fb-20', name: 'FB-20 infusion pump', projectKey: 'cmp', markets: ['us', 'EU'],
    riskFilePageId: 'https://example.atlassian.net/wiki/spaces/QMS/pages/123456/FB-20+Risk+management+file',
    qualitySpaceKey: 'qms', problemCodes: 'occlusion-alarm-delay | Occlusion alarm delayed | 0.8 | 30\nbattery-door | Battery door damage | 1.5',
    euHolidays: '2026-12-25, 2026-12-26',
  });
  assert.equal(product.key, 'FB-20');
  assert.equal(product.projectKey, 'CMP');
  assert.deepEqual(product.markets, ['US', 'EU']);
  assert.equal(product.riskFilePageId, '123456');
  assert.equal(product.qualitySpaceKey, 'QMS');
  assert.deepEqual(product.problemCodes[1], { code: 'battery-door', name: 'Battery door damage', expected: 1.5, windowDays: 30 });
  assert.deepEqual(product.euHolidays, ['2026-12-25', '2026-12-26']);
  assert.equal(formatProblemCodes(product.problemCodes).split('\n')[0], 'occlusion-alarm-delay | Occlusion alarm delayed | 0.8 | 30');
  assert.match(parseProduct({ key: 'FB-20', projectKey: 'CMP', markets: [] }).error, /market/);
  assert.match(parseProduct({ key: 'FB-20', projectKey: 'CMP', markets: ['US'], euHolidays: '25/12/2026' }).error, /YYYY-MM-DD/);
  assert.match(parseProblemCodes('bad code | x | 1').errors[0], /without spaces/);
  assert.match(parseProblemCodes('door | x | 0').errors[0], /above 0/);
});

test('problem codes, serious incidents and the agent fact sheet', () => {
  assert.equal(problemCodeOf(['urgent', 'battery-door'], [{ code: 'battery-door' }]), 'battery-door');
  assert.equal(problemCodeOf(['urgent'], [{ code: 'battery-door' }]), null);
  const serious = computeClocks({ markets: ['EU'], today: '2026-11-13', assessment: { awarenessDate: '2026-11-02', criteria: { seriousInjury: 'yes', causality: 'possible' } } });
  const minor = computeClocks({ markets: ['EU'], today: '2026-11-13', assessment: { awarenessDate: '2026-11-02', criteria: { death: 'no', seriousInjury: 'no', publicHealthThreat: 'no', malfunction: 'yes', couldCauseSeriousInjury: 'no' } } });
  const open = computeClocks({ markets: ['EU'], today: '2026-11-13', provisionalAwareness: '2026-11-02' });
  assert.equal(isReportedIndividually(serious), true);
  assert.equal(isReportedIndividually(minor), false);
  assert.equal(isReportedIndividually(open), false);
  const sheet = factSheet(
    { key: 'CMP-1', summary: 'No occlusion alarm', createdAt: '2026-11-06T09:00:00.000+0000', description: 'Pump ran dry.' },
    [{ createdAt: '2026-11-06T10:15:00.000Z', author: 'Sam Ortiz', text: 'Customer called me on 2 Nov.' }],
  );
  assert.match(sheet, /\[2026-11-06 10:15\] Sam Ortiz: Customer called me on 2 Nov\./);
});

test('entity values leave out empty attributes', () => {
  assert.deepEqual(toEntity({ complaintKey: 'CMP-1', rationale: '', submissions: {}, evidence: { death: 'x' }, criteria: null }), { complaintKey: 'CMP-1', evidence: { death: 'x' } });
});

test('agent answers and evidence are parsed from text', async () => {
  const { parseAnswers, parseEvidence } = await import('../src/engine/settings.js');
  assert.deepEqual(parseAnswers('death=no; seriousInjury=Yes;\ncouldCauseSeriousInjury: yes, causality=reasonably possible; bogus=1'), {
    death: 'no', seriousInjury: 'yes', couldCauseSeriousInjury: 'yes', causality: 'reasonably possible',
  });
  assert.deepEqual(parseEvidence('seriousInjury: "the patient needed surgery"\n- awareness: rep heard on 2 Nov\nnoise'), {
    seriousInjury: '"the patient needed surgery"', awareness: 'rep heard on 2 Nov',
  });
});

test('evidence on one line is split by criterion', async () => {
  const { parseEvidence } = await import('../src/engine/settings.js');
  const one = parseEvidence('death: Recovering. seriousInjury: the patient developed diabetic ketoacidosis. malfunction: The pump kept showing "Infusing". couldCauseSeriousInjury: The event resulted in DKA. unanticipated: Hazard H-02 covers it. causality: The pump failed to alarm.');
  assert.equal(one.death, 'Recovering.');
  assert.equal(one.seriousInjury, 'the patient developed diabetic ketoacidosis.');
  assert.equal(one.couldCauseSeriousInjury, 'The event resulted in DKA.');
  assert.equal(one.unanticipated, 'Hazard H-02 covers it.');
  assert.equal(one.causality, 'The pump failed to alarm.');
  assert.equal(one.malfunction, 'The pump kept showing "Infusing".');
});
