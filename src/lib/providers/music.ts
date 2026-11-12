import { ffmpeg } from "../exec";

/** Chord frequencies per mood. Synthesised from scratch, so there is no third-party licence to clear. */
const CHORDS: Record<string, number[]> = {
  dramatic: [55, 110, 130.81, 164.81, 220],      // A minor
  mysterious: [61.74, 123.47, 146.83, 185, 246.94], // B minor
  uplifting: [65.41, 130.81, 164.81, 196, 261.63],  // C major
  calm: [87.31, 174.61, 220, 261.63, 349.23],       // F major
  energetic: [73.42, 146.83, 185, 220, 293.66],     // D major
};

/** Procedural ambient bed (stereo, 48 kHz) with a slow pulse. */
export async function generateMusic(mood: string, seconds: number, outFile: string) {
  const f = CHORDS[mood] || CHORDS.calm;
  const pulse = mood === "energetic" ? 2 : mood === "dramatic" ? 1 : 0.5;
  const voices = f.map((hz, i) => `${(0.22 / (i + 1)).toFixed(3)}*sin(2*PI*${hz}*t)*(0.75+0.25*sin(2*PI*${(0.07 + i * 0.03).toFixed(2)}*t))`).join("+");
  const kick = `0.35*sin(2*PI*${f[0]}*t)*exp(-6*mod(t\\,${(1 / pulse).toFixed(3)}))`;
  const left = `${voices}+${kick}`;
  const right = left.replace(/sin\(2\*PI\*([\d.]+)\*t\)\*\(0\.75/g, (_m, hz) => `sin(2*PI*${(Number(hz) * 1.003).toFixed(3)}*t)*(0.75`);
  await ffmpeg([
    "-f", "lavfi", "-i", `aevalsrc=${left}|${right}:s=48000:d=${seconds.toFixed(3)}`,
    "-af", `lowpass=f=2200,aecho=0.6:0.5:120|340:0.25|0.18,afade=t=in:d=1.2,afade=t=out:st=${Math.max(0, seconds - 1.5).toFixed(3)}:d=1.5`,
    "-ac", "2", outFile,
  ]);
}

/** Synthesised transition effects (filtered noise sweeps / low thumps). */
export async function generateSfx(kind: "whoosh" | "impact" | "rise", outFile: string) {
  const chains = {
    whoosh: ["anoisesrc=d=0.55:c=pink:a=0.6:r=48000", "bandpass=f=1400:w=1800,afade=t=in:d=0.3,afade=t=out:st=0.3:d=0.25"],
    rise: ["anoisesrc=d=0.9:c=white:a=0.4:r=48000", "highpass=f=1800,afade=t=in:d=0.8:curve=exp,afade=t=out:st=0.82:d=0.08"],
    impact: ["aevalsrc=0.9*sin(2*PI*(60-40*t)*t)*exp(-7*t):s=48000:d=0.7", "lowpass=f=300,afade=t=out:st=0.4:d=0.3"],
  }[kind];
  await ffmpeg(["-f", "lavfi", "-i", chains[0], "-af", chains[1], "-ac", "2", outFile]);
}
