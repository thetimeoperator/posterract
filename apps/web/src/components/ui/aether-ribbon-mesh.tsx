import { useEffect, useRef } from "react";

type AetherRibbonMeshProps = {
  className?: string;
};

class Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  readonly maxLife: number;
  readonly size: number;
  readonly color: string;

  constructor(x: number, y: number, color: string) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 2;
    this.vy = (Math.random() - 0.5) * 2;
    this.maxLife = 80 + Math.random() * 60;
    this.life = this.maxLife;
    this.size = 1 + Math.random() * 2;
    this.color = color;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.life -= 1;
    this.vx *= 0.98;
    this.vy *= 0.98;
  }

  draw(context: CanvasRenderingContext2D) {
    if (this.life <= 0) return;
    context.globalAlpha = this.life / this.maxLife;
    context.fillStyle = this.color;
    context.beginPath();
    context.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
  }
}

export default function AetherRibbonMesh({ className = "" }: AetherRibbonMeshProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const particles: Particle[] = [];
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    const ripple = { x: 0, y: 0, radius: 420, active: false };

    let animationFrameId = 0;
    let width = 1;
    let height = 1;
    let lastTime = performance.now();
    let elapsed = 0;

    const resize = () => {
      const bounds = root.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(bounds.width));
      height = Math.max(1, Math.round(bounds.height));
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const noise = (x: number, time: number, offset: number) =>
      (Math.sin(x * 0.0012 + time * 0.25 + offset) +
        Math.cos(x * 0.0028 - time * 0.4 + offset * 2)) /
      2;

    const render = (now: number, continueAnimation = true) => {
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      elapsed += delta * 0.82;

      const interpolation = 1 - Math.exp(-8 * delta);
      pointer.x += (pointer.targetX - pointer.x) * interpolation;
      pointer.y += (pointer.targetY - pointer.y) * interpolation;

      context.fillStyle = "#020605";
      context.fillRect(0, 0, width, height);

      const ambient = context.createRadialGradient(
        width * 0.5,
        height * 0.53,
        0,
        width * 0.5,
        height * 0.53,
        Math.max(width, height) * 0.68,
      );
      ambient.addColorStop(0, "rgba(23, 86, 52, 0.18)");
      ambient.addColorStop(0.46, "rgba(4, 25, 15, 0.11)");
      ambient.addColorStop(1, "rgba(2, 6, 5, 0)");
      context.fillStyle = ambient;
      context.fillRect(0, 0, width, height);

      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        if (!particle) continue;
        particle.update();
        particle.draw(context);
        if (particle.life <= 0) particles.splice(index, 1);
      }

      if (ripple.active) {
        ripple.radius += 12;
        if (ripple.radius > 420) ripple.active = false;
      }

      const layers = [
        { ribbonCount: 15, step: 5, offset: 0, frequency: 0.0035, amplitude: 58, speed: 1.08, primary: true },
        { ribbonCount: 9, step: 7, offset: 1.1, frequency: 0.0072, amplitude: 31, speed: 0.68, primary: false },
      ];

      for (const layer of layers) {
        context.globalCompositeOperation = layer.primary ? "source-over" : "screen";

        const gradient = context.createLinearGradient(0, 0, width, 0);
        if (layer.primary) {
          gradient.addColorStop(0, "rgba(101, 255, 154, 0.02)");
          gradient.addColorStop(0.28, "rgba(101, 255, 154, 0.5)");
          gradient.addColorStop(0.58, "rgba(168, 246, 255, 0.72)");
          gradient.addColorStop(1, "rgba(101, 255, 154, 0.02)");
        } else {
          gradient.addColorStop(0, "rgba(31, 118, 76, 0)");
          gradient.addColorStop(0.48, "rgba(101, 255, 154, 0.26)");
          gradient.addColorStop(1, "rgba(168, 246, 255, 0)");
        }

        for (let ribbon = 0; ribbon < layer.ribbonCount; ribbon += 1) {
          const progress = ribbon / layer.ribbonCount;
          const yOffset = height * 0.22 + ribbon * (height * 0.034) + layer.offset * 34;
          const baseAlpha = (1 - progress * 0.72) * (layer.primary ? 0.72 : 0.34);
          const rippleDistortion = ripple.active
            ? Math.sin((elapsed * 2 + progress * Math.PI) * 2) *
              ((420 / Math.max(ripple.radius, 1)) * 2.3)
            : 0;

          context.beginPath();

          for (let x = 0; x <= width + layer.step; x += layer.step) {
            const edgeEnvelope = Math.sin((x / width) * Math.PI);
            const frequencyNoise = 1 + noise(x, elapsed, progress) * 0.18;
            const amplitudeNoise = 1 + noise(x * 2, -elapsed, progress * 0.5) * 0.15;
            const waveOne =
              Math.sin(x * (layer.frequency * frequencyNoise) + elapsed * layer.speed + ribbon * 0.18) *
              (layer.amplitude * edgeEnvelope * amplitudeNoise);
            const waveTwo = Math.cos(x * 0.008 - elapsed * 0.7 + ribbon * 0.1) * (20 * edgeEnvelope);
            const waveThree = Math.sin(x * 0.018 + elapsed * 1.4) * (8 * edgeEnvelope);
            const pointerWorldX = width / 2 + pointer.x;
            const pointerDistance = Math.abs(x - pointerWorldX);
            const pointerRadius = layer.primary ? 380 : 220;
            const pointerFactor = Math.exp(-Math.pow(pointerDistance / pointerRadius, 2));
            const pointerDisplacement =
              Math.sin(x * 0.015 + elapsed * 2.6) *
              (pointerFactor * (layer.primary ? 47 : 23) * edgeEnvelope);
            const rippleDistance = Math.hypot(x - ripple.x, yOffset - ripple.y);
            const rippleFactor = ripple.active
              ? Math.exp(-Math.pow(Math.abs(rippleDistance - ripple.radius) / 30, 2))
              : 0;
            const rippleDisplacement = rippleFactor * rippleDistortion * (1.8 - progress);
            const y =
              yOffset +
              waveOne +
              waveTwo +
              waveThree +
              pointerDisplacement +
              rippleDisplacement +
              pointer.y * (progress * 0.08);

            if (x === 0) context.moveTo(x, y);
            else context.lineTo(x, y);

            if (layer.primary && x % 60 === 0) {
              context.fillStyle = "rgba(168, 246, 255, 0.24)";
              context.fillRect(x - 1, y - 1, 2, 2);
            }
          }

          context.globalAlpha = baseAlpha;
          context.strokeStyle = gradient;
          context.lineWidth = (layer.primary ? 1.3 : 0.7) + (1 - progress) * 0.45;
          context.stroke();
        }
      }

      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";

      if (continueAnimation) animationFrameId = window.requestAnimationFrame(render);
    };

    const updatePointer = (event: PointerEvent) => {
      const bounds = root.getBoundingClientRect();
      const inside =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;

      if (!inside) {
        pointer.targetX = 0;
        pointer.targetY = 0;
        return;
      }

      pointer.targetX = event.clientX - bounds.left - width / 2;
      pointer.targetY = event.clientY - bounds.top - height / 2;
    };

    const createRipple = (event: PointerEvent) => {
      const bounds = root.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      ) {
        return;
      }

      ripple.x = event.clientX - bounds.left;
      ripple.y = event.clientY - bounds.top;
      ripple.radius = 0;
      ripple.active = true;

      for (let index = 0; index < 24; index += 1) {
        particles.push(new Particle(ripple.x, ripple.y, "rgba(101, 255, 154, 0.78)"));
      }
    };

    resize();
    const resizeObserver = new ResizeObserver(() => {
      resize();
      if (reducedMotion) render(performance.now(), false);
    });
    resizeObserver.observe(root);

    if (reducedMotion) {
      render(performance.now(), false);
    } else {
      window.addEventListener("pointermove", updatePointer, { passive: true });
      window.addEventListener("pointerdown", createRipple, { passive: true });
      animationFrameId = window.requestAnimationFrame(render);
    }

    return () => {
      resizeObserver.disconnect();
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("pointermove", updatePointer);
      window.removeEventListener("pointerdown", createRipple);
    };
  }, []);

  return (
    <div ref={rootRef} className={`site-aether ${className}`.trim()} aria-hidden="true">
      <canvas ref={canvasRef} className="site-aether-canvas" />
    </div>
  );
}
