export function getCropFractions(crop) {
  const source = crop && typeof crop === 'object' ? crop : {};
  const fraction = value => (Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.9) : 0);
  return {
    l: fraction(source.l),
    t: fraction(source.t),
    r: fraction(source.r),
    b: fraction(source.b)
  };
}

export function getCropGeometry(crop) {
  const fractions = getCropFractions(crop);
  const visibleWidth = Math.max(0.0001, 1 - fractions.l - fractions.r);
  const visibleHeight = Math.max(0.0001, 1 - fractions.t - fractions.b);
  return {
    ...fractions,
    visibleWidth,
    visibleHeight,
    imageWidth: 1 / visibleWidth,
    imageHeight: 1 / visibleHeight,
    imageLeft: -(fractions.l / visibleWidth),
    imageTop: -(fractions.t / visibleHeight)
  };
}
