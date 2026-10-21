import { resolve } from 'node:path';

// Shared constants for the waveform pipeline (`waveform-analyzer.ts`,
// `waveform-peaks.ts`, `waveform.sql.ts`, `waveform.service.ts`) and for the
// `GET /episodes/:id/waveform` endpoint that reads what they wrote.

// The one place this path is computed. `__dirname` is `<package>/dist/waveform`
// at runtime, one level under `dist/` exactly like `dist/scripts` — see
// `mikro-orm.config.ts` for the same `__dirname`-not-CWD reasoning — so this
// resolves to `<package>/data/episodes` regardless of where the process is
// launched from. `scripts/download-episodes.ts` imports this too, instead of
// computing the same formula a second time.
export const EPISODES_DIR = resolve(__dirname, '..', '..', 'data', 'episodes');

// One stored byte per this many seconds of audio. 10 (100ms resolution) is far
// finer than any bar the UI draws — the widest consumer asks for 160 points —
// so every request downsamples from stored data rather than upsampling into
// invented detail. A two-hour episode costs ~72 KB at this rate.
export const WAVEFORM_POINTS_PER_SECOND = 10;

// The sample rate audio is decoded to before peak-picking. Speech has nothing
// meaningful above 4 kHz, so 8 kHz (Nyquist 4 kHz) loses none of the shape that
// would ever reach a 40-pixel bar, and it is a fifth of a typical 44.1 kHz
// source — proportionally less audio for ffmpeg to push through the pipe.
export const WAVEFORM_SAMPLE_RATE = 8_000;

// Samples per stored byte, derived from the two constants above: at 8 kHz and
// 10 points/second, one bucket is 800 samples (100 ms).
export const WAVEFORM_BUCKET_SAMPLES = WAVEFORM_SAMPLE_RATE / WAVEFORM_POINTS_PER_SECOND;

// `GET /episodes/:id/waveform`'s default and maximum `points`. 160 matches the
// permalink's bar count (the widest consumer); 2000 is generous headroom for a
// future wide viewport without letting a request ask for more resolution than
// a browser could ever render a difference for.
export const DEFAULT_WAVEFORM_POINTS = 160;
export const MAX_WAVEFORM_POINTS = 2000;

// The percentile a byte of 255 represents. Normalizing against the true peak
// would let one microphone pop or clipped intro sting flatten an entire
// episode's speech into a thin band near zero; 99.5 rides just under that
// outlier while still reflecting genuinely loud passages.
export const WAVEFORM_NORMALIZATION_PERCENTILE = 0.995;
