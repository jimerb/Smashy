/** Original dry toy/clay breakage. All noise is local cosmetic state. */
export type BreakageKind = "match" | "floor";
export interface BreakageOptions {
  /** Presentation delay in seconds; never delays gameplay. */
  delay?: number;
  /** Reduced-motion removal uses a compact immediate sound. */
  reduced?: boolean;
  /** Cosmetic variant, independent of gameplay RNG. */
  variant?: number;
}

export function breakageProfile(
  pieceCount: number,
  kind: BreakageKind = "match",
  reduced = false,
) {
  const count = Math.max(
    1,
    Math.min(30, Math.round(Number.isFinite(pieceCount) ? pieceCount : 1)),
  );
  const fullness = Math.max(0, Math.min(1, Math.log(count / 3) / Math.log(10)));
  return {
    pieceCount: count,
    kind,
    fullness,
    crackGrains: Math.round(5 + fullness * 11),
    chipGrains: Math.round(4 + fullness * 14),
    pitchSpreadOctaves: 0.22 + fullness * 0.63,
    durationSeconds: reduced
      ? 0.16 + fullness * 0.06
      : 0.22 + fullness * 0.22 + (kind === "floor" ? 0.06 : 0),
    level: 0.78 * (1 + fullness * 0.15),
  };
}

export function synthesizeBreakage(
  pieceCount: number,
  kind: BreakageKind = "match",
  sampleRate = 44100,
  seed = 0x534d4153,
  reduced = false,
) {
  const p = breakageProfile(pieceCount, kind, reduced);
  const rate = Math.max(
    8000,
    Math.min(
      192000,
      Math.round(Number.isFinite(sampleRate) ? sampleRate : 44100),
    ),
  );
  const pcm = new Float32Array(Math.ceil(p.durationSeconds * rate));
  let state = seed >>> 0 || 1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  function addGrain(
    at: number,
    duration: number,
    amplitude: number,
    frequency: number,
    mode: "crack" | "chip",
  ) {
    const offset = Math.round(at * rate);
    const length = Math.min(Math.round(duration * rate), pcm.length - offset);
    let low = 0,
      previousLow = 0;
    const alpha =
      1 - Math.exp((-2 * Math.PI * (mode === "crack" ? 3200 : 2400)) / rate);
    for (let i = 0; i < length; i++) {
      const t = i / rate,
        progress = i / length;
      const envelope =
        Math.min(1, t / 0.0015) * Math.exp(-6 * progress) * (1 - progress);
      low += alpha * (random() * 2 - 1 - low);
      const textured = low - previousLow * 0.78;
      previousLow = low;
      const modes =
        (Math.sin(2 * Math.PI * frequency * t) +
          0.43 * Math.sin(2 * Math.PI * frequency * 1.63 * t + 0.3) +
          0.21 * Math.sin(2 * Math.PI * frequency * 2.37 * t + 0.8)) /
        1.64;
      const signal =
        mode === "crack"
          ? 0.88 * textured + 0.12 * modes
          : 0.56 * textured + 0.44 * modes;
      pcm[offset + i] += amplitude * envelope * signal;
    }
  }
  addGrain(
    0,
    kind === "floor" ? 0.074 : 0.045,
    0.36,
    kind === "floor" ? 118 : 172,
    "chip",
  );
  for (let i = 0; i < p.crackGrains; i++) {
    const at = i === 0 ? 0 : 0.008 + random() * (0.052 + 0.045 * p.fullness);
    const frequency = 720 * 2 ** ((random() - 0.5) * p.pitchSpreadOctaves);
    addGrain(
      at,
      0.023 + random() * 0.032,
      0.72 / Math.sqrt(p.crackGrains),
      frequency,
      "crack",
    );
  }
  for (let i = 0; i < p.chipGrains; i++) {
    const progress = i / Math.max(1, p.chipGrains - 1);
    const at =
      0.035 + progress ** 0.8 * (p.durationSeconds - 0.1) + random() * 0.008;
    const frequency =
      (1100 - progress * 370) * 2 ** ((random() - 0.5) * p.pitchSpreadOctaves);
    addGrain(
      at,
      0.026 + random() * 0.035,
      (0.46 - progress * 0.2) / Math.sqrt(p.chipGrains),
      frequency,
      "chip",
    );
  }
  let dc = 0;
  for (let i = 0; i < pcm.length; i++) {
    dc += 0.001 * (pcm[i] - dc);
    pcm[i] = 0.32 * Math.tanh(((pcm[i] - dc) * p.level) / 0.32);
    pcm[i] *= Math.min(1, (pcm.length - 1 - i) / (rate * 0.006));
  }
  return { profile: p, samples: pcm, sampleRate: rate };
}
