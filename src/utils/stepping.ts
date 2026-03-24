/** Returns the step size as 1/100 of the order-of-magnitude of the value. */
function getStep(value: number): number {
  if (value === 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(value))));
  return magnitude / 100;
}

/** Snap up to the next even multiple of the step, or just add the step if already aligned. */
export function stepUp(value: number): number {
  const step = getStep(value);
  const precision = Math.max(0, -Math.floor(Math.log10(step)));
  return parseFloat((Math.floor(value / step + 1e-9) * step + step).toFixed(precision));
}

/** Snap down to the previous even multiple of the step, or just subtract the step if already aligned. */
export function stepDown(value: number): number {
  const step = getStep(value);
  const precision = Math.max(0, -Math.floor(Math.log10(step)));
  return parseFloat((Math.ceil(value / step - 1e-9) * step - step).toFixed(precision));
}
