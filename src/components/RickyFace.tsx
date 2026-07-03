import { useEffect, useRef, type CSSProperties } from "react";
import type { MouthShape, RickyMood } from "../lib/realtime";

type RickyFaceProps = {
  mood: RickyMood;
  mouthShape: MouthShape;
  inputLevel?: number;
  outputLevel?: number;
};

const PARTICLE_COUNT = 14;

export function RickyFace({ mood, mouthShape, inputLevel = 0, outputLevel = 0 }: RickyFaceProps) {
  const audioLevel = Math.max(inputLevel, outputLevel);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let frame = 0;
    let lastX = 0;
    let lastY = 0;

    const onMove = (event: MouseEvent) => {
      lastX = event.clientX;
      lastY = event.clientY;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const root = rootRef.current;
        if (!root) return;
        const rect = root.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const lookX = Math.max(-1, Math.min(1, (lastX - centerX) / (rect.width * 0.9)));
        const lookY = Math.max(-1, Math.min(1, (lastY - centerY) / (rect.height * 0.9)));
        root.style.setProperty("--look-x", lookX.toFixed(3));
        root.style.setProperty("--look-y", lookY.toFixed(3));
      });
    };

    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={`face-orbit face-orbit-${mood}`}
      style={
        {
          "--mouth-open": mouthShape.open.toFixed(3),
          "--mouth-width": mouthShape.width.toFixed(3),
          "--mouth-round": mouthShape.round.toFixed(3),
          "--mouth-teeth": mouthShape.teeth.toFixed(3),
          "--input-level": inputLevel.toFixed(3),
          "--output-level": outputLevel.toFixed(3),
          "--audio-level": audioLevel.toFixed(3),
        } as CSSProperties
      }
      aria-label={`Spasoje mood: ${mood}`}
    >
      <div className="face-aura" aria-hidden="true" />
      <div className="face-halo" aria-hidden="true" />
      <div className="face-pulse-ring" aria-hidden="true" />

      <div className="face-particles" aria-hidden="true">
        {Array.from({ length: PARTICLE_COUNT }, (_unused, index) => (
          <span
            key={index}
            className="face-particle"
            style={
              {
                "--particle-angle": `${(360 / PARTICLE_COUNT) * index}deg`,
                "--particle-delay": `${(index * 0.75) % 6}s`,
                "--particle-distance": `${52 + (index % 4) * 4}%`,
              } as CSSProperties
            }
          />
        ))}
      </div>

      <div className="thinking-orbit" aria-hidden="true">
        <span className="thinking-dot" />
        <span className="thinking-dot" />
        <span className="thinking-dot" />
      </div>

      <div className="working-arc" aria-hidden="true" />

      <div className={`face face-${mood}`}>
        <div className="face-inner-glow" aria-hidden="true" />
        <div className="eye-row">
          <div className="eye">
            <span className="pupil" />
            <span className="eye-glint" />
            <span className="eye-lid" />
          </div>
          <div className="eye">
            <span className="pupil" />
            <span className="eye-glint" />
            <span className="eye-lid" />
          </div>
        </div>
        <div className="mouth-wrap">
          <div className="mouth">
            <div className="mouth-teeth" />
            <div className="mouth-line" />
          </div>
        </div>
      </div>

      <div className="voice-bars" aria-hidden="true">
        <span className="voice-bar" />
        <span className="voice-bar" />
        <span className="voice-bar" />
        <span className="voice-bar" />
        <span className="voice-bar" />
        <span className="voice-bar" />
        <span className="voice-bar" />
      </div>
    </div>
  );
}
