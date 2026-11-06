import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import { CosmeticClock } from "./clock";
import { apparatusLayout } from "./layout";
import { preloadProductionCharacterArt } from "./production-art";
import {
  characterIndex,
  characterTexture,
  CHARACTER_COLORS,
  type CharacterType,
  type Expression,
} from "./characters";

export {
  CHARACTER_NAMES,
  CHARACTER_COLORS,
  characterIndex,
} from "./characters";
export type { CharacterType } from "./characters";
export interface BoardPoint {
  x: number;
  y: number;
}
export interface BoardPiece extends BoardPoint {
  type: CharacterType;
}
export interface BoardFrame {
  domLabels?: boolean;
  width: number;
  height: number;
  lossY: number;
  /** Logical top of the lowered ceiling, before the projectile radius offset. */
  ceilingY?: number;
  striker: BoardPoint;
  cells: BoardPiece[];
  current: CharacterType | null;
  next: CharacterType | null;
  /** Radians from positive X with up represented by positive sine. */
  angle: number;
  guide?: BoardPoint[];
  landing?: BoardPoint | null;
  projectile?: BoardPiece | null;
  firing?: boolean;
  reducedMotion?: boolean;
  /** Quiet presentation only; never alters geometry, pieces or animation. */
  reducedDecoration?: boolean;
  highContrast?: boolean;
  paused?: boolean;
}

interface Particle {
  sprite: Sprite;
  start: number;
  duration: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  initialRotation: number;
  size: number;
  kind: "match" | "drop" | "chip" | "dust";
  impactAt?: number;
  dropGravity?: number;
  floorY?: number;
  impacted?: boolean;
  color?: number;
}

interface ImpactMark {
  x: number;
  y: number;
  start: number;
  color: number;
  floor: boolean;
}

const fragmentTextures = new Map<string, Texture>();
let dustTexture: Texture | null = null;

function paintedTexture(
  width: number,
  height: number,
  paint: (context: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * 2);
  canvas.height = Math.ceil(height * 2);
  const context = canvas.getContext("2d")!;
  context.scale(2, 2);
  paint(context);
  return Texture.from(canvas);
}

function fragmentTexture(type: CharacterType, variant: number): Texture {
  const index = characterIndex(type),
    key = `${index}/${variant % 3}`;
  const existing = fragmentTextures.get(key);
  if (existing) return existing;
  const texture = paintedTexture(24, 24, (ctx) => {
    ctx.translate(12, 12);
    const contours = [
      [
        [-7, -5],
        [3, -8],
        [8, 0],
        [3, 6],
        [-6, 5],
      ],
      [
        [-5, -7],
        [7, -3],
        [5, 7],
        [-3, 6],
        [-8, 0],
      ],
      [
        [-6, -2],
        [-1, -8],
        [7, -4],
        [6, 6],
        [-4, 5],
      ],
    ];
    const points = contours[variant % 3]!;
    ctx.beginPath();
    points.forEach(([x, y], i) =>
      i ? ctx.lineTo(x!, y!) : ctx.moveTo(x!, y!),
    );
    ctx.closePath();
    const shade = ctx.createLinearGradient(-7, -8, 7, 8);
    shade.addColorStop(0, CHARACTER_COLORS[index]!);
    shade.addColorStop(1, "#51453e");
    ctx.fillStyle = shade;
    ctx.fill();
    ctx.strokeStyle = "rgba(225,199,153,.42)";
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(points[0]![0]!, points[0]![1]!);
    ctx.lineTo(0, 0);
    ctx.lineTo(points[2]![0]!, points[2]![1]!);
    ctx.strokeStyle = "rgba(235,211,164,.25)";
    ctx.stroke();
  });
  fragmentTextures.set(key, texture);
  return texture;
}

function softDustTexture(): Texture {
  if (dustTexture) return dustTexture;
  dustTexture = paintedTexture(48, 48, (ctx) => {
    const dust = ctx.createRadialGradient(24, 24, 2, 24, 24, 23);
    dust.addColorStop(0, "rgba(166,146,120,.28)");
    dust.addColorStop(0.35, "rgba(137,125,111,.18)");
    dust.addColorStop(1, "rgba(100,99,99,0)");
    ctx.fillStyle = dust;
    ctx.fillRect(0, 0, 48, 48);
  });
  return dustTexture;
}

function springStrikerTexture(): Texture {
  return paintedTexture(128, 128, (ctx) => {
    ctx.translate(64, 64);
    const base = ctx.createLinearGradient(0, 40, 0, 55);
    base.addColorStop(0, "#5c5351");
    base.addColorStop(0.26, "#383b42");
    base.addColorStop(1, "#191d27");
    ctx.fillStyle = "rgba(4,7,13,.6)";
    ctx.beginPath();
    ctx.ellipse(0, 53, 57, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.roundRect(-53, 40, 106, 13, 5);
    ctx.fill();
    ctx.strokeStyle = "#81726a";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#111720";
    ctx.beginPath();
    ctx.roundRect(-19, 9, 38, 34, 4);
    ctx.fill();
    const coil = ctx.createLinearGradient(-22, 0, 22, 0);
    coil.addColorStop(0, "#4c3b2b");
    coil.addColorStop(0.28, "#a2804f");
    coil.addColorStop(0.57, "#6e5537");
    coil.addColorStop(0.8, "#ae8c58");
    coil.addColorStop(1, "#493b2d");
    ctx.lineWidth = 3.7;
    for (let y = 12; y <= 39; y += 6) {
      ctx.beginPath();
      ctx.ellipse(0, y, 21, 4, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "#10151d";
      ctx.lineWidth = 5.6;
      ctx.stroke();
      ctx.strokeStyle = coil;
      ctx.lineWidth = 3.7;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(-1, y - 0.65, 19, 3.4, 0, 0.1, Math.PI - 0.1);
      ctx.strokeStyle = "rgba(210,180,126,.24)";
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
    const plate = ctx.createLinearGradient(0, 3, 0, 13);
    plate.addColorStop(0, "#b09262");
    plate.addColorStop(0.3, "#6f5840");
    plate.addColorStop(1, "#3b3030");
    ctx.fillStyle = plate;
    ctx.beginPath();
    ctx.roundRect(-26, 3, 52, 10, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(208,181,137,.45)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    for (const direction of [-1, 1]) {
      ctx.save();
      ctx.scale(direction, 1);
      ctx.beginPath();
      ctx.moveTo(27, -11);
      ctx.quadraticCurveTo(32, -14, 35, -7);
      ctx.lineTo(45, 44);
      ctx.lineTo(29, 44);
      ctx.lineTo(26, 13);
      ctx.closePath();
      const metal = ctx.createLinearGradient(25, 0, 44, 0);
      metal.addColorStop(0, "#776b67");
      metal.addColorStop(0.22, "#524c50");
      metal.addColorStop(1, "#292d37");
      ctx.fillStyle = metal;
      ctx.fill();
      ctx.strokeStyle = "#877a72";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(30, -8);
      ctx.lineTo(34, 30);
      ctx.strokeStyle = "rgba(189,171,152,.22)";
      ctx.stroke();
      ctx.fillStyle = "#9b8c72";
      ctx.beginPath();
      ctx.arc(37, 39, 4.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#29272b";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(35, 37);
      ctx.lineTo(39, 41);
      ctx.moveTo(39, 37);
      ctx.lineTo(35, 41);
      ctx.stroke();
      ctx.restore();
    }
  });
}

const labelTextures = new Map<string, Texture>();
function labelTexture(text: string, color = "#9da6aa", size = 12): Texture {
  const key = `${text}/${color}/${size}`;
  const cached = labelTextures.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  const measure = canvas.getContext("2d")!;
  measure.font = `600 ${size * 2}px system-ui,sans-serif`;
  canvas.width = Math.ceil(measure.measureText(text).width + 12);
  canvas.height = size * 3;
  const context = canvas.getContext("2d")!;
  context.font = `600 ${size * 2}px system-ui,sans-serif`;
  context.textBaseline = "middle";
  context.fillStyle = color;
  context.fillText(text, 6, canvas.height / 2);
  const texture = Texture.from(canvas);
  labelTextures.set(key, texture);
  return texture;
}

export class BoardRenderer {
  private readonly scene = new Container();
  private readonly materialBackdrop = new Sprite();
  private readonly backdrop = new Graphics();
  private readonly ceiling = new Graphics();
  private readonly guides = new Graphics();
  private readonly impacts = new Graphics();
  private readonly pieces = new Container();
  private readonly apparatus = new Container();
  private readonly strikerBase = new Graphics();
  private readonly strikerArm = new Graphics();
  private readonly strikerMechanism = new Sprite(springStrikerTexture());
  private readonly effects = new Container();
  private readonly piecePool: Sprite[] = [];
  private readonly labels = new Container();
  private readonly loaded = new Sprite();
  private readonly queued = new Sprite();
  private readonly flying = new Sprite();
  private particles: Particle[] = [];
  private wallMarks: Array<{ point: BoardPoint; start: number }> = [];
  private impactMarks: ImpactMark[] = [];
  private frame: BoardFrame | null = null;
  private width = 1;
  private height = 1;
  private geometryKey = "";
  private recoilTime = -1000;
  private descentTime = -1000;
  private destroyed = false;
  private readonly clock = new CosmeticClock();

  constructor(
    private app: Application,
    private host: HTMLElement,
  ) {
    this.app.stage.addChild(this.scene);
    this.scene.addChild(
      this.materialBackdrop,
      this.backdrop,
      this.ceiling,
      this.guides,
      this.pieces,
      this.impacts,
      this.effects,
      this.apparatus,
      this.labels,
    );
    this.apparatus.addChild(
      this.strikerBase,
      this.strikerArm,
      this.strikerMechanism,
      this.loaded,
      this.queued,
      this.flying,
    );
    this.strikerMechanism.anchor.set(0.5);
    this.strikerMechanism.width = 128;
    this.strikerMechanism.height = 128;
    for (const sprite of [this.loaded, this.queued, this.flying]) {
      sprite.anchor.set(0.5);
      sprite.width = 64;
      sprite.height = 64;
      sprite.eventMode = "none";
    }
    this.scene.eventMode = "none";
    const canvas = this.app.canvas;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.setAttribute("role", "img");
    canvas.setAttribute(
      "aria-label",
      "Smashy board. Aim matching toys to clear connected groups and drop their supports.",
    );
    this.host.appendChild(canvas);
  }

  resize(cssWidth: number, cssHeight: number) {
    if (this.destroyed) return;
    const width = Math.max(1, Math.round(cssWidth)),
      height = Math.max(1, Math.round(cssHeight));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.app.renderer.resize(width, height);
    this.project();
  }
  private project() {
    if (!this.frame) return;
    const scale = Math.min(
      this.width / this.frame.width,
      this.height / this.frame.height,
    );
    this.scene.scale.set(scale);
    this.scene.position.set(
      (this.width - this.frame.width * scale) / 2,
      (this.height - this.frame.height * scale) / 2,
    );
  }
  recoil() {
    this.recoilTime = this.clock.read();
  }
  descend() {
    this.descentTime = this.clock.read();
  }

  /** Root may gate descent-only input with the same pause-aware timeline. */
  get settling() {
    return (
      !this.frame?.reducedMotion && this.clock.read() - this.descentTime < 220
    );
  }
  get isSettling() {
    return this.settling;
  }

  /** Clear transient presentation before a new run, restored checkpoint or board. */
  reset() {
    for (const particle of this.particles) particle.sprite.destroy();
    this.particles = [];
    this.wallMarks = [];
    this.impactMarks = [];
    this.impacts.clear();
    this.guides.clear();
    this.ceiling.clear();
    this.recoilTime = -Infinity;
    this.descentTime = -Infinity;
    this.geometryKey = "";
    this.loaded.visible = false;
    this.queued.visible = false;
    this.flying.visible = false;
    for (const sprite of this.piecePool) sprite.visible = false;
  }

  /** One small, fading wall-contact mark; never a screen flash or gameplay event. */
  bounce(point: BoardPoint) {
    if (
      this.destroyed ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y)
    )
      return;
    this.wallMarks.push({ point: { ...point }, start: this.clock.read() });
    if (this.wallMarks.length > 6) this.wallMarks.shift();
  }

  /** Cosmetic only; logical pieces must already have been removed by the caller. */
  burst(pieces: BoardPiece[], kind: "match" | "drop") {
    if (this.destroyed) return { impactDelayMs: 0 };
    const now = this.clock.read(),
      reduced = this.frame?.reducedMotion ?? false;
    const impactDelays: number[] = [];
    const max = reduced ? 18 : kind === "drop" ? 32 : 24;
    pieces.slice(0, max).forEach((piece, index) => {
      const sprite = new Sprite(
        characterTexture(piece.type, "released", this.frame?.highContrast),
      );
      sprite.anchor.set(0.5);
      sprite.width = 64;
      sprite.height = 64;
      sprite.position.set(piece.x, piece.y);
      this.effects.addChild(sprite);
      const direction = index % 2 ? 1 : -1,
        speed = direction * (22 + ((index * 13) % 33)),
        floorY = Math.max(
          piece.y + 45,
          (this.frame?.height ?? piece.y + 700) - 28,
        ),
        vy = -38 + ((index * 11) % 49),
        naturalImpactAt =
          (-vy + Math.sqrt(vy * vy + 4000 * (floorY - piece.y))) / 2000,
        // A long logical board must not hide the satisfying floor impact
        // behind its terminal overlay. Keep a continuous accelerating fall,
        // but tune cosmetic gravity to a bounded, readable flight duration.
        // No physics, scoring, or next-shot readiness depends on this curve.
        impactAt = Math.min(naturalImpactAt, 0.56 + (index % 3) * 0.01),
        dropGravity =
          (2 * (floorY - piece.y - vy * impactAt)) / (impactAt * impactAt);
      if (kind === "drop")
        impactDelays.push(Math.min(index * 3, 45) + impactAt * 1000);
      this.particles.push({
        sprite,
        start: now + Math.min(index * 3, 45),
        duration: reduced
          ? 160
          : kind === "drop"
            ? Math.min(1400, impactAt * 1000 + 180)
            : 245,
        x: piece.x,
        y: piece.y,
        vx: reduced ? 0 : speed,
        vy: reduced ? 0 : vy,
        rotation: reduced ? 0 : direction * (2.3 + ((index * 7) % 18) / 8),
        initialRotation: reduced ? 0 : direction * (index % 4) * 0.06,
        size: 64,
        kind,
        floorY,
        impactAt: impactAt * 1000,
        dropGravity,
        color: characterIndex(piece.type),
      });
      if (!reduced && kind === "match" && index < 12) {
        this.addFragments(
          piece.x,
          piece.y,
          characterIndex(piece.type),
          now + 65,
          index,
        );
        this.impactMarks.push({
          x: piece.x,
          y: piece.y,
          start: now + 65,
          color: characterIndex(piece.type),
          floor: false,
        });
      }
    });
    this.trimEffects();
    // Share the actual visual landing schedule with optional sound. A single
    // representative contact keeps a large drop cohesive without a cue per toy.
    // Reduced motion removes the fall, so it must not leave a delayed crunch.
    impactDelays.sort((a, b) => a - b);
    return {
      impactDelayMs: reduced
        ? 0
        : (impactDelays[Math.floor(impactDelays.length / 2)] ?? 0),
    };
  }

  private trimEffects() {
    while (this.particles.length > 108) {
      const oldest = this.particles.shift();
      oldest?.sprite.destroy();
    }
    if (this.impactMarks.length > 18)
      this.impactMarks.splice(0, this.impactMarks.length - 18);
  }

  private addFragments(
    x: number,
    y: number,
    type: number,
    now: number,
    index: number,
  ) {
    for (let j = 0; j < 3; j++) {
      const sprite = new Sprite(fragmentTexture(type, j));
      sprite.anchor.set(0.5);
      sprite.width = 11 + j * 2;
      sprite.height = 11 + j * 2;
      this.effects.addChild(sprite);
      this.particles.push({
        sprite,
        start: now,
        duration: 340 + j * 45,
        x,
        y,
        vx: (j - 1) * (52 + (index % 5) * 9) + 8,
        vy: -75 - j * 20,
        rotation: (j % 2 ? 1 : -1) * (4 + j),
        initialRotation: j * 1.3,
        size: 11 + j * 2,
        kind: "chip",
      });
    }
    if (index % 2 === 0) {
      const sprite = new Sprite(softDustTexture());
      sprite.anchor.set(0.5);
      this.effects.addChild(sprite);
      this.particles.push({
        sprite,
        start: now,
        duration: 370,
        x,
        y,
        vx: ((index % 3) - 1) * 14,
        vy: -22,
        rotation: 0,
        initialRotation: 0,
        size: 38,
        kind: "dust",
      });
    }
  }

  private buildBackdrop(frame: BoardFrame) {
    const g = this.backdrop,
      w = frame.width,
      h = frame.height,
      sy = frame.striker.y;
    g.clear();
    if (this.materialBackdrop.texture !== Texture.EMPTY)
      this.materialBackdrop.texture.destroy(true);
    this.materialBackdrop.texture = paintedTexture(w, h, (ctx) => {
      if (frame.reducedDecoration) {
        // Preserve the same frame and playfield footprint without the room's
        // material grain, lighting or reflective bevels. Semantic marks below
        // (limit, Next, ceiling and striker) keep their normal geometry.
        ctx.fillStyle = "#1b242b";
        ctx.beginPath();
        ctx.roundRect(0, 0, w, h, 18);
        ctx.fill();
        ctx.strokeStyle = "#46515f";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = "#151c25";
        ctx.beginPath();
        ctx.roundRect(9, 10, w - 18, h - 20, 11);
        ctx.fill();
        return;
      }
      const metal = ctx.createLinearGradient(0, 0, w, h);
      metal.addColorStop(0, "#6f6260");
      metal.addColorStop(0.07, "#38363d");
      metal.addColorStop(0.49, "#292b34");
      metal.addColorStop(0.78, "#534b4b");
      metal.addColorStop(1, "#282832");
      ctx.fillStyle = "#090e15";
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, 18);
      ctx.fill();
      ctx.fillStyle = metal;
      ctx.beginPath();
      ctx.roundRect(2, 2, w - 4, h - 4, 17);
      ctx.fill();
      ctx.strokeStyle = "#8b7770";
      ctx.lineWidth = 1.1;
      ctx.stroke();
      const inner = ctx.createLinearGradient(0, 10, 0, h - 10);
      inner.addColorStop(0, "#121822");
      inner.addColorStop(0.3, "#17202b");
      inner.addColorStop(1, "#0d141e");
      ctx.fillStyle = inner;
      ctx.beginPath();
      ctx.roundRect(9, 10, w - 18, h - 20, 11);
      ctx.fill();
      ctx.strokeStyle = "rgba(5,8,13,.85)";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = "rgba(158,139,121,.3)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.save();
      ctx.clip();
      const localLight = ctx.createRadialGradient(
        w * 0.36,
        h * 0.15,
        10,
        w * 0.5,
        h * 0.28,
        w * 0.85,
      );
      localLight.addColorStop(0, "rgba(137,124,106,.065)");
      localLight.addColorStop(0.7, "rgba(30,36,46,0)");
      localLight.addColorStop(1, "rgba(1,5,12,.2)");
      ctx.fillStyle = localLight;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(190,176,147,.018)";
      for (let i = 0; i < 350; i++) {
        const x = (i * 137.23) % w,
          y = (i * 83.17) % h;
        ctx.fillRect(x, y, 0.7, 0.7);
      }
      ctx.restore();
      // Short warm bevels catch the room light without a luminous border.
      ctx.beginPath();
      ctx.moveTo(20, 4);
      ctx.lineTo(w - 20, 4);
      ctx.strokeStyle = "rgba(185,155,129,.23)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(4, 24);
      ctx.lineTo(4, h - 25);
      ctx.strokeStyle = "rgba(185,155,129,.13)";
      ctx.stroke();
    });
    this.materialBackdrop.width = w;
    this.materialBackdrop.height = h;
    // The explicit loss line is distinct from a grid row.
    for (let x = 18; x < w - 18; x += 18)
      g.moveTo(x, frame.lossY)
        .lineTo(Math.min(x + 8, w - 18), frame.lossY)
        .stroke({ color: 0xc18063, width: 1.7, alpha: 0.6 });
    g.roundRect(18, frame.lossY + 16, w - 36, h - frame.lossY - 34, 12).fill({
      color: 0x111820,
      alpha: 0.36,
    });
    g.moveTo(30, h - 20)
      .lineTo(w - 30, h - 20)
      .stroke({ color: 0x39414b, width: 2, alpha: 0.65 });
    const apparatus = apparatusLayout(w, frame.lossY, sy),
      tray = apparatus.tray;
    g.roundRect(tray.x, tray.y, tray.width, tray.height, 12)
      .fill(0x35323a)
      .stroke({ color: 0x8d7770, width: 1.5, alpha: 0.65 });
    g.roundRect(tray.x + 6, tray.y + 6, tray.width - 12, tray.height - 12, 9)
      .fill(0x151c25)
      .stroke({ color: 0x77706b, width: 0.8, alpha: 0.35 });
    for (const child of this.labels.removeChildren()) child.destroy();
    const next = new Sprite(labelTexture("NEXT", "#a6aaa9", 11));
    next.anchor.set(0.5);
    next.width = next.texture.width / 2;
    next.height = next.texture.height / 2;
    next.position.copyFrom(apparatus.label);
    this.labels.addChild(next);
    const limit = new Sprite(labelTexture("LIMIT", "#b18b7b", 9));
    limit.anchor.set(1, 0.5);
    limit.width = limit.texture.width / 2;
    limit.height = limit.texture.height / 2;
    limit.position.set(w - 20, frame.lossY - 10);
    this.labels.addChild(limit);
    this.strikerBase.clear();
    this.strikerArm.clear();
  }

  render(frame: BoardFrame) {
    if (this.destroyed) return;
    this.labels.visible = !frame.domLabels;
    this.frame = frame;
    this.project();
    const key = `${frame.width}/${frame.height}/${frame.lossY}/${frame.striker.x}/${frame.striker.y}/${!!frame.reducedDecoration}`;
    if (key !== this.geometryKey) {
      this.geometryKey = key;
      this.buildBackdrop(frame);
    }
    this.clock.setPaused(!!frame.paused);
    const now = this.clock.read();
    const descent = frame.reducedMotion
      ? 0
      : Math.max(0, 1 - (now - this.descentTime) / 220);
    const descentY = -42 * descent * descent;
    const ceilingY = Math.max(0, (frame.ceilingY ?? 0) + descentY);
    this.ceiling.clear();
    if (ceilingY > 8)
      this.ceiling.rect(14, 8, frame.width - 28, ceilingY - 8).fill(0x111820);
    this.ceiling
      .moveTo(16, ceilingY + 3)
      .lineTo(frame.width - 16, ceilingY + 3)
      .stroke({ color: 0xaa8b59, width: 3, alpha: 0.58 });
    this.ceiling
      .moveTo(16, ceilingY + 6)
      .lineTo(frame.width - 16, ceilingY + 6)
      .stroke({ color: 0x4e4638, width: 1, alpha: 0.6 });
    this.impacts.clear();
    this.wallMarks = this.wallMarks.filter(
      (mark) => now - mark.start < (frame.reducedMotion ? 70 : 140),
    );
    for (const mark of this.wallMarks) {
      const t = Math.max(
        0,
        (now - mark.start) / (frame.reducedMotion ? 70 : 140),
      );
      const left = mark.point.x < frame.width / 2,
        x = left ? 8 : frame.width - 8;
      const sign = left ? 1 : -1,
        length = frame.reducedMotion ? 8 : 8 + t * 5;
      this.impacts
        .moveTo(x, mark.point.y - length)
        .lineTo(x, mark.point.y + length)
        .stroke({ color: 0xb49a6b, width: 2.5, alpha: 0.65 * (1 - t) });
      this.impacts
        .moveTo(x + sign * 4, mark.point.y - 5)
        .lineTo(x + sign * 7, mark.point.y)
        .lineTo(x + sign * 4, mark.point.y + 5)
        .stroke({ color: 0x9c8c70, width: 1.5, alpha: 0.45 * (1 - t) });
    }
    this.impactMarks = this.impactMarks.filter(
      (mark) => now - mark.start < 250,
    );
    for (const mark of this.impactMarks) {
      const age = now - mark.start;
      if (age < 0 || frame.reducedMotion) continue;
      const t = age / 250;
      if (mark.floor) {
        this.impacts
          .ellipse(mark.x, mark.y + 12, 8 + t * 22, 2 + t * 3)
          .stroke({ color: 0x8f7c62, width: 1.3, alpha: 0.28 * (1 - t) });
      } else {
        const length = 4 + t * 6;
        for (const sign of [-1, 1])
          this.impacts
            .moveTo(mark.x + sign * 21, mark.y - 6)
            .lineTo(mark.x + sign * (21 + length), mark.y - 12)
            .stroke({ color: 0xb19a76, width: 1.5, alpha: 0.45 * (1 - t) });
      }
    }
    for (let i = 0; i < frame.cells.length; i++) {
      const cell = frame.cells[i]!;
      let sprite = this.piecePool[i];
      if (!sprite) {
        sprite = new Sprite();
        sprite.anchor.set(0.5);
        sprite.eventMode = "none";
        this.pieces.addChild(sprite);
        this.piecePool.push(sprite);
      }
      // Only a small subset blink; never move the physical body at idle.
      const blink =
        !frame.reducedMotion &&
        !frame.paused &&
        Math.floor(now / 180 + i * 17) % 61 === 0;
      const expression: Expression = blink ? "blink" : "idle";
      const texture = characterTexture(
        cell.type,
        expression,
        frame.highContrast,
      );
      if (sprite.texture !== texture) sprite.texture = texture;
      sprite.visible = true;
      sprite.width = 64;
      sprite.height = 64;
      sprite.position.set(cell.x, cell.y + descentY);
    }
    for (let i = frame.cells.length; i < this.piecePool.length; i++)
      this.piecePool[i]!.visible = false;
    this.guides.clear();
    const dx = Math.cos(frame.angle),
      dy = -Math.sin(frame.angle);
    if (!frame.firing && !frame.projectile) {
      const origin = frame.striker;
      this.guides
        .moveTo(origin.x + dx * 37, origin.y + dy * 37)
        .lineTo(origin.x + dx * 89, origin.y + dy * 89)
        .stroke({ color: 0xc2a16c, width: 2.5, alpha: 0.8 });
      this.guides
        .moveTo(origin.x + dx * 90 - dy * 4, origin.y + dy * 90 + dx * 4)
        .lineTo(origin.x + dx * 97, origin.y + dy * 97)
        .lineTo(origin.x + dx * 90 + dy * 4, origin.y + dy * 90 - dx * 4)
        .stroke({ color: 0xc2a16c, width: 1.5, alpha: 0.8 });
      if (frame.guide && frame.guide.length > 1) {
        let carry = 0,
          total = 0;
        for (let i = 1; i < frame.guide.length && total < 150; i++) {
          const a = frame.guide[i - 1]!,
            b = frame.guide[i]!,
            distance = Math.hypot(b.x - a.x, b.y - a.y);
          if (distance < 0.001) continue;
          for (let t = carry; t < distance && total < 150; t += 18, total++) {
            const x = a.x + ((b.x - a.x) * t) / distance,
              y = a.y + ((b.y - a.y) * t) / distance;
            if (Math.hypot(x - origin.x, y - origin.y) > 100)
              this.guides
                .circle(x, y, 1.7)
                .fill({ color: 0xb8a072, alpha: 0.58 });
          }
          carry = (carry - distance) % 18;
          if (carry < 0) carry += 18;
        }
        if (frame.landing)
          this.guides
            .circle(frame.landing.x, frame.landing.y, 22)
            .stroke({ color: 0xc4aa79, width: 1.8, alpha: 0.65 });
      }
    }
    const recoil = frame.reducedMotion
      ? 0
      : Math.max(0, 1 - (now - this.recoilTime) / 100) * 5;
    this.strikerBase.position.set(frame.striker.x, frame.striker.y);
    this.strikerArm.position.set(
      frame.striker.x - dx * recoil,
      frame.striker.y - dy * recoil,
    );
    this.strikerArm.rotation = -frame.angle;
    this.strikerMechanism.position.set(
      frame.striker.x,
      frame.striker.y + recoil * 0.6,
    );
    this.strikerMechanism.scale.y =
      (128 / this.strikerMechanism.texture.height) * (1 - recoil * 0.006);
    this.loaded.visible =
      frame.current !== null && !frame.firing && !frame.projectile;
    if (this.loaded.visible) {
      this.loaded.texture = characterTexture(
        frame.current!,
        "anticipation",
        frame.highContrast,
      );
      this.loaded.width = 64;
      this.loaded.height = 64;
      this.loaded.position.copyFrom(frame.striker);
    }
    this.queued.visible = frame.next !== null;
    if (this.queued.visible) {
      this.queued.texture = characterTexture(
        frame.next!,
        "idle",
        frame.highContrast,
      );
      const apparatus = apparatusLayout(
        frame.width,
        frame.lossY,
        frame.striker.y,
      );
      this.queued.width = apparatus.spriteSize;
      this.queued.height = apparatus.spriteSize;
      this.queued.position.copyFrom(apparatus.next);
    }
    this.flying.visible = !!frame.projectile;
    if (frame.projectile) {
      this.flying.texture = characterTexture(
        frame.projectile.type,
        "anticipation",
        frame.highContrast,
      );
      this.flying.width = 64;
      this.flying.height = 64;
      this.flying.position.copyFrom(frame.projectile);
    }
    const kept: Particle[] = [],
      impactBursts: Array<{
        x: number;
        y: number;
        color: number;
        index: number;
      }> = [];
    for (const particle of this.particles) {
      const age = now - particle.start,
        reduced = !!frame.reducedMotion,
        t = Math.max(0, age / (reduced ? 160 : particle.duration));
      if (t >= 1) {
        particle.sprite.destroy();
        continue;
      }
      const seconds = Math.max(0, age) / 1000;
      particle.sprite.visible = age >= 0;
      if (reduced) {
        particle.sprite.visible =
          age >= 0 && particle.kind !== "chip" && particle.kind !== "dust";
        particle.sprite.position.set(particle.x, particle.y + t * 6);
        particle.sprite.rotation = 0;
        particle.sprite.alpha = 1 - t;
        kept.push(particle);
        continue;
      }
      const dropImpact =
          particle.kind === "drop" && age >= (particle.impactAt ?? Infinity),
        impactProgress = dropImpact
          ? Math.max(0, (age - particle.impactAt!) / 180)
          : 0,
        fallSeconds = dropImpact ? particle.impactAt! / 1000 : seconds;
      const x = particle.x + particle.vx * fallSeconds;
      particle.sprite.position.set(
        Math.max(14, Math.min(frame.width - 14, x)),
        particle.kind === "drop"
          ? dropImpact
            ? particle.floorY!
            : particle.y +
              particle.vy * seconds +
              0.5 * (particle.dropGravity ?? 2000) * seconds * seconds
          : particle.y +
              particle.vy * seconds +
              (particle.kind === "dust" ? 0 : 420) * seconds * seconds,
      );
      let sx = 1,
        sy = 1;
      if (particle.kind === "match") {
        const anticipation = Math.min(1, Math.max(0, age) / 65),
          crumble = Math.max(0, (age - 65) / 180);
        sx = (1 + 0.13 * anticipation) * (1 - crumble * 0.64);
        sy = (1 - 0.15 * anticipation) * (1 - crumble * 0.72);
        particle.sprite.alpha = 1 - crumble;
      } else if (particle.kind === "drop") {
        if (dropImpact) {
          sx = 1.12 - impactProgress * 0.54;
          sy = 0.7 - impactProgress * 0.32;
          particle.sprite.alpha = 1 - impactProgress;
          if (!particle.impacted) {
            particle.impacted = true;
            if (impactBursts.length < 8)
              impactBursts.push({
                x: Math.max(18, Math.min(frame.width - 18, x)),
                y: particle.floorY!,
                color: particle.color ?? 0,
                index: kept.length,
              });
          }
        } else {
          // The visual body stretches slightly as it accelerates and tumbles;
          // no logical cell, collision or input lock follows this motion.
          sx = 1 - Math.min(0.045, seconds * 0.05);
          sy = 1 + Math.min(0.07, seconds * 0.08);
          particle.sprite.alpha = 1;
        }
      } else if (particle.kind === "dust") {
        sx = sy = 0.65 + t * 0.9;
        particle.sprite.alpha = Math.sin(Math.PI * t) * 0.55;
      } else {
        sx = sy = 1 - t * 0.3;
        particle.sprite.alpha = Math.min(1, (1 - t) * 2);
      }
      particle.sprite.width = particle.size * sx;
      particle.sprite.height = particle.size * sy;
      particle.sprite.rotation =
        particle.initialRotation + particle.rotation * fallSeconds;
      kept.push(particle);
    }
    this.particles = kept;
    for (const burst of impactBursts) {
      this.addFragments(burst.x, burst.y, burst.color, now, burst.index);
      this.impactMarks.push({
        x: burst.x,
        y: burst.y,
        color: burst.color,
        start: now,
        floor: true,
      });
    }
    this.trimEffects();
    this.app.renderer.render(this.app.stage);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.materialBackdrop.texture !== Texture.EMPTY)
      this.materialBackdrop.texture.destroy(true);
    this.strikerMechanism.texture.destroy(true);
    this.app.destroy(true, {
      children: true,
      texture: false,
      textureSource: false,
    });
    this.particles = [];
  }
}

export async function createBoardRenderer(
  host: HTMLElement,
  options: { onError?: (error: unknown) => void } = {},
): Promise<BoardRenderer> {
  await preloadProductionCharacterArt();
  const app = new Application();
  try {
    await app.init({
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      background: 0x10141b,
      antialias: true,
      preference: "webgl",
      autoStart: false,
      sharedTicker: false,
    });
    const renderer = new BoardRenderer(app, host);
    renderer.resize(host.clientWidth, host.clientHeight);
    return renderer;
  } catch (error) {
    options.onError?.(error);
    try {
      app.destroy(true);
    } catch {
      /* incomplete GPU initialization */
    }
    throw error;
  }
}
