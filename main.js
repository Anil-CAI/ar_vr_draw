import * as THREE from './vendor/three/three.module.js';
import { VRButton } from './vendor/three/VRButton.js';


let scene, camera, renderer;
let controllerL, controllerR;
let gripL, gripR;

/* ================= DRAWING ================= */
let drawing = false;
let currentLine, lineGeometry;
let points = [];
let strokeColor = 0x000000;
let strokeThickness = 0.01;
let allLines = [];

let smoothLin = 0;
let smoothAng = 0;
const SMOOTH_FACTOR = 0.25;  // 25% smoothing


/* ================= MENU ================= */
let menuGroup;
let raycaster = new THREE.Raycaster();
let tempMatrix = new THREE.Matrix4();

let lastCmdTime = performance.now();

/* ================= VELOCITY ================= */
let panelL, panelR;

let prevPosL = new THREE.Vector3();
let prevPosR = new THREE.Vector3();
let prevQuatL = new THREE.Quaternion();
let prevQuatR = new THREE.Quaternion();
let prevTime = performance.now();

/* ===== ZERO SPAM CONTROL ===== */
let zeroSpamCount = 0;

/* ================= CLUTCH ================= */
let gripActive = false;


/* ================= VR SCALING ================= */
const VR_LIN_SCALE = 0.6;
const VR_ANG_SCALE = 1.2;
const DEADZONE = 0.05;

const MAX_PITCH_RAD = 0.6;   // ~35 degrees
const MAX_YAW_RAD   = 0.8;  

/* ================= WS ================= */
const ws = new WebSocket("wss://10.16.174.33:8765");


ws.onopen = () => console.log("WS connected to ROS bridge");
ws.onerror = (e) => console.error("WS error", e);
ws.onclose = () => console.log("WS closed");

function sendCmdVel(lin, ang) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: "cmd_vel",
    linear: lin,
    angular: ang
  }));
}

/* ================= INIT ================= */

init();
animate();

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;

  document.body.appendChild(renderer.domElement);
  document.body.appendChild(VRButton.createButton(renderer));

  scene.add(new THREE.AmbientLight(0xffffff, 1));

  controllerL = renderer.xr.getController(0);
  controllerR = renderer.xr.getController(1);
  scene.add(controllerL, controllerR);

  gripL = renderer.xr.getControllerGrip(0);
  gripR = renderer.xr.getControllerGrip(1);
  scene.add(gripL, gripR);

  addControllerVisuals(controllerL);
  addControllerVisuals(controllerR);

  controllerR.addEventListener('selectstart', onSelectStart);
  controllerR.addEventListener('selectend', onSelectEnd);

  createMenu();

  panelL = createVelocityPanel(-0.45, 'LEFT');
  panelR = createVelocityPanel(0.45, 'RIGHT');

  window.addEventListener('resize', onWindowResize);
}

function addControllerVisuals(controller) {
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.01, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0x000000 })
  );
  controller.add(tip);

  const laserGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1)
  ]);
  const laser = new THREE.Line(
    laserGeo,
    new THREE.LineBasicMaterial({ color: 0x000000 })
  );
  laser.scale.z = 5;
  controller.add(laser);
}

function updateGripState(controller) {
  const session = renderer.xr.getSession();
  if (!session) return;

  const inputSources = session.inputSources;
  for (const src of inputSources) {
    if (!src.gamepad) continue;
    if (src.handedness !== 'right') continue;

    const grip = src.gamepad.buttons[1]?.value || 0;
    gripActive = grip > 0.5;
  }
}

/* ================= DRAWING ================= */

function onSelectStart() {
  const hit = checkMenuHit();
  if (hit) {
    handleMenuAction(hit.userData.action);
    return;
  }

  drawing = true;
  points = [];
  lineGeometry = new THREE.BufferGeometry();

  const material = new THREE.LineBasicMaterial({ color: strokeColor });
  currentLine = new THREE.Line(lineGeometry, material);

  scene.add(currentLine);
  allLines.push(currentLine);
}

function onSelectEnd() {
  drawing = false;
}

function render() {
  updateGripState(controllerR);

  if (performance.now() - lastCmdTime > 1000) {
    sendCmdVel(0, 0);
  }

  if (drawing) {
    const pos = new THREE.Vector3();
    controllerR.getWorldPosition(pos);
    points.push(pos.clone());
    lineGeometry.setFromPoints(points);
  }

  updateVelocities();
  renderer.render(scene, camera);
}


/* ================= MENU ================= */

function createMenu() {
  menuGroup = new THREE.Group();
  menuGroup.position.set(0, 1.3, -0.6);

  const actions = [
    { label: '+', action: 'thick_plus' },
    { label: '-', action: 'thick_minus' },
    { label: 'Color', action: 'color' },
    { label: 'Clear', action: 'clear' },
    { label: 'Save', action: 'save' }
  ];

  actions.forEach((item, i) => {
    const btn = createButton(item.label);
    btn.position.x = (i - 2) * 0.12;
    btn.userData.action = item.action;
    menuGroup.add(btn);
  });

  scene.add(menuGroup);
}

function createButton(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#e0e0e0';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.font = '40px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({ map: texture });
  const geo = new THREE.BoxGeometry(0.11, 0.06, 0.02);

  return new THREE.Mesh(geo, mat);
}

function checkMenuHit() {
  tempMatrix.identity().extractRotation(controllerR.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controllerR.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

  const hits = raycaster.intersectObjects(menuGroup.children, true);
  return hits.length ? hits[0].object : null;
}

function handleMenuAction(action) {
  switch (action) {
    case 'thick_plus':
      strokeThickness += 0.002;
      break;
    case 'thick_minus':
      strokeThickness = Math.max(0.002, strokeThickness - 0.002);
      break;
    case 'color':
      strokeColor = Math.random() * 0xffffff;
      break;
    case 'clear':
      allLines.forEach(l => scene.remove(l));
      allLines = [];
      break;
    case 'save':
      saveJSON();
      break;
  }
}

/* ================= VELOCITY ================= */

function createVelocityPanel(x, label) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.18),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true })
  );

  panel.position.set(x, 1.45, -0.6);
  panel.userData = { canvas, ctx, texture, label };
  scene.add(panel);
  return panel;
}

/* ================= ORIENTATION BASED CONTROL (STABLE) ================= */

function updateVelocities() {
  const now = performance.now();
  const dt = (now - prevTime) / 1000;
  if (dt <= 0) return;

  const ang = computeYawFromLeft(controllerL);
  const lin = computePitchFromRight(controllerR);

  // Safety timestamp
  lastCmdTime = performance.now();

  // Smoothing
  smoothLin = smoothLin + (lin - smoothLin) * SMOOTH_FACTOR;
  smoothAng = smoothAng + (ang - smoothAng) * SMOOTH_FACTOR;

  if (gripActive) {
    sendCmdVel(smoothLin, smoothAng);
  } else {
    sendCmdVel(0, 0);
  }

  prevTime = now;
}



/* ======= NEW: Clean functions for LEFT yaw + RIGHT pitch ======= */

function computeYawFromLeft(controller) {
  const quat = new THREE.Quaternion();
  controller.getWorldQuaternion(quat);

  const euler = new THREE.Euler().setFromQuaternion(quat, "YXZ");

  let yaw = euler.y;

  yaw = Math.max(-MAX_YAW_RAD, Math.min(MAX_YAW_RAD, yaw));

  let ang = (yaw / MAX_YAW_RAD) * VR_ANG_SCALE;

  if (Math.abs(ang) < DEADZONE) ang = 0;

  if (Math.abs(ang) > 0.01)
    console.log("[LEFT→YAW → ANG]", ang.toFixed(3));

  return ang;
}

function computePitchFromRight(controller) {
  const quat = new THREE.Quaternion();
  controller.getWorldQuaternion(quat);

  const euler = new THREE.Euler().setFromQuaternion(quat, "YXZ");

  let pitch = euler.x;

  pitch = Math.max(-MAX_PITCH_RAD, Math.min(MAX_PITCH_RAD, pitch));

  let lin = (-pitch / MAX_PITCH_RAD) * VR_LIN_SCALE;

  if (Math.abs(lin) < DEADZONE) lin = 0;

  if (Math.abs(lin) > 0.01)
    console.log("[RIGHT→PITCH → LIN]", lin.toFixed(3));

  return lin;
}


function computeLinearFromLeft(controller, prevQuat) {
  const quat = new THREE.Quaternion();
  controller.getWorldQuaternion(quat);

  const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');

  // Quest 3: forward/back tilt
  let lin = -euler.z * VR_LIN_SCALE;

  if (Math.abs(lin) < DEADZONE) lin = 0;

  prevQuat.copy(quat);
  return lin;
}

function computeAngularFromRight(controller, prevQuat) {
  const quat = new THREE.Quaternion();
  controller.getWorldQuaternion(quat);

  const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');

  // Wrist rotation
  let ang = euler.y * VR_ANG_SCALE;

  if (Math.abs(ang) < DEADZONE) ang = 0;

  prevQuat.copy(quat);
  return ang;
}





/* ================= SAVE ================= */

function saveJSON() {
  const data = allLines.map(line => ({
    color: line.material.color.getHex(),
    points: Array.from(line.geometry.attributes.position.array)
  }));

  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'vr_drawing.json';
  a.click();
}

/* ================= KEYBOARD TEST ================= */

const KEY_LIN = 0.2;
const KEY_ANG = 1.0;
let keyState = { w: false, a: false, s: false, d: false };

function keyboardCmdVel() {
  let lin = 0, ang = 0;
  if (keyState.w) lin += KEY_LIN;
  if (keyState.s) lin -= KEY_LIN;
  if (keyState.a) ang += KEY_ANG;
  if (keyState.d) ang -= KEY_ANG;
  if (lin !== 0 || ang !== 0) sendCmdVel(lin, ang);
}

window.addEventListener("keydown", e => {
  const k = e.key.toLowerCase();
  if (k in keyState) {
    keyState[k] = true;
    keyboardCmdVel();
  }
  if (k === " ") sendCmdVel(0, 0);
});

window.addEventListener("keyup", e => {
  const k = e.key.toLowerCase();
  if (k in keyState) {
    keyState[k] = false;
    sendCmdVel(0, 0);
  }
});

/* ================= MISC ================= */

function animate() {
  renderer.setAnimationLoop(render);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
