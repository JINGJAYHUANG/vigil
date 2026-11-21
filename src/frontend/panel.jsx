import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Button, ButtonGroup, DatePicker, EmptyState, Inline, Label, Link, Lozenge, SectionMessage, Select, Spinner, Stack,
  Strong, Text, TextArea, Textfield,
} from '@forge/react';
import { invoke, rovo } from '@forge/bridge';

const AGENT = { type: 'forge', agentKey: 'vigil-agent', agentName: 'Vigil' };
export const APPEARANCE = {
  overdue: 'removed', 'due-today': 'removed', 'due-soon': 'moved', 'needs-assessment': 'new', open: 'inprogress',
  submitted: 'success', 'submitted-late': 'default', 'not-required': 'default',
};
const TRI = [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }, { label: 'Unknown', value: 'unknown' }];
const CAUSALITY = [
  { label: 'Established', value: 'established' }, { label: 'Reasonably possible', value: 'possible' },
  { label: 'Excluded', value: 'excluded' }, { label: 'Unknown', value: 'unknown' },
];
const ANSWER = { yes: 'Yes', no: 'No', unknown: 'Unknown' };
const CAUSALITY_TEXT = { established: 'Established', possible: 'Reasonably possible', excluded: 'Excluded', unknown: 'Unknown' };
const REGULATORS = [
  { label: 'FDA initial report', value: 'FDA' }, { label: 'FDA supplemental report', value: 'FDA-SUPP' },
  { label: 'FDA separate 5-day report', value: 'FDA-5' }, { label: 'EU report (MIR)', value: 'EU' },
];

function Requirement({ r }) {
  const due = r.dueDateText ? ` · ${r.status === 'needs-assessment' ? 'if reportable, due' : 'due'} ${r.dueDateText}` : '';
  return (
    <Stack space="space.050">
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Lozenge appearance={APPEARANCE[r.status] ?? 'default'}>{r.label}</Lozenge>
        <Text><Strong>{`${r.regulator} · ${r.report}`}</Strong>{due}</Text>
      </Inline>
      <Text size="small">{r.reason}</Text>
      {r.submittedOn ? <Text size="small">{`Sent ${r.submittedOn}${r.reference ? ` · ${r.reference}` : ''}`}</Text> : null}
    </Stack>
  );
}

function AssessForm({ criteria, current, defaultAwareness, onDone }) {
  const initial = { awarenessDate: current?.awarenessDate ?? defaultAwareness, awarenessQuote: current?.awarenessQuote ?? '', rationale: current?.rationale ?? '', causality: current?.criteria?.causality ?? 'unknown', remedialDate: current?.remedialDate ?? '' };
  for (const c of criteria) initial[c.key] = current?.criteria?.[c.key] ?? 'unknown';
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (x) => setV({ ...v, [k]: x?.target ? x.target.value : (x?.value ?? x) });
  const save = async () => {
    setBusy(true);
    const res = await invoke('saveAssessment', v).catch(() => ({ ok: false, error: 'Vigil could not save the assessment.' }));
    setBusy(false);
    if (res?.ok) onDone(); else setError(res?.error ?? 'Not saved.');
  };
  const pick = (options, value) => options.find((o) => o.value === value);
  return (
    <Stack space="space.150">
      <Label labelFor="aware">Awareness date (the day any employee first learned of the event)</Label>
      <DatePicker placeholder="Select a date" id="aware" value={v.awarenessDate} onChange={set('awarenessDate')} />
      <Label labelFor="quote">Where that date comes from</Label>
      <Textfield id="quote" value={v.awarenessQuote} onChange={set('awarenessQuote')} placeholder="Sales rep comment: customer called on 2 Nov" />
      {criteria.map((c) => (
        <Stack key={c.key} space="space.050">
          <Label labelFor={c.key}>{c.label}</Label>
          <Select inputId={c.key} options={TRI} value={pick(TRI, v[c.key])} onChange={set(c.key)} />
        </Stack>
      ))}
      <Label labelFor="causality">Causal relationship with the device</Label>
      <Select inputId="causality" options={CAUSALITY} value={pick(CAUSALITY, v.causality)} onChange={set('causality')} />
      <Label labelFor="remedial">Date the need for remedial action was known (optional)</Label>
      <DatePicker placeholder="Select a date" id="remedial" value={v.remedialDate || undefined} onChange={set('remedialDate')} />
      <Label labelFor="rationale">Rationale</Label>
      <TextArea id="rationale" value={v.rationale} onChange={set('rationale')} />
      {error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : null}
      <ButtonGroup>
        <Button appearance="primary" onClick={save} isDisabled={busy}>Save assessment</Button>
        <Button onClick={() => onDone(false)}>Cancel</Button>
      </ButtonGroup>
    </Stack>
  );
}

function SubmissionForm({ onDone }) {
  const [regulator, setRegulator] = useState(REGULATORS[0]);
  const [on, setOn] = useState('');
  const [ref, setRef] = useState('');
  const [error, setError] = useState(null);
  const save = async () => {
    const res = await invoke('recordSubmission', { regulator: regulator?.value, submittedOn: on, reference: ref }).catch(() => ({ ok: false, error: 'Not saved.' }));
    if (res?.ok) onDone(); else setError(res?.error ?? 'Not saved.');
  };
  return (
    <Stack space="space.100">
      <Label labelFor="reg">Report</Label>
      <Select inputId="reg" options={REGULATORS} value={regulator} onChange={setRegulator} />
      <Label labelFor="on">Date sent</Label>
      <DatePicker placeholder="Select a date" id="on" value={on || undefined} onChange={setOn} />
      <Label labelFor="ref">Report number or reference</Label>
      <Textfield id="ref" value={ref} onChange={(e) => setRef(e.target.value)} />
      {error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : null}
      <ButtonGroup>
        <Button appearance="primary" onClick={save}>Record</Button>
        <Button onClick={() => onDone(false)}>Cancel</Button>
      </ButtonGroup>
    </Stack>
  );
}

function NewInfoForm({ onDone }) {
  const [day, setDay] = useState('');
  const [error, setError] = useState(null);
  const save = async () => {
    const res = await invoke('recordSubmission', { newInfoDate: day }).catch(() => ({ ok: false, error: 'Not saved.' }));
    if (res?.ok) onDone(); else setError(res?.error ?? 'Not saved.');
  };
  return (
    <Stack space="space.100">
      <Label labelFor="info">Date the new information was received</Label>
      <DatePicker placeholder="Select a date" id="info" value={day || undefined} onChange={setDay} />
      {error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : null}
      <ButtonGroup>
        <Button appearance="primary" onClick={save}>Start the supplemental clock</Button>
        <Button onClick={() => onDone(false)}>Cancel</Button>
      </ButtonGroup>
    </Stack>
  );
}

const App = () => {
  const [data, setData] = useState(null);
  const [mode, setMode] = useState(null);
  const [rovoEnabled, setRovoEnabled] = useState(false);
  const [record, setRecord] = useState(null);

  const load = () => invoke('getPanel').then(setData).catch(() => setData({ ok: false, error: 'Vigil could not load the clocks.' }));
  useEffect(() => {
    load();
    rovo.isEnabled().then(setRovoEnabled).catch(() => setRovoEnabled(false));
  }, []);
  const done = (changed = true) => { setMode(null); if (changed !== false) load(); };

  if (!data) return <Spinner label="Loading reporting clocks" />;
  if (!data.ok) return <SectionMessage appearance="warning" title="Vigil could not load the clocks"><Text>{data.error}</Text></SectionMessage>;
  if (!data.configured) {
    return <EmptyState header="This project is not set up in Vigil" description={`Add the project ${data.projectKey} under Apps > Vigilance > Products to see reporting clocks.`} />;
  }

  const { clocks, assessment, product, complaint } = data;
  const assess = () => rovo.open({ ...AGENT, prompt: `Assess complaint ${complaint.key} for reportability.` });
  const writeRecord = async () => {
    setRecord({ busy: true });
    setRecord(await invoke('writeDecisionRecord').catch(() => ({ ok: false, error: 'Not created.' })));
  };
  const facts = assessment ? data.criteria.filter((c) => c.key !== 'unanticipated' && assessment.criteria?.[c.key] && assessment.criteria[c.key] !== 'no') : [];

  return (
    <Stack space="space.200">
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Lozenge appearance={APPEARANCE[clocks.overall.status] ?? 'default'} isBold>{clocks.overall.label}</Lozenge>
        <Text>{`${product.name} · marketed in ${product.markets.join(' and ')}`}</Text>
      </Inline>

      {clocks.provisional ? (
        <SectionMessage appearance="warning" title="No reportability decision yet">
          <Text>{`The clocks below count from the day this complaint was created (${clocks.awarenessDate}). The real awareness date is the day any employee first learned of the event, and it may be earlier.`}</Text>
        </SectionMessage>
      ) : (
        <Stack space="space.050">
          <Text><Strong>{`Aware since ${assessment.awarenessDate}`}</Strong>{assessment.awarenessQuote ? `: "${assessment.awarenessQuote}"` : ''}</Text>
          {assessment.reportabilityDate ? <Text size="small">{`Became reportable on new information on ${assessment.reportabilityDate}; the clocks start then.`}</Text> : null}
        </Stack>
      )}

      {clocks.requirements.map((r) => <Requirement key={r.id} r={r} />)}

      {assessment ? (
        <Stack space="space.050">
          <Text><Strong>Facts confirmed</Strong>{facts.length ? '' : ': none of the reporting criteria apply.'}</Text>
          {facts.map((c) => (
            <Text key={c.key} size="small">{`${c.label}: ${ANSWER[assessment.criteria[c.key]]}${assessment.evidence?.[c.key] ? `. "${assessment.evidence[c.key]}"` : ''}`}</Text>
          ))}
          {assessment.criteria?.unanticipated === 'no' && (assessment.criteria?.seriousInjury === 'yes') ? (
            <Text size="small">{`Anticipated in the risk assessment${assessment.evidence?.unanticipated ? `: "${assessment.evidence.unanticipated.replace(/[.\s]+$/, '')}"` : ''}. EU limit 15 days, not 10 (MDCG 2023-3 Q12).`}</Text>
          ) : null}
          <Text size="small">{`Causal relationship: ${CAUSALITY_TEXT[assessment.criteria?.causality] ?? 'Unknown'}${assessment.evidence?.causality ? `. "${assessment.evidence.causality}"` : ''}`}</Text>
          {assessment.rationale ? <Text size="small">{`Rationale: ${assessment.rationale}`}</Text> : null}
        </Stack>
      ) : null}

      {data.riskFile.linked.length || data.riskFile.owners.length ? (
        <Stack space="space.050">
          <Text><Strong>Risk management file</Strong> (from Teamwork Graph)</Text>
          <Inline space="space.100" shouldWrap>
            {data.riskFile.linked.map((p) => <Link key={p.pageId} href={p.url} openNewTab>{p.title}</Link>)}
          </Inline>
          {data.riskFile.owners.length ? <Text size="small">{`Owner: ${data.riskFile.owners.join(', ')}. A new harm or a higher rate may need a risk review.`}</Text> : null}
        </Stack>
      ) : null}

      {mode === 'assess' ? <AssessForm criteria={data.criteria} current={assessment} defaultAwareness={clocks.awarenessDate} onDone={done} /> : null}
      {mode === 'submit' ? <SubmissionForm onDone={done} /> : null}
      {mode === 'info' ? <NewInfoForm onDone={done} /> : null}

      {!mode ? (
        <Inline space="space.100" shouldWrap>
          {rovoEnabled ? <Button appearance={assessment ? 'default' : 'primary'} onClick={assess}>Assess with Rovo</Button> : null}
          <Button onClick={() => setMode('assess')}>{assessment ? 'Edit assessment' : 'Assess manually'}</Button>
          {assessment ? <Button onClick={() => setMode('submit')}>Record a report</Button> : null}
          {assessment?.newInfoDate === null && clocks.requirements.some((r) => r.id === 'FDA' && r.submittedOn) ? <Button onClick={() => setMode('info')}>New information</Button> : null}
          {assessment && !assessment.decisionPageUrl ? <Button onClick={writeRecord} isDisabled={record?.busy}>Write decision record</Button> : null}
        </Inline>
      ) : null}
      {assessment?.decisionPageUrl ? <Link href={assessment.decisionPageUrl} openNewTab>Decision record in Confluence</Link> : null}
      {record && !record.busy && !record.ok ? <SectionMessage appearance="error"><Text>{record.error}</Text></SectionMessage> : null}
      {record?.ok ? <Link href={record.page.url} openNewTab>{`Decision record created: ${record.page.title}`}</Link> : null}
      <Text size="small">Vigil does the date arithmetic from the facts people confirm. It does not replace your complaint handling procedure and does not submit reports.</Text>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
