import chipUrl from "../../public/art/ready/chip-sprite-ready-v1.png";
import gumUrl from "../../public/art/ready/gum-sprite-ready-v1.png";
import rivetUrl from "../../public/art/ready/rivet-sprite-ready-v1.png";
import wispUrl from "../../public/art/ready/wisp-sprite-ready-v1.png";
import bashUrl from "../../public/art/ready/bash-sprite-ready-v1.png";
import loopUrl from "../../public/art/ready/loop-sprite-ready-v1.png";
import pebUrl from "../../public/art/ready/peb-sprite-ready-v1.png";
import anchorUrl from "../../public/art/ready/anchor-sprite-ready-v1.png";
import chipPlate from "../../public/art/ready/chip-faceplate-v1.png";
import gumPlate from "../../public/art/ready/gum-faceplate-v1.png";
import rivetPlate from "../../public/art/ready/rivet-faceplate-v1.png";
import wispPlate from "../../public/art/ready/wisp-faceplate-v1.png";
import bashPlate from "../../public/art/ready/bash-faceplate-v1.png";
import loopPlate from "../../public/art/ready/loop-faceplate-v1.png";
import pebPlate from "../../public/art/ready/peb-faceplate-v1.png";
import { registerProductionFacePlate, productionFaceCanvas } from "./faces";
import { normalizeCharacterSource } from "./normalize-art";
export { normalizeCharacterSource } from "./normalize-art";
export const PRODUCTION_CHARACTER_ART = [
  { name: "Chip", url: chipUrl },
  { name: "Gum", url: gumUrl },
  { name: "Rivet", url: rivetUrl },
  { name: "Wisp", url: wispUrl },
  { name: "Bash", url: bashUrl },
  { name: "Loop", url: loopUrl },
  { name: "Peb", url: pebUrl },
  { name: "Anchor", url: anchorUrl },
] as const;
const FACE_PLATES = [
  chipPlate,
  gumPlate,
  rivetPlate,
  wispPlate,
  bashPlate,
  loopPlate,
  pebPlate,
];
interface ArtInspection {
  name: string;
  loaded: boolean;
  sourceWidth?: number;
  sourceHeight?: number;
  transparentPixels?: number;
  partialAlphaPixels?: number;
  bounds?: { x: number; y: number; width: number; height: number };
  normalizedWidth?: number;
  normalizedHeight?: number;
  facePlateLoaded?: boolean;
}
const prepared: Array<HTMLCanvasElement | undefined> = [];
const inspections: ArtInspection[] = PRODUCTION_CHARACTER_ART.map(
  ({ name }) => ({ name, loaded: false, facePlateLoaded: false }),
);
let pending: Promise<void> | null = null;
async function loadPrepared(url: string) {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Character art loading timed out")),
          6000,
        );
      }),
    ]);
    return normalizeCharacterSource(image, true);
  } catch {
    return undefined;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
async function prepareArt(index: number) {
  const result = await loadPrepared(PRODUCTION_CHARACTER_ART[index]!.url);
  if (!result) return;
  prepared[index] = result.canvas;
  Object.assign(inspections[index]!, { loaded: true, ...result.inspection });
}
async function prepareFace(index: number) {
  const result = await loadPrepared(FACE_PLATES[index]!);
  if (!result) return;
  registerProductionFacePlate(index, result.canvas);
  inspections[index]!.facePlateLoaded = true;
}
/** Small imported bodies and face plates decode before first textures. */
export function preloadProductionCharacterArt(): Promise<void> {
  return (pending ??= Promise.all([
    ...PRODUCTION_CHARACTER_ART.map((_, i) => prepareArt(i)),
    ...FACE_PLATES.map((_, i) => prepareFace(i)),
  ]).then(() => {
    // Compose once before play, avoiding a first-blink/first-impact CPU spike.
    for (let index = 0; index < 7; index++) {
      const body = prepared[index];
      if (body)
        for (const state of ["blink", "anticipation", "released"] as const)
          productionFaceCanvas(index, body, state);
    }
    try {
      performance.mark("smashy-art-ready", {
        detail: {
          bodies: inspections.filter((row) => row.loaded).length,
          faces: inspections.filter((row) => row.facePlateLoaded).length,
        },
      });
    } catch {
      /* Local timing diagnostics must never gate play. */
    }
  }));
}
export function productionCharacterCanvas(index: number) {
  return prepared[index];
}
export function productionArtInspection(): ArtInspection[] {
  return inspections.map((row) => ({
    ...row,
    bounds: row.bounds ? { ...row.bounds } : undefined,
  }));
}
