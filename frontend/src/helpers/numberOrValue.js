export function numberOrValue(v) {
  const a = v * 1;
  if (isNaN(a)) return v;
  else return a;
}
