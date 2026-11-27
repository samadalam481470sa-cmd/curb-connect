// Carrollton monthly PDF report tests (audit-gaps round 2). The fixture text
// is extractor-style output (space-joined text items) built from the live
// report fetched 2026-11-27 (report dated 2026-11-01, 110 pages, October
// 2026 permits): header rows first, then the detail blocks that repeat the
// street address — the harder of the two plausible item orders.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CARROLLTON_REPORT_URL,
  fetchCarrollton,
  normalizeCarrollton,
  parseCarrolltonReportText,
} from './sources';
import { assessFreshness } from './freshness';

const fixtureText = readFileSync(
  new URL('./fixtures/carrollton-report.txt', import.meta.url),
  'utf8',
);
const now = new Date('2026-11-27T12:00:00.000Z');

describe('parseCarrolltonReportText', () => {
  const parsed = parseCarrolltonReportText(fixtureText);

  it('reads the report date and the previous-month coverage', () => {
    expect(parsed.reportDate).toBe('2026-11-01T00:00:00.000Z');
    expect(parsed.coverageMonth).toBe('2026-10');
  });

  it('dedupes repeated permit numbers and parses every record', () => {
    expect(parsed.records.map((r) => r.permitNumber)).toEqual([
      'PRSE202601539',
      'PRRE202601579',
      'PRBD202602007',
      'PRMH202603019',
      'PRRN202603711',
    ]);
  });

  it('parses type, address, zip and entered date from the header rows', () => {
    const solar = parsed.records.find((r) => r.permitNumber === 'PRRE202601579')!;
    expect(solar.permitType).toBe('Renewable Energy/Solar Panel');
    expect(solar.address).toBe('3957 Freshwater Dr, Carrollton, TX 75007');
    expect(solar.zip).toBe('75007');
    expect(solar.dateEntered).toBe('2026-03-23T00:00:00.000Z');
    const remodel = parsed.records.find((r) => r.permitNumber === 'PRRN202603711')!;
    expect(remodel.permitType).toBe('Renovation/Remodel');
    expect(remodel.address).toContain('1620 Valwood Pkwy');
    expect(remodel.zip).toBe('75006');
  });

  it('matches valuation, status, issued date and applicant from the detail blocks', () => {
    const big = parsed.records.find((r) => r.permitNumber === 'PRBD202602007')!;
    expect(big.valuation).toBe(4_400_000);
    expect(big.status).toBe('Issued');
    expect(big.dateIssued).toBe('2026-10-21T00:00:00.000Z');
    expect(big.applicant).toBe('Matthew Rogers');
    expect(big.description).toContain('Just Pots');

    const mech = parsed.records.find((r) => r.permitNumber === 'PRMH202603019')!;
    expect(mech.valuation).toBe(70_000);
    expect(mech.applicant).toBe('David Lane Butters');
    expect(mech.dateIssued).toBe('2026-10-07T00:00:00.000Z');

    const event = parsed.records.find((r) => r.permitNumber === 'PRSE202601539')!;
    expect(event.valuation).toBe(0);
    expect(event.status).toBe('Closed');
    expect(event.applicant).toBe('Maeghan Weygandt');

    const remodel = parsed.records.find((r) => r.permitNumber === 'PRRN202603711')!;
    expect(remodel.applicant).toBe("James W. O'Neill");
    expect(remodel.valuation).toBe(90_000);
  });
});

describe('normalizeCarrollton', () => {
  it('maps records to RawPermit with the applicant in the description, never as contractor', () => {
    const { records } = parseCarrolltonReportText(fixtureText);
    const permits = normalizeCarrollton(records, now);
    expect(permits).toHaveLength(5);
    const big = permits.find((p) => p.permitNumber === 'PRBD202602007')!;
    expect(big.source).toBe('carrollton');
    expect(big.sourceName).toBe('City of Carrollton');
    expect(big.city).toBe('Carrollton');
    expect(big.address).toBe('2121 Sandy Lake Rd');
    expect(big.value).toBe(4_400_000);
    expect(big.contractor).toBe('');
    expect(big.description).toContain('Applicant: Matthew Rogers.');
    expect(big.url).toBe(CARROLLTON_REPORT_URL);
    expect(big.issuedAt).toBe('2026-10-21T00:00:00.000Z');
    expect(big.appliedAt).toBe('2026-04-13T00:00:00.000Z');
  });

  it('drops future-dated rows', () => {
    const permits = normalizeCarrollton(
      [
        {
          permitNumber: 'PRBD202699999',
          permitType: 'New',
          address: '1 Main St, Carrollton, TX 75006',
          zip: '75006',
          dateEntered: '2026-12-01T00:00:00.000Z',
          dateIssued: '2027-01-15T00:00:00.000Z',
          valuation: 1000,
          status: 'Issued',
          applicant: '',
          description: '',
        },
      ],
      now,
    );
    expect(permits).toEqual([]);
  });
});

/** A minimal one-page PDF with a real text layer, so fetchCarrollton's
 *  extract-then-parse path runs end to end without a binary fixture. */
function textPdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content =
    'BT /F1 9 Tf 36 756 Td ' +
    lines.map((l) => `(${esc(l)}) Tj 0 -13 Td`).join(' ') +
    ' ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe('fetchCarrollton', () => {
  it('fetches the fixed report URL, extracts the text layer and filters to the window', async () => {
    const pdf = textPdf([
      '11/1/2026 Monthly Permit Report Page 1 of 1',
      '3/23/2026 PRRE202601579 Renewable Energy/Solar Panel 3957 Freshwater Dr, Carrollton, TX 75007',
      '3957 Freshwater Dr, 43 MODULES - 17.630 kW DC Tony Trammell $0.00 Permit(s) Issued 10/13/2026',
      '6/2/2026 PRMH202603019 Mechanical 1401 Mac Arthur Dr, Carrollton, TX 75007',
      '1401 Mac Arthur Dr, Installation of two new air conditioning units David Lane Butters $70,000.00 Permit(s) Issued 10/7/2026',
    ]);
    const seen: string[] = [];
    const fetcher = (async (url: string) => {
      seen.push(url);
      return {
        ok: true,
        status: 200,
        // Fresh copy per call: pdf.js detaches the buffer it is given.
        arrayBuffer: async () => pdf.slice().buffer as ArrayBuffer,
      };
    }) as unknown as typeof fetch;
    const permits = await fetchCarrollton(new Date('2026-09-01'), now, fetcher);
    expect(seen).toEqual([CARROLLTON_REPORT_URL]);
    expect(permits.map((p) => p.permitNumber).sort()).toEqual(['PRMH202603019', 'PRRE202601579']);
    const mech = permits.find((p) => p.permitNumber === 'PRMH202603019')!;
    expect(mech.value).toBe(70_000);
    expect(mech.description).toContain('Applicant: David Lane Butters.');
    // A window after October excludes both permits.
    const later = await fetchCarrollton(new Date('2026-11-01'), now, fetcher);
    expect(later).toEqual([]);
  });

  it('surfaces an unavailable report as an error', async () => {
    const fetcher = (async () => ({
      ok: false,
      status: 503,
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch;
    await expect(fetchCarrollton(new Date('2026-09-01'), now, fetcher)).rejects.toThrow(
      'Carrollton monthly report unavailable (503).',
    );
  });
});

describe('carrollton freshness', () => {
  it('uses the 45-day monthly window with the monthly cadence note', () => {
    const fresh = assessFreshness('carrollton', '2026-10-21T00:00:00.000Z', now);
    expect(fresh.status).toBe('live');
    expect(fresh.message).toContain('Monthly PDF report');
    expect(fresh.message).toContain('~4–5 weeks old');
    const stale = assessFreshness('carrollton', '2026-09-01T00:00:00.000Z', now);
    expect(stale.status).toBe('stale');
  });
});
