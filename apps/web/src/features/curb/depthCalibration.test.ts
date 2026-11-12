import { describe, expect, it } from 'vitest';
import { calibrateDepth, type DepthReading } from './depthCalibration';
const r = (stationFt: number, depthIn: number): DepthReading => ({
  id: String(stationFt), stationFt, depthIn, method: 'core', recordedAt: '2026-11-12', note: '',
});
describe('field depth evidence calibration', () => {
  it('uses a measured median baseline but does not collapse the unverified range', () => {
    expect(calibrateDepth(24,6,8,10,[r(0,8.5),r(12,7.5),r(24,9)])).toMatchObject({
      baseIn:8.5,lowIn:6,highIn:10,count:3,remainsBounded:true,outOfRange:false,
    });
  });
  it('expands conservative bounds on an unexpectedly deeper core', () => {
    expect(calibrateDepth(24,6,8,10,[r(6,12)])).toMatchObject({
      baseIn:12,lowIn:6,highIn:12,outOfRange:true,
    });
  });
  it('does not guess depth without samples', () => {
    expect(calibrateDepth(24,6,8,10,[])).toMatchObject({baseIn:8,lowIn:6,highIn:10,count:0});
  });
  it('rejects duplicated stations and out-of-path or impossible readings', () => {
    expect(() => calibrateDepth(24,6,8,10,[r(1,8),r(1,9)])).toThrow();
    expect(() => calibrateDepth(24,6,8,10,[r(25,8)])).toThrow();
    expect(() => calibrateDepth(24,6,8,10,[r(0,0)])).toThrow();
  });
});
