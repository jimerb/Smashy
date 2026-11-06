export type DropReward = "wheeee-1" | "wheeee-2" | "ooo-smashy";
export type DropRewardClips = Partial<Record<DropReward, string>>;

/** Cosmetic selection only: never consume the board's seeded random stream. */
export function selectDropReward(
  dropped: number,
  random: () => number = Math.random,
): DropReward | null {
  if (!Number.isSafeInteger(dropped) || dropped < 7) return null;
  if (dropped >= 10) return "ooo-smashy";
  return random() < 0.5 ? "wheeee-1" : "wheeee-2";
}

/** Balance the supplied recordings at playback; keep original asset bytes. */
export function rewardPlaybackGain(buffer: AudioBuffer) {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i++)
      peak = Math.max(peak, Math.abs(samples[i]));
  }
  return peak < 0.001 ? 0 : Math.min(64, 0.4 / peak);
}
