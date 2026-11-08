import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const neutral = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.7, metalness: 0.1 });
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x3a4048, transparent: true, opacity: 0.35 });

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

const REAL_ARM = '/static/models/rs-arm.glb?v=2';
// Wrist camera on the real arm, in the arm model's frame: where the phone camera sat, aimed past the fingertips.
const WRIST_CAMERA = { position: [0.0211, 0.3075, 0.3335], target: [0.0767, 0.0659, 0.4294], up: [-0.056, 0.735, 0.675] };

// A camera drawn as a small body with a viewing pyramid along its +Z, the direction lookAt aims it.
const frustumLine = new THREE.LineBasicMaterial({ color: 0x1772d0, transparent: true, opacity: 0.8 });
const frustumFill = new THREE.MeshBasicMaterial({ color: 0x1772d0, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
function makeCamera(name, length, halfWidth, halfHeight) {
  const body = new THREE.Mesh(box(length * 0.28, length * 0.2, length * 0.22), neutral);
  body.name = name;
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => new THREE.Vector3(x * halfWidth, y * halfHeight, length));
  const o = new THREE.Vector3();
  const lines = [o, c[0], o, c[1], o, c[2], o, c[3], c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]];
  body.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines), frustumLine));
  const fill = new THREE.BufferGeometry().setFromPoints([o, c[0], c[1], o, c[1], c[2], o, c[2], c[3], o, c[3], c[0]]);
  const pyramid = new THREE.Mesh(fill, frustumFill);
  pyramid.userData.decoration = true;
  body.add(pyramid);
  return body;
}
function aim(object, position, target, up = [0, 1, 0]) {
  object.position.set(...position);
  object.up.set(...up);
  object.lookAt(new THREE.Vector3(...target));
  return object;
}

const PLACEHOLDERS = {
  rig() {
    const root = new THREE.Group();
    const add = adder(root);
    add('table', box(1.4, 0.04, 0.8), 0, -0.02, 0);
    // Overhead camera: a small pillar on the arms' side of the table, with a short boom, looking down.
    add('pillar-post', box(0.035, 0.75, 0.035), 0, 0.375, -0.37);
    add('pillar-boom', box(0.025, 0.025, 0.3), 0, 0.74, -0.23);
    const overhead = makeCamera('camera-overhead', 0.2, 0.15, 0.1);
    root.add(aim(overhead, [0, 0.72, -0.08], [0, 0, 0.12], [0, 0, -1]));
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      // Named from the robot's point of view (operator behind the arms), so the arm at -x is its right arm.
      arm.name = side < 0 ? 'arm-right' : 'arm-left';
      arm.position.set(side * 0.35, 0, -0.2);
      root.add(arm);
      // Both arms are the real RS arm (exported from the MuJoCo model, no phone mount); they load in later.
      // The right one (-x) is mirrored so the pair is symmetric.
      arm.userData.model = REAL_ARM;
      arm.userData.mirror = side < 0;
      arm.userData.wristCamera = true;
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

// The view buttons fly the 3D camera to a camera in the scene (by node name) or back to the overview.
const OVERVIEW_FOV = 35;
const CAMERA_FOV = 53; // the viewing pyramids are drawn at about this vertical field of view
const FLIGHT_MS = 900;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function setupViewer(viewer) {
  const host = viewer.querySelector('.cad-canvas');
  const buttons = [...viewer.querySelectorAll('.cad-views button')];
  let needsRender = true;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c0cc, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 4, 3);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(OVERVIEW_FOV, 1, 0.01, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enableZoom = false; // keep the page scrolling normally over the viewer
  controls.enablePan = false;

  // Real CAD exports are dense enough that outline edges turn into noise, so they are drawn shaded only.
  function addEdges(root) {
    root.traverse((object) => {
      if (!object.isMesh || object.userData.decoration) return;
      object.add(new THREE.LineSegments(new THREE.EdgesGeometry(object.geometry, 30), edgeMaterial));
    });
  }

  // Groups in a placeholder can name a real model to load into themselves (userData.model).
  function loadSubmodels(root) {
    const slots = [];
    root.traverse((object) => object.userData.model && slots.push(object));
    for (const slot of slots) {
      new GLTFLoader().load(slot.userData.model, (gltf) => {
        if (slot.userData.mirror) gltf.scene.scale.x = -1;
        if (slot.userData.wristCamera) {
          const { position, target, up } = WRIST_CAMERA;
          const side = slot.name.replace('arm-', '');
          gltf.scene.add(aim(makeCamera(`camera-wrist-${side}`, 0.09, 0.06, 0.045), position, target, up));
        }
        slot.add(gltf.scene);
        needsRender = true;
      });
    }
  }

  let overview = null;
  let flight = null;
  let hidden = null; // the camera body we are looking through, hidden so it does not block the view

  function poseFor(name) {
    if (name === 'overview') return overview && { ...overview, fov: OVERVIEW_FOV, body: null };
    const body = scene.getObjectByName(name);
    if (!body) return null;
    scene.updateMatrixWorld();
    const position = body.getWorldPosition(new THREE.Vector3());
    const forward = body.getWorldDirection(new THREE.Vector3());
    return { position, target: position.clone().addScaledVector(forward, 0.3), fov: CAMERA_FOV, body };
  }

  function flyTo(name) {
    const pose = poseFor(name);
    if (!pose) return;
    if (hidden) hidden.visible = true;
    hidden = null;
    flight = {
      from: { position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov },
      to: pose,
      start: performance.now(),
    };
    controls.enabled = false;
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
    needsRender = true;
  }

  function show(root, withEdges = true) {
    scene.add(root);
    if (withEdges) addEdges(root);

    const bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
    controls.target.copy(center);
    // data-view on the viewer sets the starting direction from the model to the camera.
    const view = viewer.dataset.view ? viewer.dataset.view.split(',').map(Number) : [1, 0.65, 1.2];
    camera.position.copy(center).add(new THREE.Vector3(...view).normalize().multiplyScalar(radius * 3));
    camera.near = radius / 200;
    camera.far = radius * 20;
    camera.updateProjectionMatrix();
    controls.update();
    overview = { position: camera.position.clone(), target: center.clone() };
    needsRender = true;
  }

  new GLTFLoader().load(
    viewer.dataset.model,
    (gltf) => {
      // data-mirror shows the model's mirror image (e.g. the right-hand handles from the left-hand export).
      if (viewer.dataset.mirror !== undefined) gltf.scene.scale.x = -1;
      show(gltf.scene, false);
    },
    undefined,
    () => {
      const placeholder = PLACEHOLDERS[viewer.dataset.placeholder || 'rig']();
      show(placeholder);
      loadSubmodels(placeholder);
      const hint = viewer.querySelector('.cad-hint');
      hint.textContent += ' · placeholder model';
    },
  );

  buttons.forEach((b) => b.addEventListener('click', () => flyTo(b.dataset.view)));
  controls.addEventListener('change', () => { needsRender = true; });
  new ResizeObserver(() => {
    const { clientWidth: w, clientHeight: h } = host;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    needsRender = true;
  }).observe(host);

  renderer.setAnimationLoop((now) => {
    if (flight) {
      const t = Math.min(1, (now - flight.start) / FLIGHT_MS);
      const k = ease(t);
      camera.position.lerpVectors(flight.from.position, flight.to.position, k);
      controls.target.lerpVectors(flight.from.target, flight.to.target, k);
      camera.fov = flight.from.fov + (flight.to.fov - flight.from.fov) * k;
      camera.updateProjectionMatrix();
      camera.lookAt(controls.target);
      if (t === 1) {
        hidden = flight.to.body;
        if (hidden) hidden.visible = false;
        flight = null;
        controls.enabled = true;
      }
      needsRender = true;
    }
    controls.update();
    if (!needsRender) return;
    needsRender = false;
    renderer.render(scene, camera);
  });
}

document.querySelectorAll('.cad-viewer').forEach(setupViewer);
