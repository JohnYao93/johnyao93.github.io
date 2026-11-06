import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Each isolate layer bolds the parts whose node names contain a `bold` keyword, leaves `keep` parts
// as plain context, and hides everything else. Match the keywords to the node names in your GLB.
const LAYERS = {
  full: null,
  frame: { bold: ['frame'], keep: ['table'] },
  arms: { bold: ['arm', 'handle'], keep: ['table'] },
  cameras: { bold: ['camera'], keep: ['table', 'frame', 'arm', 'handle'] },
};

const neutral = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.7, metalness: 0.1 });
const bold = new THREE.MeshStandardMaterial({ color: 0x1772d0, roughness: 0.45, metalness: 0.1 });
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x3a4048, transparent: true, opacity: 0.35 });
const boldEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x0b3d70 });

function names(object) {
  const chain = [];
  for (let o = object; o; o = o.parent) if (o.name) chain.push(o.name.toLowerCase());
  return chain.join(' ');
}

// Stand-in geometry, shown until the real models are exported to the paths in data-model.
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cylinder = (r, h) => new THREE.CylinderGeometry(r, r, h, 24);
function adder(root) {
  return (name, geometry, x, y, z, parent = root) => {
    const mesh = new THREE.Mesh(geometry, neutral);
    mesh.name = name;
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
}

const PLACEHOLDERS = {
  rig() {
    const root = new THREE.Group();
    const add = adder(root);
    add('table', box(1.4, 0.04, 0.8), 0, -0.02, 0);
    for (const x of [-0.65, 0.65]) add('frame-post', box(0.03, 0.9, 0.03), x, 0.45, -0.35);
    add('frame-top', box(1.33, 0.03, 0.03), 0, 0.9, -0.35);
    add('frame-boom', box(0.03, 0.03, 0.4), 0, 0.9, -0.15);
    add('camera-top', box(0.09, 0.03, 0.04), 0, 0.87, 0.05);
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.name = side < 0 ? 'arm-left' : 'arm-right';
      arm.position.set(side * 0.35, 0, -0.2);
      root.add(arm);
      add('arm-base', cylinder(0.05, 0.08), 0, 0.04, 0, arm);
      add('arm-upper', box(0.04, 0.3, 0.04), 0, 0.23, 0, arm).rotation.x = 0.35;
      add('arm-fore', box(0.035, 0.035, 0.28), 0, 0.36, 0.18, arm);
      add('arm-wrist', box(0.06, 0.05, 0.06), 0, 0.34, 0.34, arm);
      add('handle-a', cylinder(0.012, 0.11), side * 0.05, 0.3, 0.34, arm);
      add('handle-b', cylinder(0.012, 0.11), -side * 0.05, 0.3, 0.34, arm);
      add('camera-wrist', box(0.05, 0.025, 0.03), 0, 0.38, 0.37, arm);
    }
    return root;
  },
  handles() {
    const root = new THREE.Group();
    const add = adder(root);
    add('wrist-mount', box(0.07, 0.05, 0.05), 0, 0, -0.06);
    add('pivot', cylinder(0.012, 0.05), 0, 0, 0).rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) {
      const lever = new THREE.Group();
      lever.name = 'lever';
      lever.rotation.z = side * 0.32;
      root.add(lever);
      add('lever-bar', box(0.014, 0.16, 0.012), 0, -0.08, side * 0.008, lever);
      const loop = add('finger-loop', new THREE.TorusGeometry(0.024, 0.006, 12, 32), 0, -0.18, side * 0.008, lever);
      loop.rotation.y = Math.PI / 2;
      add('jaw', box(0.01, 0.06, 0.01), 0, 0.035, side * 0.008, lever);
    }
    return root;
  },
};

function setupViewer(viewer) {
  const host = viewer.querySelector('.cad-canvas');
  const buttons = [...viewer.querySelectorAll('.cad-layers button')];
  const parts = [];
  let needsRender = true;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c0cc, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 4, 3);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enableZoom = false; // keep the page scrolling normally over the viewer
  controls.enablePan = false;

  function isolate(layerName) {
    const layer = LAYERS[layerName];
    const matches = (part, keywords) => keywords.some((k) => part.names.includes(k));
    for (const part of parts) {
      const isBold = layer && matches(part, layer.bold);
      const isKept = !layer || isBold || matches(part, layer.keep);
      part.mesh.visible = isKept;
      part.mesh.material = isBold ? bold : layer ? neutral : part.original;
      part.edges.material = isBold ? boldEdgeMaterial : edgeMaterial;
    }
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layer === layerName)));
    needsRender = true;
  }

  function show(root) {
    scene.add(root);
    root.traverse((object) => {
      if (!object.isMesh) return;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(object.geometry, 30), edgeMaterial);
      object.add(edges);
      parts.push({ mesh: object, edges, names: names(object), original: object.material });
    });

    const bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(1, 0.65, 1.2).normalize().multiplyScalar(radius * 3));
    camera.near = radius / 100;
    camera.far = radius * 20;
    camera.updateProjectionMatrix();
    controls.update();
    isolate('full');
  }

  new GLTFLoader().load(
    viewer.dataset.model,
    (gltf) => show(gltf.scene),
    undefined,
    () => {
      show(PLACEHOLDERS[viewer.dataset.placeholder || 'rig']());
      const hint = viewer.querySelector('.cad-hint');
      hint.textContent += ' · placeholder model';
    },
  );

  buttons.forEach((b) => b.addEventListener('click', () => isolate(b.dataset.layer)));
  controls.addEventListener('change', () => { needsRender = true; });
  new ResizeObserver(() => {
    const { clientWidth: w, clientHeight: h } = host;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    needsRender = true;
  }).observe(host);

  renderer.setAnimationLoop(() => {
    controls.update();
    if (!needsRender) return;
    needsRender = false;
    renderer.render(scene, camera);
  });
}

document.querySelectorAll('.cad-viewer').forEach(setupViewer);
