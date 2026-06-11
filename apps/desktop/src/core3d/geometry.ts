import * as THREE from "three";

export function makeArcGeometry(radius: number, tube: number, progress: number) {
  const arc = Math.max(0.002, Math.PI * 2 * progress);
  return new THREE.TorusGeometry(radius, tube, 12, 96, arc);
}

export function pointOnRing(radius: number, index: number, total: number, startAngle = -Math.PI / 2) {
  const angle = startAngle + (index / total) * Math.PI * 2;
  return {
    angle,
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}
