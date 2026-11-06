/** Local facial state compositor for the original production bodies.
 * All coordinates use the existing 64-logical-unit / 256-pixel texture frame.
 * No body transform, timer, randomness, or gameplay data belongs in this file.
 */
export type FaceExpression = "idle" | "blink" | "anticipation" | "released";
export interface FaceEllipse {
  x: number;
  y: number;
  rx: number;
  ry: number;
}
export interface FaceSpec {
  eyes: readonly [FaceEllipse, FaceEllipse];
  eyeZones: readonly [FaceEllipse, FaceEllipse];
  mouth: FaceEllipse;
  mouthZone: FaceEllipse;
  ink: string;
  glance: number;
  protectedEllipses?: readonly FaceEllipse[];
  protected?: readonly {
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
}

/** Explicit face islands avoid contours, rivets, surface marks and Loop's hole. */
export const FACE_SPECS: readonly FaceSpec[] = [
  {
    // Chip: deliberately uneven bead placement follows the approved idle.
    eyes: [
      { x: 21.8, y: 29.4, rx: 4.5, ry: 5.0 },
      { x: 40.1, y: 29.7, rx: 4.7, ry: 5.1 },
    ],
    eyeZones: [
      { x: 21.8, y: 28.9, rx: 8.0, ry: 9.0 },
      { x: 40.1, y: 29.0, rx: 8.0, ry: 9.0 },
    ],
    mouth: { x: 31.6, y: 37.0, rx: 5.8, ry: 3.8 },
    mouthZone: { x: 31.6, y: 37.3, rx: 9.1, ry: 6.0 },
    ink: "#483127",
    glance: -0.25,
  },
  {
    eyes: [
      { x: 23.7, y: 29.3, rx: 3.7, ry: 3.8 },
      { x: 39.3, y: 29.2, rx: 3.7, ry: 3.8 },
    ],
    eyeZones: [
      { x: 23.7, y: 28.6, rx: 6.9, ry: 7.4 },
      { x: 39.3, y: 28.6, rx: 6.9, ry: 7.4 },
    ],
    mouth: { x: 31.5, y: 34.0, rx: 4.3, ry: 2.6 },
    mouthZone: { x: 31.5, y: 34.4, rx: 6.8, ry: 4.7 },
    ink: "#3e4230",
    glance: 0.15,
  },
  {
    // Rivet: only the inset face, never the six surrounding bolts.
    eyes: [
      { x: 25.0, y: 31.5, rx: 3.6, ry: 4.3 },
      { x: 37.3, y: 31.5, rx: 3.6, ry: 4.3 },
    ],
    eyeZones: [
      { x: 25.0, y: 30.7, rx: 5.7, ry: 7.0 },
      { x: 37.3, y: 30.7, rx: 5.7, ry: 7.0 },
    ],
    mouth: { x: 31.3, y: 37.5, rx: 4.7, ry: 2.8 },
    mouthZone: { x: 31.3, y: 37.1, rx: 7.1, ry: 4.9 },
    ink: "#273640",
    glance: 0,
    protectedEllipses: [
      { x: 31.3, y: 20.3, rx: 3, ry: 3.2 },
      { x: 19.3, y: 26.7, rx: 3, ry: 3.2 },
      { x: 20, y: 38.7, rx: 3, ry: 3.2 },
      { x: 31.3, y: 44.3, rx: 3, ry: 3.2 },
      { x: 43, y: 38.7, rx: 3, ry: 3.2 },
      { x: 43.3, y: 26.7, rx: 3, ry: 3.2 },
    ],
  },
  {
    eyes: [
      { x: 24.0, y: 32.2, rx: 4.7, ry: 4.6 },
      { x: 39.1, y: 32.2, rx: 4.7, ry: 4.6 },
    ],
    eyeZones: [
      { x: 24.0, y: 31.4, rx: 7.6, ry: 8.6 },
      { x: 39.1, y: 31.4, rx: 7.6, ry: 8.6 },
    ],
    mouth: { x: 31.8, y: 39.0, rx: 4.0, ry: 2.6 },
    mouthZone: { x: 31.8, y: 38.8, rx: 6.4, ry: 4.4 },
    ink: "#503444",
    glance: -0.45,
    protected: [{ x: 38, y: 12, width: 13, height: 13.5 }],
  },
  {
    eyes: [
      { x: 24.6, y: 30.6, rx: 4.0, ry: 4.5 },
      { x: 37.7, y: 30.6, rx: 4.0, ry: 4.5 },
    ],
    eyeZones: [
      { x: 24.6, y: 29.8, rx: 7.0, ry: 8.0 },
      { x: 37.7, y: 29.8, rx: 7.0, ry: 8.0 },
    ],
    mouth: { x: 31.5, y: 38.1, rx: 6.1, ry: 4.2 },
    mouthZone: { x: 31.5, y: 37.9, rx: 10.0, ry: 6.2 },
    ink: "#59362c",
    glance: 0,
  },
  {
    // Loop: small face on the arch bridge; original alpha is always restored.
    eyes: [
      { x: 27.6, y: 23.4, rx: 2.8, ry: 3.4 },
      { x: 36.0, y: 23.1, rx: 2.8, ry: 3.4 },
    ],
    eyeZones: [
      { x: 27.2, y: 22.3, rx: 4.7, ry: 6.2 },
      { x: 36.1, y: 22.2, rx: 4.7, ry: 6.2 },
    ],
    mouth: { x: 31.7, y: 28.1, rx: 2.4, ry: 1.8 },
    mouthZone: { x: 31.7, y: 28.2, rx: 4.4, ry: 3.0 },
    ink: "#503038",
    glance: 0.15,
  },
  {
    eyes: [
      { x: 25.5, y: 29.3, rx: 4.0, ry: 3.6 },
      { x: 40.9, y: 29.6, rx: 4.0, ry: 3.6 },
    ],
    eyeZones: [
      { x: 25.2, y: 28.2, rx: 7.0, ry: 7.8 },
      { x: 40.3, y: 28.2, rx: 7.0, ry: 7.8 },
    ],
    mouth: { x: 32.8, y: 35.7, rx: 3.8, ry: 2.5 },
    mouthZone: { x: 32.8, y: 35.7, rx: 6.0, ry: 4.2 },
    ink: "#35494d",
    glance: 1.05,
    protected: [{ x: 10, y: 33.5, width: 17.2, height: 11 }],
  },
];

const plates = new Map<
  number,
  { canvas: HTMLCanvasElement; revision: number }
>();
let revision = 0;
const composites = new WeakMap<
  HTMLCanvasElement,
  Map<string, HTMLCanvasElement>
>();

/** The loader must apply the idle body's exact normalization to this plate. */
export function registerProductionFacePlate(
  index: number,
  canvas?: HTMLCanvasElement,
): void {
  if (!Number.isInteger(index) || index < 0 || index >= 7)
    throw new Error("Only ordinary toys have face plates.");
  if (!canvas) {
    plates.delete(index);
    revision++;
    return;
  }
  if (canvas.width !== 256 || canvas.height !== 256)
    throw new Error(
      "A face plate must share the 256-pixel normalized idle frame.",
    );
  plates.set(index, { canvas, revision: ++revision });
}
export function productionFaceRevision(index: number): number {
  return plates.get(index)?.revision ?? revision;
}
export function productionFaceReady(index: number): boolean {
  return index < 7 && plates.has(index);
}

function ellipseWeight(zone: FaceEllipse, x: number, y: number): number {
  const radius = Math.hypot((x - zone.x) / zone.rx, (y - zone.y) / zone.ry);
  if (radius >= 1) return 0;
  if (radius <= 0.8) return 1;
  const t = (1 - radius) / 0.2;
  return t * t * (3 - 2 * t);
}
export function facePatchWeight(
  index: number,
  x: number,
  y: number,
  expression: FaceExpression,
): number {
  const spec = FACE_SPECS[index];
  if (!spec || expression === "idle") return 0;
  if (
    spec.protectedEllipses?.some(
      (zone) => Math.hypot((x - zone.x) / zone.rx, (y - zone.y) / zone.ry) <= 1,
    )
  )
    return 0;
  if (
    spec.protected?.some(
      (r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height,
    )
  )
    return 0;
  return Math.max(
    ...spec.eyeZones.map((zone) => ellipseWeight(zone, x, y)),
    ellipseWeight(spec.mouthZone, x, y),
  );
}

export interface MaterialEye {
  x: number;
  y: number;
  rx: number;
  ry: number;
  closed?: boolean;
  direction?: number;
  released?: boolean;
  ink?: string;
}
/** Shared shaded cream-bead construction for production face layers/fallback. */
export function drawMaterialEye(
  ctx: CanvasRenderingContext2D,
  eye: MaterialEye,
): void {
  const { x, y, rx, ry } = eye;
  const ink = eye.ink ?? "#302c2b",
    direction = eye.direction ?? 0;
  ctx.lineCap = "round";
  if (eye.closed) {
    const reach = rx * 0.86,
      bend = (eye.released ? -1 : 1) * ry * 0.48;
    ctx.beginPath();
    ctx.moveTo(x - reach, y);
    ctx.quadraticCurveTo(x, y + bend, x + reach, y);
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1.3, ry * 0.36);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - reach * 0.8, y - 0.75);
    ctx.quadraticCurveTo(x, y + bend - 0.75, x + reach * 0.8, y - 0.75);
    ctx.strokeStyle = "rgba(230,210,178,.28)";
    ctx.lineWidth = 0.55;
    ctx.stroke();
    return;
  }
  ctx.fillStyle = "rgba(22,22,27,.28)";
  ctx.beginPath();
  ctx.ellipse(x + 0.35, y + 0.8, rx + 0.75, ry + 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  const bead = ctx.createRadialGradient(
    x - rx * 0.4,
    y - ry * 0.5,
    0.3,
    x,
    y,
    Math.max(rx, ry) * 1.2,
  );
  bead.addColorStop(0, "#e9ddbf");
  bead.addColorStop(0.6, "#cfc09f");
  bead.addColorStop(1, "#a69b83");
  ctx.fillStyle = bead;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, -0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(42,36,31,.22)";
  ctx.lineWidth = 0.45;
  ctx.stroke();
  const pupilX = x + direction + rx * 0.08,
    pupilY = y + ry * 0.08;
  ctx.fillStyle = "#28272b";
  ctx.beginPath();
  ctx.ellipse(pupilX, pupilY, rx * 0.43, ry * 0.51, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(240,227,198,.62)";
  ctx.beginPath();
  ctx.arc(
    pupilX - rx * 0.17,
    pupilY - ry * 0.18,
    Math.max(0.35, rx * 0.14),
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  index: number,
  expression: Exclude<FaceExpression, "idle">,
): void {
  const spec = FACE_SPECS[index];
  for (const eye of spec.eyes) {
    const wide = expression === "anticipation" ? 1.08 : 1;
    drawMaterialEye(ctx, {
      ...eye,
      rx: eye.rx * wide,
      ry: eye.ry * (expression === "anticipation" ? 1.15 : 1),
      closed: expression !== "anticipation",
      released: expression === "released",
      direction: spec.glance,
      ink: spec.ink,
    });
    if (expression === "anticipation" && index !== 5) {
      ctx.strokeStyle = spec.ink;
      ctx.globalAlpha = 0.72;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(eye.x - eye.rx * 0.6, eye.y - eye.ry - 2);
      ctx.quadraticCurveTo(
        eye.x,
        eye.y - eye.ry - 3,
        eye.x + eye.rx * 0.65,
        eye.y - eye.ry - 2.3,
      );
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  const mouth = spec.mouth;
  ctx.lineCap = "round";
  ctx.strokeStyle = spec.ink;
  ctx.fillStyle = spec.ink;
  ctx.lineWidth = index === 5 ? 1.2 : 1.65;
  ctx.beginPath();
  if (expression === "blink") {
    ctx.moveTo(mouth.x - mouth.rx * 0.65, mouth.y - 0.4);
    ctx.quadraticCurveTo(
      mouth.x,
      mouth.y + mouth.ry * 0.6,
      mouth.x + mouth.rx * 0.65,
      mouth.y - 0.4,
    );
    ctx.stroke();
  } else if (expression === "anticipation") {
    ctx.ellipse(mouth.x, mouth.y, mouth.rx * 0.53, mouth.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(229,208,176,.34)";
    ctx.lineWidth = 0.65;
    ctx.stroke();
  } else {
    ctx.moveTo(mouth.x - mouth.rx, mouth.y - mouth.ry * 0.35);
    ctx.quadraticCurveTo(
      mouth.x,
      mouth.y + mouth.ry * 1.3,
      mouth.x + mouth.rx,
      mouth.y - mouth.ry * 0.35,
    );
    ctx.stroke();
    if (index === 0 || index === 4) {
      ctx.quadraticCurveTo(
        mouth.x,
        mouth.y + mouth.ry * 2,
        mouth.x - mouth.rx,
        mouth.y - mouth.ry * 0.35,
      );
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(mouth.x - mouth.rx * 0.58, mouth.y + 0.2);
      ctx.quadraticCurveTo(
        mouth.x,
        mouth.y + 1.2,
        mouth.x + mouth.rx * 0.58,
        mouth.y + 0.2,
      );
      ctx.strokeStyle = "#cfc09f";
      ctx.lineWidth = 1.0;
      ctx.stroke();
    }
  }
}

/** Compose only the declared face islands; alpha and every outside RGBA byte
 * are restored from idle. Idle/Anchor return their original canvas unchanged.
 */
export function composeProductionFace(
  index: number,
  idle: HTMLCanvasElement,
  clean: HTMLCanvasElement,
  expression: FaceExpression,
): HTMLCanvasElement {
  if (expression === "idle" || index === 7) return idle;
  if (!FACE_SPECS[index]) throw new Error("Unknown face identity.");
  if (
    [idle, clean].some(
      (canvas) => canvas.width !== 256 || canvas.height !== 256,
    )
  )
    throw new Error(
      "Production face inputs must share the normalized 256-pixel frame.",
    );
  const original = idle
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(0, 0, 256, 256);
  const material = clean
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(0, 0, 256, 256);
  const overlay = document.createElement("canvas");
  overlay.width = overlay.height = 256;
  const layer = overlay.getContext("2d")!;
  layer.scale(4, 4);
  drawFace(layer, index, expression);
  const features = layer.getImageData(0, 0, 256, 256).data;
  const output = new ImageData(new Uint8ClampedArray(original.data), 256, 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const offset = (y * 256 + x) * 4,
        alpha = original.data[offset + 3];
      if (!alpha) continue;
      const weight = facePatchWeight(
        index,
        (x + 0.5) / 4,
        (y + 0.5) / 4,
        expression,
      );
      if (!weight) continue;
      const paint = (features[offset + 3] / 255) * weight;
      const replacement = material.data[offset + 3] ? weight : 0;
      for (let channel = 0; channel < 3; channel++) {
        const base =
          original.data[offset + channel] * (1 - replacement) +
          material.data[offset + channel] * replacement;
        output.data[offset + channel] = Math.round(
          base * (1 - paint) + features[offset + channel] * paint,
        );
      }
      // Alpha is intentionally copied, not recomputed by source-over blending.
      output.data[offset + 3] = alpha;
    }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const target = canvas.getContext("2d", { willReadFrequently: true })!;
  // Copy the original premultiplied bitmap directly. A full get/put round trip
  // can change low-alpha contour RGB by one byte even when those bytes were
  // copied unchanged. Write only actually changed face-pixel runs afterward.
  target.drawImage(idle, 0, 0);
  for (let y = 0; y < 256; y++) {
    let start = -1;
    for (let x = 0; x <= 256; x++) {
      const offset = (y * 256 + x) * 4;
      const changed =
        x < 256 &&
        [0, 1, 2].some(
          (channel) =>
            output.data[offset + channel] !== original.data[offset + channel],
        );
      if (changed && start < 0) start = x;
      if (!changed && start >= 0) {
        target.putImageData(output, 0, 0, start, y, x - start, 1);
        start = -1;
      }
    }
  }
  return canvas;
}

/** No placeholder plate is installed here. Missing clean art keeps the idle body. */
export function productionFaceCanvas(
  index: number,
  idle: HTMLCanvasElement,
  expression: FaceExpression,
): HTMLCanvasElement {
  const plate = plates.get(index);
  if (!plate || expression === "idle" || index === 7) return idle;
  let cache = composites.get(idle);
  if (!cache) composites.set(idle, (cache = new Map()));
  const key = `${index}/${expression}/${plate.revision}`;
  let canvas = cache.get(key);
  if (!canvas) {
    canvas = composeProductionFace(index, idle, plate.canvas, expression);
    cache.set(key, canvas);
  }
  return canvas;
}
