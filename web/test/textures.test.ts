import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { texturesIn, whenLoaded } from '../src/room/textures.ts';

test('texturesIn：收齊材質與 uniform 的貼圖，看不見的物件也算，不含 render target', async () => {
  const a = new THREE.Texture();
  const b = new THREE.Texture();
  const c = new THREE.Texture();
  const rt = new THREE.WebGLRenderTarget(4, 4);
  const root = new THREE.Group();
  const geo = new THREE.BoxGeometry();
  root.add(new THREE.Mesh(geo, [new THREE.MeshStandardMaterial({ map: a }), new THREE.MeshStandardMaterial({ map: a })]));
  const hidden = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: { m: { value: b }, n: { value: 1 }, r: { value: rt.texture } } }));
  hidden.visible = false;
  root.add(hidden);
  root.add(new THREE.Sprite(new THREE.SpriteMaterial({ map: c })));
  const got = texturesIn(root);
  assert.equal(got.length, 3);
  assert.deepEqual(new Set(got), new Set([a, b, c]));
  await whenLoaded(a); // 不是 photo() 載的：直接 resolve
});
