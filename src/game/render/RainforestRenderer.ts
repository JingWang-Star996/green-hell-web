import * as THREE from "three";
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

const WORLD_HALF = 54;
const EYE_HEIGHT = 1.68;
const WALK_SPEED = 3.35;
const SPRINT_SPEED = 5.7;
const INTERACT_DISTANCE = 3.2;

const defaultSnapshot: RenderSnapshot = {
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
};

type EntityView = {
  definition: RenderEntity;
  object: THREE.Object3D;
};

type CircleCollider = { x: number; z: number; radius: number };

export class RainforestRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: EngineCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.08, 180);
  private previousFrameTime = performance.now();
  private readonly keys = new Set<string>();
  private readonly entityViews = new Map<string, EntityView>();
  private readonly colliders: CircleCollider[] = [];
  private readonly hazardWarned = new Set<string>();
  private readonly hazardTriggered = new Set<string>();
  private readonly worldGroup = new THREE.Group();
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
  private readonly cleanup: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.isLowPowerDevice(),
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = !this.isLowPowerDevice();
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
    this.snapshot = snapshot;
    this.syncEntities(snapshot.entities);
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
    this.player.set(
      THREE.MathUtils.clamp(x, -WORLD_HALF + 1, WORLD_HALF - 1),
      0,
      THREE.MathUtils.clamp(z, -WORLD_HALF + 1, WORLD_HALF - 1),
    );
    this.lastPlayer.copy(this.player);
    this.yaw = yaw;
    this.camera.position.set(this.player.x, terrainHeight(this.player.x, this.player.z) + EYE_HEIGHT, this.player.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
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
    candidate.x = THREE.MathUtils.clamp(candidate.x, -WORLD_HALF + 1, WORLD_HALF - 1);
    candidate.z = THREE.MathUtils.clamp(candidate.z, -WORLD_HALF + 1, WORLD_HALF - 1);
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
      object.visible = definition.available;
      object.userData.entityId = definition.id;
      this.dynamicGroup.add(object);
      this.entityViews.set(definition.id, { definition, object });
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
    const groundGeometry = new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2, 72, 72);
    groundGeometry.rotateX(-Math.PI / 2);
    const positions = groundGeometry.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    const low = new THREE.Color(0x243d26);
    const high = new THREE.Color(0x436038);
    const mud = new THREE.Color(0x514a31);
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const height = terrainHeight(x, z);
      positions.setY(i, height);
      const river = riverDistance(x, z);
      const color = river < 2.8 ? mud : low.clone().lerp(high, THREE.MathUtils.clamp((height + 1.5) / 7, 0, 1));
      const variation = (hash2(x * 3, z * 3) - 0.5) * 0.09;
      color.offsetHSL(0, 0, variation);
      colors.push(color.r, color.g, color.b);
    }
    groundGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    groundGeometry.computeVertexNormals();
    const ground = new THREE.Mesh(groundGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    ground.receiveShadow = true;
    this.worldGroup.add(ground);

    this.createRiver();
    this.createForest();
    this.createLandmarks();
  }

  private createRiver(): void {
    const waterMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x2f756f,
      roughness: 0.22,
      metalness: 0.05,
      transparent: true,
      opacity: 0.78,
      depthWrite: true,
    });
    for (let x = -52; x <= 52; x += 2) {
      const z = riverCenter(x);
      const segment = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 4.4), waterMaterial);
      segment.rotation.x = -Math.PI / 2;
      segment.position.set(x, terrainHeight(x, z) + 0.18, z);
      segment.rotation.z = -Math.atan(Math.cos(x * 0.09) * 0.27);
      segment.receiveShadow = true;
      this.worldGroup.add(segment);
    }
  }

  private createForest(): void {
    const count = this.isLowPowerDevice() ? 145 : 240;
    const trunkGeometry = new THREE.CylinderGeometry(0.18, 0.31, 4.2, 6);
    const crownGeometry = new THREE.ConeGeometry(1.65, 4.6, 7);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 1 });
    const crownMaterial = new THREE.MeshStandardMaterial({ color: 0x1d4b2c, roughness: 0.98 });
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count);
    const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, count);
    const dummy = new THREE.Object3D();
    let placed = 0;
    let attempt = 0;
    while (placed < count && attempt < count * 12) {
      attempt += 1;
      const x = seeded(attempt * 17.13) * 104 - 52;
      const z = seeded(attempt * 41.77 + 9) * 104 - 52;
      if (riverDistance(x, z) < 3.7 || isLandmarkClearing(x, z)) continue;
      const scale = 0.78 + seeded(attempt * 5.3) * 0.7;
      const y = terrainHeight(x, z);
      dummy.position.set(x, y + 2.1 * scale, z);
      dummy.scale.set(scale, scale, scale);
      dummy.rotation.y = seeded(attempt * 3.2) * Math.PI;
      dummy.updateMatrix();
      trunks.setMatrixAt(placed, dummy.matrix);
      dummy.position.y = y + (5.1 + seeded(attempt * 7) * 0.7) * scale;
      dummy.rotation.y += 0.4;
      dummy.scale.set(scale * (0.85 + seeded(attempt * 13) * 0.35), scale, scale * 0.9);
      dummy.updateMatrix();
      crowns.setMatrixAt(placed, dummy.matrix);
      this.colliders.push({ x, z, radius: 0.34 * scale + 0.25 });
      placed += 1;
    }
    trunks.count = placed;
    crowns.count = placed;
    trunks.castShadow = this.renderer.shadowMap.enabled;
    trunks.receiveShadow = true;
    crowns.castShadow = this.renderer.shadowMap.enabled;
    this.worldGroup.add(trunks, crowns);

    const fernCount = this.isLowPowerDevice() ? 150 : 320;
    const fernGeometry = new THREE.ConeGeometry(0.48, 0.78, 5);
    fernGeometry.translate(0, 0.39, 0);
    const fernMaterial = new THREE.MeshStandardMaterial({ color: 0x356c3a, roughness: 1, side: THREE.DoubleSide });
    const ferns = new THREE.InstancedMesh(fernGeometry, fernMaterial, fernCount);
    for (let i = 0; i < fernCount; i += 1) {
      const x = seeded(i * 19.3 + 4) * 104 - 52;
      const z = seeded(i * 29.7 + 18) * 104 - 52;
      const scale = 0.45 + seeded(i * 7.1) * 0.75;
      dummy.position.set(x, terrainHeight(x, z), z);
      dummy.scale.set(scale, scale, scale);
      dummy.rotation.set(0, seeded(i * 11) * Math.PI * 2, 0);
      dummy.updateMatrix();
      ferns.setMatrixAt(i, dummy.matrix);
    }
    this.worldGroup.add(ferns);
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

    const cave = new THREE.Group();
    cave.position.set(-35, terrainHeight(-35, 31), 31);
    for (let i = 0; i < 9; i += 1) {
      const angle = (i / 9) * Math.PI * 2;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1.6 + seeded(i) * 1.2, 0),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0x42483b : 0x333c34, roughness: 1 }),
      );
      rock.position.set(Math.cos(angle) * 2.4, 1.2 + Math.sin(angle) * 1.1, Math.sin(angle) * 1.6);
      rock.scale.y = 1.3;
      cave.add(rock);
    }
    const opening = new THREE.Mesh(new THREE.CircleGeometry(1.7, 18), new THREE.MeshBasicMaterial({ color: 0x020302 }));
    opening.position.set(0, 1.55, -1.67);
    cave.add(opening);
    this.worldGroup.add(cave);

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

  private isColliding(x: number, z: number): boolean {
    for (const collider of this.colliders) {
      if (Math.hypot(x - collider.x, z - collider.z) < collider.radius + 0.28) return true;
    }
    return false;
  }

  private isSheltered(x: number, z: number): boolean {
    if (this.snapshot.shelterBuilt && Math.hypot(x - 3.4, z - 2.4) < 3.2) return true;
    if (Math.hypot(x + 35, z - 31) < 4.1) return true;
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
    const crate = mesh(new THREE.BoxGeometry(0.9, 0.48, 0.62), rough(0x7a6a42));
    crate.position.y = 0.24;
    const strap = mesh(new THREE.BoxGeometry(0.12, 0.5, 0.65), rough(0x383b34));
    strap.position.y = 0.25;
    group.add(crate, strap);
  } else if (kind === "station" || kind === "wreck" || kind === "beacon") {
    const marker = mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshBasicMaterial({ color: kind === "station" ? 0xffcf6d : kind === "wreck" ? 0xf2763d : 0xff4d42 }));
    marker.position.y = 2.3;
    group.add(marker);
  }
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
