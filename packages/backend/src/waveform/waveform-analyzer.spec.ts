import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeAudioFile } from './waveform-analyzer';
import { WAVEFORM_POINTS_PER_SECOND } from './waveform.constants';

// ⚠️ The one suite in this module that needs a real `ffmpeg` on `PATH`. It
// skips itself rather than failing when the binary is missing, so `npm test`
// stays green on a machine that never installed it — the analyzer degrades
// the same way at runtime (see `WaveformService`).
function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const describeWithFfmpeg = hasFfmpeg() ? describe : describe.skip;

describeWithFfmpeg('analyzeAudioFile', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'gravindex-waveform-test-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function synthesize(name: string, filterComplex: string, durationSeconds: number): string {
    const out = join(dir, name);
    execFileSync('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      filterComplex,
      '-t',
      String(durationSeconds),
      '-codec:a',
      'libmp3lame',
      '-qscale:a',
      '9',
      out,
    ]);
    return out;
  }

  it('measures a plain tone: one byte per 1/WAVEFORM_POINTS_PER_SECOND of audio, none of them silent', async () => {
    const file = synthesize('tone.mp3', 'sine=frequency=440', 2);

    const { peaks, seconds } = await analyzeAudioFile(file);

    expect(seconds).toBe(2);
    // mp3 encoding pads/trims by a frame or two — allow a byte of slack either
    // side of the exact 2 * WAVEFORM_POINTS_PER_SECOND.
    expect(peaks.length).toBeGreaterThanOrEqual(2 * WAVEFORM_POINTS_PER_SECOND - 1);
    expect(peaks.length).toBeLessThanOrEqual(2 * WAVEFORM_POINTS_PER_SECOND + 1);
    for (const byte of peaks) {
      expect(byte).toBeGreaterThan(0);
    }
  }, 30_000);

  it('measures true silence as an all-zero waveform', async () => {
    const file = synthesize('silence.mp3', 'anullsrc=channel_layout=mono:sample_rate=8000', 1);

    const { peaks } = await analyzeAudioFile(file);

    for (const byte of peaks) {
      expect(byte).toBe(0);
    }
  }, 30_000);

  it('rejects when ffmpeg cannot decode the file at all', async () => {
    const notAudio = join(dir, 'not-audio.mp3');
    execFileSync('sh', ['-c', `printf 'not an mp3 at all' > "${notAudio}"`]);

    await expect(analyzeAudioFile(notAudio)).rejects.toThrow();
  }, 30_000);
});

describe('analyzeAudioFile — missing binary', () => {
  it('rejects with a clear message when the ffmpeg path does not exist', async () => {
    await expect(
      analyzeAudioFile('/does/not/matter.mp3', { ffmpegPath: '/definitely/not/a/real/binary' }),
    ).rejects.toThrow(/could not run/);
  });
});
