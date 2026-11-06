/** Canonical preparation shared by the exporter and loader. Prepared assets
 * bypass recentering, preserving their exact 256-pixel runtime frame. */
export function normalizeCharacterSource(
  image: HTMLImageElement,
  alreadyPrepared = false,
) {
  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  if (
    !source.width ||
    !source.height ||
    (alreadyPrepared && (source.width !== 256 || source.height !== 256))
  )
    return undefined;
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, source.width, source.height).data;
  let left = source.width,
    top = source.height,
    right = -1,
    bottom = -1,
    transparentPixels = 0,
    partialAlphaPixels = 0;
  for (let y = 0; y < source.height; y++)
    for (let x = 0; x < source.width; x++) {
      const alpha = pixels[(y * source.width + x) * 4 + 3]!;
      if (alpha === 0) transparentPixels++;
      else if (alpha < 255) partialAlphaPixels++;
      if (alpha < 24) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  if (right < left || bottom < top) return undefined;
  const width = right - left + 1,
    height = bottom - top + 1,
    scale = 44 / Math.max(width, height);
  const normalizedWidth = alreadyPrepared ? width / 4 : width * scale,
    normalizedHeight = alreadyPrepared ? height / 4 : height * scale;
  let canvas = source;
  if (!alreadyPrepared) {
    canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const target = canvas.getContext("2d");
    if (!target) return undefined;
    target.imageSmoothingEnabled = true;
    target.imageSmoothingQuality = "high";
    target.scale(4, 4);
    target.drawImage(
      source,
      left,
      top,
      width,
      height,
      (64 - normalizedWidth) / 2,
      (64 - normalizedHeight) / 2,
      normalizedWidth,
      normalizedHeight,
    );
  }
  return {
    canvas,
    inspection: {
      sourceWidth: source.width,
      sourceHeight: source.height,
      transparentPixels,
      partialAlphaPixels,
      bounds: { x: left, y: top, width, height },
      normalizedWidth,
      normalizedHeight,
    },
  };
}
