import * as THREE from 'three';

export type ScreenRect = { x: number; y: number; z: number; w: number; h: number };
export type Pose = { pos: [number, number, number]; look: [number, number, number]; fov: number };

/**
 * 手機直式的沙發鏡頭：站在 z = -6.3、正對銀幕，整面銀幕塞進畫面寬度，銀幕在畫面上方約 25%。
 * 鏡頭是往下看的，銀幕投影成上寬下窄的梯形：只照銀幕寬度留邊，上緣兩角會超出畫面，
 * trailerMode 判成 off、預告整個不顯示（2026-11-09 業主 Sony Xperia 1、390×844 都是這樣；375×667 剛好塞得進）。
 * 所以實際投影四角量最寬的地方，超出就把視角放寬再算。
 */
export function screenPhonePose(aspect: number, SC: ScreenRect, z = -6.3, maxNdcX = 0.96): Pose {
  const d = SC.z - z; // < 0（往 -z 看）
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => new THREE.Vector3(SC.x + sx! * SC.w / 2, SC.y + sy! * SC.h / 2, SC.z + 0.004));
  const cam = new THREE.PerspectiveCamera(50, aspect, 0.05, 50);
  let tanH = (SC.w / 2 + 0.12) / -d; // 左右各留 12 公分
  let pose!: Pose;
  for (let k = 0; k < 6; k++) {
    const tanV = tanH / aspect;
    const lift = 0.5 * -d * tanV; // 銀幕中心比視線高這麼多，就會在畫面上方 25%
    pose = { pos: [SC.x, 1.5, z], look: [SC.x, SC.y - lift, SC.z], fov: Math.min(84, (2 * Math.atan(tanV) * 180) / Math.PI) };
    cam.fov = pose.fov;
    cam.position.set(...pose.pos);
    cam.lookAt(new THREE.Vector3(...pose.look));
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const widest = Math.max(...corners.map((c) => Math.abs(c.clone().project(cam).x)));
    if (widest <= maxNdcX || pose.fov >= 84) return pose;
    tanH *= widest / (maxNdcX - 0.01);
  }
  return pose;
}
