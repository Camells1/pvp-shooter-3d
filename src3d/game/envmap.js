// Shared image-based lighting so metals and clearcoat armor have something to reflect.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

let cached = null;
export function getEnvMap(renderer) {
  if (!cached) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    cached = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  return cached;
}
