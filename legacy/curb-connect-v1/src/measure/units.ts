export const FEET_PER_METER = 1 / 0.3048;
export const SQ_FEET_PER_SQ_METER = FEET_PER_METER * FEET_PER_METER;
export const SQ_FEET_PER_ACRE = 43560;
export const SQ_FEET_PER_SQ_MILE = 5280 * 5280;

export type LengthUnit = "ft" | "ft-in" | "in" | "yd" | "m";
export type AreaUnit = "sqft" | "sqyd" | "sqm" | "acre" | "sqmi";

export const lengthUnitLabels: Record<LengthUnit, string> = {
  ft: "Feet",
  "ft-in": "Feet + inches",
  in: "Inches",
  yd: "Yards",
  m: "Meters"
};

export const areaUnitLabels: Record<AreaUnit, string> = {
  sqft: "Square feet",
  sqyd: "Square yards",
  sqm: "Square meters",
  acre: "Acres",
  sqmi: "Square miles"
};

export function metersToFeet(meters: number): number {
  return meters * FEET_PER_METER;
}

export function sqMetersToSqFeet(sqMeters: number): number {
  return sqMeters * SQ_FEET_PER_SQ_METER;
}

const numberFormat = (digits: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Formats feet as 12' 4-1/2" rounded to the nearest 1/8 inch. */
export function formatFeetInches(feet: number): string {
  const totalEighths = Math.round(Math.abs(feet) * 12 * 8);
  const wholeFeet = Math.floor(totalEighths / 96);
  const remainingEighths = totalEighths - wholeFeet * 96;
  const wholeInches = Math.floor(remainingEighths / 8);
  let fractionEighths = remainingEighths - wholeInches * 8;
  let denominator = 8;
  while (fractionEighths > 0 && fractionEighths % 2 === 0) {
    fractionEighths /= 2;
    denominator /= 2;
  }
  const fraction = fractionEighths > 0 ? `-${fractionEighths}/${denominator}` : "";
  const sign = feet < 0 && totalEighths > 0 ? "-" : "";
  return `${sign}${wholeFeet.toLocaleString("en-US")}' ${wholeInches}${fraction}"`;
}

export function formatLength(meters: number, unit: LengthUnit): string {
  const feet = metersToFeet(meters);
  switch (unit) {
    case "ft":
      return `${numberFormat(1).format(feet)} ft`;
    case "ft-in":
      return formatFeetInches(feet);
    case "in":
      return `${numberFormat(1).format(feet * 12)} in`;
    case "yd":
      return `${numberFormat(2).format(feet / 3)} yd`;
    case "m":
      return `${numberFormat(2).format(meters)} m`;
  }
}

export function formatArea(sqMeters: number, unit: AreaUnit): string {
  const sqFeet = sqMetersToSqFeet(sqMeters);
  switch (unit) {
    case "sqft":
      return `${numberFormat(0).format(sqFeet)} sq ft`;
    case "sqyd":
      return `${numberFormat(1).format(sqFeet / 9)} sq yd`;
    case "sqm":
      return `${numberFormat(1).format(sqMeters)} m²`;
    case "acre":
      return `${numberFormat(3).format(sqFeet / SQ_FEET_PER_ACRE)} ac`;
    case "sqmi":
      return `${numberFormat(4).format(sqFeet / SQ_FEET_PER_SQ_MILE)} sq mi`;
  }
}
