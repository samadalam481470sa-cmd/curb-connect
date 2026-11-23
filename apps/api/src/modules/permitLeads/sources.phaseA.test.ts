import { describe, expect, it } from 'vitest';
import {
  dallasMonthPatterns,
  normalizeArlington,
  normalizeCollin,
  normalizeDallas,
  normalizeSanAntonio,
} from './sources';

const now = new Date('2026-11-22T12:00:00.000Z');

describe('Phase A permit sources', () => {
  it('reads Arlington issued permits without inventing zip, units or contacts', () => {
    const [p] = normalizeArlington([
      {
        attributes: {
          FOLDERYEAR: '26',
          FOLDERSEQUENCE: '094384',
          FOLDERTYPE: 'RP',
          STATUSDESC: 'Issued',
          ISSUEDATE: 1795193422000,
          SUBDESC: 'Single-Family',
          WORKDESC: 'Foundation',
          FOLDERNAME: '420 THOMAS CHAPEL DRIVE',
          ConstructionValuationDeclared: 6225,
          InDate: 1795025388000,
        },
        geometry: { x: -97.10608324251608, y: 32.69616106130407 },
      },
    ]);
    expect(p).toMatchObject({
      source: 'arlington',
      permitNumber: '26-094384',
      city: 'Arlington',
      address: '420 THOMAS CHAPEL DRIVE',
      zip: '',
      units: 0,
      contractor: '',
      contractorPhone: '',
      value: 6225,
      latitude: 32.69616106130407,
      longitude: -97.10608324251608,
    });
    expect(p?.issuedAt).toBe(new Date(1795193422000).toISOString());
  });

  it('drops Arlington State-Plane geometry that was not reprojected', () => {
    const [p] = normalizeArlington([
      {
        attributes: { FOLDERYEAR: '26', FOLDERSEQUENCE: '1', FOLDERNAME: '1 Main St' },
        geometry: { x: 2397283.25, y: 6939051.45 },
      },
    ]);
    expect(p?.latitude).toBeNull();
    expect(p?.longitude).toBeNull();
  });

  it('reads San Antonio permits, dedupes on number + type and skips sign permits', () => {
    const rows = normalizeSanAntonio([
      {
        'PERMIT TYPE': 'Sidewalk-Curb Permit',
        'PERMIT #': 'SDW-CRB-PMT26-38500315',
        'PROJECT NAME': '426 Buckingham Ave Approach and Sidewalk',
        'WORK TYPE': null,
        ADDRESS: '426 BUCKINGHAM AVE, City of San Antonio, TX 78210',
        X_COORD: '-98.474624',
        Y_COORD: '29.395121',
        'DATE SUBMITTED': '2026-11-20',
        'DATE ISSUED': '2026-11-20',
        'DECLARED VALUATION': null,
        'PRIMARY CONTACT': 'ADALBERTO SERVIN CONSTRUCTION',
      },
      {
        // Same number + type again (trade-row duplicate) — kept once.
        'PERMIT TYPE': 'Sidewalk-Curb Permit',
        'PERMIT #': 'SDW-CRB-PMT26-38500315',
        ADDRESS: '426 BUCKINGHAM AVE, City of San Antonio, TX 78210',
        'DATE ISSUED': '2026-11-20',
      },
      {
        'PERMIT TYPE': 'On Premise Sign',
        'PERMIT #': 'SIG-OPS-PMT26-21501695',
        ADDRESS: '1110 BROOKLYN AVE, City of San Antonio, TX 78212',
        'DATE ISSUED': '2026-11-20',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'sanantonio',
      permitNumber: 'SDW-CRB-PMT26-38500315',
      city: 'San Antonio',
      zip: '78210',
      contractor: 'ADALBERTO SERVIN CONSTRUCTION',
      contractorPhone: '',
      value: 0,
      latitude: 29.395121,
      longitude: -98.474624,
    });
  });

  it('drops San Antonio State-Plane coordinates instead of guessing', () => {
    const [p] = normalizeSanAntonio([
      {
        'PERMIT TYPE': 'Building Permit',
        'PERMIT #': 'BLD-1',
        ADDRESS: '1 Main St, San Antonio, TX 78201',
        X_COORD: '2397283.25',
        Y_COORD: '6939051.45',
        'DATE ISSUED': '2026-11-01',
      },
    ]);
    expect(p?.latitude).toBeNull();
    expect(p?.longitude).toBeNull();
  });

  it('tolerates 2026-shaped Dallas rows with contractor, value and land use missing', () => {
    const [p] = normalizeDallas([
      {
        permit_number: 'COM-NEW-26-000153',
        permit_type: 'Commercial New Construction Permit',
        issued_date: '11/01/26',
        area: '84',
        work_description: 'Construction of an 8,400 sf wood framed building',
        street_address: '7855 ELMBROOK DR',
        zip_code: '75247',
      },
    ]);
    expect(p).toMatchObject({
      permitNumber: 'COM-NEW-26-000153',
      contractor: '',
      contractorPhone: '',
      value: 0,
      landUse: '',
      issuedAt: '2026-11-01T00:00:00.000Z',
    });
    expect(dallasMonthPatterns(new Date('2026-11-01'), now)).toEqual(['11/%/26']);
  });

  it('keeps Collin guards: future dates capped, zero value stays missing, issuer names the city', () => {
    const rows = normalizeCollin(
      [
        {
          permitnum: '25-04154',
          permitissueddate: '2026-11-10T00:00:00.000',
          permitissuedby: 'FRISCO CITY',
          situscity: '',
          permittypedescr: 'New Construction',
          permitbuildername: 'LANDON #E4176-D',
          permitvalue: '0',
          situsconcatshort: '7102 FARLEY ST',
        },
        {
          permitnum: '26-9999',
          permitissueddate: '2206-08-19T00:00:00.000',
          permitissuedby: 'CELINA CITY',
          situscity: 'PROSPER',
          permitvalue: '100000',
        },
      ],
      now,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ city: 'Frisco', value: 0 });
  });
});
