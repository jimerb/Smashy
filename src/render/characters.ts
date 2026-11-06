import { Texture } from "pixi.js";
import { productionCharacterCanvas } from "./production-art";
import {
  drawMaterialEye,
  productionFaceCanvas,
  productionFaceReady,
  productionFaceRevision,
  type FaceExpression,
} from "./faces";

export type CharacterType = number | string;
export type Expression = FaceExpression;
export const CHARACTER_NAMES = [
  "Chip",
  "Gum",
  "Rivet",
  "Wisp",
  "Bash",
  "Loop",
  "Peb",
  "Anchor",
] as const;
export const CHARACTER_COLORS = [
  "#c79a55",
  "#809573",
  "#6e829b",
  "#9a7895",
  "#c18268",
  "#b9808c",
  "#829fa5",
  "#666b78",
];
const textureCache = new Map<string, Texture>();

function tone(color: string, amount: number): string {
  const rgb = color
    .slice(1)
    .match(/../g)!
    .map((channel) => parseInt(channel, 16));
  return `rgb(${rgb.map((channel) => Math.round(Math.max(0, Math.min(255, channel * amount)))).join(",")})`;
}

export function characterIndex(type: CharacterType): number {
  if (typeof type === "number")
    return Math.max(0, Math.min(7, Math.floor(type)));
  const index = CHARACTER_NAMES.findIndex(
    (name) => name.toLowerCase() === type.toLowerCase(),
  );
  return index < 0 ? 0 : index;
}

function body(ctx: CanvasRenderingContext2D, type: number) {
  ctx.beginPath();
  switch (type) {
    case 0:
      ctx.moveTo(-20, -14);
      ctx.lineTo(-15, -20);
      ctx.lineTo(12, -20);
      ctx.lineTo(12, -14);
      ctx.lineTo(20, -11);
      ctx.lineTo(20, 16);
      ctx.quadraticCurveTo(20, 20, 15, 20);
      ctx.lineTo(-17, 20);
      ctx.quadraticCurveTo(-21, 20, -21, 15);
      break;
    case 1:
      ctx.moveTo(-19, -10);
      ctx.bezierCurveTo(-23, -23, -5, -25, 4, -15);
      ctx.bezierCurveTo(8, -8, 17, -21, 21, -6);
      ctx.bezierCurveTo(28, 15, 8, 24, -7, 20);
      ctx.bezierCurveTo(-23, 17, -26, 2, -19, -10);
      break;
    case 2:
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const x = Math.cos(a) * 23,
          y = Math.sin(a) * 23;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      break;
    case 3:
      ctx.moveTo(-3, -23);
      ctx.quadraticCurveTo(1, -25, 5, -19);
      ctx.lineTo(21, 0);
      ctx.quadraticCurveTo(23, 3, 18, 8);
      ctx.lineTo(1, 22);
      ctx.quadraticCurveTo(-2, 24, -5, 20);
      ctx.lineTo(-21, 3);
      ctx.quadraticCurveTo(-24, 0, -19, -6);
      break;
    case 4:
      ctx.moveTo(-3, -22);
      ctx.quadraticCurveTo(0, -25, 4, -22);
      ctx.lineTo(22, -6);
      ctx.lineTo(15, 20);
      ctx.quadraticCurveTo(0, 24, -16, 19);
      ctx.lineTo(-22, -5);
      break;
    case 5:
      ctx.moveTo(-21, 20);
      ctx.lineTo(-21, -2);
      ctx.bezierCurveTo(-21, -27, 21, -27, 21, -2);
      ctx.lineTo(21, 20);
      ctx.lineTo(10, 20);
      ctx.lineTo(10, 7);
      ctx.bezierCurveTo(10, -5, -10, -5, -10, 7);
      ctx.lineTo(-10, 20);
      break;
    case 6:
      ctx.ellipse(0, 1, 23, 19, -0.09, 0, Math.PI * 2);
      break;
    default:
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i + Math.PI / 8;
        const x = Math.cos(a) * 23,
          y = Math.sin(a) * 23;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
  }
  ctx.closePath();
}

function eye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  blink: boolean,
  direction: number,
  big: boolean,
) {
  drawMaterialEye(ctx, {
    x,
    y,
    rx: big ? 5 : 4.6,
    ry: big ? 5.4 : 5,
    closed: blink,
    direction,
  });
}

/** Production faces stay on the production material for every expression. */
function productionTexture(
  index: number,
  expression: Expression,
  highContrast: boolean,
): Texture | null {
  const idle = productionCharacterCanvas(index);
  if (!idle) return null;
  const pose = index === 7 || !productionFaceReady(index) ? "idle" : expression;
  const key = `production/${index}/${pose}/${highContrast}/${productionFaceRevision(index)}`;
  const existing = textureCache.get(key);
  if (existing) return existing;
  const source = productionFaceCanvas(index, idle, pose);
  // Body pose belongs to the sprite transform, never a resampled expression
  // texture. The ordinary idle path reuses its approved canvas byte-for-byte.
  let canvas = source;
  if (highContrast && index < 7) {
    canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0);
    ctx.scale(4, 4);
    // Small separate badges preserve the original face and the arch's alpha.
    ctx.fillStyle = "rgba(16,22,30,.85)";
    ctx.beginPath();
    ctx.roundRect(11, 44, 9, 9, 2.2);
    ctx.fill();
    ctx.strokeStyle = "#d5c8a7";
    ctx.fillStyle = "#d5c8a7";
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.save();
    ctx.translate(15.5, 48.5);
    ctx.beginPath();
    if (index === 0) {
      ctx.moveTo(-2, 2);
      ctx.lineTo(-2, -2);
      ctx.lineTo(2, -2);
    } else if (index === 1) {
      ctx.moveTo(-2, 0);
      ctx.lineTo(2, 0);
    } else if (index === 2) {
      ctx.rect(-2, -2, 4, 4);
    } else if (index === 3) {
      ctx.moveTo(-2, 2);
      ctx.lineTo(2, -2);
    } else if (index === 4) {
      ctx.arc(0, 0, 1.6, 0, Math.PI * 2);
    } else if (index === 5) {
      ctx.arc(0, 1, 2, Math.PI, 0);
    } else {
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(i * 2 + 0.5, 0);
        ctx.arc(i * 2, 0, 0.5, 0, Math.PI * 2);
      }
    }
    ctx.stroke();
    ctx.restore();
  }
  const texture = Texture.from(canvas);
  textureCache.set(key, texture);
  return texture;
}

/** Original code-authored individual sprite surfaces. No reference sheet crops. */
export function characterTexture(
  type: CharacterType,
  expression: Expression = "idle",
  highContrast = false,
): Texture {
  const index = characterIndex(type);
  const artwork = productionTexture(index, expression, highContrast);
  if (artwork) return artwork;
  const key = `${index}/${expression}/${highContrast}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx)
    throw new Error("A 2D canvas is required to draw Smashy characters.");
  ctx.scale(4, 4);
  ctx.translate(32, 30);
  // Small contact shadow and a dark lower bevel suggest depth without bloom.
  ctx.save();
  ctx.translate(0, 22);
  ctx.scale(1, 0.24);
  const contact = ctx.createRadialGradient(0, 0, 5, 0, 0, 27);
  contact.addColorStop(0, "rgba(3,8,14,.4)");
  contact.addColorStop(1, "rgba(3,8,14,0)");
  ctx.fillStyle = contact;
  ctx.fillRect(-28, -28, 56, 56);
  ctx.restore();
  const color = CHARACTER_COLORS[index]!;
  // A short extruded lower edge, a broad bevel, then a separate face plane.
  // These are drawn surfaces; every creature still has the same logical proxy.
  for (let layer = 4; layer > 0; layer--) {
    ctx.save();
    ctx.translate(0.4, layer * 0.65);
    body(ctx, index);
    ctx.fillStyle = tone(color, 0.47 + (4 - layer) * 0.045);
    ctx.fill();
    ctx.restore();
  }
  body(ctx, index);
  const edge = ctx.createLinearGradient(-21, -22, 20, 23);
  edge.addColorStop(0, tone(color, 1.34));
  edge.addColorStop(0.36, tone(color, 1.05));
  edge.addColorStop(0.7, tone(color, 0.79));
  edge.addColorStop(1, tone(color, 0.55));
  ctx.fillStyle = edge;
  ctx.fill();
  ctx.save();
  ctx.translate(-0.35, -0.8);
  ctx.scale(index === 6 ? 0.91 : 0.87, index === 6 ? 0.89 : 0.86);
  body(ctx, index);
  const face = ctx.createLinearGradient(-13, -20, 14, 24);
  face.addColorStop(0, tone(color, 1.16));
  face.addColorStop(0.4, tone(color, 1.01));
  face.addColorStop(1, tone(color, 0.76));
  ctx.fillStyle = face;
  ctx.fill();
  ctx.strokeStyle = "rgba(240,220,182,.12)";
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.restore();
  body(ctx, index);
  ctx.save();
  ctx.clip();
  const shade = ctx.createLinearGradient(-10, -24, 8, 26);
  shade.addColorStop(
    0,
    highContrast ? "rgba(250,237,203,.25)" : "rgba(242,224,186,.12)",
  );
  shade.addColorStop(0.38, "rgba(242,224,186,.015)");
  shade.addColorStop(1, "rgba(14,24,37,.23)");
  ctx.fillStyle = shade;
  ctx.fillRect(-28, -28, 56, 56);
  const volume = ctx.createRadialGradient(-8, -11, 2, 0, 1, 31);
  volume.addColorStop(0, "rgba(230,216,177,.18)");
  volume.addColorStop(0.5, "rgba(228,211,174,.025)");
  volume.addColorStop(1, "rgba(16,26,39,.23)");
  ctx.fillStyle = volume;
  ctx.fillRect(-28, -28, 56, 56);
  const bevel = ctx.createLinearGradient(-15, -20, 18, 23);
  bevel.addColorStop(0, "rgba(236,221,183,.32)");
  bevel.addColorStop(0.45, "rgba(205,205,187,.025)");
  bevel.addColorStop(1, "rgba(21,31,43,.38)");
  body(ctx, index);
  ctx.strokeStyle = bevel;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  // A few broad, quiet planes distinguish clay, metal and soft molded rubber.
  if (index === 0) {
    ctx.beginPath();
    ctx.moveTo(-18, -14);
    ctx.lineTo(-14, -17);
    ctx.lineTo(10, -17);
    ctx.lineTo(10, -13);
    ctx.lineTo(-13, -13);
    ctx.closePath();
    ctx.fillStyle = "rgba(242,219,166,.23)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(16, -8);
    ctx.lineTo(18, -7);
    ctx.lineTo(18, 15);
    ctx.lineTo(15, 17);
    ctx.closePath();
    ctx.fillStyle = "rgba(52,49,34,.18)";
    ctx.fill();
  } else if (index === 2 || index === 7) {
    ctx.strokeStyle = "rgba(214,221,211,.04)";
    ctx.lineWidth = 0.6;
    for (let y = -18; y < 20; y += 2.4) {
      ctx.beginPath();
      ctx.moveTo(-25, y);
      ctx.lineTo(25, y - 4);
      ctx.stroke();
    }
  } else if (index === 3 || index === 4) {
    ctx.beginPath();
    ctx.moveTo(-1, -20);
    ctx.lineTo(-17, 0);
    ctx.lineTo(-7, -3);
    ctx.lineTo(2, -15);
    ctx.closePath();
    ctx.fillStyle = "rgba(233,212,193,.09)";
    ctx.fill();
  } else if (index === 5) {
    ctx.beginPath();
    ctx.moveTo(-12, 19);
    ctx.lineTo(-12, 7);
    ctx.bezierCurveTo(-12, -8, 12, -8, 12, 7);
    ctx.lineTo(12, 19);
    ctx.strokeStyle = "rgba(34,32,43,.24)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // Irregular shallow pores and a low-frequency mottled surface avoid flat fill.
  // This local integer hash never draws from, or changes, gameplay randomness.
  let grain = 701 + index * 937;
  const grainRandom = () => {
    grain = (Math.imul(grain, 1664525) + 1013904223) >>> 0;
    return grain / 4294967296;
  };
  for (let i = 0; i < (index === 1 ? 46 : 118); i++) {
    const x = grainRandom() * 48 - 24;
    const y = grainRandom() * 48 - 24;
    const radius = 0.2 + grainRandom() * (index === 4 ? 0.85 : 0.55);
    ctx.fillStyle = `rgba(28,26,32,${0.045 + grainRandom() * 0.085})`;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * 0.6, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(245,226,191,.07)";
    ctx.beginPath();
    ctx.ellipse(
      x,
      y + radius * 0.7,
      radius * 0.8,
      radius * 0.3,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
  body(ctx, index);
  ctx.strokeStyle = highContrast ? "#d4c9ae" : "rgba(41,34,37,.5)";
  ctx.lineWidth = highContrast ? 1.15 : 0.65;
  ctx.stroke();
  if (index === 2) {
    // Rivet's inset center is a solid occupied face plate, not a playable hole.
    const recess = ctx.createRadialGradient(-3, -7, 2, 0, 0, 16);
    recess.addColorStop(0, "#596e86");
    recess.addColorStop(0.85, "#485b72");
    recess.addColorStop(1, "#344255");
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      i
        ? ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15)
        : ctx.moveTo(Math.cos(a) * 15, Math.sin(a) * 15);
    }
    ctx.closePath();
    ctx.fillStyle = recess;
    ctx.fill();
    ctx.strokeStyle = "rgba(198,209,209,.22)";
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
  if (index === 7) {
    ctx.strokeStyle = "#c0c1b5";
    ctx.lineWidth = 2.3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.arc(0, -8, 3.3, 0, Math.PI * 2);
    ctx.moveTo(0, -4);
    ctx.lineTo(0, 12);
    ctx.moveTo(-8, 4);
    ctx.quadraticCurveTo(-8, 14, 0, 13);
    ctx.quadraticCurveTo(8, 14, 8, 4);
    ctx.moveTo(-8, 4);
    ctx.lineTo(-11, 7);
    ctx.moveTo(8, 4);
    ctx.lineTo(11, 7);
    ctx.moveTo(-6, -1);
    ctx.lineTo(6, -1);
    ctx.stroke();
    for (const [x, y] of [
      [-13, -13],
      [13, -13],
      [-13, 13],
      [13, 13],
    ]) {
      ctx.fillStyle = "#a2a79f";
      ctx.beginPath();
      ctx.arc(x!, y!, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const eyeY = index === 5 ? -10 : index === 6 ? -3 : -4;
    eye(
      ctx,
      -7,
      eyeY - (index === 0 ? 1.3 : 0),
      expression === "blink" || expression === "released",
      index === 6 ? 1 : 0,
      expression === "anticipation",
    );
    eye(
      ctx,
      7,
      eyeY,
      expression === "blink" || expression === "released",
      index === 6 ? 1 : 0,
      expression === "anticipation",
    );
    ctx.strokeStyle = "#3a2d2b";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    if (index !== 5) {
      ctx.beginPath();
      if (expression === "anticipation") {
        ctx.ellipse(0, 7, 2.4, 3.7, 0, 0, Math.PI * 2);
      } else if (expression === "released") {
        ctx.moveTo(-6, 4);
        ctx.quadraticCurveTo(0, 13, 6, 4);
      } else if (index === 6) {
        ctx.moveTo(1, 8);
        ctx.quadraticCurveTo(5, 10, 8, 6);
      } else {
        ctx.moveTo(-5, 6);
        ctx.quadraticCurveTo(0, index === 3 ? 6 : 10, 5, 6);
      }
      ctx.stroke();
      if (expression === "anticipation") {
        ctx.fillStyle = "#4d3430";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(-3, 11);
      ctx.quadraticCurveTo(1, 13, 4, 10.5);
      ctx.strokeStyle = "rgba(237,211,177,.22)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    if (index === 2) {
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 - Math.PI / 6;
        const x = Math.cos(a) * 18,
          y = Math.sin(a) * 18;
        ctx.fillStyle = "rgba(25,34,48,.6)";
        ctx.beginPath();
        ctx.arc(x, y + 0.45, 2, 0, Math.PI * 2);
        ctx.fill();
        const rivet = ctx.createRadialGradient(x - 0.5, y - 0.6, 0, x, y, 1.8);
        rivet.addColorStop(0, "#a3afb6");
        rivet.addColorStop(1, "#65768d");
        ctx.fillStyle = rivet;
        ctx.beginPath();
        ctx.arc(x, y, 1.65, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(35,48,65,.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 3, 12, 0.2, Math.PI - 0.2);
      ctx.stroke();
    }
    if (index === 3) {
      ctx.strokeStyle = "rgba(220,190,159,.6)";
      ctx.lineWidth = 1.7;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(3 + i * 2.3, -16 + i * 3);
        ctx.lineTo(5.5 + i * 2.3, -18 + i * 3);
        ctx.stroke();
      }
    }
    if (index === 6) {
      ctx.fillStyle = "#506e77";
      for (const [x, y] of [
        [-14, 6],
        [-10, 9],
        [-16, 10],
      ]) {
        ctx.beginPath();
        ctx.arc(x!, y!, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (index === 1) {
      ctx.strokeStyle = "rgba(34,77,58,.35)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-15, -9);
      ctx.quadraticCurveTo(-12, -14, -7, -11);
      ctx.stroke();
    }
    if (index === 4) {
      ctx.strokeStyle = "rgba(81,40,33,.35)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(-10, 13);
      ctx.quadraticCurveTo(0, 18, 10, 12);
      ctx.stroke();
    }
    if (highContrast) {
      // The preference is named Shape glyphs in the UI: give it actual stable
      // material marks as well as an outline, without covering either eye.
      ctx.save();
      ctx.translate(index === 5 ? -16 : -12, index === 5 ? 11 : 14);
      ctx.strokeStyle = "rgba(235,224,195,.88)";
      ctx.fillStyle = "rgba(235,224,195,.88)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (index === 0) {
        ctx.moveTo(-2, 2);
        ctx.lineTo(-2, -2);
        ctx.lineTo(2, -2);
      } else if (index === 1) {
        ctx.moveTo(-2.5, 0);
        ctx.lineTo(2.5, 0);
      } else if (index === 2) {
        ctx.rect(-2, -2, 4, 4);
      } else if (index === 3) {
        ctx.moveTo(-2, 2);
        ctx.lineTo(2, -2);
      } else if (index === 4) {
        ctx.arc(0, 0, 1.6, 0, Math.PI * 2);
      } else if (index === 5) {
        ctx.arc(0, 1, 2, Math.PI, 0);
      } else {
        for (let i = -1; i <= 1; i++) {
          ctx.moveTo(i * 2 + 0.5, 0);
          ctx.arc(i * 2, 0, 0.5, 0, Math.PI * 2);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
  }
  const texture = Texture.from(canvas);
  textureCache.set(key, texture);
  return texture;
}

export function clearCharacterTextureCache() {
  for (const texture of new Set(textureCache.values())) texture.destroy(true);
  textureCache.clear();
}
