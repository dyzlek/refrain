import type { Playback } from '@shared/protocol';
import { positionAt } from '@shared/timing';
import { serverNow } from './clock.ts';

// L'extrait est décodé à l'avance puis lancé par l'horloge audio, à la milliseconde,
// au lieu d'un <audio>.play() dont le démarrage varie d'un appareil à l'autre.

class AudioEngine {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' });
  readonly analyser = this.ctx.createAnalyser();
  private master = this.ctx.createGain();
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private voice: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private key = '';

  constructor() {
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.78;
    this.analyser.connect(this.master).connect(this.ctx.destination);
    let saved = 0.8;
    try {
      saved = Number(localStorage.getItem('refrain:volume') ?? 0.8);
    } catch {
      /* stockage indisponible */
    }
    this.master.gain.value = saved;
  }

  get locked(): boolean {
    return this.ctx.state !== 'running';
  }

  /** Les navigateurs exigent un geste de l'utilisateur avant de produire du son. */
  unlock(): Promise<void> {
    return this.ctx.resume();
  }

  set volume(v: number) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    try {
      localStorage.setItem('refrain:volume', String(v));
    } catch {
      /* stockage indisponible */
    }
  }

  get volume(): number {
    return this.master.gain.value;
  }

  load(url: string): Promise<AudioBuffer> {
    let p = this.buffers.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error('Extrait indisponible');
          return r.arrayBuffer();
        })
        .then((data) => this.ctx.decodeAudioData(data));
      p.catch(() => this.buffers.delete(url));
      this.buffers.set(url, p);
      // Un extrait par manche : inutile de garder les anciens.
      if (this.buffers.size > 3) this.buffers.delete(this.buffers.keys().next().value!);
    }
    return p;
  }

  /** Met le son en accord avec l'état partagé. Appelé à chaque état reçu : ne fait rien s'il n'a pas changé. */
  async apply(pb: Playback | null): Promise<void> {
    const key = pb && pb.playing ? `${pb.url}|${pb.anchor}|${pb.position}` : '';
    if (key === this.key) return;
    this.key = key;
    this.stop();
    if (!pb || !pb.playing) return;

    const buffer = await this.load(pb.url).catch(() => null);
    if (!buffer || this.key !== key) return;

    // Le son sort des haut-parleurs avec un peu de retard (outputLatency) : on part d'autant en avance.
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    const pos = positionAt(pb, serverNow()) + latency;
    if (pos >= buffer.duration) return;

    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    src.buffer = buffer;
    src.connect(gain).connect(this.analyser);
    const when = this.ctx.currentTime + Math.max(0, -pos);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(1, when + 0.04);
    src.start(when, Math.max(0, pos));
    this.voice = { src, gain };
  }

  stop(): void {
    if (!this.voice) return;
    const { src, gain } = this.voice;
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.06);
    src.stop(t + 0.07);
    this.voice = null;
  }

  /** Petit « bip » synthétisé pour le buzz : aucun fichier à charger. */
  blip(freq = 880, duration = 0.12): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq / 2, t + duration);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration);
  }
}

export const audio = new AudioEngine();
