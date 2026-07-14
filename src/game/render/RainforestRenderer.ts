import * as THREE from "three";
import {
  WORLD_CHUNK_SIZE,
  activeChunkCoordinates,
  chunkKey,
  generateChunkVisualPlan,
  worldToChunkCoordinate,
  type ChunkVisualPlan,
  type WorldVisualDetail,
} from "../world/generation";
import type {
  EngineCallbacks,
  EngineDiagnostics,
  InteractionTarget,
  PlayerFrame,
  RenderEntity,
  RenderEntityKind,
  RenderSnapshot,
  TouchInput,
} from "./types";

const EYE_HEIGHT = 1.68;
const WALK_SPEED = 3.35;
const SPRINT_SPEED = 5.7;
const INTERACT_DISTANCE = 3.2;
const SURVEY_SHELTER_X = -35;
const SURVEY_SHELTER_Z = 31;
const SURVEY_SHELTER_YAW = -0.9;

const defaultSnapshot: RenderSnapshot = {
  worldSeed: "canopy-living-forest-v1",
  day: 1,
  minuteOfDay: 13 * 60 + 20,
  rain: 0.12,
  storm: false,
  fireBuilt: false,
  fireLit: false,
  shelterBuilt: false,
  bedBuilt: false,
  beaconBuilt: false,
  signalActive: false,
  canSprint: true,
  entities: [],
  wildlife: [],
};

type EntityView = {
  definition: RenderEntity;
  object: THREE.Object3D;
};

type CircleCollider = { x: number; z: number; radius: number };

type ChunkView = {
  group: THREE.Group;
  colliders: CircleCollider[];
};

type WildlifeView = {
  projection: RenderSnapshot["wildlife"][number];
  object: THREE.Object3D;
};

export class RainforestRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: EngineCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.08, 180);
  private previousFrameTime = performance.now();
  private readonly keys = new Set<string>();
  private readonly entityViews = new Map<string, EntityView>();
  private readonly wildlifeViews = new Map<string, WildlifeView>();
  private readonly chunkViews = new Map<string, ChunkView>();
  private readonly colliders: CircleCollider[] = [];
  private readonly hazardWarned = new Set<string>();
  private readonly hazardTriggered = new Set<string>();
  private readonly worldGroup = new THREE.Group();
  private readonly chunkGroup = new THREE.Group();
  private readonly dynamicGroup = new THREE.Group();
  private readonly rainGeometry = new THREE.BufferGeometry();
  private readonly rainMaterial = new THREE.PointsMaterial({
    color: 0xbdd8d0,
    size: 0.055,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  private readonly rainPoints: THREE.Points;
  private readonly hemisphere = new THREE.HemisphereLight(0xcbe2c3, 0x142014, 1.6);
  private readonly sun = new THREE.DirectionalLight(0xffefc9, 2.2);
  private readonly fireGroup = new THREE.Group();
  private readonly fireLight = new THREE.PointLight(0xff7a2d, 0, 12, 2);
  private readonly signalLight = new THREE.PointLight(0xff3d2e, 0, 20, 2);
  private birdFlock: THREE.InstancedMesh | null = null;
  private birdWingPositions: THREE.BufferAttribute | null = null;
  private birdMaterial: THREE.MeshBasicMaterial | null = null;
  private fireflies: THREE.Points | null = null;
  private fireflyBasePositions: Float32Array | null = null;
  private fireflyMaterial: THREE.PointsMaterial | null = null;
  private readonly wildlifeDummy = new THREE.Object3D();
  private wildlifeTime = 0;
  private snapshot = defaultSnapshot;
  private animationFrame = 0;
  private running = false;
  private paused = false;
  private pointerLocked = false;
  private dragFallbackActive = false;
  private dragPointerId: number | null = null;
  private dragLastX = 0;
  private dragLastY = 0;
  private yaw = Math.PI;
  private pitch = -0.05;
  private player = new THREE.Vector3(0, 0, 5);
  private lastPlayer = new THREE.Vector3(0, 0, 5);
  private touch: TouchInput = { forward: 0, right: 0, lookX: 0, lookY: 0, sprint: false };
  private currentTarget: InteractionTarget | null = null;
  private lastFrameReport = 0;
  private frameSamples: number[] = [];
  private diagnostics: EngineDiagnostics = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, x: 0, z: 0 };
  private reducedMotion = false;
  private userReducedMotion = false;
  private activeChunkCenter = "";
  private readonly worldVisualDetail: WorldVisualDetail;
  private readonly activeChunkRadius: number;
  private readonly maxWildlifeViews: number;
  private readonly cleanup: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    const lowPower = this.isLowPowerDevice();
    this.worldVisualDetail = lowPower ? "low" : "standard";
    this.activeChunkRadius = lowPower ? 1 : 2;
    this.maxWildlifeViews = lowPower ? 10 : 24;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !lowPower,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = !lowPower;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.fog = new THREE.FogExp2(0x274435, 0.021);
    this.scene.background = new THREE.Color(0x6b8c72);
    this.scene.add(this.worldGroup, this.dynamicGroup, this.hemisphere, this.sun);

    this.sun.position.set(-28, 42, 20);
    this.sun.castShadow = this.renderer.shadowMap.enabled;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -38;
    this.sun.shadow.camera.right = 38;
    this.sun.shadow.camera.top = 38;
    this.sun.shadow.camera.bottom = -38;
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 95;

    this.camera.rotation.order = "YXZ";
    this.rainPoints = new THREE.Points(this.rainGeometry, this.rainMaterial);
    this.rainPoints.frustumCulled = false;
    this.scene.add(this.rainPoints);
    this.createWorld();
    this.createRain();
    this.createCampfire();
    this.createWildlife();
    this.bindEvents();
    this.resize();
    this.setPlayerPosition(0, 5, Math.PI);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.previousFrameTime = performance.now();
    this.animate();
  }

  stop(): void {
    this.running = false;
    window.cancelAnimationFrame(this.animationFrame);
  }

  setSnapshot(snapshot: RenderSnapshot): void {
    const seedChanged = snapshot.worldSeed !== this.snapshot.worldSeed;
    this.snapshot = snapshot;
    if (seedChanged) {
      this.clearWorldChunks();
      this.syncWorldChunks();
    }
    this.syncEntities(snapshot.entities);
    this.syncWildlife(snapshot.wildlife);
    this.syncStructures();
    if (!this.running) this.renderer.render(this.scene, this.camera);
  }

  setTouchInput(input: Partial<TouchInput>): void {
    this.touch = { ...this.touch, ...input };
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.keys.clear();
    this.touch = { forward: 0, right: 0, lookX: 0, lookY: 0, sprint: false };
    if (paused) {
      this.stop();
      this.renderer.render(this.scene, this.camera);
    } else if (!this.running) {
      this.start();
    }
  }

  setReducedMotion(enabled: boolean): void {
    this.userReducedMotion = enabled;
    this.reducedMotion = enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  resetRun(): void {
    this.hazardWarned.clear();
    this.hazardTriggered.clear();
    this.currentTarget = null;
    this.callbacks.onTargetChange(null);
    this.setPaused(false);
  }

  setPlayerPosition(x: number, z: number, yaw = this.yaw): void {
    this.player.set(x, 0, z);
    this.lastPlayer.copy(this.player);
    this.yaw = yaw;
    this.camera.position.set(this.player.x, terrainHeight(this.player.x, this.player.z) + EYE_HEIGHT, this.player.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.syncWorldChunks();
  }

  requestPointerLock(): void {
    if (document.pointerLockElement !== this.canvas) {
      try {
        const request = this.canvas.requestPointerLock?.();
        if (request) void request.catch(() => this.enableDragFallback());
        else this.enableDragFallback();
      } catch {
        this.enableDragFallback();
      }
    }
  }

  releasePointerLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.dragFallbackActive = false;
    this.endDragLook();
    this.canvas.style.cursor = "";
    this.callbacks.onPointerLockChange(false);
  }

  interact(): void {
    if (this.currentTarget) this.callbacks.onInteract(this.currentTarget);
  }

  getDiagnostics(): EngineDiagnostics {
    return { ...this.diagnostics };
  }

  dispose(): void {
    this.stop();
    this.cleanup.forEach((fn) => fn());
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.InstancedMesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private bindEvents(): void {
    const onResize = () => this.resize();
    const onKeyDown = (event: KeyboardEvent) => {
      if (this.paused) return;
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight", "KeyE"].includes(event.code)) {
        if (event.code === "KeyE" && !event.repeat) this.interact();
        this.keys.add(event.code);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => this.keys.delete(event.code);
    const onMouseMove = (event: MouseEvent) => {
      if (!this.pointerLocked) return;
      const sensitivity = 0.0018;
      this.yaw -= event.movementX * sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * sensitivity, -1.34, 1.34);
    };
    const onPointerLock = () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (this.pointerLocked) {
        this.dragFallbackActive = false;
        this.endDragLook();
        this.canvas.style.cursor = "";
      }
      this.callbacks.onPointerLockChange(this.pointerLocked || this.dragFallbackActive);
      this.keys.clear();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (
        this.paused ||
        this.pointerLocked ||
        !this.dragFallbackActive ||
        event.pointerType !== "mouse" ||
        event.button !== 0
      ) return;
      this.dragPointerId = event.pointerId;
      this.dragLastX = event.clientX;
      this.dragLastY = event.clientY;
      this.canvas.style.cursor = "grabbing";
      try { this.canvas.setPointerCapture(event.pointerId); } catch { /* capture may be denied by embeds */ }
      event.preventDefault();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== this.dragPointerId || this.pointerLocked || this.paused) return;
      const sensitivity = 0.0042;
      const deltaX = event.clientX - this.dragLastX;
      const deltaY = event.clientY - this.dragLastY;
      this.dragLastX = event.clientX;
      this.dragLastY = event.clientY;
      this.yaw -= deltaX * sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch - deltaY * sensitivity, -1.34, 1.34);
      event.preventDefault();
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== this.dragPointerId) return;
      this.endDragLook(event.pointerId);
    };
    const onVisibility = () => {
      if (document.hidden) this.keys.clear();
    };
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => { this.reducedMotion = media.matches || this.userReducedMotion; };
    onMotion();

    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", onPointerLock);
    this.canvas.addEventListener("pointerdown", onPointerDown);
    this.canvas.addEventListener("pointermove", onPointerMove);
    this.canvas.addEventListener("pointerup", onPointerEnd);
    this.canvas.addEventListener("pointercancel", onPointerEnd);
    this.canvas.addEventListener("lostpointercapture", onPointerEnd);
    document.addEventListener("visibilitychange", onVisibility);
    media.addEventListener("change", onMotion);
    this.cleanup.push(
      () => window.removeEventListener("resize", onResize),
      () => window.removeEventListener("keydown", onKeyDown),
      () => window.removeEventListener("keyup", onKeyUp),
      () => document.removeEventListener("mousemove", onMouseMove),
      () => document.removeEventListener("pointerlockchange", onPointerLock),
      () => this.canvas.removeEventListener("pointerdown", onPointerDown),
      () => this.canvas.removeEventListener("pointermove", onPointerMove),
      () => this.canvas.removeEventListener("pointerup", onPointerEnd),
      () => this.canvas.removeEventListener("pointercancel", onPointerEnd),
      () => this.canvas.removeEventListener("lostpointercapture", onPointerEnd),
      () => document.removeEventListener("visibilitychange", onVisibility),
      () => media.removeEventListener("change", onMotion),
    );
  }

  private enableDragFallback(): void {
    if (this.paused || this.pointerLocked) return;
    this.dragFallbackActive = true;
    this.canvas.style.cursor = "grab";
    this.callbacks.onPointerLockChange(true);
  }

  private endDragLook(pointerId = this.dragPointerId): void {
    if (pointerId === null || pointerId !== this.dragPointerId) return;
    if (this.canvas.hasPointerCapture(pointerId)) {
      try { this.canvas.releasePointerCapture(pointerId); } catch { /* already released */ }
    }
    this.dragPointerId = null;
    this.canvas.style.cursor = this.dragFallbackActive ? "grab" : "";
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const dprCap = this.isLowPowerDevice() ? 1 : 1.5;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    if (!this.running) return;
    this.animationFrame = window.requestAnimationFrame(this.animate);
    const now = performance.now();
    const delta = Math.min((now - this.previousFrameTime) / 1000, 0.05);
    this.previousFrameTime = now;
    this.updatePlayer(delta);
    this.updateEnvironment(delta);
    this.updateTarget();
    this.renderer.render(this.scene, this.camera);
    this.updateDiagnostics(delta);
  };

  private updatePlayer(delta: number): void {
    const forwardInput = this.paused ? 0 : (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0) + this.touch.forward;
    const rightInput = this.paused ? 0 : (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0) + this.touch.right;
    const moving = Math.abs(forwardInput) > 0.05 || Math.abs(rightInput) > 0.05;
    const sprinting = moving && this.snapshot.canSprint && (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.touch.sprint);
    const speed = sprinting ? SPRINT_SPEED : WALK_SPEED;
    const movement = new THREE.Vector3();
    if (moving) {
      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      movement.addScaledVector(forward, forwardInput).addScaledVector(right, rightInput);
      if (movement.lengthSq() > 1) movement.normalize();
      movement.multiplyScalar(speed * delta);
    }

    if (!this.paused && (this.touch.lookX || this.touch.lookY)) {
      this.yaw -= this.touch.lookX * delta * 1.8;
      this.pitch = THREE.MathUtils.clamp(this.pitch - this.touch.lookY * delta * 1.5, -1.34, 1.34);
    }

    const candidate = this.player.clone().add(movement);
    if (!this.isColliding(candidate.x, candidate.z)) this.player.copy(candidate);
    else {
      const slideX = new THREE.Vector3(candidate.x, 0, this.player.z);
      const slideZ = new THREE.Vector3(this.player.x, 0, candidate.z);
      if (!this.isColliding(slideX.x, slideX.z)) this.player.copy(slideX);
      else if (!this.isColliding(slideZ.x, slideZ.z)) this.player.copy(slideZ);
    }

    const distance = this.player.distanceTo(this.lastPlayer);
    const bob = moving && !this.reducedMotion ? Math.sin(performance.now() * (sprinting ? 0.013 : 0.009)) * 0.025 : 0;
    this.camera.position.set(this.player.x, terrainHeight(this.player.x, this.player.z) + EYE_HEIGHT + bob, this.player.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.lastPlayer.copy(this.player);
    this.syncWorldChunks();

    const frame: PlayerFrame = {
      x: this.player.x,
      z: this.player.z,
      yaw: this.yaw,
      distance,
      sprinting,
      inWater: riverDistance(this.player.x, this.player.z) < 1.65,
      sheltered: this.isSheltered(this.player.x, this.player.z),
    };
    this.callbacks.onPlayerFrame(frame);
    this.checkHazards();
  }

  private updateEnvironment(delta: number): void {
    const minute = this.snapshot.minuteOfDay % 1440;
    const daylight = THREE.MathUtils.smoothstep(Math.sin(((minute - 360) / 1440) * Math.PI * 2) * 0.5 + 0.5, 0.08, 0.82);
    const stormDarken = this.snapshot.storm ? 0.42 : 1;
    this.hemisphere.intensity = 0.35 + daylight * 1.35 * stormDarken;
    this.sun.intensity = 0.05 + daylight * 2.15 * stormDarken;
    this.sun.color.set(daylight < 0.35 ? 0xff9b62 : 0xffefc9);
    const skyDay = new THREE.Color(0x789b7d);
    const skyNight = new THREE.Color(0x020807);
    const skyStorm = new THREE.Color(0x263c35);
    const sky = skyNight.clone().lerp(skyDay, daylight).lerp(skyStorm, this.snapshot.rain * 0.62);
    this.scene.background = sky;
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(sky.clone().lerp(new THREE.Color(0x173024), 0.45));
      this.scene.fog.density = 0.016 + this.snapshot.rain * 0.018 + (1 - daylight) * 0.006;
    }

    this.rainMaterial.opacity = THREE.MathUtils.lerp(this.rainMaterial.opacity, this.snapshot.rain * 0.78, 0.07);
    this.rainPoints.visible = this.snapshot.rain > 0.02;
    this.rainPoints.position.set(this.player.x, terrainHeight(this.player.x, this.player.z) + 8, this.player.z);
    if (this.rainPoints.visible && !this.reducedMotion) {
      const positions = this.rainGeometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i += 1) {
        let y = positions.getY(i) - delta * (11 + this.snapshot.rain * 15);
        if (y < -3) y = 9 + Math.random() * 4;
        positions.setY(i, y);
      }
      positions.needsUpdate = true;
    }

    this.fireLight.intensity = this.snapshot.fireLit ? 2.4 + Math.sin(performance.now() * 0.015) * 0.45 : 0;
    this.fireGroup.visible = this.snapshot.fireBuilt;
    this.fireGroup.children.forEach((child, index) => {
      if (child.userData.flame && this.snapshot.fireLit && !this.reducedMotion) {
        child.scale.y = 0.82 + Math.sin(performance.now() * 0.012 + index) * 0.16;
        child.rotation.y += delta * (index % 2 ? 0.9 : -0.7);
      }
    });
    this.signalLight.intensity = this.snapshot.signalActive ? 3 + Math.sin(performance.now() * 0.008) * 1.4 : 0;
    this.updateWildlife(delta, daylight);
  }

  private updateWildlife(delta: number, daylight: number): void {
    this.wildlifeTime += delta;
    const motionTime = this.reducedMotion ? 0 : this.wildlifeTime;

    if (this.birdFlock && this.birdWingPositions && this.birdMaterial) {
      const clearSky = 1 - THREE.MathUtils.smoothstep(this.snapshot.rain, 0.18, 0.82);
      const birdActivity = THREE.MathUtils.smoothstep(daylight, 0.24, 0.68) * clearSky;
      this.birdFlock.visible = birdActivity > 0.04;
      this.birdMaterial.opacity = birdActivity * 0.78;
      if (this.birdFlock.visible) {
        const wingY = 0.08 + Math.sin(motionTime * 7.4) * 0.13;
        this.birdWingPositions.setY(1, wingY);
        this.birdWingPositions.setY(4, wingY);
        this.birdWingPositions.needsUpdate = true;

        const flockAngle = motionTime * 0.09;
        const centerX = this.player.x + Math.cos(flockAngle) * 14;
        const centerZ = this.player.z + Math.sin(flockAngle) * 14;
        for (let i = 0; i < this.birdFlock.count; i += 1) {
          const column = i - (this.birdFlock.count - 1) * 0.5;
          const x = centerX + column * 1.35 + Math.sin(motionTime * 0.42 + i * 1.7) * 0.7;
          const z = centerZ - Math.abs(column) * 0.62 + Math.cos(motionTime * 0.36 + i) * 0.45;
          const scale = 0.72 + seeded(i * 9.1 + 2) * 0.34;
          this.wildlifeDummy.position.set(x, terrainHeight(x, z) + 9.5 + (i % 3) * 0.38, z);
          this.wildlifeDummy.rotation.set(
            0,
            -flockAngle + Math.PI * 0.5,
            Math.sin(motionTime * 0.5 + i) * 0.08,
          );
          this.wildlifeDummy.scale.setScalar(scale);
          this.wildlifeDummy.updateMatrix();
          this.birdFlock.setMatrixAt(i, this.wildlifeDummy.matrix);
        }
        this.birdFlock.instanceMatrix.needsUpdate = true;
      }
    }

    if (this.fireflies && this.fireflyBasePositions && this.fireflyMaterial) {
      const night = THREE.MathUtils.smoothstep(1 - daylight, 0.3, 0.8);
      const rainShelter = 1 - THREE.MathUtils.smoothstep(this.snapshot.rain, 0.28, 0.94) * 0.88;
      const fireflyActivity = night * rainShelter;
      this.fireflies.visible = fireflyActivity > 0.035;
      this.fireflyMaterial.opacity = fireflyActivity * 0.92;
      if (this.fireflies.visible && !this.reducedMotion) {
        const positions = this.fireflies.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < positions.count; i += 1) {
          const offset = i * 3;
          positions.setXYZ(
            i,
            this.fireflyBasePositions[offset] + Math.sin(motionTime * 0.74 + i * 1.37) * 0.16,
            this.fireflyBasePositions[offset + 1] + Math.sin(motionTime * 1.12 + i * 0.83) * 0.24,
            this.fireflyBasePositions[offset + 2] + Math.cos(motionTime * 0.67 + i * 1.11) * 0.16,
          );
        }
        positions.needsUpdate = true;
      }
    }
  }

  private updateTarget(): void {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    let best: InteractionTarget | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const view of this.entityViews.values()) {
      if (!view.definition.interactive || !view.definition.available || !view.object.visible) continue;
      const to = view.object.position.clone().sub(this.camera.position);
      const distance = Math.hypot(to.x, to.z);
      if (distance > Math.min(INTERACT_DISTANCE, view.definition.interactRadius)) continue;
      const alignment = forward.dot(to.normalize());
      if (alignment < 0.44) continue;
      const score = distance + (1 - alignment) * 1.4;
      if (score < bestScore) {
        bestScore = score;
        best = {
          id: view.definition.id,
          kind: view.definition.kind,
          label: view.definition.label,
          distance,
        };
      }
    }
    if (best?.id !== this.currentTarget?.id) {
      this.currentTarget = best;
      this.callbacks.onTargetChange(best);
    } else if (best) {
      this.currentTarget = best;
    }
  }

  private checkHazards(): void {
    for (const view of this.entityViews.values()) {
      if (view.definition.kind !== "snake" || !view.definition.available) continue;
      const distance = Math.hypot(this.player.x - view.definition.x, this.player.z - view.definition.z);
      if (distance < 6.8 && !this.hazardWarned.has(view.definition.id)) {
        this.hazardWarned.add(view.definition.id);
        this.callbacks.onHazardWarning(view.definition.id);
      }
      if (this.hazardTriggered.has(view.definition.id)) continue;
      if (distance < 1.45) {
        this.hazardTriggered.add(view.definition.id);
        this.callbacks.onHazard(view.definition.id);
      }
    }
    for (const view of this.wildlifeViews.values()) {
      if (view.projection.role !== "predator" || !view.projection.visible) continue;
      const warningId = `wildlife:${view.projection.individualId}`;
      const distance = Math.hypot(
        this.player.x - view.projection.position.x,
        this.player.z - view.projection.position.z,
      );
      if (
        distance < view.projection.encounter.awarenessRadius &&
        !this.hazardWarned.has(warningId)
      ) {
        this.hazardWarned.add(warningId);
        this.callbacks.onHazardWarning(warningId);
      }
    }
  }

  private updateDiagnostics(delta: number): void {
    this.frameSamples.push(delta * 1000);
    if (this.frameSamples.length > 90) this.frameSamples.shift();
    const now = performance.now();
    if (now - this.lastFrameReport < 500) return;
    const average = this.frameSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, this.frameSamples.length);
    this.diagnostics = {
      fps: average ? Math.round(1000 / average) : 0,
      frameMs: Number(average.toFixed(1)),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      x: Number(this.player.x.toFixed(1)),
      z: Number(this.player.z.toFixed(1)),
    };
    this.lastFrameReport = now;
  }

  private syncEntities(entities: RenderEntity[]): void {
    const incoming = new Set(entities.map((entity) => entity.id));
    for (const [id, view] of this.entityViews) {
      if (!incoming.has(id)) {
        this.dynamicGroup.remove(view.object);
        disposeObject(view.object);
        this.entityViews.delete(id);
      }
    }
    for (const definition of entities) {
      const existing = this.entityViews.get(definition.id);
      if (existing) {
        existing.definition = definition;
        existing.object.visible = definition.available;
        continue;
      }
      const object = createEntityObject(definition.kind);
      object.position.set(definition.x, terrainHeight(definition.x, definition.z), definition.z);
      if (definition.kind === "cache") object.rotation.y = SURVEY_SHELTER_YAW;
      object.visible = definition.available;
      object.userData.entityId = definition.id;
      this.dynamicGroup.add(object);
      this.entityViews.set(definition.id, { definition, object });
    }
  }

  private syncWildlife(wildlife: RenderSnapshot["wildlife"]): void {
    const visible = wildlife
      .filter((projection) => projection.visible)
      .sort((left, right) =>
        Math.hypot(left.position.x - this.player.x, left.position.z - this.player.z) -
        Math.hypot(right.position.x - this.player.x, right.position.z - this.player.z),
      )
      .slice(0, this.maxWildlifeViews);
    const incoming = new Set(visible.map((projection) => projection.individualId));
    for (const [id, view] of this.wildlifeViews) {
      if (incoming.has(id)) continue;
      this.dynamicGroup.remove(view.object);
      disposeObject(view.object);
      this.wildlifeViews.delete(id);
    }
    for (const projection of visible) {
      let view = this.wildlifeViews.get(projection.individualId);
      if (!view) {
        const object = createWildlifeObject(projection.speciesId);
        object.userData.wildlifeId = projection.individualId;
        this.dynamicGroup.add(object);
        view = { projection, object };
        this.wildlifeViews.set(projection.individualId, view);
      }
      view.projection = projection;
      view.object.position.set(
        projection.position.x,
        terrainHeight(projection.position.x, projection.position.z),
        projection.position.z,
      );
      view.object.rotation.y = -projection.headingRadians;
      view.object.scale.setScalar(projection.scale);
      view.object.visible = projection.visible;
    }
  }

  private syncStructures(): void {
    this.fireGroup.visible = this.snapshot.fireBuilt;
    const shelter = this.worldGroup.getObjectByName("player-shelter");
    if (shelter) shelter.visible = this.snapshot.shelterBuilt;
    const bed = this.worldGroup.getObjectByName("leaf-bed");
    if (bed) bed.visible = this.snapshot.bedBuilt;
    const antenna = this.worldGroup.getObjectByName("beacon-antenna");
    if (antenna) antenna.visible = this.snapshot.beaconBuilt;
  }

  private createWorld(): void {
    this.worldGroup.add(this.chunkGroup);
    this.syncWorldChunks();
    this.createLandmarks();
  }

  private syncWorldChunks(): void {
    const center = worldToChunkCoordinate(this.player.x, this.player.z);
    const centerKey = chunkKey(center);
    if (centerKey === this.activeChunkCenter) return;

    const requiredCoordinates = activeChunkCoordinates(
      this.player.x,
      this.player.z,
      this.activeChunkRadius,
    );
    const requiredKeys = new Set(requiredCoordinates.map((coordinate) => chunkKey(coordinate)));
    for (const [key, view] of this.chunkViews) {
      if (requiredKeys.has(key)) continue;
      this.chunkGroup.remove(view.group);
      disposeObject(view.group);
      this.chunkViews.delete(key);
    }

    for (const coordinate of requiredCoordinates) {
      const key = chunkKey(coordinate);
      if (this.chunkViews.has(key)) continue;
      const plan = generateChunkVisualPlan(this.snapshot.worldSeed, coordinate, this.worldVisualDetail);
      const view = this.createChunkView(plan);
      this.chunkViews.set(key, view);
      this.chunkGroup.add(view.group);
    }
    this.activeChunkCenter = centerKey;
  }

  private clearWorldChunks(): void {
    for (const view of this.chunkViews.values()) {
      this.chunkGroup.remove(view.group);
      disposeObject(view.group);
    }
    this.chunkViews.clear();
    this.activeChunkCenter = "";
  }

  private createChunkView(plan: ChunkVisualPlan): ChunkView {
    const group = new THREE.Group();
    const colliders: CircleCollider[] = [];
    group.name = `world-chunk-${plan.descriptor.key}`;
    group.userData.biome = plan.descriptor.biome;
    this.createChunkGround(plan, group);
    this.createChunkTrees(plan, group, colliders);
    this.createChunkUndergrowth(plan, group);
    this.createChunkRocks(plan, group, colliders);
    this.createChunkWater(plan, group);
    return { group, colliders };
  }

  private createChunkGround(plan: ChunkVisualPlan, group: THREE.Group): void {
    const coordinate = plan.descriptor.coordinate;
    const centerX = (coordinate.x + 0.5) * WORLD_CHUNK_SIZE;
    const centerZ = (coordinate.z + 0.5) * WORLD_CHUNK_SIZE;
    const segments = this.worldVisualDetail === "low" ? 8 : 12;
    const geometry = new THREE.PlaneGeometry(
      WORLD_CHUNK_SIZE,
      WORLD_CHUNK_SIZE,
      segments,
      segments,
    );
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    const low = new THREE.Color(plan.profile.groundLow);
    const high = new THREE.Color(plan.profile.groundHigh);
    const mud = new THREE.Color(0x4e4933);
    for (let index = 0; index < positions.count; index += 1) {
      const worldX = centerX + positions.getX(index);
      const worldZ = centerZ + positions.getZ(index);
      const height = terrainHeight(worldX, worldZ);
      positions.setY(index, height);
      const color = low.clone().lerp(
        high,
        THREE.MathUtils.clamp((height + 1.8) / 5.6, 0, 1),
      );
      if (riverDistance(worldX, worldZ) < 3.1) color.lerp(mud, 0.72);
      color.offsetHSL(0, 0, (hash2(worldX * 3, worldZ * 3) - 0.5) * 0.08);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const ground = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    );
    ground.position.set(centerX, 0, centerZ);
    ground.receiveShadow = true;
    group.add(ground);
  }

  private createChunkTrees(
    plan: ChunkVisualPlan,
    group: THREE.Group,
    colliders: CircleCollider[],
  ): void {
    const trees = plan.trees.filter(
      (spawn) => riverDistance(spawn.x, spawn.z) >= 3.5 && !isLandmarkClearing(spawn.x, spawn.z),
    );
    if (trees.length === 0) return;
    const style = plan.profile.treeStyle;
    const trunkHeight = style === "palm" ? 5.8 : style === "wetland" ? 5.1 : 4.5;
    const trunkGeometry = new THREE.CylinderGeometry(
      style === "palm" ? 0.13 : 0.18,
      style === "palm" ? 0.24 : 0.32,
      trunkHeight,
      6,
    );
    const crownGeometry = style === "palm"
      ? new THREE.ConeGeometry(2.25, 0.72, 8)
      : style === "sparse"
        ? new THREE.ConeGeometry(1.35, 3.4, 6)
        : new THREE.SphereGeometry(style === "wetland" ? 1.25 : 1.55, 7, 5);
    const trunks = new THREE.InstancedMesh(
      trunkGeometry,
      new THREE.MeshStandardMaterial({ color: style === "wetland" ? 0x40382a : 0x4a3423, roughness: 1 }),
      trees.length,
    );
    const crowns = new THREE.InstancedMesh(
      crownGeometry,
      new THREE.MeshStandardMaterial({ color: plan.profile.treeColor, roughness: 0.98 }),
      trees.length,
    );
    const dummy = new THREE.Object3D();
    trees.forEach((spawn, index) => {
      const y = terrainHeight(spawn.x, spawn.z);
      dummy.position.set(spawn.x, y + (trunkHeight * spawn.scale) / 2, spawn.z);
      dummy.scale.setScalar(spawn.scale);
      dummy.rotation.set(0, spawn.rotation, style === "wetland" ? 0.04 * Math.sin(spawn.rotation) : 0);
      dummy.updateMatrix();
      trunks.setMatrixAt(index, dummy.matrix);
      dummy.position.y = y + trunkHeight * spawn.scale;
      dummy.rotation.set(0, spawn.rotation + 0.35, 0);
      if (style === "palm") dummy.scale.set(spawn.scale, spawn.scale * 0.74, spawn.scale);
      else if (style === "wetland") dummy.scale.set(spawn.scale * 0.86, spawn.scale * 0.72, spawn.scale * 0.86);
      else dummy.scale.set(spawn.scale, spawn.scale, spawn.scale * 0.92);
      dummy.updateMatrix();
      crowns.setMatrixAt(index, dummy.matrix);
      colliders.push({ x: spawn.x, z: spawn.z, radius: 0.3 * spawn.scale + 0.22 });
    });
    trunks.castShadow = this.renderer.shadowMap.enabled;
    trunks.receiveShadow = true;
    crowns.castShadow = this.renderer.shadowMap.enabled;
    group.add(trunks, crowns);
  }

  private createChunkUndergrowth(plan: ChunkVisualPlan, group: THREE.Group): void {
    const shrubs = plan.shrubs.filter((spawn) => !isLandmarkClearing(spawn.x, spawn.z));
    if (shrubs.length === 0) return;
    const wetland = plan.profile.treeStyle === "wetland";
    const geometry = wetland
      ? new THREE.ConeGeometry(0.13, 1.55, 5)
      : new THREE.ConeGeometry(0.48, 0.8, 5);
    geometry.translate(0, wetland ? 0.775 : 0.4, 0);
    const shrubsMesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: plan.profile.shrubColor,
        roughness: 1,
        side: THREE.DoubleSide,
      }),
      shrubs.length,
    );
    const dummy = new THREE.Object3D();
    shrubs.forEach((spawn, index) => {
      dummy.position.set(spawn.x, terrainHeight(spawn.x, spawn.z), spawn.z);
      dummy.scale.set(spawn.scale, spawn.scale, spawn.scale);
      dummy.rotation.set(0, spawn.rotation, wetland ? Math.sin(spawn.rotation) * 0.08 : 0);
      dummy.updateMatrix();
      shrubsMesh.setMatrixAt(index, dummy.matrix);
    });
    shrubsMesh.receiveShadow = true;
    group.add(shrubsMesh);
  }

  private createChunkRocks(
    plan: ChunkVisualPlan,
    group: THREE.Group,
    colliders: CircleCollider[],
  ): void {
    const rocks = plan.rocks.filter((spawn) => !isLandmarkClearing(spawn.x, spawn.z));
    if (rocks.length === 0) return;
    const rockMesh = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.72, 0),
      new THREE.MeshStandardMaterial({ color: plan.profile.rockColor, roughness: 1 }),
      rocks.length,
    );
    const dummy = new THREE.Object3D();
    rocks.forEach((spawn, index) => {
      dummy.position.set(spawn.x, terrainHeight(spawn.x, spawn.z) + 0.32 * spawn.scale, spawn.z);
      dummy.scale.set(spawn.scale, spawn.scale * 0.55, spawn.scale * 0.82);
      dummy.rotation.set(spawn.rotation * 0.07, spawn.rotation, spawn.rotation * 0.04);
      dummy.updateMatrix();
      rockMesh.setMatrixAt(index, dummy.matrix);
      if (spawn.scale > 0.9) {
        colliders.push({ x: spawn.x, z: spawn.z, radius: 0.38 * spawn.scale });
      }
    });
    rockMesh.castShadow = this.renderer.shadowMap.enabled;
    rockMesh.receiveShadow = true;
    group.add(rockMesh);
  }

  private createChunkWater(plan: ChunkVisualPlan, group: THREE.Group): void {
    if (plan.wetPatches.length > 0) {
      const puddles = new THREE.InstancedMesh(
        new THREE.CircleGeometry(1, 18),
        new THREE.MeshPhysicalMaterial({
          color: plan.descriptor.biome === "swamp" ? 0x1d3a31 : 0x356b65,
          roughness: 0.28,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
        }),
        plan.wetPatches.length,
      );
      const dummy = new THREE.Object3D();
      plan.wetPatches.forEach((spawn, index) => {
        dummy.position.set(spawn.x, terrainHeight(spawn.x, spawn.z) + 0.08, spawn.z);
        dummy.scale.set(spawn.scale * 1.35, spawn.scale * 0.75, 1);
        dummy.rotation.set(-Math.PI / 2, 0, spawn.rotation);
        dummy.updateMatrix();
        puddles.setMatrixAt(index, dummy.matrix);
      });
      group.add(puddles);
    }

    const minX = plan.descriptor.coordinate.x * WORLD_CHUNK_SIZE;
    const maxX = minX + WORLD_CHUNK_SIZE;
    const minZ = plan.descriptor.coordinate.z * WORLD_CHUNK_SIZE;
    const maxZ = minZ + WORLD_CHUNK_SIZE;
    const riverSegments: Array<{ x: number; z: number; rotation: number }> = [];
    for (let x = minX + 1.5; x < maxX; x += 3) {
      const z = riverCenter(x);
      if (z < minZ - 2.4 || z > maxZ + 2.4) continue;
      riverSegments.push({ x, z, rotation: -Math.atan(Math.cos(x * 0.09) * 0.27) });
    }
    if (riverSegments.length === 0) return;
    const geometry = new THREE.PlaneGeometry(3.25, 4.5);
    geometry.rotateX(-Math.PI / 2);
    const river = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshPhysicalMaterial({
        color: 0x2f756f,
        roughness: 0.22,
        metalness: 0.05,
        transparent: true,
        opacity: 0.78,
        depthWrite: true,
      }),
      riverSegments.length,
    );
    const dummy = new THREE.Object3D();
    riverSegments.forEach((segment, index) => {
      dummy.position.set(segment.x, terrainHeight(segment.x, segment.z) + 0.18, segment.z);
      dummy.rotation.set(0, segment.rotation, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      river.setMatrixAt(index, dummy.matrix);
    });
    river.receiveShadow = true;
    group.add(river);
  }

  private createLandmarks(): void {
    this.worldGroup.add(createWreckage());
    this.colliders.push({ x: 0, z: 3, radius: 3.7 });

    const station = new THREE.Group();
    station.position.set(33, terrainHeight(33, 27), 27);
    station.name = "weather-station";
    const metal = new THREE.MeshStandardMaterial({ color: 0x8d8b78, roughness: 0.72, metalness: 0.45 });
    const rust = new THREE.MeshStandardMaterial({ color: 0x884529, roughness: 0.92 });
    const hut = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.8, 4.2), metal);
    hut.position.y = 1.4;
    hut.castShadow = true;
    station.add(hut);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.1, 0.12), rust);
    door.position.set(0.9, 1.05, -2.16);
    station.add(door);
    for (const offset of [-1.8, 1.8]) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 7.5, 6), metal);
      mast.position.set(offset, 5.3, 0.8);
      mast.castShadow = true;
      station.add(mast);
    }
    this.colliders.push({ x: 33, z: 27, radius: 3.4 });
    this.worldGroup.add(station);

    const surveyShelter = createSurveyRockShelter();
    surveyShelter.position.set(
      SURVEY_SHELTER_X,
      terrainHeight(SURVEY_SHELTER_X, SURVEY_SHELTER_Z),
      SURVEY_SHELTER_Z,
    );
    surveyShelter.rotation.y = SURVEY_SHELTER_YAW;
    this.worldGroup.add(surveyShelter);
    this.addLocalColliderSegment(-2.18, -1.25, -2.18, 1.72, 0.58);
    this.addLocalColliderSegment(2.18, -1.25, 2.18, 1.72, 0.58);
    this.addLocalColliderSegment(-2.18, 1.72, 2.18, 1.72, 0.58);

    const shelter = createShelter();
    shelter.name = "player-shelter";
    shelter.visible = false;
    shelter.position.set(3.4, terrainHeight(3.4, 2.4), 2.4);
    this.worldGroup.add(shelter);
    const bed = createLeafBed();
    bed.name = "leaf-bed";
    bed.visible = false;
    bed.position.set(3.4, terrainHeight(3.4, 2.4) + 0.08, 2.4);
    this.worldGroup.add(bed);

    const antenna = createAntenna();
    antenna.name = "beacon-antenna";
    antenna.visible = false;
    antenna.position.set(2.2, terrainHeight(2.2, 6.2), 6.2);
    this.signalLight.position.set(0, 5.8, 0);
    antenna.add(this.signalLight);
    this.worldGroup.add(antenna);
  }

  private createRain(): void {
    const count = this.isLowPowerDevice() ? 520 : 1100;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (seeded(i * 12.7) - 0.5) * 30;
      positions[i * 3 + 1] = seeded(i * 27.1) * 15 - 3;
      positions[i * 3 + 2] = (seeded(i * 18.9 + 4) - 0.5) * 30;
    }
    this.rainGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  }

  private createCampfire(): void {
    this.fireGroup.position.set(-1.8, terrainHeight(-1.8, 2.2), 2.2);
    for (const rotation of [-0.65, 0.65]) {
      const log = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.16, 1.65, 7),
        new THREE.MeshStandardMaterial({ color: 0x4e2f20, roughness: 1 }),
      );
      log.rotation.z = Math.PI / 2;
      log.rotation.y = rotation;
      log.position.y = 0.2;
      this.fireGroup.add(log);
    }
    for (let i = 0; i < 3; i += 1) {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.28 - i * 0.055, 0.8 - i * 0.13, 7),
        new THREE.MeshBasicMaterial({ color: i === 0 ? 0xff5b22 : i === 1 ? 0xffa12b : 0xffdf6a, transparent: true, opacity: 0.9 }),
      );
      flame.position.set((i - 1) * 0.12, 0.62 - i * 0.02, (i % 2) * 0.1);
      flame.userData.flame = true;
      this.fireGroup.add(flame);
    }
    this.fireLight.position.set(0, 1.25, 0);
    this.fireGroup.add(this.fireLight);
    this.fireGroup.visible = false;
    this.worldGroup.add(this.fireGroup);
  }

  private createWildlife(): void {
    const birdCount = this.isLowPowerDevice() ? 4 : 7;
    const birdGeometry = new THREE.BufferGeometry();
    const birdPositions = new Float32Array([
      0, 0, 0.18, -0.56, 0.08, 0, -0.08, 0, -0.14,
      0, 0, 0.18, 0.56, 0.08, 0, 0.08, 0, -0.14,
    ]);
    this.birdWingPositions = new THREE.BufferAttribute(birdPositions, 3);
    birdGeometry.setAttribute("position", this.birdWingPositions);
    this.birdMaterial = new THREE.MeshBasicMaterial({
      color: 0x101914,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.birdFlock = new THREE.InstancedMesh(birdGeometry, this.birdMaterial, birdCount);
    this.birdFlock.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.birdFlock.frustumCulled = false;
    this.birdFlock.visible = false;
    this.worldGroup.add(this.birdFlock);

    const clusterCenters = [
      { x: 1, z: 6 },
      { x: 13, z: -12 },
      { x: SURVEY_SHELTER_X + 2, z: SURVEY_SHELTER_Z - 3 },
      { x: 29, z: 24 },
    ];
    const fireflyCount = this.isLowPowerDevice() ? 24 : 48;
    const fireflyPositions = new Float32Array(fireflyCount * 3);
    for (let i = 0; i < fireflyCount; i += 1) {
      const center = clusterCenters[i % clusterCenters.length];
      const radius = 1.3 + seeded(i * 4.7 + 3) * 3.2;
      const angle = seeded(i * 8.3 + 5) * Math.PI * 2;
      const x = center.x + Math.cos(angle) * radius;
      const z = center.z + Math.sin(angle) * radius;
      fireflyPositions[i * 3] = x;
      fireflyPositions[i * 3 + 1] = terrainHeight(x, z) + 0.5 + seeded(i * 6.1 + 1) * 1.75;
      fireflyPositions[i * 3 + 2] = z;
    }
    this.fireflyBasePositions = fireflyPositions.slice();
    const fireflyGeometry = new THREE.BufferGeometry();
    fireflyGeometry.setAttribute("position", new THREE.BufferAttribute(fireflyPositions, 3));
    this.fireflyMaterial = new THREE.PointsMaterial({
      color: 0xd9ff87,
      size: this.isLowPowerDevice() ? 0.105 : 0.125,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.fireflies = new THREE.Points(fireflyGeometry, this.fireflyMaterial);
    this.fireflies.frustumCulled = false;
    this.fireflies.visible = false;
    this.worldGroup.add(this.fireflies);
  }

  private addLocalColliderSegment(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    radius: number,
  ): void {
    const length = Math.hypot(toX - fromX, toZ - fromZ);
    const steps = Math.max(1, Math.ceil(length / (radius * 1.35)));
    const cosine = Math.cos(SURVEY_SHELTER_YAW);
    const sine = Math.sin(SURVEY_SHELTER_YAW);
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      const localX = THREE.MathUtils.lerp(fromX, toX, progress);
      const localZ = THREE.MathUtils.lerp(fromZ, toZ, progress);
      this.colliders.push({
        x: SURVEY_SHELTER_X + localX * cosine + localZ * sine,
        z: SURVEY_SHELTER_Z - localX * sine + localZ * cosine,
        radius,
      });
    }
  }

  private isColliding(x: number, z: number): boolean {
    for (const collider of this.colliders) {
      if (Math.hypot(x - collider.x, z - collider.z) < collider.radius + 0.28) return true;
    }
    for (const view of this.chunkViews.values()) {
      for (const collider of view.colliders) {
        if (Math.hypot(x - collider.x, z - collider.z) < collider.radius + 0.28) return true;
      }
    }
    return false;
  }

  private isSheltered(x: number, z: number): boolean {
    if (this.snapshot.shelterBuilt && Math.hypot(x - 3.4, z - 2.4) < 3.2) return true;
    const shelterOffsetX = x - SURVEY_SHELTER_X;
    const shelterOffsetZ = z - SURVEY_SHELTER_Z;
    const cosine = Math.cos(SURVEY_SHELTER_YAW);
    const sine = Math.sin(SURVEY_SHELTER_YAW);
    const shelterLocalX = shelterOffsetX * cosine - shelterOffsetZ * sine;
    const shelterLocalZ = shelterOffsetX * sine + shelterOffsetZ * cosine;
    if (Math.abs(shelterLocalX) < 1.95 && shelterLocalZ > -1.35 && shelterLocalZ < 1.55) return true;
    if (Math.hypot(x - 33, z - 27) < 5.2) return true;
    return false;
  }

  private isLowPowerDevice(): boolean {
    const nav = navigator as Navigator & { deviceMemory?: number };
    return window.matchMedia("(pointer: coarse)").matches || (nav.deviceMemory ?? 8) <= 4;
  }
}

function terrainHeight(x: number, z: number): number {
  const broad = Math.sin(x * 0.075) * 0.55 + Math.cos(z * 0.068) * 0.62;
  const detail = Math.sin((x + z) * 0.16) * 0.18 + Math.cos((x - z) * 0.11) * 0.22;
  const ridge = Math.max(0, 1 - Math.hypot(x - 39, z + 31) / 26) * 4.4;
  const stationPlateau = Math.max(0, 1 - Math.hypot(x - 33, z - 27) / 12) * 1.3;
  const riverCut = Math.max(0, 1 - riverDistance(x, z) / 4.3) * 2.1;
  return broad + detail + ridge + stationPlateau - riverCut;
}

function riverCenter(x: number): number {
  return -17 + Math.sin(x * 0.09) * 3;
}

function riverDistance(x: number, z: number): number {
  return Math.abs(z - riverCenter(x));
}

function seeded(value: number): number {
  const raw = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return raw - Math.floor(raw);
}

function hash2(x: number, z: number): number {
  return seeded(x * 0.37 + z * 1.73);
}

function isLandmarkClearing(x: number, z: number): boolean {
  return (
    Math.hypot(x, z - 3) < 9 ||
    Math.hypot(x - 33, z - 27) < 7 ||
    Math.hypot(x + 35, z - 31) < 6 ||
    Math.hypot(x - 39, z + 31) < 5
  );
}

function createWildlifeObject(
  speciesId: RenderSnapshot["wildlife"][number]["speciesId"],
): THREE.Object3D {
  const group = new THREE.Group();
  const material = (color: number) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.96 });
  const addMesh = (
    geometry: THREE.BufferGeometry,
    color: number,
    position: readonly [number, number, number],
    scale: readonly [number, number, number] = [1, 1, 1],
  ) => {
    const object = new THREE.Mesh(geometry, material(color));
    object.position.set(...position);
    object.scale.set(...scale);
    object.castShadow = true;
    object.receiveShadow = true;
    group.add(object);
    return object;
  };

  if (speciesId === "reedtail-scuttler") {
    addMesh(new THREE.SphereGeometry(0.36, 7, 5), 0x826747, [0, 0.34, 0], [1.25, 0.72, 0.72]);
    addMesh(new THREE.SphereGeometry(0.22, 7, 5), 0xa1845d, [0, 0.38, -0.42], [0.9, 0.85, 1]);
    const tail = addMesh(new THREE.ConeGeometry(0.08, 0.82, 5), 0x9c7b52, [0, 0.34, 0.57]);
    tail.rotation.x = Math.PI / 2;
  } else if (speciesId === "mossback-grazer") {
    addMesh(new THREE.SphereGeometry(0.72, 8, 6), 0x42543a, [0, 0.82, 0], [1.35, 0.82, 0.82]);
    addMesh(new THREE.SphereGeometry(0.42, 7, 5), 0x526348, [0, 0.82, -0.82], [0.9, 0.78, 1.2]);
    for (const x of [-0.5, 0.5]) {
      for (const z of [-0.42, 0.42]) {
        addMesh(new THREE.CylinderGeometry(0.08, 0.1, 0.78, 5), 0x383b2c, [x, 0.38, z]);
      }
    }
    const moss = addMesh(new THREE.ConeGeometry(0.5, 0.28, 7), 0x65824b, [0.1, 1.38, 0.08], [1.3, 1, 0.9]);
    moss.rotation.z = Math.PI;
  } else {
    addMesh(new THREE.SphereGeometry(0.56, 8, 6), 0x6b4a2f, [0, 0.62, 0], [1.5, 0.62, 0.72]);
    addMesh(new THREE.SphereGeometry(0.34, 7, 5), 0x8b6037, [0, 0.69, -0.67], [0.9, 0.72, 1.15]);
    const tail = addMesh(new THREE.ConeGeometry(0.1, 1.05, 6), 0x5b3928, [0, 0.58, 0.82]);
    tail.rotation.x = Math.PI / 2;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.045, 5, 12),
      new THREE.MeshBasicMaterial({ color: 0xd58a35 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.72, -0.02);
    group.add(ring);
  }
  return group;
}

function createEntityObject(kind: RenderEntityKind): THREE.Object3D {
  const group = new THREE.Group();
  const rough = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.94 });
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const result = new THREE.Mesh(geometry, material);
    result.castShadow = true;
    result.receiveShadow = true;
    return result;
  };
  if (kind === "stick" || kind === "vine") {
    const branch = mesh(new THREE.CylinderGeometry(0.045, 0.07, kind === "vine" ? 1.5 : 1.05, 6), rough(kind === "vine" ? 0x55733b : 0x725039));
    branch.rotation.z = Math.PI / 2.25;
    branch.position.y = 0.18;
    group.add(branch);
  } else if (kind === "stone") {
    const stone = mesh(new THREE.DodecahedronGeometry(0.32, 0), rough(0x74796f));
    stone.scale.set(1.2, 0.65, 0.9);
    stone.position.y = 0.22;
    group.add(stone);
  } else if (["herb", "tobacco", "palm"].includes(kind)) {
    const color = kind === "tobacco" ? 0x6d893f : kind === "palm" ? 0x4f8b43 : 0x79a95b;
    for (let i = 0; i < (kind === "palm" ? 7 : 5); i += 1) {
      const leaf = mesh(new THREE.PlaneGeometry(kind === "palm" ? 0.85 : 0.46, kind === "palm" ? 1.7 : 0.88), new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
      leaf.position.set(Math.sin(i * 2.1) * 0.25, 0.45 + (i % 2) * 0.12, Math.cos(i * 2.1) * 0.25);
      leaf.rotation.set(-0.55, i * 2.1, 0.12);
      group.add(leaf);
    }
  } else if (["coconut", "banana", "nut", "mushroom"].includes(kind)) {
    if (kind === "mushroom") {
      const cap = mesh(new THREE.SphereGeometry(0.18, 8, 5), rough(0xf1b45d));
      cap.scale.y = 0.45;
      cap.position.y = 0.32;
      const stem = mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.26, 6), rough(0xd9d0a5));
      stem.position.y = 0.13;
      group.add(cap, stem);
    } else {
      const colors: Record<string, number> = { coconut: 0x6a4a29, banana: 0xd3bd3f, nut: 0x80532d };
      const fruit = mesh(kind === "banana" ? new THREE.CapsuleGeometry(0.12, 0.42, 4, 8) : new THREE.SphereGeometry(kind === "coconut" ? 0.3 : 0.2, 9, 7), rough(colors[kind]));
      fruit.position.y = kind === "coconut" ? 0.3 : 0.22;
      if (kind === "banana") fruit.rotation.z = 0.85;
      group.add(fruit);
    }
  } else if (kind === "snake") {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.6, 0.12, -0.1),
      new THREE.Vector3(-0.22, 0.12, 0.2),
      new THREE.Vector3(0.18, 0.13, -0.2),
      new THREE.Vector3(0.55, 0.16, 0.08),
    ]);
    const snake = mesh(new THREE.TubeGeometry(curve, 24, 0.07, 6, false), rough(0x53612d));
    group.add(snake);
  } else if (kind === "water") {
    const marker = mesh(new THREE.RingGeometry(0.28, 0.4, 16), new THREE.MeshBasicMaterial({ color: 0x83d7cf, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.1;
    group.add(marker);
  } else if (kind === "cache") {
    const crateMaterial = new THREE.MeshStandardMaterial({
      color: 0x9a7840,
      emissive: 0x1b1205,
      emissiveIntensity: 0.34,
      roughness: 0.88,
    });
    const crate = mesh(new THREE.BoxGeometry(1.14, 0.56, 0.78), crateMaterial);
    crate.position.y = 0.3;
    const lid = mesh(new THREE.BoxGeometry(1.2, 0.12, 0.84), rough(0xb08a4a));
    lid.position.y = 0.62;
    const metal = rough(0x343a34);
    for (const x of [-0.36, 0.36]) {
      const strap = mesh(new THREE.BoxGeometry(0.1, 0.7, 0.82), metal);
      strap.position.set(x, 0.35, 0);
      group.add(strap);
    }
    const surveyMark = mesh(
      new THREE.PlaneGeometry(0.34, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xf0d077, side: THREE.DoubleSide }),
    );
    surveyMark.position.set(0, 0.38, -0.397);
    group.add(crate, lid, surveyMark);
  } else if (kind === "station" || kind === "wreck" || kind === "beacon") {
    const marker = mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshBasicMaterial({ color: kind === "station" ? 0xffcf6d : kind === "wreck" ? 0xf2763d : 0xff4d42 }));
    marker.position.y = 2.3;
    group.add(marker);
  }
  return group;
}

function createSurveyRockShelter(): THREE.Group {
  const group = new THREE.Group();
  group.name = "survey-rock-shelter";
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  const stoneMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x3c4439, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x4a5142, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x303830, roughness: 1 }),
  ];
  let rockIndex = 0;
  const addRock = (
    x: number,
    y: number,
    z: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
    rotation = 0,
  ) => {
    const rock = new THREE.Mesh(rockGeometry, stoneMaterials[rockIndex % stoneMaterials.length]);
    rockIndex += 1;
    rock.position.set(x, y, z);
    rock.scale.set(scaleX, scaleY, scaleZ);
    rock.rotation.set((rockIndex % 2 ? 0.08 : -0.06), rotation, (rockIndex % 3 - 1) * 0.06);
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  };

  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      addRock(side * 2.16, 0.72 + (i % 2) * 0.08, -1.12 + i * 1.36, 0.88, 0.76, 0.98, i * 0.24);
    }
    addRock(side * 2.03, 1.55, -0.3, 0.76, 0.65, 0.9, side * 0.18);
    addRock(side * 2.0, 1.58, 1.05, 0.8, 0.69, 0.88, side * -0.14);
  }

  for (let i = 0; i < 4; i += 1) {
    addRock(-1.58 + i * 1.05, 0.68 + (i % 2) * 0.06, 1.68, 0.68, 0.72, 0.76, i * 0.3);
  }
  for (let i = 0; i < 3; i += 1) {
    addRock(-1.08 + i * 1.08, 1.5, 1.62, 0.72, 0.66, 0.74, -i * 0.22);
  }

  const overhang = new THREE.Mesh(rockGeometry, stoneMaterials[1]);
  overhang.position.set(0, 2.42, 0.18);
  overhang.scale.set(2.72, 0.48, 1.72);
  overhang.rotation.set(-0.04, 0.03, -0.025);
  overhang.castShadow = true;
  overhang.receiveShadow = true;
  group.add(overhang);

  const interior = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 1.9),
    new THREE.MeshBasicMaterial({ color: 0x070b08, side: THREE.DoubleSide }),
  );
  interior.position.set(0, 1.02, 1.59);
  group.add(interior);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(3.65, 3.1),
    new THREE.MeshStandardMaterial({ color: 0x252a20, roughness: 1, side: THREE.DoubleSide }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.035, 0.2);
  floor.receiveShadow = true;
  group.add(floor);

  const moss = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, 0.38),
    new THREE.MeshStandardMaterial({ color: 0x53663a, roughness: 1, side: THREE.DoubleSide }),
  );
  moss.position.set(0, 2.05, -1.34);
  moss.rotation.x = -0.32;
  group.add(moss);
  return group;
}

function createWreckage(): THREE.Group {
  const group = new THREE.Group();
  group.position.set(0, terrainHeight(0, 3), 3);
  group.name = "wreckage";
  const orange = new THREE.MeshStandardMaterial({ color: 0xc9572e, roughness: 0.78, metalness: 0.24 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x252b29, roughness: 0.9, metalness: 0.35 });
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(5.8, 1.15, 1.7), orange);
  fuselage.rotation.z = -0.1;
  fuselage.rotation.y = 0.34;
  fuselage.position.set(0, 0.75, 0);
  fuselage.castShadow = true;
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 1.35), dark);
  cockpit.position.set(-2.55, 1.05, 0.82);
  cockpit.rotation.y = 0.34;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.15, 6.8), orange);
  wing.position.set(0.4, 0.66, 0.1);
  wing.rotation.y = 0.25;
  group.add(fuselage, cockpit, wing);
  return group;
}

function createShelter(): THREE.Group {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x67462f, roughness: 1 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x3f6939, roughness: 1, side: THREE.DoubleSide });
  for (const x of [-1.3, 1.3]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 2.5, 6), wood);
    pole.position.set(x, 1.25, 0);
    pole.castShadow = true;
    group.add(pole);
  }
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.2, 2, 2), leaf);
  roof.position.set(0, 2.15, 0.45);
  roof.rotation.set(-1.08, 0, 0);
  roof.castShadow = true;
  group.add(roof);
  return group;
}

function createLeafBed(): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < 9; i += 1) {
    const leaf = new THREE.Mesh(
      new THREE.PlaneGeometry(0.65, 1.9),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0x587843 : 0x6b874d, roughness: 1, side: THREE.DoubleSide }),
    );
    leaf.rotation.x = -Math.PI / 2;
    leaf.rotation.z = (i - 4) * 0.08;
    leaf.position.set((i - 4) * 0.22, 0.02 + i * 0.002, 0);
    group.add(leaf);
  }
  return group;
}

function createAntenna(): THREE.Group {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x929990, roughness: 0.55, metalness: 0.65 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.11, 5.8, 6), metal);
  mast.position.y = 2.9;
  mast.castShadow = true;
  group.add(mast);
  for (let i = 0; i < 3; i += 1) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.8 - i * 0.3, 5), metal);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = i * Math.PI / 3;
    arm.position.y = 4.7 + i * 0.38;
    group.add(arm);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3d2e }));
  lamp.position.y = 5.85;
  group.add(lamp);
  return group;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}
