/** Apparatus stays below the loss line, including the narrowest Custom board. */
export function apparatusLayout(
  width: number,
  lossY: number,
  strikerY: number,
) {
  if (width < 336) {
    const next = { x: width - 46, y: lossY + 47 };
    return {
      next,
      spriteSize: 48,
      tray: { x: next.x - 28, y: next.y - 27, width: 56, height: 54 },
      label: { x: next.x, y: lossY + 9 },
    };
  }
  return {
    next: { x: width - 64, y: strikerY + 3 },
    spriteSize: 56,
    tray: { x: width - 104, y: strikerY - 33, width: 80, height: 72 },
    label: { x: width - 64, y: strikerY - 47 },
  };
}
