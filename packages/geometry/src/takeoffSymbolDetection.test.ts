import { describe, expect, it } from 'vitest';
import { findSquareTakeoffSymbols } from './takeoffSymbolDetection';

const square = [
  { x: 20, y: 30 },
  { x: 30, y: 30 },
  { x: 30, y: 40 },
  { x: 20, y: 40 },
];

describe('Takeoff square symbol proposals', () => {
  it('finds small straight and rotated squares and collapses overlapping outlines', () => {
    const rotated = [
      { x: 60, y: 50 },
      { x: 65, y: 55 },
      { x: 60, y: 60 },
      { x: 55, y: 55 },
    ];
    expect(findSquareTakeoffSymbols([square, square, rotated])).toMatchObject([
      { point: { x: 25, y: 35 }, side: 10 },
      { point: { x: 60, y: 55 } },
    ]);
  });

  it('skips rectangles, large plan outlines, and skewed shapes', () => {
    const wide = [
      { x: 0, y: 0 },
      { x: 26, y: 0 },
      { x: 26, y: 12 },
      { x: 0, y: 12 },
    ];
    const large = [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 80 },
      { x: 0, y: 80 },
    ];
    const slanted = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 16, y: 8 },
      { x: 6, y: 8 },
    ];
    expect(findSquareTakeoffSymbols([wide, large, slanted])).toEqual([]);
  });
});
