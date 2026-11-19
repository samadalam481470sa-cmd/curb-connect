export type DrawTool = 'pan' | 'polygon' | 'rectangle' | 'place' | 'select';

export interface MapViewState {
  readonly center: [lng: number, lat: number];
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
}

export type EdgeClass = 'eave' | 'rake' | 'ridge' | 'hip' | 'valley' | 'unclassified';

export interface MapPolygonFacet {
  readonly id: string;
  /** Open ring of [lng, lat] vertices. */
  readonly ring: ReadonlyArray<readonly [number, number]>;
  readonly pitchRise: string;
  readonly pitchRun: string;
  readonly label: string;
}

export type OpeningEquipment = 'hvac' | 'hatch' | 'skylight' | 'exhaust' | 'other';

export interface MapOpening {
  readonly id: string;
  readonly number: number;
  /** Center [lng, lat]. */
  readonly center: readonly [number, number];
  /** Width in feet (along local east). */
  readonly widthFt: number;
  /** Length in feet (along local north). */
  readonly lengthFt: number;
  readonly equipment: OpeningEquipment;
  /** Optional drawn rectangle ring (open). */
  readonly ring?: ReadonlyArray<readonly [number, number]>;
}
