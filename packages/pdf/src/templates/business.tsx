import { Document, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import {
  PROVENANCE_LABEL,
  formatDate,
  formatDateTime,
  formatMoney,
  isMeasured,
  stableSort,
} from '../format';
import { Banner, Bullets, DocPage, INK, KeyValue, Table, TotalLine, s } from '../layout';
import type {
  CurbEstimateSnapshot,
  DocumentMeta,
  GateKind,
  InvoiceSnapshot,
  ProposalSnapshot,
  SignatureCertificateSnapshot,
} from '../snapshots';

function Doc({
  meta,
  title,
  children,
}: {
  meta: DocumentMeta;
  title: string;
  children: ReactNode;
}) {
  return (
    <Document
      title={`${title} ${meta.documentId}`}
      author={meta.organization.name}
      creator={meta.productName ?? 'Field Pro'}
      producer={meta.productName ?? 'Field Pro'}
      language={meta.locale ?? 'en-US'}
      creationDate={new Date(meta.issuedAt)}
      modificationDate={new Date(meta.issuedAt)}
    >
      {children}
    </Document>
  );
}

function OrgBlock({ meta }: { meta: DocumentMeta }) {
  const o = meta.organization;
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={s.bold}>{o.name}</Text>
      {o.phone ? <Text style={s.muted}>{o.phone}</Text> : null}
      {o.email ? <Text style={s.muted}>{o.email}</Text> : null}
      {o.licenseNumber ? <Text style={s.muted}>{`License ${o.licenseNumber}`}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------- curb estimate

export const GATE_LABEL: Record<GateKind, string> = {
  permit: 'Municipal permit',
  utility_locate: 'Utility locate / clearance',
  right_of_way: 'Right-of-way authorization',
  professional_review: 'Professional (engineering) review',
  depth_verification: 'Depth and reinforcement verification',
  site_safety: 'Site safety prerequisites',
};

const GATE_STATUS_LABEL = {
  satisfied: 'Satisfied',
  pending: 'Pending',
  unknown: 'Unknown',
  not_required: 'Not required',
} as const;

/** True only when every gate is satisfied or not required. */
export function gatesClear(gates: CurbEstimateSnapshot['gates']): boolean {
  return gates.every((g) => g.status === 'satisfied' || g.status === 'not_required');
}

export function CurbEstimateDocument({ snapshot }: { snapshot: CurbEstimateSnapshot }) {
  const { meta } = snapshot;
  const TITLE = 'Curb cutting estimate';
  // Defense in depth: never print a binding quote while any gate is open, whatever the flag says.
  const binding = snapshot.binding && gatesClear(snapshot.gates) && snapshot.unknowns.length === 0;
  const lines = stableSort(
    snapshot.lines,
    (l) => l.category,
    (l) => l.id,
  );
  const gates = stableSort(
    snapshot.gates,
    (g) => g.kind,
    (g) => g.kind,
  );
  return (
    <Doc meta={meta} title={TITLE}>
      <DocPage meta={meta} title={TITLE}>
        <OrgBlock meta={meta} />
        <Text style={s.h1}>{TITLE}</Text>
        {binding ? null : (
          <Banner tone="danger" title="PRELIMINARY — BUDGETARY RANGE, NOT A BINDING QUOTE">
            Permit, utility, right-of-way or measurement checks are still open. Final price is set
            only after they are verified.
          </Banner>
        )}
        <KeyValue k="Estimate ID" v={meta.documentId} />
        <KeyValue k="Revision" v={String(meta.revision)} />
        <KeyValue k="Date" v={formatDate(meta.issuedAt, meta.timeZone)} />
        <KeyValue k="Site" v={snapshot.site.addressLines.join(', ')} />
        {snapshot.site.jurisdiction ? (
          <KeyValue k="Jurisdiction" v={snapshot.site.jurisdiction} />
        ) : null}
        {snapshot.validUntil ? (
          <KeyValue k="Valid until" v={formatDate(snapshot.validUntil, meta.timeZone)} />
        ) : null}

        <Text style={s.h2}>{binding ? 'Price' : 'Budgetary range'}</Text>
        <View style={[s.row, { gap: 8 }]} wrap={false}>
          {(['low', 'base', 'high'] as const).map((k) => (
            <View key={k} style={{ flex: 1, borderWidth: 0.75, borderColor: INK.rule, padding: 6 }}>
              <Text style={[s.small, s.muted]}>
                {k === 'low' ? 'Low' : k === 'base' ? 'Base' : 'High'}
              </Text>
              <Text style={[s.bold, { fontSize: 13 }]}>{formatMoney(snapshot.scenarios[k])}</Text>
            </View>
          ))}
        </View>

        <Text style={s.h2}>Line items (base scenario)</Text>
        <Table
          rows={lines}
          rowKey={(l) => l.id}
          columns={[
            { header: 'Item', width: '34%', cell: (l) => l.description },
            { header: 'Qty', width: '12%', align: 'right', cell: (l) => `${l.quantity} ${l.unit}` },
            {
              header: 'Unit price',
              width: '16%',
              align: 'right',
              cell: (l) => formatMoney(l.unitPrice),
            },
            { header: 'Total', width: '16%', align: 'right', cell: (l) => formatMoney(l.total) },
            {
              header: 'Basis',
              width: '22%',
              cell: (l) =>
                `${isMeasured(l.provenance) ? 'Measured' : 'Estimated'} · ${PROVENANCE_LABEL[l.provenance]}`,
            },
          ]}
        />
        <View style={{ marginTop: 6, marginLeft: '45%' }}>
          <TotalLine label="Direct cost" value={formatMoney(snapshot.directCost)} />
          <TotalLine label="Overhead" value={formatMoney(snapshot.overhead)} />
          <TotalLine label="Contingency" value={formatMoney(snapshot.contingency)} />
          <TotalLine
            label={
              snapshot.pricingMethod.kind === 'markup'
                ? `Markup ${snapshot.pricingMethod.rate}`
                : `Target margin ${snapshot.pricingMethod.rate}`
            }
            value="applied"
          />
          <TotalLine label="Tax" value={formatMoney(snapshot.tax)} />
          <TotalLine
            label={binding ? 'Selling price' : 'Base budgetary price'}
            value={formatMoney(snapshot.sellingPrice)}
            strong
          />
        </View>

        <Text style={s.h2}>Unknowns</Text>
        {snapshot.unknowns.length > 0 ? (
          <Table
            rows={snapshot.unknowns}
            rowKey={(u, i) => `${i}-${u.item}`}
            columns={[
              { header: 'Not yet known', width: '45%', cell: (u) => u.item },
              { header: 'Effect on price', width: '55%', cell: (u) => u.impact },
            ]}
          />
        ) : (
          <Text style={s.muted}>No open unknowns.</Text>
        )}

        <Text style={s.h2}>Permit, utility and right-of-way gates</Text>
        <Table
          rows={gates}
          rowKey={(g) => g.kind}
          columns={[
            { header: 'Check', width: '40%', cell: (g) => GATE_LABEL[g.kind] },
            { header: 'Status', width: '20%', cell: (g) => GATE_STATUS_LABEL[g.status] },
            { header: 'Note', width: '40%', cell: (g) => g.note ?? '' },
          ]}
        />
        <Text style={[s.small, s.muted, { marginTop: 4 }]}>
          Work is never scheduled while a required check is pending or unknown.
        </Text>

        <Text style={s.h2}>Calibration evidence</Text>
        {snapshot.calibration.length > 0 ? (
          <Table
            rows={stableSort(
              snapshot.calibration,
              (c) => c.photoId,
              (c) => c.method,
            )}
            rowKey={(c) => `${c.photoId}-${c.method}`}
            columns={[
              { header: 'Photo', width: '25%', cell: (c) => c.photoId },
              { header: 'Method', width: '30%', cell: (c) => c.method.replace(/_/g, ' ') },
              { header: 'Quality', width: '25%', cell: (c) => c.quality },
              {
                header: 'Captured',
                width: '20%',
                cell: (c) => (c.capturedAt ? formatDate(c.capturedAt, meta.timeZone) : ''),
              },
            ]}
          />
        ) : (
          <Text style={s.muted}>No calibrated photos: dimensions are user entered or unknown.</Text>
        )}
        <Text style={s.h2}>Basis and disclaimers</Text>
        <KeyValue k="Price book revision" v={snapshot.priceBookRevision} />
        <KeyValue k="Pricing engine" v={snapshot.engineVersion} />
        <Bullets items={snapshot.disclaimers} />
      </DocPage>
    </Doc>
  );
}

// ---------------------------------------------------------------- proposal

export function ProposalDocument({ snapshot }: { snapshot: ProposalSnapshot }) {
  const { meta } = snapshot;
  const TITLE = 'Proposal';
  const selected = snapshot.options.find((o) => o.id === snapshot.selectedOptionId) ?? null;
  return (
    <Doc meta={meta} title={TITLE}>
      <DocPage meta={meta} title={TITLE}>
        <OrgBlock meta={meta} />
        <Text style={s.h1}>{snapshot.title}</Text>
        {snapshot.budgetary ? (
          <Banner tone="danger" title="BUDGETARY PROPOSAL — NOT FOR ACCEPTANCE">
            Based on a preliminary estimate. It cannot be accepted or signed until site checks are
            complete and a final proposal is issued.
          </Banner>
        ) : null}
        <KeyValue k="Proposal ID" v={meta.documentId} />
        <KeyValue k="Revision" v={String(meta.revision)} />
        <KeyValue
          k="Prepared for"
          v={[snapshot.customer.name, ...snapshot.customer.addressLines].join(', ')}
        />
        <KeyValue k="Date" v={formatDate(meta.issuedAt, meta.timeZone)} />
        <KeyValue k="Valid until" v={formatDate(snapshot.validUntil, meta.timeZone)} />
        <KeyValue
          k="Selected package"
          v={
            selected
              ? `${selected.name} — ${formatMoney(selected.total)}`
              : 'Not yet selected (choose exactly one)'
          }
        />

        {snapshot.options.map((o) => (
          <View
            key={o.id}
            style={{
              marginTop: 10,
              borderWidth: o.id === snapshot.selectedOptionId ? 1.5 : 0.75,
              borderColor: o.id === snapshot.selectedOptionId ? INK.primary : INK.rule,
              padding: 8,
            }}
          >
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text
                style={s.h3}
              >{`${o.name}${o.id === snapshot.selectedOptionId ? ' (selected)' : ''}`}</Text>
              <Text style={s.h3}>{formatMoney(o.total)}</Text>
            </View>
            <Bullets items={o.scope} />
            <Table
              rows={o.lines}
              rowKey={(l, i) => `${i}`}
              columns={[
                { header: 'Line item', width: '70%', cell: (l) => l.description },
                {
                  header: 'Amount',
                  width: '30%',
                  align: 'right',
                  cell: (l) => formatMoney(l.total),
                },
              ]}
            />
            {o.exclusions.length > 0 ? (
              <>
                <Text style={[s.small, s.bold, { marginTop: 4 }]}>Not included</Text>
                <Bullets items={o.exclusions} />
              </>
            ) : null}
            {o.warranty ? (
              <Text style={[s.small, s.muted]}>{`Warranty: ${o.warranty}`}</Text>
            ) : null}
          </View>
        ))}

        {snapshot.optionalAddOns.length > 0 ? (
          <>
            <Text style={s.h2}>Optional additions</Text>
            <Table
              rows={snapshot.optionalAddOns}
              rowKey={(a) => a.id}
              columns={[
                { header: 'Addition', width: '55%', cell: (a) => a.description },
                { header: 'Chosen', width: '15%', cell: (a) => (a.selected ? 'Yes' : 'No') },
                {
                  header: 'Amount',
                  width: '30%',
                  align: 'right',
                  cell: (a) => formatMoney(a.total),
                },
              ]}
            />
          </>
        ) : null}

        <Text style={s.h2}>Payment terms</Text>
        <Bullets items={snapshot.paymentTerms} />
        <KeyValue k="Tax" v={snapshot.taxTreatment} />
        {snapshot.startDateAssumption ? (
          <KeyValue k="Start date assumption" v={snapshot.startDateAssumption} />
        ) : null}
        <Text style={s.h2}>Terms</Text>
        <Bullets items={snapshot.terms} />
      </DocPage>
    </Doc>
  );
}

// ---------------------------------------------------------------- invoice

const INVOICE_STATUS = {
  draft: 'Draft',
  issued: 'Issued',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  void: 'Void',
} as const;

export function InvoiceDocument({ snapshot }: { snapshot: InvoiceSnapshot }) {
  const { meta } = snapshot;
  const TITLE = 'Invoice';
  return (
    <Doc meta={meta} title={TITLE}>
      <DocPage meta={meta} title={TITLE}>
        <OrgBlock meta={meta} />
        <Text style={s.h1}>{`${TITLE} ${meta.documentId}`}</Text>
        {snapshot.status === 'void' ? (
          <Banner tone="danger" title="VOID — this invoice is cancelled and is not payable" />
        ) : null}
        {snapshot.status === 'draft' ? (
          <Banner tone="warning" title="DRAFT — not yet issued" />
        ) : null}
        <KeyValue k="Status" v={INVOICE_STATUS[snapshot.status]} />
        <KeyValue k="Issue date" v={formatDate(meta.issuedAt, meta.timeZone)} />
        <KeyValue k="Due date" v={formatDate(snapshot.dueDate, meta.timeZone)} />
        <KeyValue
          k="Bill to"
          v={[snapshot.billTo.name, ...snapshot.billTo.addressLines].join(', ')}
        />
        {snapshot.proposalReference ? (
          <KeyValue k="Proposal" v={snapshot.proposalReference} />
        ) : null}
        <Table
          rows={snapshot.lines}
          rowKey={(l) => l.id}
          columns={[
            { header: 'Description', width: '52%', cell: (l) => l.description },
            { header: 'Qty', width: '12%', align: 'right', cell: (l) => l.quantity },
            {
              header: 'Unit price',
              width: '18%',
              align: 'right',
              cell: (l) => formatMoney(l.unitPrice),
            },
            { header: 'Amount', width: '18%', align: 'right', cell: (l) => formatMoney(l.total) },
          ]}
        />
        <View style={{ marginTop: 6, marginLeft: '50%' }}>
          <TotalLine label="Subtotal" value={formatMoney(snapshot.subtotal)} />
          {snapshot.discounts.map((d, i) => (
            <TotalLine key={`d${i}`} label={d.label} value={formatMoney(d.amount)} />
          ))}
          {snapshot.taxes.map((t, i) => (
            <TotalLine
              key={`t${i}`}
              label={`${t.label} (${t.rate})`}
              value={formatMoney(t.amount)}
            />
          ))}
          <TotalLine label="Total" value={formatMoney(snapshot.total)} strong />
          {stableSort(
            snapshot.payments,
            (p) => p.at,
            (p) => p.reference ?? '',
          ).map((p, i) => (
            <TotalLine
              key={`p${i}`}
              label={`Paid ${formatDate(p.at, meta.timeZone)} (${p.method})`}
              value={formatMoney({ ...p.amount, amountMinor: -p.amount.amountMinor })}
            />
          ))}
          <TotalLine label="Balance due" value={formatMoney(snapshot.balanceDue)} strong />
        </View>
        {snapshot.notes ? (
          <>
            <Text style={s.h2}>Notes</Text>
            <Text>{snapshot.notes}</Text>
          </>
        ) : null}
      </DocPage>
    </Doc>
  );
}

// ---------------------------------------------------------------- signature certificate

const CERT_STATUS = {
  completed: 'Completed — all required signers signed',
  partially_signed: 'Partially signed — not yet a complete agreement',
  declined: 'Declined',
  expired: 'Expired',
  voided: 'Voided',
} as const;

export function SignatureCertificateDocument({
  snapshot,
}: {
  snapshot: SignatureCertificateSnapshot;
}) {
  const { meta } = snapshot;
  const TITLE = 'Signature audit certificate';
  const tz = meta.timeZone;
  return (
    <Doc meta={meta} title={TITLE}>
      <DocPage meta={meta} title={TITLE}>
        <Text style={s.h1}>{TITLE}</Text>
        {snapshot.status !== 'completed' ? (
          <Banner tone="warning" title={CERT_STATUS[snapshot.status]} />
        ) : null}
        <KeyValue k="Certificate ID" v={meta.documentId} />
        <KeyValue k="Envelope ID" v={snapshot.envelopeId} />
        <KeyValue k="Document" v={snapshot.documentTitle} />
        <KeyValue k="Document SHA-256" v={snapshot.documentSha256} />
        <KeyValue k="Signature provider" v={snapshot.provider} />
        <KeyValue k="Status" v={CERT_STATUS[snapshot.status]} />
        <Text style={s.h2}>Signers</Text>
        {stableSort(
          snapshot.signers,
          (x) => x.order,
          (x) => x.email,
        ).map((x) => (
          <View
            key={`${x.order}-${x.email}`}
            style={{ borderWidth: 0.75, borderColor: INK.rule, padding: 6, marginBottom: 6 }}
            wrap={false}
          >
            <Text style={s.bold}>{`${x.order}. ${x.name} (${x.role})`}</Text>
            <KeyValue k="Email" v={x.email} />
            <KeyValue
              k="Status"
              v={
                x.status === 'signed' ? 'Signed' : x.status === 'declined' ? 'Declined' : 'Pending'
              }
            />
            {x.signedAt ? <KeyValue k="Signed at" v={formatDateTime(x.signedAt, tz)} /> : null}
            {x.consentText ? <KeyValue k="Consent" v={x.consentText} /> : null}
            {x.ipAddress ? <KeyValue k="IP address" v={x.ipAddress} /> : null}
            {x.userAgent ? <KeyValue k="Device" v={x.userAgent} /> : null}
            {x.identityEvidence ? <KeyValue k="Identity evidence" v={x.identityEvidence} /> : null}
          </View>
        ))}
        <Text style={s.h2}>Event log</Text>
        <Table
          rows={stableSort(
            snapshot.events,
            (e) => e.sequence,
            (e) => e.type,
          )}
          rowKey={(e) => String(e.sequence)}
          columns={[
            { header: '#', width: '6%', cell: (e) => String(e.sequence) },
            { header: 'Time', width: '30%', cell: (e) => formatDateTime(e.at, tz) },
            { header: 'Event', width: '20%', cell: (e) => e.type },
            { header: 'Actor', width: '22%', cell: (e) => e.actor },
            { header: 'Detail', width: '22%', cell: (e) => e.detail ?? '' },
          ]}
        />
      </DocPage>
    </Doc>
  );
}
