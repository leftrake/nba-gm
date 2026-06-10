// Seedable RNG (mulberry32) so leagues are reproducible if desired
export function makeRng(seed = Date.now()) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = makeRng();

export function randInt(min, max, rng = rand) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function pick(arr, rng = rand) {
  return arr[Math.floor(rng() * arr.length)];
}

// Approx normal distribution via central limit
export function gauss(mean, sd, rng = rand) {
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += rng();
  return mean + ((sum - 3) / 3) * sd * 1.73;
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
