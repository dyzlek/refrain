<script lang="ts">
  import { onMount } from 'svelte';
  import { audio } from '../lib/audio.ts';

  // Un anneau de barres : chaque barre écoute une bande du spectre, la basse fait respirer le cercle.
  let { idle = false, intensity = 1 }: { idle?: boolean; intensity?: number } = $props();

  let canvas: HTMLCanvasElement;

  onMount(() => {
    const ctx = canvas.getContext('2d')!;
    const data = new Uint8Array(audio.analyser.frequencyBinCount);
    const BARS = 96;
    const smooth = new Float32Array(BARS);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = Math.min(devicePixelRatio, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim() || '#ff5a2e';
    const fg = styles.getPropertyValue('--fg').trim() || '#ece8df';

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (!idle) audio.analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const r = Math.min(w, h) * 0.27;

      let bass = 0;
      for (let i = 0; i < BARS; i++) {
        // Échelle log : les graves prennent moins de place, les aigus sont étalés.
        const bin = Math.floor(Math.pow(i / BARS, 1.6) * data.length * 0.75);
        // Une courbe pour garder du relief : sans elle, un morceau compressé sature tout l'anneau.
        const live = idle ? 0 : Math.pow(data[bin] / 255, 2.2);
        const wave = reduced ? 0.05 : 0.05 + 0.04 * Math.sin(t / 900 + i * 0.35) + 0.03 * Math.sin(t / 1300 - i * 0.2);
        const v = Math.max(live * intensity, wave);
        smooth[i] += (v - smooth[i]) * 0.35;
        if (i < 8) bass += smooth[i] / 8;
      }

      const pulse = r * (1 + bass * 0.18);
      ctx.lineCap = 'round';
      for (let i = 0; i < BARS; i++) {
        const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const len = smooth[i] * r * 0.62;
        const x0 = cx + Math.cos(a) * pulse;
        const y0 = cy + Math.sin(a) * pulse;
        ctx.strokeStyle = smooth[i] > 0.42 ? accent : fg;
        ctx.globalAlpha = 0.35 + smooth[i] * 0.65;
        ctx.lineWidth = Math.max(1.5, (2 * Math.PI * pulse) / BARS - 3);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(cx + Math.cos(a) * (pulse + len), cy + Math.sin(a) * (pulse + len));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, pulse * 0.92, 0, Math.PI * 2);
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  });
</script>

<canvas bind:this={canvas}></canvas>

<style>
  canvas { display: block; width: 100%; height: 100%; }
</style>
