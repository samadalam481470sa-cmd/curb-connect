import { describe, expect, it } from 'vitest';
import { findSquareTakeoffSymbols, findTakeoffSymbols } from './takeoffSymbolDetection';

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

describe('Takeoff vector symbol proposals', () => {
  it('finds small triangular outlines and rejects stretched or collinear outlines', () => {
    const triangle = [
      { x: 6, y: 10 },
      { x: 0, y: 0 },
      { x: 12, y: 0 },
    ];
    const stretched = triangle.map(({ x, y }) => ({ x: x * 3, y }));
    const flat = triangle.map(({ x }) => ({ x, y: 0 }));
    const [point] = findTakeoffSymbols('triangle', {
      contours: [stretched, square, flat, triangle, triangle],
      curvedContours: [],
    });
    expect(point?.x).toBe(6);
    expect(point?.y).toBeCloseTo(10 / 3);
    expect(
      findTakeoffSymbols('triangle', { contours: [stretched, flat], curvedContours: [] }),
    ).toEqual([]);
  });

  it('finds rotated cross outlines and rejects elongated crosses and stars', () => {
    const cross = [
      [-2, -8],
      [2, -8],
      [2, -2],
      [8, -2],
      [8, 2],
      [2, 2],
      [2, 8],
      [-2, 8],
      [-2, 2],
      [-8, 2],
      [-8, -2],
      [-2, -2],
    ].map(([x, y]) => ({ x: x!, y: y! }));
    const rotated = cross.map(({ x, y }) => ({
      x: 40 + 0.8 * x - 0.6 * y,
      y: 50 + 0.6 * x + 0.8 * y,
    }));
    const star = Array.from({ length: 12 }, (_, index) => {
      const theta = (index * Math.PI) / 6;
      const radius = index % 2 ? 4 : 8;
      return { x: radius * Math.cos(theta), y: radius * Math.sin(theta) };
    });
    const [point, ...extra] = findTakeoffSymbols('cross', {
      contours: [square, cross.map(({ x, y }) => ({ x: 2 * x, y })), star, rotated],
      curvedContours: [],
    });
    expect(point?.x).toBeCloseTo(40);
    expect(point?.y).toBeCloseTo(50);
    expect(extra).toEqual([]);
  });

  it('finds a closed circle and rejects ellipses and out-of-size curves', () => {
    const circle = Array.from({ length: 24 }, (_, index) => {
      const theta = (index * Math.PI) / 12;
      return { x: 40 + 8 * Math.cos(theta), y: 50 + 8 * Math.sin(theta) };
    });
    const ellipse = circle.map(({ x, y }) => ({ x: x * 1.75, y }));
    const tooLarge = circle.map(({ x, y }) => ({ x: x * 4, y: y * 4 }));
    const [point, ...extra] = findTakeoffSymbols('circle', {
      contours: [square],
      curvedContours: [ellipse, tooLarge, circle],
    });
    expect(point?.x).toBeCloseTo(40);
    expect(point?.y).toBeCloseTo(50);
    expect(extra).toEqual([]);
  });
});
