import * as THREE from "three";

export function metalMaterial(color = "#101820") {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.78,
    roughness: 0.24,
    envMapIntensity: 1.2,
  });
}

export function glowMaterial(color: string, intensity = 1.4) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
    metalness: 0.1,
    roughness: 0.18,
    transparent: true,
    opacity: 0.92,
  });
}

export function glassMaterial(color: string) {
  return new THREE.MeshPhysicalMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.28,
    metalness: 0.02,
    roughness: 0.08,
    transmission: 0.12,
    transparent: true,
    opacity: 0.78,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
}
