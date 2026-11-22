// House command reader for the studio's "Ask or build" bar. It runs entirely in the browser (on
// the user's own computer, no server and no AI service): plain commands change the house at once,
// and anything it does not understand goes to the server's brief reader (AI when set up).
//
//   "2400 sqft"  "build a 1800 sq ft 3 bed 2 bath"   whole house from a size
//   "make it cheaper"  "cut cost"                     applies the smart (non-program) savings
//   "add a bedroom"  "remove a bath"  "4 bed"  "3 bath"
//   "no garage"  "1 car garage"  "2 car garage"
//   "two story"  "one story"  "roof 8/12"  "9 ft walls"  "studs 24"  "waste 7%"
//   "50 x 32"  "length 54"  "width 30"  "eaves 2 ft"
//   "undo"
//
// Every result says in plain words what changed, so nothing happens silently.
import { LIMITS } from './layout';
import { applyAllSmart, savingOptions, specFromSquareFeet } from './quickBuild';
import type { StudioCostSettings } from './studioCost';
import type { BuildSpec } from './takeoff';

export type CommandResult =
  | { kind: 'spec'; spec: BuildSpec; said: string }
  | { kind: 'undo' }
  | { kind: 'none' };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, a: 1, an: 1 };
const n = (s: string | undefined) => (s === undefined ? NaN : WORD_NUM[s] ?? Number(s));

export function runHouseCommand(raw: string, spec: BuildSpec, costs: StudioCostSettings): CommandResult {
  const t = raw.toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 300) return { kind: 'none' };
  if (/^(undo|go back|revert)\b/.test(t)) return { kind: 'undo' };

  const changes: string[] = [];
  let next: BuildSpec = { ...spec };

  // Whole house from a size.
  const sq = t.match(/(\d{3,5})\s*(?:sq\.?\s*ft|sqft|square\s*f(?:ee|oo)t|sf)\b/);
  if (sq) {
    const beds = t.match(/(\d|one|two|three|four|five|six)\s*(?:bed|br|bedroom)s?\b/);
    const baths = t.match(/(\d|one|two|three|four|five)\s*(?:bath|ba|bathroom)s?\b/);
    const stories = /\b(two|2)[-\s]?stor(y|ies)\b/.test(t) ? 2 : /\b(one|1|single)[-\s]?stor(y|ies)\b/.test(t) ? 1 : undefined;
    const garage = /\bno garage\b/.test(t) ? 'none' : /\b(1|one)[-\s]?car\b/.test(t) ? 'one_car' : /\b(2|two)[-\s]?car\b/.test(t) ? 'two_car' : undefined;
    const built = specFromSquareFeet(
      {
        sqft: Number(sq[1]),
        ...(stories ? { stories } : {}),
        ...(beds ? { bedrooms: clamp(n(beds[1]), 1, LIMITS.maxBedrooms) } : {}),
        ...(baths ? { bathrooms: clamp(n(baths[1]), 1, LIMITS.maxBathrooms) } : {}),
        ...(garage ? { garage } : {}),
      },
      spec,
    );
    const s = built.spec;
    return {
      kind: 'spec',
      spec: s,
      said: `Built a ${Number(sq[1]).toLocaleString('en-US')} sq ft house: ${s.lengthFt} × ${s.widthFt} ft, ${s.stories} ${s.stories === 1 ? 'story' : 'stories'}, ${s.bedrooms} bed, ${s.bathrooms} bath.${built.assumed.length ? ` Assumed ${built.assumed.join(', ')}.` : ''}`,
    };
  }

  if (/\b(cheaper|cut (the )?cost|save money|lower (the )?cost|value engineer|reduce (the )?cost)\b/.test(t)) {
    const options = savingOptions(spec, costs);
    const smart = applyAllSmart(spec, options, costs);
    if (smart.saving < 50) return { kind: 'spec', spec, said: 'This house is already built lean. No design or method change saves more than $50.' };
    const used = options.filter((o) => o.kind !== 'program' && o.id !== 'two-story').map((o) => o.title.toLowerCase());
    return { kind: 'spec', spec: smart.spec, said: `Saved about $${Math.round(smart.saving).toLocaleString('en-US')}: ${used.join('; ')}. Undo to go back.` };
  }

  const bedAbs = t.match(/\b(\d|one|two|three|four|five|six)\s*(?:bed|br|bedroom)s?\b/);
  const bathAbs = t.match(/\b(\d|one|two|three|four|five)\s*(?:bath|ba|bathroom)s?\b/);
  const addRemove = (word: RegExp, key: 'bedrooms' | 'bathrooms', max: number, label: string) => {
    if (new RegExp(`\\b(add|another|plus|one more)\\b.*${word.source}`).test(t)) {
      next[key] = clamp(next[key] + 1, 1, max);
      changes.push(`${label}: ${next[key]}`);
      return true;
    }
    if (new RegExp(`\\b(remove|drop|delete|minus|one less|take out)\\b.*${word.source}`).test(t)) {
      next[key] = clamp(next[key] - 1, 1, max);
      changes.push(`${label}: ${next[key]}`);
      return true;
    }
    return false;
  };
  if (!addRemove(/(bed|bedroom)s?\b/, 'bedrooms', LIMITS.maxBedrooms, 'bedrooms') && bedAbs) {
    next.bedrooms = clamp(n(bedAbs[1]), 1, LIMITS.maxBedrooms);
    changes.push(`bedrooms: ${next.bedrooms}`);
  }
  if (!addRemove(/(bath|bathroom)s?\b/, 'bathrooms', LIMITS.maxBathrooms, 'bathrooms') && bathAbs) {
    next.bathrooms = clamp(n(bathAbs[1]), 1, LIMITS.maxBathrooms);
    changes.push(`bathrooms: ${next.bathrooms}`);
  }

  if (/\b(no|remove|without|drop)( the)? garage\b/.test(t)) next.garage = 'none';
  else if (/\b(1|one|single)[-\s]?car\b/.test(t)) next.garage = 'one_car';
  else if (/\b(2|two|double)[-\s]?car\b/.test(t) || /\badd( a)? garage\b/.test(t)) next.garage = 'two_car';
  if (next.garage !== spec.garage) changes.push(`garage: ${next.garage === 'none' ? 'none' : next.garage === 'one_car' ? '1-car' : '2-car'}`);

  if (/\b(two|2)[-\s]?stor(y|ies)\b/.test(t)) next.stories = 2;
  else if (/\b(one|1|single)[-\s]?stor(y|ies)\b|\branch\b/.test(t)) next.stories = 1;
  if (next.stories !== spec.stories) changes.push(`${next.stories} ${next.stories === 1 ? 'story' : 'stories'}`);

  const pitch = t.match(/\b(\d{1,2})\s*(?:\/|in)\s*12\b/);
  if (pitch) {
    next.roofPitch = clamp(Number(pitch[1]), 3, 12);
    changes.push(`roof ${next.roofPitch}/12`);
  }
  const walls = t.match(/\b(8|9|10)\s*(?:ft|foot|')\s*(?:walls?|ceilings?)\b|\b(?:walls?|ceilings?)\s*(?:to|at)?\s*(8|9|10)\s*(?:ft|foot|')?/);
  if (walls) {
    next.wallHeightFt = Number(walls[1] ?? walls[2]) as BuildSpec['wallHeightFt'];
    changes.push(`${next.wallHeightFt} ft walls`);
  }
  const studs = t.match(/\bstuds?\s*(?:at|to)?\s*(16|24)\b|\b(16|24)\s*(?:in|")?\s*(?:o\.?c\.?|on center)/);
  if (studs) {
    next.studSpacingIn = Number(studs[1] ?? studs[2]) as BuildSpec['studSpacingIn'];
    changes.push(`studs ${next.studSpacingIn} in on center`);
  }
  const waste = t.match(/\bwaste\s*(?:to|at)?\s*(\d{1,2})\s*%?/);
  if (waste) {
    next.wastePercent = clamp(Number(waste[1]), 0, 30);
    changes.push(`waste ${next.wastePercent}%`);
  }
  const eaves = t.match(/\b(?:eaves?|overhang)\s*(?:to|at)?\s*(\d(?:\.\d)?)\s*(?:ft|')?/);
  if (eaves) {
    next.overhangFt = clamp(Number(eaves[1]), 0, 3);
    changes.push(`eaves ${next.overhangFt} ft`);
  }
  const size = t.match(/\b(\d{2,3})\s*(?:ft|')?\s*(?:x|by|×)\s*(\d{2,3})\s*(?:ft|')?\b/);
  if (size) {
    const a = Number(size[1]);
    const b = Number(size[2]);
    next.lengthFt = clamp(Math.max(a, b), LIMITS.minLength, LIMITS.maxLength);
    next.widthFt = clamp(Math.min(a, b), LIMITS.minWidth, LIMITS.maxWidth);
    changes.push(`${next.lengthFt} × ${next.widthFt} ft`);
  }
  const len = t.match(/\blength\s*(?:to|at)?\s*(\d{2,3})/);
  if (len) {
    next.lengthFt = clamp(Number(len[1]), LIMITS.minLength, LIMITS.maxLength);
    changes.push(`length ${next.lengthFt} ft`);
  }
  const wid = t.match(/\b(?:width|depth)\s*(?:to|at)?\s*(\d{2,3})/);
  if (wid) {
    next.widthFt = clamp(Number(wid[1]), LIMITS.minWidth, LIMITS.maxWidth);
    changes.push(`width ${next.widthFt} ft`);
  }

  if (!changes.length) return { kind: 'none' };
  next = { ...next };
  return { kind: 'spec', spec: next, said: `Changed ${changes.join(', ')}.` };
}
