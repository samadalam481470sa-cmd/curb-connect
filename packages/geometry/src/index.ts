// @fieldline/geometry: pure geometry for roof facets, curb segments, calibration and units.
// Canonical units are SI (meters, square meters, cubic meters); conversion to display units
// happens only at boundaries. See docs/adr/0005 and README.md (calculation specification).

/** Bump when a geometric algorithm or validation rule changes; stored with every geometry revision. */
export const GEOMETRY_VERSION = '1.0.0';

export * from './numeric';
export * from './units';
export * from './polygon';
export * from './projection';
export * from './pitch';
export * from './topology';
export * from './editor';
export * from './curb';
export * from './calibration';
