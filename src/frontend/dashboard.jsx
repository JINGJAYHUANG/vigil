import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  BarChart, Button, ButtonGroup, Checkbox, DonutChart, DynamicTable, EmptyState, Heading, Inline, Label, Link, Lozenge,
  SectionMessage, Spinner, Stack, Strong, Text, TextArea, Textfield,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const APPEARANCE = {
  overdue: 'removed', 'due-today': 'removed', 'due-soon': 'moved', 'needs-assessment': 'new', open: 'inprogress',
  submitted: 'success', 'submitted-late': 'default', 'not-required': 'default',
};
const STATUS_LABEL = {
  overdue: 'Overdue', 'due-today': 'Due today', 'due-soon': 'Due within 3 days', 'needs-assessment': 'Needs assessment',
  open: 'Report pending', submitted: 'Submitted', 'submitted-late': 'Submitted late', 'not-required': 'Not reportable',
};
const ORDER = ['overdue', 'due-today', 'due-soon', 'needs-assessment', 'open', 'submitted-late', 'submitted', 'not-required'];
const PALETTE = [
  { key: 'Overdue', value: '#C9372C' }, { key: 'Due today', value: '#AE2E24' }, { key: 'Due within 3 days', value: '#E2B203' },
  { key: 'Needs assessment', value: '#6E5DC6' }, { key: 'Report pending', value: '#1D7AFC' }, { key: 'Submitted late', value: '#8590A2' },
  { key: 'Submitted', value: '#22A06B' }, { key: 'Not reportable', value: '#B3B9C4' },
];
const TREND_PALETTE = [{ key: 'Observed', value: '#C9372C' }, { key: 'Expected', value: '#8590A2' }];

const head = {
  cells: [
    { key: 'status', content: 'Status', isSortable: true, width: 14 },
    { key: 'complaint', content: 'Complaint', width: 38 },
    { key: 'next', content: 'Next deadline', isSortable: true, width: 22 },
    { key: 'aware', content: 'Day 0', isSortable: true, width: 12 },
    { key: 'code', content: 'Problem code', width: 14 },
  ],
};

function rows(items) {
  return items.map((r) => ({
    key: r.key,
    cells: [
      { key: ORDER.indexOf(r.overall.status), content: <Lozenge appearance={APPEARANCE[r.overall.status] ?? 'default'}>{r.overall.label}</Lozenge> },
      {
        key: r.key,
        content: (
          <Stack space="space.025">
            <Link href={r.url}>{r.key}</Link>
            <Text size="small">{r.summary}</Text>
          </Stack>
        ),
      },
      {
        key: r.overall.dueDate ?? '9999',
        content: r.overall.dueDate ? <Text>{`${r.overall.regulator} ${r.overall.report}: ${r.dueDateText}`}</Text> : <Text size="small">None</Text>,
      },
      { key: r.awarenessDate ?? '', content: <Text size="small">{`${r.awarenessDate ?? '-'}${r.assessed ? '' : ' (created)'}`}</Text> },
      { key: r.code ?? '', content: <Text size="small">{r.code ?? '-'}</Text> },
    ],
  }));
}

function ProductForm({ product, onDone }) {
  const [v, setV] = useState({
    key: product?.key ?? '', name: product?.name ?? '', projectKey: product?.projectKey ?? '',
    us: product ? product.markets.includes('US') : true, eu: product ? product.markets.includes('EU') : true,
    riskFilePageId: product?.riskFilePageId ?? '', qualitySpaceKey: product?.qualitySpaceKey ?? '',
    problemCodes: product?.problemCodesText ?? '', euHolidays: (product?.euHolidays ?? []).join(', '),
  });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    const payload = { ...v, markets: [v.us ? 'US' : null, v.eu ? 'EU' : null].filter(Boolean) };
    const res = await invoke('saveProduct', payload).catch(() => ({ ok: false, error: 'Not saved.' }));
    if (res?.ok) onDone(); else setError(res?.error ?? 'Not saved.');
  };
  return (
    <Stack space="space.100">
      <Label labelFor="pk">Product key</Label>
      <Textfield id="pk" value={v.key} onChange={set('key')} placeholder="FB-20" isDisabled={Boolean(product)} />
      <Label labelFor="pn">Product name</Label>
      <Textfield id="pn" value={v.name} onChange={set('name')} placeholder="FB-20 infusion pump" />
      <Label labelFor="pj">Jira project with the complaints</Label>
      <Textfield id="pj" value={v.projectKey} onChange={set('projectKey')} placeholder="CMP" />
      <Text>Markets</Text>
      <Checkbox isChecked={v.us} onChange={set('us')} label="United States (FDA, 21 CFR Part 803)" />
      <Checkbox isChecked={v.eu} onChange={set('eu')} label="European Union (MDR, Regulation (EU) 2017/745)" />
      <Label labelFor="rf">Risk management file (Confluence page ID or link)</Label>
      <Textfield id="rf" value={v.riskFilePageId} onChange={set('riskFilePageId')} />
      <Label labelFor="qs">Confluence space for decision records</Label>
      <Textfield id="qs" value={v.qualitySpaceKey} onChange={set('qualitySpaceKey')} placeholder="QMS" />
      <Label labelFor="pc">Problem codes from the surveillance plan: label | name | expected count | window days</Label>
      <TextArea id="pc" value={v.problemCodes} onChange={set('problemCodes')} placeholder="false-occlusion-alarm | False occlusion alarm | 0.8 | 30" />
      <Label labelFor="hol">Public holidays of the EU competent authority (YYYY-MM-DD, optional)</Label>
      <Textfield id="hol" value={v.euHolidays} onChange={set('euHolidays')} />
      {error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : null}
      <ButtonGroup>
        <Button appearance="primary" onClick={save}>Save product</Button>
        <Button onClick={() => onDone(false)}>Cancel</Button>
      </ButtonGroup>
    </Stack>
  );
}

const App = () => {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = () => invoke('getDashboard').then(setData).catch(() => setData({ ok: false, error: 'Vigil could not load the complaints.' }));
  useEffect(() => { load(); }, []);
  const done = (changed = true) => { setEditing(null); if (changed !== false) load(); };

  if (!data) return <Spinner label="Loading complaints" />;
  if (!data.ok) return <SectionMessage appearance="warning" title="Vigil could not load the complaints"><Text>{data.error}</Text></SectionMessage>;

  const c = data.counts;
  const byStatus = ORDER.filter((s) => c[s]).map((s) => ({ label: STATUS_LABEL[s], count: c[s] }));
  const signals = data.trends.flatMap((t) => t.signals.map((s) => ({ ...s, product: t.product })));
  const trendBars = signals.flatMap((s) => [
    { code: s.name, series: 'Observed', count: s.observed },
    { code: s.name, series: 'Expected', count: s.expected },
  ]);

  const products = (
    <Stack space="space.100">
      <Heading size="small">Products</Heading>
      {data.products.map((p) => (
        <Inline key={p.key} space="space.100" alignBlock="center" shouldWrap>
          <Text><Strong>{p.name}</Strong>{` · project ${p.projectKey} · ${p.markets.join(' and ')} · ${p.problemCodes.length} problem codes`}</Text>
          <Button appearance="subtle" onClick={() => setEditing(p)}>Edit</Button>
        </Inline>
      ))}
      {editing ? <ProductForm product={editing === 'new' ? null : editing} onDone={done} /> : <Button onClick={() => setEditing('new')}>Add a product</Button>}
    </Stack>
  );

  if (!data.products.length) {
    return (
      <Stack space="space.300">
        <EmptyState header="Set up your first product" description="Tell Vigil which Jira project holds the complaints for a device, where the device is marketed, and where its risk management file is." />
        {products}
      </Stack>
    );
  }

  return (
    <Stack space="space.300">
      <Stack space="space.100">
        <Text>
          <Strong>{`${data.open} open`}</Strong>
          {` · ${c.overdue + c['due-today']} overdue or due today · ${c['due-soon']} due within 3 days · ${c['needs-assessment']} ${c['needs-assessment'] === 1 ? 'needs' : 'need'} assessment · `}
          <Strong>{(() => { const n = signals.filter((s) => s.signal).length; return `${n} trend signal${n === 1 ? '' : 's'}`; })()}</Strong>
        </Text>
        <Text size="small">{`Today is ${data.todayText}. Clocks count from day 0, the day any employee first learned of the event. Unassessed complaints count from the day they were created.`}</Text>
      </Stack>

      {signals.filter((s) => s.signal).map((s) => (
        <SectionMessage key={s.code} appearance="warning" title={`Trend signal: ${s.name} (${s.product})`}>
          <Text>{s.reason}</Text>
          <Text size="small">{`Complaints: ${s.keys.join(', ')}`}</Text>
        </SectionMessage>
      ))}

      <Inline space="space.400" shouldWrap>
        <DonutChart title="Complaints by status" data={byStatus} colorAccessor="label" labelAccessor="label" valueAccessor="count" width={320} height={260} colorPalette={PALETTE} hideMenu />
        {trendBars.length ? (
          <BarChart title="Incidents in the window vs. the surveillance plan" data={trendBars} xAccessor="code" yAccessor="count" colorAccessor="series" width={460} height={260} colorPalette={TREND_PALETTE} hideMenu />
        ) : null}
      </Inline>

      {data.upcoming.length ? (
        <SectionMessage appearance="information" title={`Reports due in the next 14 days: ${data.upcoming.length}`}>
          <Stack space="space.050">
            {data.upcoming.map((u) => <Text key={`${u.key}-${u.regulator}-${u.report}`}>{`${u.dueDateText} · ${u.key} · ${u.regulator} ${u.report} (${u.label})`}</Text>)}
          </Stack>
        </SectionMessage>
      ) : null}

      <DynamicTable head={head} rows={rows(data.rows)} rowsPerPage={20} />
      {products}
      <Text size="small">Vigil does the date arithmetic from the facts people confirm. It does not replace your complaint handling procedure and does not submit reports.</Text>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
