(function () {
  'use strict';

  // Shared metre-scale exterior for both viewers; the shelf dimensions are scenario assumptions.
  window.warehouseCarrierParts = function (spec) {
    if (spec.kind !== 'mobile-rack') spec = window.WarehouseDemoCore.carrierSpec();
    const parts = [], add = (mat, x, y, z, w, h, d, detail = false, role = 'frame') => parts.push({ mat, x, y, z, w, h, d, detail, role });
    const L = spec.lengthM, D = spec.widthM, H = spec.heightM, C = spec.baseClearanceM;
    const post = 0.045, px = L / 2 - 0.04, pz = D / 2 - 0.04;
    for (const x of [-px, px]) for (const z of [-pz, pz]) {
      add('carrierSteel', x, H / 2, z, post, H, post, false, 'leg');
      add('carrierSteel', x, 0.008, z, 0.08, 0.016, 0.08, false, 'foot');
      for (let y = C + 0.08; y < H - 0.04; y += 0.13) add('carrierHole', x, y, z + Math.sign(z) * 0.0235, 0.009, 0.022, 0.002, true);
    }
    // The entire underside is open to .44m; the lifting plate contacts this face.
    for (const z of [-pz, pz]) add('carrierSteel', 0, C + 0.035, z, L - 0.04, 0.07, 0.045, false, 'base-support');
    for (const x of [-px, px]) add('carrierSteel', x, C + 0.035, 0, 0.045, 0.07, D - 0.04, false, 'base-support');
    add('carrierSteel', 0, C + 0.02, 0, 0.92, 0.04, 0.56, false, 'contact-face');
    const firstTop = C + 0.07, pitch = (H - firstTop - 0.28) / Math.max(1, spec.levels - 1);
    for (let level = 0; level < spec.levels; level++) {
      const y = firstTop - 0.012 + level * pitch, sideHeight = Math.min(pitch - 0.055, 0.31, H - y - 0.055);
      add('carrierTray', 0, y, 0, L - 0.035, 0.024, D - 0.035, false, 'shelf-tray');
      for (const z of [-pz, pz]) {
        if (level > 0) add('carrierSteel', 0, y - 0.006, z, L - 0.04, 0.036, 0.027);
        add('carrierHole', 0, y + 0.105, z, L - 0.06, 0.022, 0.019);
        add('carrierLabel', -L * 0.3, y - 0.007, z + Math.sign(z) * 0.015, 0.105, 0.025, 0.002, true);
      }
      for (const x of [-px, px]) {
        add('carrierPanel', x, y + sideHeight / 2 + 0.035, 0, 0.014, sideHeight, D - 0.07);
        add('carrierSteel', x, y + sideHeight + 0.035, 0, 0.024, 0.016, D - 0.04);
      }
      const boxW = (L - 0.16) / 3, boxD = (D - 0.13) / 2;
      for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
        if (level === spec.levels - 1 && row === 1 && col === 2) continue;
        const x = (col - 1) * (boxW + 0.018), z = (row - 0.5) * (boxD + 0.018);
        const h = Math.min(pitch - 0.075, 0.20 + ((level + row + col) % 3) * 0.028), bottom = y + 0.012;
        add((level + row + col) % 3 ? 'load' : 'loadLight', x, bottom + h / 2, z, boxW, h, boxD, false, 'carton');
        add('carrierTape', x, bottom + h + 0.001, z, 0.032, 0.002, boxD + 0.002, true, 'cargo-detail');
        add('carrierTape', x, bottom + h / 2, z + boxD / 2 + 0.001, 0.032, h, 0.002, true, 'cargo-detail');
        add('carrierLabel', x + boxW * 0.22, bottom + h * 0.55, z + boxD / 2 + 0.002, boxW * 0.28, h * 0.37, 0.002, true, 'cargo-detail');
      }
    }
    for (const z of [-pz, pz]) add('carrierSteel', 0, H - 0.015, z, L, 0.03, 0.025);
    return parts;
  };

  // Rendering only: coordinates, routes and operational states belong to the simulation.
  window.createWarehouseScene = function ({ container, onSelect, onInspect }) {
    if (!container) throw new Error('Для 3D-сцены нужен контейнер');
    const T = window.THREE;
    const BG = 0xe7eceb, INK = 0x30474b, TEAL = 0x078c91, WARN = 0xae762e;
    const ownNodes = [], listeners = [], persistent = new Set();
    let disposed = false, lost = false, raf = 0, model = null;
    let root = null, rackGroup = null, robotsGroup = null, routesGroup = null;
    const peopleMeshes = new Map();
    let width = 1, height = 1, W = 1, H = 1, fitSpan = 10, view = 'iso', layer = 'all', slice = null;
    let selected = null, transition = null, robotParts = [], robotCapacity = 0, carrierParts = [], carrierCapacity = 0, carrierSpec = null;
    let quality = 'balanced', followId = null, dirty = true, rendering = false, pendingFrame = null, frameKey = '';
    let lastDrawAt = 0, effectiveDpr = 1, detailGroup = null, architectureGroup = null, queueLabels = [];
    let hasViewport = false, pendingReset = false;
    let cleaning = false, coverageOverlay = null, coverageCanvas = null, coverageContext = null, coverageTexture = null;
    let coveragePending = null, coverageVersion = null, coverageUploadedAt = 0, coverageTimer = 0;
    let brushMesh = null, safetyMesh = null, safetyVisible = true;
    let taskRobotId = null, hovered = null;
    const renderTimes = [], renderStamps = [];
    const stats = { renderCount: 0, renderRequests: 0, drawCalls: 0, triangles: 0, frameTimeMs: 0, instances: 0 };
    const records = new Map(), routes = new Map(), points = new Map(), previous = new Map(), robotLabels = new Map(), sections = new Map(), frameRobots = new Map(), taskEndpoints = new Map(), incidentLabels = new Map(), frameIncidents = new Map(), carrierTransforms = new Map();
    let carrierRecordKey = '';
    let labels = [], pickables = [], modelGeometry = new Set();
    let renderer, scene, camera, controls, composer, normalTarget, normalMaterial, edgePass, fxaa;
    let selectionBox, selectionGeometry, selectionMaterial;
    const clip = T ? new T.Plane(new T.Vector3(0, -1, 0), 10000) : null;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finite = (n, fallback) => Number.isFinite(Number(n)) ? Number(n) : fallback;
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
    const fmt = (n) => numberFormat.format(n);
    const addNode = (node) => { container.appendChild(node); ownNodes.push(node); return node; };
    const listen = (node, event, fn, opts) => {
      node.addEventListener(event, fn, opts);
      listeners.push(() => node.removeEventListener(event, fn, opts));
    };
    const message = addNode(document.createElement('div'));
    Object.assign(message.style, {
      position: 'absolute', left: '16px', right: '16px', bottom: '16px', zIndex: '4',
      padding: '10px 12px', background: '#f3f5f2', color: '#30474b', border: '1px solid #9eaaa9',
      font: '13px/1.45 system-ui,sans-serif', display: 'none', pointerEvents: 'none',
    });
    message.setAttribute('role', 'status');
    function say(text) { message.textContent = text || ''; message.style.display = text ? 'block' : 'none'; }
    const labelsRoot = addNode(document.createElement('div'));
    Object.assign(labelsRoot.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', zIndex: '2' });
    const hoverInfo = addNode(document.createElement('div'));
    hoverInfo.id = 'scene-hover-info'; hoverInfo.hidden = true; hoverInfo.setAttribute('role', 'status');
    Object.assign(hoverInfo.style, { position: 'absolute', zIndex: '5', maxWidth: '265px', background: '#fff', color: '#193237', border: '1px solid #94acab', padding: '12px', pointerEvents: 'none', font: '12px/1.6 Segoe UI, sans-serif', whiteSpace: 'pre-line' });
    const incidentStyle = addNode(document.createElement('style'));
    incidentStyle.textContent = '.warehouse-incident-marker:focus-visible{outline:3px solid #193237;outline-offset:3px}.warehouse-incident-marker:hover{filter:brightness(.94)}.warehouse-incident-marker .incident-diamond{animation:warehouse-incident-alert 1.8s ease-out infinite}@keyframes warehouse-incident-alert{0%,100%{box-shadow:0 0 0 0 var(--incident-glow)}65%{box-shadow:0 0 0 7px transparent}}@media(prefers-reduced-motion:reduce){.warehouse-incident-marker .incident-diamond{animation:none}}';

    function fallback(reason) {
      say(reason);
      return {
        setModel() {}, setFrame() {}, setView() {}, setLayer() {}, setSlice() {}, setQuality() {}, setFollow() {}, selectObject() { return false; }, inspectRobot() { return false; }, focusIncident() { return false; }, focus() {}, reset() {}, resize() {}, render() {},
        getStats() { return { available: false, renderCount: 0, drawCalls: 0, triangles: 0 }; },
        capturePng() { return null; },
        dispose() { ownNodes.forEach((n) => n.remove()); },
      };
    }
    if (!T || !T.OrbitControls) return fallback('3D не загрузилось. Обновите страницу; расчёт и его показатели доступны отдельно.');
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    } catch {
      return fallback('WebGL недоступен. Откройте демо в браузере с аппаратным ускорением; расчёт не зависит от 3D.');
    }
    const canvas = addNode(renderer.domElement);
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none' });
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Типовая 3D-схема склада. Перетаскивание вращает, колесо меняет масштаб. Стрелки перемещают вид, плюс и минус меняют масштаб, Home возвращает общий вид.');
    renderer.setClearColor(BG, 1);
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.info.autoReset = false;
    renderer.localClippingEnabled = true;
    scene = new T.Scene();
    scene.background = new T.Color(BG);
    camera = new T.OrthographicCamera(-10, 10, 10, -10, 0.1, 2000);
    camera.position.set(20, 24, 20);
    camera.layers.enable(1);
    controls = new T.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = true;
    controls.minZoom = 0.4;
    controls.maxZoom = 20;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.target.set(0, 0, 0);
    const hemi = new T.HemisphereLight(0xffffff, 0x899795, 0.6);
    scene.add(hemi);
    const sun = new T.DirectionalLight(0xffffff, 0.55);
    sun.position.set(-30, 70, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 2;
    scene.add(sun);
    scene.add(sun.target);
    const gradient = new T.DataTexture(new Uint8Array([90, 175, 245]), 3, 1, T.LuminanceFormat);
    gradient.minFilter = gradient.magFilter = T.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
    persistent.add(gradient);
    function toon(color, extra) {
      const mat = new T.MeshToonMaterial(Object.assign({ color: new T.Color(color).convertSRGBToLinear(), gradientMap: gradient, clippingPlanes: [], clipShadows: true }, extra));
      persistent.add(mat);
      return mat;
    }
    const mats = {
      floor: toon(0xd5dcd8), rack: toon(0x718b8e), shelf: toon(0xa7b8b7), wall: toon(0xc8cfca), wallBase: toon(0x8b9b96),
      robot: toon(TEAL), dark: toon(0x30474b), tire: toon(0x263234), pallet: toon(0xb6a081),
      load: toon(0xc7b798), loadLight: toon(0xd0c8b7), point: toon(0x91afac), busy: toon(WARN), charger: toon(0x526e71), marking: toon(0xede7d4),
      lift: toon(0x58676a), led: toon(0x36d1cc, { emissive: new T.Color(0x083733) }), dockLight: toon(0xb7d9ce, { emissive: new T.Color(0x25453b) }),
      cleaner: toon(0xe0e7e5), cleanerAccent: toon(TEAL), screen: toon(0x1f3439), brush: toon(0x36575a), emergency: toon(0xb7493e),
      ronavi: toon(0xe5ce27), carrierSteel: toon(0x697a7d), carrierPanel: toon(0xb9c3c3), carrierTray: toon(0x8a989a),
      carrierHole: toon(0x303b3d), carrierTape: toon(0xc8b888), carrierLabel: toon(0xe7e6dc),
    };
    const boxGeo = new T.BoxGeometry(1, 1, 1), wheelGeo = new T.CylinderGeometry(0.115, 0.115, 0.08, 12);
    wheelGeo.rotateX(Math.PI / 2);
    persistent.add(boxGeo); persistent.add(wheelGeo);
    const brushGeo = new T.CylinderGeometry(0.17, 0.2, 0.028, 12); persistent.add(brushGeo);
    const bodyShape = new T.Shape(), r = 0.12;
    bodyShape.moveTo(-0.5 + r, -0.5); bodyShape.lineTo(0.5 - r, -0.5); bodyShape.quadraticCurveTo(0.5, -0.5, 0.5, -0.5 + r);
    bodyShape.lineTo(0.5, 0.5 - r); bodyShape.quadraticCurveTo(0.5, 0.5, 0.5 - r, 0.5);
    bodyShape.lineTo(-0.5 + r, 0.5); bodyShape.quadraticCurveTo(-0.5, 0.5, -0.5, 0.5 - r);
    bodyShape.lineTo(-0.5, -0.5 + r); bodyShape.quadraticCurveTo(-0.5, -0.5, -0.5 + r, -0.5);
    const bodyGeo = new T.ExtrudeGeometry(bodyShape, { depth: 1, bevelEnabled: false, curveSegments: 3 });
    bodyGeo.rotateX(-Math.PI / 2); bodyGeo.translate(0, -0.5, 0); persistent.add(bodyGeo);
    // One shared hard-surface shell: rounded plan, bevelled edges and a tapered top.
    // This is a visual prototype, not manufacturer CAD or a new physical footprint.
    const cleanerShellGeo = new T.ExtrudeGeometry(bodyShape, { depth: 0.9, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2, curveSegments: 4 });
    cleanerShellGeo.rotateX(-Math.PI / 2); cleanerShellGeo.computeBoundingBox();
    const shellSize = cleanerShellGeo.boundingBox.getSize(new T.Vector3()), shellCentre = cleanerShellGeo.boundingBox.getCenter(new T.Vector3());
    const shellPositions = cleanerShellGeo.attributes.position;
    for (let i = 0; i < shellPositions.count; i++) {
      const x = (shellPositions.getX(i) - shellCentre.x) / shellSize.x, y = (shellPositions.getY(i) - shellCentre.y) / shellSize.y, z = (shellPositions.getZ(i) - shellCentre.z) / shellSize.z;
      const t = y + 0.5; shellPositions.setXYZ(i, x * (1 - t * 0.15) - t * 0.04, y, z * (1 - t * 0.1));
    }
    cleanerShellGeo.computeVertexNormals(); cleanerShellGeo.computeBoundingBox(); cleanerShellGeo.computeBoundingSphere(); persistent.add(cleanerShellGeo);
    const windowGeo = new T.BoxGeometry(1, 1, 1); windowGeo.rotateZ(0.14); persistent.add(windowGeo);
    const lineMat = new T.LineBasicMaterial({ color: new T.Color(INK).convertSRGBToLinear(), transparent: true, opacity: 0.24 });
    const routeMat = new T.LineBasicMaterial({ color: new T.Color(TEAL).convertSRGBToLinear(), transparent: true, opacity: 0.85 });
    const chargeRouteMat = new T.LineBasicMaterial({ color: new T.Color(WARN).convertSRGBToLinear(), transparent: true, opacity: 0.9 });
    persistent.add(lineMat); persistent.add(routeMat); persistent.add(chargeRouteMat);
    selectionMaterial = new T.LineBasicMaterial({ color: TEAL, depthTest: false, transparent: true, opacity: 0.95 });
    persistent.add(selectionMaterial);
    selectionGeometry = new T.EdgesGeometry(boxGeo);
    persistent.add(selectionGeometry);
    selectionBox = new T.LineSegments(selectionGeometry, selectionMaterial);
    selectionBox.layers.set(1);
    selectionBox.renderOrder = 10;
    selectionBox.visible = false;
    scene.add(selectionBox);
    let selectedRouteGeometry = new T.BufferGeometry(), selectedRouteCapacity = 0;
    const selectedRouteMaterial = new T.MeshBasicMaterial({ color: TEAL, side: T.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false });
    const selectedRoute = new T.Mesh(selectedRouteGeometry, selectedRouteMaterial);
    selectedRoute.layers.set(1); selectedRoute.frustumCulled = false; selectedRoute.visible = false; selectedRoute.renderOrder = 4;
    scene.add(selectedRoute); persistent.add(selectedRouteGeometry); persistent.add(selectedRouteMaterial);
    const haloGeometry = new T.RingGeometry(0.85, 1.05, 24), haloMaterial = new T.MeshBasicMaterial({ color: TEAL, side: T.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false });
    const halo = new T.Mesh(haloGeometry, haloMaterial); halo.rotation.x = -Math.PI / 2; halo.layers.set(1); halo.visible = false;
    scene.add(halo); persistent.add(haloGeometry); persistent.add(haloMaterial);
    const swathMaterial = new T.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0.3, depthWrite: false }); persistent.add(swathMaterial);

    function initFX() {
      if (!T.EffectComposer || !T.RenderPass || !T.ShaderPass || !T.FXAAShader) return;
      if (!renderer.capabilities.isWebGL2 && !renderer.extensions.get('WEBGL_depth_texture')) return;
      normalMaterial = new T.MeshNormalMaterial();
      normalTarget = new T.WebGLRenderTarget(1, 1, {
        minFilter: T.NearestFilter, magFilter: T.NearestFilter,
        depthTexture: new T.DepthTexture(1, 1, T.UnsignedIntType),
      });
      const shader = {
        uniforms: {
          tDiffuse: { value: null }, tNormal: { value: normalTarget.texture }, tDepth: { value: normalTarget.depthTexture },
          resolution: { value: new T.Vector2(1, 1) }, near: { value: camera.near }, far: { value: camera.far }, ink: { value: new T.Color(INK) },
        },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: 'uniform sampler2D tDiffuse,tNormal,tDepth;uniform vec2 resolution;uniform float near,far;uniform vec3 ink;varying vec2 vUv;float D(vec2 p){return near+texture2D(tDepth,p).r*(far-near);}vec3 N(vec2 p){return normalize(texture2D(tNormal,p).rgb*2.-1.);}void main(){vec2 x=vec2(1./resolution.x,0.),y=vec2(0.,1./resolution.y);float d=D(vUv);float lap=abs(D(vUv-x)+D(vUv+x)-2.*d)+abs(D(vUv-y)+D(vUv+y)-2.*d);vec3 n=N(vUv);float m=min(min(dot(n,N(vUv-x)),dot(n,N(vUv+x))),min(dot(n,N(vUv-y)),dot(n,N(vUv+y))));float edge=max(smoothstep(.12,.35,lap),1.-smoothstep(.60,.82,m));vec4 c=texture2D(tDiffuse,vUv);gl_FragColor=vec4(mix(c.rgb,ink,edge*.30),c.a);}',
      };
      composer = new T.EffectComposer(renderer);
      composer.addPass(new T.RenderPass(scene, camera));
      edgePass = new T.ShaderPass(shader);
      composer.addPass(edgePass);
      fxaa = new T.ShaderPass(T.FXAAShader);
      composer.addPass(fxaa);
    }
    // Contours are an explicit high-quality mode, never a mandatory multi-pass cost.
    function disposeFX() {
      if (composer) {
        composer.passes.forEach((pass) => {
          if (pass.material) pass.material.dispose();
          if (pass.fsQuad && pass.fsQuad.dispose) pass.fsQuad.dispose();
        });
        composer.renderTarget1.dispose(); composer.renderTarget2.dispose();
      }
      if (normalTarget) normalTarget.dispose();
      if (normalMaterial) normalMaterial.dispose();
      composer = normalTarget = normalMaterial = edgePass = fxaa = null;
    }

    function ownGeometry(geometry) { modelGeometry.add(geometry); return geometry; }
    function record(id, name, kind, center, size, details) {
      const rec = { id, name, kind, source: 'assumption', center, size, details: Object.assign({ Основание: 'Условная геометрия типового склада; не чертёж объекта' }, details) };
      records.set(id, rec);
      return rec;
    }
    function publicRecord(rec) { return { id: rec.id, name: rec.name, kind: rec.kind, source: rec.source, details: rec.details }; }
    function label(rec, text, y, category) {
      const el = document.createElement('button');
      el.type = 'button'; el.textContent = text;
      Object.assign(el.style, {
        position: 'absolute', left: '0', top: '0', transform: 'translate(-50%,-50%)', border: '0', borderRadius: '3px',
        color: '#30474b', background: '#e7ecebe8', padding: '3px 6px', font: '500 11px/1.25 system-ui,sans-serif',
        whiteSpace: 'nowrap', cursor: 'pointer', pointerEvents: 'auto', minHeight: '0', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis',
      });
      el.addEventListener('click', () => { if (category === 'robot') { selectObject(rec.id); onInspect?.(rec.id); } else if (category === 'incident') selectObject(rec.id); else focus(rec.id); });
      if (category === 'section' || category === 'zone' || category === 'incident') {
        el.addEventListener('pointerenter', e => showHover(rec, e));
        if (category === 'incident') {
          el.addEventListener('focus', () => { const rect = el.getBoundingClientRect(); showHover(rec, { clientX: rect.left, clientY: rect.bottom }); });
          el.addEventListener('blur', () => { hovered = null; hoverInfo.hidden = true; updateSelection(); invalidate(); });
        }
        el.addEventListener('pointerleave', () => { hovered = null; hoverInfo.hidden = true; updateSelection(); invalidate(); });
      }
      labelsRoot.appendChild(el);
      const item = { rec, el, y, category, sx: 0, sy: 0, visible: false };
      labels.push(item);
      return item;
    }
    function mesh(geometry, material, group, rec) {
      const obj = new T.Mesh(geometry, material);
      obj.castShadow = obj.receiveShadow = true;
      group.add(obj);
      if (rec) { obj.userData.record = rec; pickables.push(obj); }
      return obj;
    }
    const dummy = new T.Object3D();
    function batch(transforms, material, group) {
      if (!transforms.length) return null;
      const obj = new T.InstancedMesh(boxGeo, material, transforms.length);
      transforms.forEach((tr, i) => {
        dummy.position.set(tr.x, tr.y, tr.z); dummy.scale.set(tr.w, tr.h, tr.d); dummy.rotation.set(0, tr.yaw || 0, 0); dummy.updateMatrix();
        obj.setMatrixAt(i, dummy.matrix);
      });
      obj.castShadow = group !== routesGroup; obj.receiveShadow = true;
      obj.userData.records = transforms.map((tr) => tr.rec);
      group.add(obj); pickables.push(obj);
      stats.instances += transforms.length;
      return obj;
    }
    function floorLines() {
      const verts = [];
      const step = Math.max(5, Math.ceil(Math.max(W, H) / 100) * 5);
      const footprint = model.layout.footprint || [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
      const inside = (x, y) => {
        let hit = false;
        for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
          const a = footprint[i], b = footprint[j];
          if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) hit = !hit;
        }
        return hit;
      };
      for (let x = step; x < W; x += step) for (let z = 0; z < H; z += step) if (inside(x, z + step / 2)) verts.push(x, 0.045, z, x, 0.045, Math.min(H, z + step));
      for (let z = step; z < H; z += step) for (let x = 0; x < W; x += step) if (inside(x + step / 2, z)) verts.push(x, 0.045, z, Math.min(W, x + step), 0.045, z);
      footprint.forEach((a, i) => { const b = footprint[(i + 1) % footprint.length]; verts.push(a.x, 0.05, a.y, b.x, 0.05, b.y); });
      const geo = ownGeometry(new T.BufferGeometry());
      geo.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
      const lines = new T.LineSegments(geo, lineMat); lines.layers.set(1); root.add(lines);
      const scale = record('scale', 'Масштаб', 'scale', new T.Vector3(W / 2, 0, -2), new T.Vector3(0, 0, 0), { 'Сетка': fmt(step) + ' м', 'Размер поля': fmt(W) + ' × ' + fmt(H) + ' м' });
      label(scale, fmt(W) + ' × ' + fmt(H) + ' м · сетка ' + fmt(step) + ' м', 0.1, 'scale');
    }
    function buildArchitecture(layout) {
      const walls = [], bases = [], frames = [], doorLights = [], markings = [];
      const wh = finite(layout.wallHeightM, 4.5);
      (layout.walls || []).forEach((r, i) => {
        const h = finite(r.heightM, wh), d = finite(r.h, 0), w = finite(r.w, 0);
        if (!(w > 0 && d > 0)) return;
        const rec = record('wall:' + (r.id || i), 'Стена ' + (i + 1), 'wall', new T.Vector3(r.x + w / 2, h / 2, r.y + d / 2), new T.Vector3(w, h, d), {
          Геометрия: 'Граница модельного маршрута', Высота: fmt(h) + ' м — допущение визуализации', Размер: fmt(w) + ' × ' + fmt(d) + ' м',
        });
        walls.push({ x: rec.center.x, y: h / 2, z: rec.center.z, w, h, d, rec });
        bases.push({ x: rec.center.x, y: 0.32, z: rec.center.z, w: w + 0.03, h: 0.64, d: d + 0.03, rec });
      });
      (layout.columns || []).forEach((r, i) => {
        const w = finite(r.w, 0.5), d = finite(r.h, 0.5), h = finite(r.heightM, wh);
        const rec = record('column:' + (r.id || i), 'Колонна ' + (i + 1), 'column', new T.Vector3(r.x + w / 2, h / 2, r.y + d / 2), new T.Vector3(w, h, d), { Основание: 'Колонна модельной планировки; геометрия участвует в построении маршрутов' });
        walls.push({ x: rec.center.x, y: h / 2, z: rec.center.z, w, h, d, rec });
        bases.push({ x: rec.center.x, y: 0.28, z: rec.center.z, w: w + 0.12, h: 0.56, d: d + 0.12, rec });
      });
      (layout.doors || []).forEach((d, i) => {
        const horizontal = d.w >= d.h, length = Math.max(d.w, d.h), thickness = Math.max(0.18, Math.min(d.w, d.h));
        const dh = Math.min(wh - 0.3, finite(d.clearHeightM, 3.4));
        const cx = d.x + d.w / 2, cz = d.y + d.h / 2;
        const rec = record('door:' + (d.id || i), d.label || 'Проём ' + (i + 1), 'door', new T.Vector3(cx, dh / 2, cz), new T.Vector3(d.w, dh, d.h), {
          Проход: fmt(length) + ' м', Высота: fmt(dh) + ' м — допущение визуализации', Основание: 'Проём задан планировкой, маршрут проходит через реальный разрыв стены',
        });
        for (const sign of [-1, 1]) frames.push({ x: cx + (horizontal ? sign * length / 2 : 0), y: dh / 2, z: cz + (horizontal ? 0 : sign * length / 2), w: horizontal ? 0.15 : thickness, h: dh, d: horizontal ? thickness : 0.15, rec });
        frames.push({ x: cx, y: (dh + wh) / 2, z: cz, w: horizontal ? length : thickness, h: Math.max(0.2, wh - dh), d: horizontal ? thickness : length, rec });
        doorLights.push({ x: cx, y: dh - 0.12, z: cz, w: horizontal ? Math.min(1.2, length * 0.3) : 0.08, h: 0.07, d: horizontal ? 0.08 : Math.min(1.2, length * 0.3), rec });
        markings.push({ x: cx, y: 0.065, z: cz, w: horizontal ? length : 0.15, h: 0.025, d: horizontal ? 0.15 : length, rec });
        label(rec, rec.name, dh + 0.35, 'door');
      });
      batch(walls, mats.wall, architectureGroup); batch(bases, mats.wallBase, architectureGroup);
      batch(frames, mats.dark, architectureGroup); batch(doorLights, mats.dockLight, architectureGroup);
      const fixedObstacles = [];
      (layout.obstacles || []).filter(o => o.kind !== 'packing-table').forEach((r, i) => {
        const w = finite(r.w, 0), d = finite(r.h, 0), h = finite(r.heightM, carrierSpec.heightM);
        if (!(w > 0 && d > 0 && h > 0)) return;
        const rec = record('obstacle:' + (r.id || i), r.label || 'Неподвижное препятствие ' + (i + 1), 'obstacle', new T.Vector3(r.x + w / 2, h / 2, r.y + d / 2), new T.Vector3(w, h, d), {
          Основание: 'Неподвижное препятствие из входной планировки; его точный напольный габарит участвует в маршрутизации',
          Размер: fmt(w) + ' × ' + fmt(d) + ' м', Высота: fmt(h) + ' м' + (Number.isFinite(r.heightM) ? '' : ' — допущение отображения'),
        });
        fixedObstacles.push({ x: rec.center.x, y: h / 2, z: rec.center.z, w, h, d, rec });
      });
      const fixedMesh = batch(fixedObstacles, mats.rack, architectureGroup); if (fixedMesh) fixedMesh.userData.componentRole = 'fixed-obstacle';
      const worktops = [], legs = [], parcels = [];
      (layout.obstacles || []).filter((o) => o.kind === 'packing-table').forEach((r, i) => {
        const h = finite(r.heightM, 0.9), w = finite(r.w, 1), d = finite(r.h, 1);
        const rec = record('packing:' + (r.id || i), 'Упаковочный пост ' + (i + 1), 'packing', new T.Vector3(r.x + w / 2, h / 2, r.y + d / 2), new T.Vector3(w, h, d), {
          Основание: 'Пост задан препятствием модельной планировки; маршрут обходит его', Размер: fmt(w) + ' × ' + fmt(d) + ' м',
          Оборудование: 'Стол и тара условные; упаковочная операция отдельно не рассчитывается',
        });
        worktops.push({ x: rec.center.x, y: h, z: rec.center.z, w, h: 0.12, d, rec });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) legs.push({ x: rec.center.x + sx * Math.max(0, w / 2 - 0.13), y: h / 2, z: rec.center.z + sz * Math.max(0, d / 2 - 0.13), w: 0.09, h, d: 0.09, rec });
        parcels.push({ x: rec.center.x, y: h + 0.3, z: rec.center.z, w: Math.min(0.7, w * 0.6), h: 0.45, d: Math.min(0.55, d * 0.6), rec });
      });
      batch(worktops, mats.shelf, architectureGroup); batch(legs, mats.dark, architectureGroup); batch(parcels, mats.loadLight, detailGroup);
      const graph = layout.routingGraph;
      if (graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges)) {
        const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
        graph.edges.forEach((edge) => {
          const a = nodes.get(edge.from), b = nodes.get(edge.to); if (!a || !b) return;
          const length = Math.hypot(b.x - a.x, b.y - a.y), count = Math.floor(length / 5);
          const yaw = -Math.atan2(b.y - a.y, b.x - a.x);
          for (let i = 1; i <= count; i++) {
            const t = i / (count + 1);
            markings.push({ x: a.x + (b.x - a.x) * t, y: 0.07, z: a.y + (b.y - a.y) * t, w: Math.min(1.4, length / 3), h: 0.018, d: 0.1, yaw });
          }
        });
      }
      batch(markings, mats.marking, root);
      const stagingLines = [];
      (layout.staging || []).forEach((s, i) => {
        const rec = record('waiting:' + (s.id || i), (s.label || 'Зона ожидания') + ' · модель', 'waiting', new T.Vector3(s.x + s.w / 2, 0.07, s.y + s.h / 2), new T.Vector3(s.w, 0.1, s.h), {
          Основание: 'Модельная зона ожидания. Позиции и очереди не являются системой управления трафиком',
        });
        const inset = 0.2;
        const w = Math.max(0.1, s.w - inset * 2), d = Math.max(0.1, s.h - inset * 2);
        stagingLines.push({ x: rec.center.x, y: 0.07, z: s.y + inset, w, h: 0.02, d: 0.1, rec }, { x: rec.center.x, y: 0.07, z: s.y + s.h - inset, w, h: 0.02, d: 0.1, rec }, { x: s.x + inset, y: 0.07, z: rec.center.z, w: 0.1, h: 0.02, d, rec }, { x: s.x + s.w - inset, y: 0.07, z: rec.center.z, w: 0.1, h: 0.02, d, rec });
        const item = label(rec, rec.name, 0.2, 'waiting');
        queueLabels.push({ item, pointIds: s.pointIds || (s.pointId ? [s.pointId] : []), base: rec.name });
      });
      batch(stagingLines, mats.pallet, root);
    }
    function buildSections(list) {
      list.forEach((section, index) => {
        const polygon = pathPoints(section.polygon);
        if (polygon.length < 3) return;
        const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        const id = String(section.id), workId = 'S' + String(index + 1).padStart(2, '0');
        const rec = record('section:' + id, section.label || section.name || workId, 'section', new T.Vector3((minX + maxX) / 2, 0.08, (minY + maxY) / 2), new T.Vector3(maxX - minX, 0.05, maxY - minY), {
          Задание: workId, Основание: 'Секция модельной уборки; границы и препятствия заданы планом',
          Площадь: Number.isFinite(section.targetM2) ? fmt(section.targetM2) + ' м²' : 'Нет данных',
          Убрано: 'Нет кадра покрытия', Роботы: 'Нет данных кадра',
        });
        const shape = new T.Shape();
        polygon.forEach((p, i) => { if (i) shape.lineTo(p.x, -p.y); else shape.moveTo(p.x, -p.y); }); shape.closePath();
        const geo = ownGeometry(new T.ShapeGeometry(shape)); geo.rotateX(-Math.PI / 2);
        const material = new T.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0.035, side: T.DoubleSide, depthWrite: false }); modelGeometry.add(material);
        const area = mesh(geo, material, root, rec); area.position.y = 0.065; area.layers.set(1); area.castShadow = area.receiveShadow = false;
        const edgeGeometry = ownGeometry(new T.BufferGeometry().setFromPoints(polygon.map((p) => new T.Vector3(p.x, 0.105, p.y))));
        const edgeMaterial = new T.LineBasicMaterial({ color: TEAL, transparent: true, opacity: 0.75 }); modelGeometry.add(edgeMaterial);
        const edge = new T.LineLoop(edgeGeometry, edgeMaterial); edge.layers.set(1); root.add(edge);
        const item = label(rec, workId + ' · ' + rec.name + ' · 0%', 0.3, 'section');
        Object.assign(item.el.style, { whiteSpace: 'pre-line', textAlign: 'left', lineHeight: '1.35', maxWidth: '230px', border: '1px solid #9fb7b3', background: '#f0f5f1e8' });
        sections.set(id, { rec, item, edge, area, workId, assigned: section.assignedRobotIds || [] });
      });
    }
    function buildTaskEndpoints() {
      for (const side of ['from', 'to']) {
        const pickup = side === 'from';
        const rec = record('task:' + side, pickup ? 'Погрузка' : 'Выгрузка', 'task-endpoint', new T.Vector3(), new T.Vector3(1.9, 0.12, 1.9), {});
        const material = new T.MeshBasicMaterial({ color: pickup ? WARN : TEAL, transparent: true, opacity: 0.2, depthWrite: false }); modelGeometry.add(material);
        const group = new T.Group(); root.add(group);
        const pad = mesh(boxGeo, material, group, rec); pad.scale.set(1.9, 0.025, 1.9); pad.layers.set(1); pad.castShadow = pad.receiveShadow = false;
        const item = label(rec, '', 0.45, 'task');
        Object.assign(item.el.style, { color: pickup ? '#765016' : '#086c72', background: '#f3f6edee', border: '1px solid ' + (pickup ? '#ae762e' : '#078c91'), padding: '4px 7px', maxWidth: '230px' });
        group.visible = false; item.disabled = true;
        pad.visible = false; taskEndpoints.set(side, { rec, group, pad, item });
      }
    }
    function updateTaskEndpoints() {
      if (cleaning || !root) return;
      const robot = frameRobots.get(taskRobotId), task = robot?.task;
      taskEndpoints.forEach((entry, side) => {
        const point = task && task[side], show = layer !== 'infrastructure' && point && Number.isFinite(point.x) && Number.isFinite(point.y);
        entry.group.visible = entry.pad.visible = !!show; entry.item.disabled = !show;
        if (!show) return;
        const id = 'task:' + task.id + ':' + side;
        if (entry.rec.id !== id) { records.delete(entry.rec.id); entry.rec.id = id; records.set(id, entry.rec); }
        entry.rec.robotId = String(robot.id); entry.rec.center.set(point.x, 0.1, point.y); entry.group.position.set(point.x, 0.1, point.y);
        const pickup = side === 'from', active = pickup ? ['toPickup', 'loading'].includes(robot.phase) || robot.phase === 'waitPoint' && !robot.loaded : ['toDrop', 'unloading'].includes(robot.phase) || robot.phase === 'waitPoint' && robot.loaded;
        const text = (pickup ? 'A · Погрузка' : 'B · Выгрузка') + ' #' + task.id + (active ? ' ← текущий этап' : '');
        if (entry.item.el.textContent !== text) entry.item.el.textContent = text;
        entry.rec.name = (pickup ? 'Погрузка' : 'Выгрузка') + ' · задание #' + task.id;
        entry.rec.details = { Задание: '#' + task.id, Робот: 'AMR-' + String(Number(robot.id) + 1).padStart(2, '0'), Операция: pickup ? 'Погрузка' : 'Выгрузка', Положение: fmt(point.x) + '; ' + fmt(point.y) + ' м', Носитель: carrierSpec.label, Основание: 'Конец задания из имитации; путь показан отдельно по проходам', Геометрия: carrierSpec.sourceNote };
      });
    }
    function updateSections(list) {
      (list || []).forEach((s) => {
        const item = sections.get(String(s.id)); if (!item) return;
        const progress = Number.isFinite(s.progress) ? clamp(s.progress, 0, 100) : null;
        const assigned = s.assignedRobotIds || (s.robotId !== null && s.robotId !== undefined ? [s.robotId] : item.assigned);
        const robots = assigned.length ? assigned.map((id) => 'CL-' + String(Number(id) + 1).padStart(2, '0')).join(', ') : 'не назначен';
        const title = item.workId + ' · ' + item.rec.name + '\n' + (progress === null ? 'нет данных' : fmt(progress) + '% убрано') + ' · ' + robots;
        if (item.item.el.textContent !== title) item.item.el.textContent = title;
        item.rec.details.Убрано = Number.isFinite(s.cleanedAreaM2 ?? s.cleanedM2) ? fmt(s.cleanedAreaM2 ?? s.cleanedM2) + ' м²' : 'Нет данных';
        item.rec.details.Площадь = Number.isFinite(s.targetM2) ? fmt(s.targetM2) + ' м² доступного пола' : item.rec.details.Площадь;
        item.rec.details.Прогресс = progress === null ? 'Нет данных' : fmt(progress) + '%';
        item.rec.details.Роботы = robots; item.rec.details.Состояние = s.status || 'Нет данных';
      });
    }
    function queueCoverage(next) {
      if (!next || next.version === coverageVersion && !coveragePending) return;
      coveragePending = next;
    }
    function updateCoverage() {
      if (!coveragePending || !root) return;
      const elapsed = performance.now() - coverageUploadedAt;
      if (coverageVersion !== null && elapsed < 250) {
        if (!coverageTimer) coverageTimer = setTimeout(() => { coverageTimer = 0; invalidate(); }, 250 - elapsed);
        return;
      }
      const c = coveragePending, cols = Math.floor(c.width), rows = Math.floor(c.height), cell = Number(c.cellSizeM);
      if (!(cols > 0 && rows > 0 && cols * rows <= 1000000 && cell > 0) || !c.freeMask || !c.covered) { coveragePending = null; return; }
      if (!coverageCanvas || coverageCanvas.width !== cols || coverageCanvas.height !== rows) {
        if (coverageOverlay) { root.remove(coverageOverlay); coverageOverlay.geometry.dispose(); coverageOverlay.material.dispose(); coverageTexture.dispose(); }
        coverageCanvas = document.createElement('canvas'); coverageCanvas.width = cols; coverageCanvas.height = rows;
        coverageContext = coverageCanvas.getContext('2d'); if (!coverageContext) { coveragePending = null; return; }
        coverageTexture = new T.CanvasTexture(coverageCanvas); coverageTexture.minFilter = coverageTexture.magFilter = T.NearestFilter; coverageTexture.generateMipmaps = false;
        coverageTexture.encoding = T.sRGBEncoding;
        const geometry = new T.PlaneGeometry(cols * cell, rows * cell); geometry.rotateX(-Math.PI / 2);
        const material = new T.MeshBasicMaterial({ map: coverageTexture, transparent: true, depthWrite: false, side: T.DoubleSide });
        coverageOverlay = new T.Mesh(geometry, material); coverageOverlay.layers.set(1); coverageOverlay.renderOrder = 2;
        coverageOverlay.visible = layer !== 'infrastructure';
        root.add(coverageOverlay);
      }
      coverageOverlay.position.set(finite(c.originX, 0) + cols * cell / 2, 0.085, finite(c.originY, 0) + rows * cell / 2);
      const image = coverageContext.createImageData(cols, rows), pixels = image.data; let covered = 0;
      for (let i = 0; i < cols * rows; i++) {
        if (!c.freeMask[i]) continue;
        const done = c.covered[i] > 0, hatch = (i % cols + Math.floor(i / cols)) % 4 === 0;
        pixels[i * 4] = done ? 7 : 114; pixels[i * 4 + 1] = done ? 140 : 141; pixels[i * 4 + 2] = done ? 145 : 136;
        pixels[i * 4 + 3] = done ? hatch ? 185 : 135 : 24;
        if (done) covered++;
      }
      coverageContext.putImageData(image, 0, 0); coverageTexture.needsUpdate = true;
      coverageVersion = c.version; coveragePending = null; coverageUploadedAt = performance.now();
      stats.coverageVersion = coverageVersion; stats.coveredCells = covered; stats.coverageCells = cols * rows;
    }
    function clearModel() {
      clearTimeout(coverageTimer); coverageTimer = 0;
      if (coverageOverlay) { coverageOverlay.geometry.dispose(); coverageOverlay.material.dispose(); coverageTexture.dispose(); }
      coverageOverlay = coverageCanvas = coverageContext = coverageTexture = coveragePending = null; coverageVersion = null; coverageUploadedAt = 0;
      if (root) {
        root.traverse((o) => {
          // r128 has no InstancedMesh.dispose(), but its per-instance attributes need removal.
          if (o.isInstancedMesh && typeof o.dispose === 'function') o.dispose();
        });
        scene.remove(root);
      }
      modelGeometry.forEach((g) => g.dispose()); modelGeometry.clear();
      routes.forEach((r) => r.geometry.dispose()); routes.clear();
      labels.forEach((l) => { l.el.remove(); l.leader?.remove(); }); labels = [];
      records.clear(); points.clear(); previous.clear(); robotLabels.clear(); incidentLabels.clear(); frameIncidents.clear(); sections.clear(); frameRobots.clear(); taskEndpoints.clear(); taskRobotId = null; pickables = []; robotParts = []; robotCapacity = 0; carrierParts = []; carrierCapacity = 0; brushMesh = safetyMesh = null; hovered = null; hoverInfo.hidden = true;
      peopleMeshes.clear(); delete stats.personCount;
      delete stats.coverageVersion; delete stats.coveredCells; delete stats.coverageCells;
      delete stats.carrierCount;
      carrierTransforms.clear(); carrierRecordKey = '';
      queueLabels = []; pendingFrame = null; frameKey = ''; followId = null; stats.instances = 0;
      root = null;
      selected = null; selectionBox.visible = false; selectedRoute.visible = halo.visible = false;
    }
    function setModel(next) {
      if (disposed) return;
      clearModel(); model = next;
      cleaning = next?.kind === 'cleaning';
      carrierSpec = window.WarehouseDemoCore.carrierSpec(next?.input);
      if (carrierSpec.kind !== 'mobile-rack') carrierSpec = window.WarehouseDemoCore.carrierSpec();
      if (!next || !next.layout) { say('Нет планировки для 3D. Укажите данные объекта.'); invalidate(); return; }
      W = finite(next.layout.widthM, 0); H = finite(next.layout.heightM, 0);
      if (!(W > 0 && H > 0)) { say('В планировке отсутствуют корректные размеры в метрах.'); invalidate(); return; }
      root = new T.Group(); root.position.set(-W / 2, 0, -H / 2); scene.add(root);
      rackGroup = new T.Group(); robotsGroup = new T.Group(); routesGroup = new T.Group(); detailGroup = new T.Group(); architectureGroup = new T.Group();
      root.add(rackGroup, robotsGroup, routesGroup, detailGroup, architectureGroup);
      const footprint = next.layout.footprint || [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
      const shape = new T.Shape();
      footprint.forEach((p, i) => { if (i) shape.lineTo(p.x, -p.y); else shape.moveTo(p.x, -p.y); }); shape.closePath();
      const slab = ownGeometry(new T.ExtrudeGeometry(shape, { depth: 0.25, bevelEnabled: false, curveSegments: 1 })); slab.rotateX(-Math.PI / 2);
      const floor = mesh(slab, mats.floor, root); floor.position.y = -0.25;
      const zoneColors = { receiving: 0xc7d4cb, storage: 0xd5ddda, packing: 0xd6ccb9, shipping: 0xbcced0, charging: 0xd8cbb3 };
      const rooms = next.layout.compartments && next.layout.compartments.length ? next.layout.compartments : next.layout.zones || [];
      rooms.forEach((z) => {
        const w = finite(z.w, 0), h = finite(z.h, 0);
        if (!(w > 0 && h > 0)) return;
      const rec = record('zone:' + (z.id || z.kind), z.label || z.kind, 'zone', new T.Vector3(z.x + w / 2, -0.001, z.y + h / 2), new T.Vector3(w, 0.002, h), {
          Площадь: fmt(w * h) + ' м²', Размер: fmt(w) + ' × ' + fmt(h) + ' м', Тип: 'Типовая функциональная зона',
        });
        const material = toon(zoneColors[z.kind] || 0xd5ddda);
        material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1;
        // These small per-model zone materials are released on rebuild as well.
        modelGeometry.add({ dispose() { material.dispose(); persistent.delete(material); } });
        const plane = mesh(boxGeo, material, root, rec);
        rec.floorMaterial = material; rec.floorColor = material.color.clone();
        plane.position.copy(rec.center); plane.scale.set(w, 0.002, h); plane.castShadow = false;
        if (!cleaning) label(rec, rec.name, 0.25, 'zone');
      });
      floorLines();
      buildArchitecture(next.layout);
      if (cleaning) buildSections(next.sections || next.layout.sections || []);
      else buildTaskEndpoints();
      const storageLines = [];
      (next.racks || []).forEach((r, index) => {
        const rw = finite(r.w, 0), rd = finite(r.h, finite(r.d, 0));
        if (!(rw > 0 && rd > 0)) return;
        const x = finite(r.x, 0), z = next.racksYDown ? H - finite(r.y, 0) - rd : finite(r.y, 0);
        const fixed = (next.layout.obstacles || []).some(o => o.kind === 'rack' && Math.abs(o.x - x) < 0.001 && Math.abs(o.y - z) < 0.001 && Math.abs(o.w - rw) < 0.001 && Math.abs(o.h - rd) < 0.001);
        const rec = record('rack:' + index, (fixed ? 'Неподвижная зона хранения ' : 'Зона мобильных стеллажей ') + (index + 1), 'rack', new T.Vector3(x + rw / 2, 0.06, z + rd / 2), new T.Vector3(rw, 0.04, rd), {
          Размер: fmt(rw) + ' × ' + fmt(rd) + ' м',
          Конструкция: fixed ? 'Реальное неподвижное препятствие входной планировки показано отдельным объёмом' : 'Напольная разметка зоны хранения; каждый отдельный стеллаж показан по состоянию модели',
        });
        for (const dz of [0, rd]) storageLines.push({ x: x + rw / 2, y: 0.065, z: z + dz, w: rw, h: 0.012, d: 0.055, rec });
        for (const dx of [0, rw]) storageLines.push({ x: x + dx, y: 0.065, z: z + rd / 2, w: 0.055, h: 0.012, d: rd, rec });
        if (index % 2 === 0) { const item = label(rec, 'S' + String(index + 1).padStart(2, '0'), 0.16, 'rack'); item.minZoom = 2.4; }
      });
      batch(storageLines, mats.marking, rackGroup);
      const basePoints = [...(next.layout.receiving || []), ...(next.layout.shipping || []), ...(next.layout.chargers || [])];
      basePoints.forEach(addPoint);
      fitSpan = Math.max(W, H) * 1.16;
      const shadowSize = Math.max(W, H) * 0.8;
      Object.assign(sun.shadow.camera, { left: -shadowSize, right: shadowSize, top: shadowSize, bottom: -shadowSize, near: 0.1, far: Math.max(300, shadowSize * 5) });
      sun.position.set(-W * 0.35, Math.max(W, H), H * 0.3);
      sun.shadow.camera.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate = true;
      setSlice(slice); applyLayers(); resize(); reset();
      say('');
    }
    function addPoint(p) {
      if (!root || points.has(String(p.id)) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      const charging = p.kind === 'charger' || p.kind === 'charging';
      const name = (charging ? 'Зарядка ' : p.kind === 'shipping' ? 'Отгрузка ' : 'Приёмка ') + p.id;
      const pw = charging ? 1.35 : carrierSpec.lengthM + 0.32, pd = charging ? 1.15 : carrierSpec.widthM + 0.32;
      const rec = record('point:' + p.id, name, 'point', new T.Vector3(p.x, 0.08, p.y), new T.Vector3(pw, 0.08, pd), { Тип: charging ? 'Зарядная точка' : 'Позиция целого мобильного стеллажа', Занятость: 'Нет данных кадра', Очередь: 'Нет данных кадра' });
      const group = new T.Group(); root.add(group);
      const pad = mesh(boxGeo, mats.point, group, rec); pad.position.set(p.x, 0.0005, p.y); pad.scale.set(pw, 0.001, pd); pad.castShadow = false;
      const perimeter = ownGeometry(new T.BufferGeometry().setFromPoints([[-pw / 2, -pd / 2], [pw / 2, -pd / 2], [pw / 2, pd / 2], [-pw / 2, pd / 2]].map(([x, z]) => new T.Vector3(p.x + x, 0.002, p.y + z))));
      const outline = new T.LineLoop(perimeter, lineMat); group.add(outline);
      if (charging) { const cabinet = mesh(boxGeo, mats.charger, group, rec); cabinet.scale.set(0.42, 0.65, 0.18); cabinet.position.set(p.x, 0.325, p.y + pd / 2 + 0.1); cabinet.userData.componentRole = 'charger-cabinet'; }
      const lamp = mesh(boxGeo, mats.charger, group, rec); lamp.scale.set(0.18, 0.001, 0.045); lamp.position.set(p.x + pw / 2 - 0.14, 0.002, p.y + pd / 2 - 0.1); lamp.castShadow = false;
      const entry = { rec, pad, lamp, charging, group, label: label(rec, String(p.id), 0.22, 'point') };
      points.set(String(p.id), entry);
    }
    function ensureRobots(count) {
      if (count <= robotCapacity) return;
      const old = new Set(robotParts.map((p) => p.mesh));
      old.forEach((m) => { robotsGroup.remove(m); if (typeof m.dispose === 'function') m.dispose(); });
      if (brushMesh) { robotsGroup.remove(brushMesh); if (typeof brushMesh.dispose === 'function') brushMesh.dispose(); brushMesh = null; }
      if (safetyMesh) { robotsGroup.remove(safetyMesh); if (typeof safetyMesh.dispose === 'function') safetyMesh.dispose(); safetyMesh = null; }
      pickables = pickables.filter((p) => !old.has(p));
      robotParts = [];
      robotCapacity = Math.min(500, Math.max(count, robotCapacity * 2, 16));
      const safetyGeo = ownGeometry(new T.RingGeometry(.94, 1, 40)); safetyGeo.rotateX(-Math.PI / 2);
      const safetyMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .8, side: T.DoubleSide, depthWrite: false }); modelGeometry.add(safetyMat);
      safetyMesh = new T.InstancedMesh(safetyGeo, safetyMat, robotCapacity); safetyMesh.layers.set(1); safetyMesh.frustumCulled = false; safetyMesh.count = 0; safetyMesh.instanceMatrix.setUsage(T.DynamicDrawUsage); robotsGroup.add(safetyMesh);
      const components = cleaning ? [
        [bodyGeo, mats.dark, 0, 0.09, 0, 0.76, 0.12, 0.64, false],
        [cleanerShellGeo, mats.cleaner, 0, 0.46, 0, 0.68, 0.64, 0.6, false],
        [bodyGeo, mats.screen, -0.02, 0.82, 0, 0.6, 0.09, 0.54, false],
        [bodyGeo, mats.cleanerAccent, 0, 0.205, 0, 0.71, 0.035, 0.625, false],
        [windowGeo, mats.screen, 0.299, 0.625, 0, 0.018, 0.16, 0.4, false],
        [boxGeo, mats.led, 0.31, 0.604, 0, 0.014, 0.012, 0.24, false],
        [wheelGeo, mats.tire, -0.12, 0.115, -0.29, 1, 1, 1, false],
        [wheelGeo, mats.tire, -0.12, 0.115, 0.29, 1, 1, 1, false],
        [wheelGeo, mats.lift, -0.12, 0.115, -0.337, 0.45, 0.45, 0.3, false],
        [wheelGeo, mats.lift, -0.12, 0.115, 0.337, 0.45, 0.45, 0.3, false],
        [brushGeo, mats.brush, 0.25, 0.025, -0.22, 0.85, 1, 0.85, false],
        [brushGeo, mats.brush, 0.25, 0.025, 0.22, 0.85, 1, 0.85, false],
        [brushGeo, mats.lift, 0.25, 0.045, -0.22, 0.25, 0.6, 0.25, false],
        [brushGeo, mats.lift, 0.25, 0.045, 0.22, 0.25, 0.6, 0.25, false],
        [boxGeo, mats.dark, -0.4, 0.035, 0, 0.05, 0.05, 0.7, false],
        [boxGeo, mats.lift, -0.36, 0.77, -0.23, 0.035, 0.18, 0.035, false],
        [boxGeo, mats.lift, -0.36, 0.77, 0.23, 0.035, 0.18, 0.035, false],
        [boxGeo, mats.dark, -0.36, 0.87, 0, 0.045, 0.035, 0.48, false],
        [brushGeo, mats.lift, -0.1, 0.876, 0.17, 0.23, 0.45, 0.23, false],
        [brushGeo, mats.emergency, -0.1, 0.891, 0.17, 0.17, 0.8, 0.17, false],
      ] : [
        [bodyGeo, mats.tire, 0, 0.077, 0, 1.024, 0.095, 0.642, false],
        [bodyGeo, mats.ronavi, 0, 0.15, 0, 1.018, 0.14, 0.638, false],
        [bodyGeo, mats.dark, 0, 0.296, 0, 1.044, 0.142, 0.654, false],
        [boxGeo, mats.dark, 0.511, 0.178, 0, 0.015, 0.06, 0.15, false],
        [boxGeo, mats.led, 0.524, 0.258, 0, 0.005, 0.012, 0.584, false],
        [boxGeo, mats.led, 0, 0.258, 0.328, 0.97, 0.012, 0.005, false],
        [boxGeo, mats.led, 0, 0.258, -0.328, 0.97, 0.012, 0.005, false],
        [wheelGeo, mats.tire, 0.02, 0.086, -0.27, 0.72, 0.72, 0.72, false],
        [wheelGeo, mats.tire, 0.02, 0.086, 0.27, 0.72, 0.72, 0.72, false],
        [boxGeo, mats.lift, 0, 0.374, 0, 0.92, 0.012, 0.56, false, true],
        ...[-0.32, 0.32].flatMap(x => [-0.19, 0.19].map(z => [boxGeo, mats.lift, x, 0.31, z, 0.036, 0.14, 0.036, false, false, 'jack-rod'])),
      ];
      components.forEach(([geo, mat, x, y, z, w, h, d, loaded, lift, role]) => {
        const m = new T.InstancedMesh(geo, mat, robotCapacity);
        m.userData.componentRole = role || (lift ? 'platform-face' : cleaning ? 'cleaner-body' : 'robot-body');
        m.instanceMatrix.setUsage(T.DynamicDrawUsage); m.castShadow = false; m.receiveShadow = true;
        m.count = 0; m.frustumCulled = false;
        robotsGroup.add(m); pickables.push(m);
        robotParts.push({ mesh: m, x, y, z, w, h, d, loaded, lift, role });
      });
      if (cleaning) {
        brushMesh = new T.InstancedMesh(boxGeo, swathMaterial, robotCapacity); brushMesh.layers.set(1); brushMesh.frustumCulled = false;
        brushMesh.instanceMatrix.setUsage(T.DynamicDrawUsage); brushMesh.count = 0; robotsGroup.add(brushMesh);
      }
    }
    function pathPoints(path) {
      return (Array.isArray(path) ? path : []).map((p) => Array.isArray(p) ? { x: p[0], y: p[1] } : p).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
    }
    function updateCarriers(list) {
      if (cleaning) return;
      const carriers = (list || []).filter((c) => c.visible !== false && Number.isFinite(c.x) && Number.isFinite(c.y));
      stats.carrierCount = carriers.length;
      if (carriers.length > carrierCapacity) {
        const old = new Set(carrierParts.map((p) => p.mesh));
        old.forEach((m) => { root.remove(m); m.dispose?.(); }); pickables = pickables.filter((p) => !old.has(p));
        carrierParts = []; carrierCapacity = Math.max(16, carriers.length);
        carrierTransforms.clear(); carrierRecordKey = '';
        const groups = new Map();
        const pieces = window.warehouseCarrierParts(carrierSpec);
        const levels = pieces.filter(p => p.role === 'shelf-tray');
        const bands = levels.map((tray, i) => {
          const boxes = pieces.filter(p => p.role === 'carton' && Math.abs(p.y - p.h / 2 - tray.y - tray.h / 2) < 0.00001);
          const minX = Math.min(...boxes.map(p => p.x - p.w / 2)), maxX = Math.max(...boxes.map(p => p.x + p.w / 2));
          const minZ = Math.min(...boxes.map(p => p.z - p.d / 2)), maxZ = Math.max(...boxes.map(p => p.z + p.d / 2));
          const minY = tray.y + tray.h / 2, maxY = Math.max(...boxes.map(p => p.y + p.h / 2));
          return { mat: i % 2 ? 'loadLight' : 'load', x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2, w: maxX - minX, h: maxY - minY, d: maxZ - minZ, role: 'carton-band', lod: 'far' };
        });
        pieces.concat(bands).forEach((p) => {
          p.lod = p.lod || (p.detail ? 'detail' : p.role === 'carton' ? 'near' : 'all');
          p.cargo = ['carton', 'carton-band', 'cargo-detail'].includes(p.role);
          const key = p.mat + '|' + p.lod + '|' + p.cargo;
          if (!groups.has(key)) groups.set(key, []); groups.get(key).push(p);
        });
        groups.forEach((pieces) => {
          const m = new T.InstancedMesh(boxGeo, mats[pieces[0].mat], carrierCapacity * pieces.length);
          m.userData.componentRole = 'carrier-batch'; m.userData.components = pieces;
          m.instanceMatrix.setUsage(T.DynamicDrawUsage); m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true;
          const batch = { mesh: m, pieces, lod: pieces[0].lod, cargo: pieces[0].cargo, fullUploadPending: false };
          m.onAfterRender = () => { batch.fullUploadPending = false; };
          root.add(m); pickables.push(m); carrierParts.push(batch);
        });
      }
      const seen = new Set(), carrierRecords = [], cargoRecords = [];
      let matrixWrites = 0, uploadFloats = 0;
      carrierParts.forEach(batch => { batch.firstChanged = Infinity; batch.lastChanged = -1; });
      carriers.forEach((value, index) => {
        const id = 'carrier:' + value.id, yaw = -finite(value.heading, 0), c = Math.cos(yaw), s = Math.sin(yaw), liftM = finite(value.liftM, 0);
        let rec = records.get(id);
        if (!rec) rec = record(id, 'Мобильный стеллаж ' + value.id, 'carrier', new T.Vector3(), new T.Vector3(carrierSpec.lengthM, carrierSpec.heightM, carrierSpec.widthM), { Тип: carrierSpec.label, Носитель: value.id, Размер: fmt(carrierSpec.lengthM) + ' × ' + fmt(carrierSpec.widthM) + ' × ' + fmt(carrierSpec.heightM) + ' м', Ярусы: carrierSpec.levels, Основание: carrierSpec.sourceNote });
        rec.robotId = value.robotId === null || value.robotId === undefined ? null : String(value.robotId);
        rec.center.set(value.x, carrierSpec.heightM / 2 + liftM, value.y);
        rec.size.set(Math.abs(c) * carrierSpec.lengthM + Math.abs(s) * carrierSpec.widthM, carrierSpec.heightM, Math.abs(s) * carrierSpec.lengthM + Math.abs(c) * carrierSpec.widthM);
        const phases = { parked: 'На домашнем месте', pickup: 'Перед подхватом', loading: 'Подхват', carrying: 'Перевозка', unloading: 'Постановка', delivered: 'Установлен в зоне операции' };
        rec.details.Состояние = phases[value.phase] || value.phase;
        rec.details.Содержимое = value.contents === 'empty' ? 'Пустой носитель' : 'С грузом';
        if (rec.liftM !== liftM) { rec.liftM = liftM; rec.details.Подъём = fmt(liftM * 1000) + ' мм'; }
        if (value.taskId !== null && value.taskId !== undefined) rec.details.Задание = '#' + value.taskId; else delete rec.details.Задание;
        if (rec.robotId !== null) rec.details.Робот = 'AMR-' + String(Number(rec.robotId) + 1).padStart(2, '0'); else delete rec.details.Робот;
        seen.add(id); carrierRecords.push(rec);
        const cargoIndex = value.contents === 'empty' ? -1 : cargoRecords.length;
        if (cargoIndex >= 0) cargoRecords.push(rec);
        const frameTransform = [index, value.x, value.y, yaw, liftM].join('|');
        const cargoTransform = [cargoIndex, value.x, value.y, yaw, liftM].join('|');
        const oldTransform = carrierTransforms.get(id);
        const frameChanged = oldTransform?.frame !== frameTransform, cargoChanged = oldTransform?.cargo !== cargoTransform;
        if (frameChanged || cargoChanged) {
          carrierTransforms.set(id, { frame: frameTransform, cargo: cargoTransform });
          carrierParts.forEach((batch) => {
            if (batch.cargo ? cargoIndex < 0 || !cargoChanged : !frameChanged) return;
            const first = (batch.cargo ? cargoIndex : index) * batch.pieces.length;
            batch.firstChanged = Math.min(batch.firstChanged, first);
            batch.lastChanged = Math.max(batch.lastChanged, first + batch.pieces.length - 1);
            batch.pieces.forEach((p, pieceIndex) => {
            dummy.position.set(value.x + p.x * c + p.z * s, p.y + liftM, value.y - p.x * s + p.z * c);
            dummy.rotation.set(0, yaw, 0); dummy.scale.set(p.w, p.h, p.d); dummy.updateMatrix();
            batch.mesh.setMatrixAt(first + pieceIndex, dummy.matrix); matrixWrites++;
            });
          });
        }
      });
      const recordKey = carriers.map(c => c.id + ':' + (c.contents === 'empty' ? 'empty' : 'full')).join('|'), recordsChanged = recordKey !== carrierRecordKey;
      carrierParts.forEach((batch) => {
        const batchRecords = batch.cargo ? cargoRecords : carrierRecords;
        batch.mesh.count = batchRecords.length * batch.pieces.length;
        if (batch.lastChanged >= 0) {
          // Three r128 accepts a contiguous dirty range in floats, not a full stock upload.
          batch.mesh.instanceMatrix.updateRange.offset = batch.fullUploadPending ? 0 : batch.firstChanged * 16;
          batch.mesh.instanceMatrix.updateRange.count = batch.fullUploadPending ? -1 : (batch.lastChanged - batch.firstChanged + 1) * 16;
          uploadFloats += batch.fullUploadPending ? batch.mesh.instanceMatrix.array.length : batch.mesh.instanceMatrix.updateRange.count;
          batch.mesh.instanceMatrix.needsUpdate = true;
        }
        if (recordsChanged) batch.mesh.userData.records = batchRecords.flatMap((rec) => batch.pieces.map(() => rec));
      });
      stats.emptyCarrierCount = carriers.length - cargoRecords.length;
      stats.loadedCarrierCount = cargoRecords.length;
      stats.carrierMatrixWrites = matrixWrites;
      stats.carrierUploadFloats = uploadFloats;
      carrierRecordKey = recordKey;
      for (const [id, rec] of records) if (rec.kind === 'carrier' && !seen.has(id)) { records.delete(id); carrierTransforms.delete(id); }
      updateCarrierLod();
    }
    function updateCarrierLod() {
      if (!carrierParts.length) return;
      camera.updateMatrixWorld(true);
      const ground = new T.Vector3().project(camera), top = new T.Vector3(0, carrierSpec.heightM, 0).project(camera);
      const heightPx = Math.abs(top.y - ground.y) * height / 2;
      const corners = [[0, 0], [carrierSpec.lengthM, 0], [0, carrierSpec.widthM], [carrierSpec.lengthM, carrierSpec.widthM]].map(([x, z]) => new T.Vector3(x, 0, z).project(camera));
      const planPx = Math.max((Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x))) * width / 2, (Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y))) * height / 2);
      const resolution = Math.max(heightPx, planPx * 1.5), near = quality !== 'low' && resolution >= 56;
      const detail = near && layer !== 'flow' && resolution >= (quality === 'details' ? 90 : 140);
      carrierParts.forEach(p => {
        const visible = p.lod === 'all' || p.lod === 'near' && near || p.lod === 'far' && !near || p.lod === 'detail' && detail;
        // Hidden LOD buffers may have missed several disjoint updates since their last draw.
        if (visible && !p.mesh.visible) { p.fullUploadPending = true; p.mesh.instanceMatrix.updateRange.count = -1; p.mesh.instanceMatrix.needsUpdate = true; }
        p.mesh.visible = visible;
      });
      stats.carrierLod = { mode: detail ? 'detail' : near ? 'cartons' : 'five-tier', heightPx, planPx };
      stats.carrierCargoInstances = carrierParts.filter(p => p.cargo && p.mesh.visible).reduce((n, p) => n + p.mesh.count, 0);
    }
    function incidentRecord(incident) {
      const id = 'incident:' + incident.id, statuses = { reported: 'Обнаружен', acknowledged: 'Принят', diagnosing: 'Диагностика', recovering: 'Восстановление', resolved: 'Устранён' };
      const robot = (cleaning ? 'CL-' : 'AMR-') + String(Number(incident.robotId) + 1).padStart(2, '0');
      const rec = records.get(id) || record(id, '', 'incident', new T.Vector3(), new T.Vector3(1.6, 1, 1.6), {});
      rec.name = robot + ' · ' + (incident.label || incident.code || 'Инцидент'); rec.center.set(incident.x, 0.5, incident.y);
      rec.details = { Основание: 'Учебный инцидент имитации; не телеметрия реального робота', incidentId: String(incident.id), Робот: robot, Код: incident.code || 'Нет данных', Серьёзность: incident.severity === 'critical' ? 'Критический' : 'Предупреждение', Состояние: statuses[incident.status] || incident.status || 'Обнаружен', 'С момента обнаружения': Number.isFinite(incident.ageS) ? fmt(incident.ageS) + ' с' : 'Нет данных', Положение: fmt(incident.x) + '; ' + fmt(incident.y) + ' м', Влияние: incident.impact || (incident.haltsRobot ? 'Робот остановлен моделью' : 'Предупреждение'), Сценарий: 'Автоматический учебный цикл обслуживания', Действия: Array.isArray(incident.instructions) ? incident.instructions.join('; ') : 'Нет данных' };
      return rec;
    }
    function updateIncidents(items) {
      const seen = new Set(); frameIncidents.clear();
      (Array.isArray(items) ? items : []).forEach((incident) => {
        if (!incident || !Number.isFinite(incident.x) || !Number.isFinite(incident.y)) return;
        const id = 'incident:' + incident.id; frameIncidents.set(id, incident);
        if (incident.active !== true || incident.status === 'resolved') { if (selected === id) incidentRecord(incident); return; }
        seen.add(id);
        const rec = incidentRecord(incident);
        let item = incidentLabels.get(id);
        if (!item) {
          item = label(rec, '', 1.8, 'incident'); item.el.className = 'warehouse-incident-marker'; item.el.dataset.incidentId = String(incident.id);
          const diamond = document.createElement('span'), glyph = document.createElement('span'), caption = document.createElement('span');
          diamond.className = 'incident-diamond'; glyph.textContent = '!'; diamond.setAttribute('aria-hidden', 'true'); diamond.appendChild(glyph);
          Object.assign(diamond.style, { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 19px', width: '19px', height: '19px', transform: 'rotate(45deg)', color: '#fff' });
          Object.assign(glyph.style, { transform: 'rotate(-45deg)', font: '800 15px/1 Segoe UI,sans-serif' });
          Object.assign(caption.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'pre', textAlign: 'left', minWidth: '0', flex: '1 1 auto' });
          Object.assign(item.el.style, { gap: '9px', alignItems: 'center', padding: '6px 9px', maxWidth: '225px', minHeight: '42px', border: '1px solid', borderRadius: '2px', background: '#fffaf3', font: '600 11px/1.3 Segoe UI,sans-serif', zIndex: '4', overflow: 'visible' });
          const leader = document.createElement('span');
          Object.assign(leader.style, { position: 'absolute', height: '1px', transformOrigin: '0 0', opacity: '0.65', pointerEvents: 'none', zIndex: '3' }); labelsRoot.appendChild(leader);
          item.el.append(diamond, caption); item.diamond = diamond; item.caption = caption; item.leader = leader; incidentLabels.set(id, item);
        }
        const robot = (cleaning ? 'CL-' : 'AMR-') + String(Number(incident.robotId) + 1).padStart(2, '0');
        const state = rec.details.Состояние, critical = incident.severity === 'critical';
        item.tone = critical ? '#a82d27' : '#855607'; item.diamond.style.background = item.tone;
        item.leader.style.background = item.tone;
        item.el.style.color = item.tone; item.el.style.borderColor = item.tone; item.el.style.setProperty('--incident-glow', critical ? '#a82d2755' : '#85560755');
        item.caption.textContent = robot + ' · ' + (incident.code || 'Инцидент') + '\n' + state + ' · ' + (Number.isFinite(incident.ageS) ? fmt(incident.ageS) + ' с' : 'Возраст неизвестен');
        item.el.title = rec.name + '\n' + Object.entries(rec.details).filter(([key]) => key !== 'incidentId').map(([key, value]) => key + ': ' + value).join('\n');
        item.el.setAttribute('aria-label', rec.name + '. ' + state + '. Открыть инцидент');
      });
      for (const [id, item] of incidentLabels) if (!seen.has(id)) {
        item.el.remove(); item.leader.remove(); if (selected !== id) records.delete(id); labels = labels.filter((entry) => entry !== item); incidentLabels.delete(id);
        if (hovered === id) { hovered = null; hoverInfo.hidden = true; }
      }
      for (const [id, rec] of records) if (rec.kind === 'incident' && !seen.has(id) && (selected !== id || !frameIncidents.has(id))) records.delete(id);
    }
    function updatePeople(people) {
      const seen = new Set();
      (people || []).forEach(p => {
        seen.add(p.id); let item = peopleMeshes.get(p.id);
        if (!item) {
          const group = new T.Group(); root.add(group);
          const rec = record('person:' + p.id, 'Пешеход · модель', 'person', new T.Vector3(p.x, .85, p.y), new T.Vector3(p.radiusM*2,1.7,p.radiusM*2), { Основание:'Заданная траектория и оценочные параметры реакции/торможения. Не датчик и не сертифицированная система безопасности.' });
          const add = (geo, mat, x, y, z) => { const m=mesh(ownGeometry(geo),mat,group,rec);m.position.set(x,y,z);return m; };
          add(new T.SphereGeometry(.16,10,8),mats.loadLight,0,1.55,0);
          add(new T.CylinderGeometry(.19,.23,.65,10),mats.busy,0,1.05,0);
          for(const side of [-1,1]){add(new T.CylinderGeometry(.075,.07,.65,8),mats.dark,side*.11,.36,0);add(new T.CylinderGeometry(.055,.055,.6,8),mats.busy,side*.26,1.02,0);}
          const ring=add(new T.RingGeometry(p.radiusM,p.radiusM+.025,24),mats.emergency,0,.004,0);ring.rotation.x=-Math.PI/2;
          if(p.crosswalk){const a=p.crosswalk.from,b=p.crosswalk.to,vertical=Math.abs(a.x-b.x)<.001,length=Math.hypot(b.x-a.x,b.y-a.y),count=Math.max(1,Math.floor(length));for(let n=0;n<count;n++){const stripe=mesh(boxGeo,mats.marking,root,rec);stripe.position.set(a.x+(b.x-a.x)*(n+.5)/count,.003,a.y+(b.y-a.y)*(n+.5)/count);stripe.scale.set(vertical?p.crosswalk.widthM:.45,.002,vertical?.45:p.crosswalk.widthM);stripe.castShadow=false;}}
          item={group,rec,label:label(rec,'Пешеход · модель',1.9,'person')};peopleMeshes.set(p.id,item);
        }
        item.group.position.set(p.x,0,p.y);item.rec.center.set(p.x,.85,p.y);item.rec.details.Положение=fmt(p.x)+' × '+fmt(p.y)+' м';item.rec.details.Состояние=({'at-curb':'Ожидает у бордюра',requesting:'Ожидает освобождения перехода',crossing:'Идёт по переходу','fixed-trajectory':'Заданная траектория'})[p.phase]||p.phase;item.rec.details.Ожидание=fmt(p.waitS||0)+' с';item.rec.details.Переходов=(p.crossings||[]).filter(c=>c.completedAtS!==null).length;
      });
      peopleMeshes.forEach((item,id)=>{item.group.visible=seen.has(id);item.label.el.hidden=!seen.has(id);});
      stats.personCount=seen.size;
    }
    function applyFrame(next) {
      if (disposed || !root) return;
      const robots = next && Array.isArray(next.robots) ? next.robots.filter((b) => Number.isFinite(b.x) && Number.isFinite(b.y)).slice(0, 500) : [];
      ensureRobots(robots.length);
      updateCarriers(next?.carriers);
      updatePeople(next?.people);
      const seen = new Set();
      const robotRecords = [];
      frameRobots.clear();
      let activeBrushes = 0;
      robots.forEach((b, index) => {
        const key = String(b.id), id = 'robot:' + key, path = pathPoints(b.remainingPath || b.path);
        frameRobots.set(key, b);
        const old = previous.get(key);
        const dx = old ? b.x - old.x : 0, dz = old ? b.y - old.y : 0;
        const yaw = Number.isFinite(b.underlift?.headingRad) ? -b.underlift.headingRad : Number.isFinite(b.heading) ? -b.heading : Math.hypot(dx, dz) > 0.001 ? Math.atan2(-dz, dx) : old ? old.yaw : 0;
        previous.set(key, { x: b.x, y: b.y, yaw }); seen.add(key);
        let rec = records.get(id);
        if (!rec) rec = record(id, (cleaning ? 'Робот уборки ' : 'Робот ') + (Number(b.id) + 1), 'robot', new T.Vector3(), cleaning ? new T.Vector3(0.8, 0.9, 0.8) : new T.Vector3(1.3, 1.15, 0.9), {});
        const pose = cleaning ? { visible: false, liftM: 0 } : window.WarehouseDemoCore.carrierPose(b, carrierSpec);
        const payloadHeight = pose.visible ? carrierSpec.heightM + pose.liftM : 0.38;
        rec.center.set(b.x, cleaning ? 0.55 : payloadHeight / 2, b.y);
        if (!cleaning) {
          const bodyW = Math.abs(Math.cos(yaw)) * 1.044 + Math.abs(Math.sin(yaw)) * 0.654, bodyD = Math.abs(Math.sin(yaw)) * 1.044 + Math.abs(Math.cos(yaw)) * 0.654;
          const pod = pose.visible && b.podPose, podYaw = pod ? -finite(pod.heading, 0) : yaw;
          const podW = pose.visible ? Math.abs(Math.cos(podYaw)) * carrierSpec.lengthM + Math.abs(Math.sin(podYaw)) * carrierSpec.widthM : 0;
          const podD = pose.visible ? Math.abs(Math.sin(podYaw)) * carrierSpec.lengthM + Math.abs(Math.cos(podYaw)) * carrierSpec.widthM : 0;
          const px = pod ? pod.x : b.x, pz = pod ? pod.y : b.y;
          const minX = Math.min(b.x - bodyW / 2, px - podW / 2), maxX = Math.max(b.x + bodyW / 2, px + podW / 2);
          const minZ = Math.min(b.y - bodyD / 2, pz - podD / 2), maxZ = Math.max(b.y + bodyD / 2, pz + podD / 2);
          rec.center.set((minX + maxX) / 2, payloadHeight / 2, (minZ + maxZ) / 2); rec.size.set(maxX - minX, payloadHeight, maxZ - minZ);
          if (!rec.robotCenter) rec.robotCenter = new T.Vector3(); rec.robotCenter.set(b.x, 0.19, b.y);
        }
        let marker = robotLabels.get(key);
        if (!marker) { marker = label(rec, '', 1.3, 'robot'); robotLabels.set(key, marker); }
        if (!cleaning) marker.y = payloadHeight + 0.14;
        const phases = { toPickup: 'к погрузке', toDrop: b.carrierContents === 'empty' ? 'пустой носитель' : 'с грузом', toCharger: 'к зарядке', charging: 'зарядка', loading: '↑ погрузка', unloading: '↓ разгрузка', waitPoint: 'очередь', waitCharger: 'ждёт зарядку', idle: 'свободен', working: 'убирает', transit: 'по проходу', toDock: 'к станции', waitingDock: 'ждёт станцию', parking: 'к парковке', done: 'секция пройдена' };
        const waiting = /wait/i.test(b.phase || ''), charging = /charg/i.test(b.phase || '');
        if (b.safety) {
          const radius = b.safety.radiusM + b.safety.requiredClearanceM / 2;
          dummy.position.set(b.x, .115, b.y); dummy.rotation.set(0, 0, 0); dummy.scale.set(radius, 1, radius); dummy.updateMatrix(); safetyMesh.setMatrixAt(index, dummy.matrix);
          safetyMesh.setColorAt(index, new T.Color(b.safety.blocked ? 0xb34a32 : 0x2c8279));
        } else { dummy.scale.set(0, 0, 0); dummy.updateMatrix(); safetyMesh.setMatrixAt(index, dummy.matrix); }
        marker.shortText = (charging ? '⚡ ' : waiting || b.phase === 'idle' ? 'Ⅱ ' : /loading/i.test(b.phase || '') ? '↕ ' : '› ') + String(Number(b.id) + 1).padStart(2, '0');
        marker.fullText = (cleaning ? 'CL-' : 'AMR-') + String(Number(b.id) + 1).padStart(2, '0') + ' · ' + (b.safety?.blocked ? 'уступает дорогу' : phases[b.phase] || b.phase || 'нет данных') + (Number.isFinite(b.handlingProgress) ? ' ' + fmt(b.handlingProgress * 100) + '%' : '');
        marker.el.title = marker.fullText + ' · модель и работа робота'; marker.el.setAttribute('aria-label', marker.el.title);
        marker.tone = b.safety?.blocked ? '#a74430' : charging || waiting ? '#865914' : '#086c72';
        rec.details = {
          Модель: model.product ? (model.product.name || model.product.slug || 'Не указана') : 'Не указана',
          Состояние: b.phase || 'Нет данных', Груз: pose.visible ? carrierSpec.label + (b.carrierContents === 'empty' ? ' · пустой' : ' · с грузом') : 'Без груза',
          'Заряд': Number.isFinite(b.soc) ? fmt(b.soc <= 1 ? b.soc * 100 : b.soc) + ' %' : 'Нет данных',
          'Положение': fmt(b.x) + '; ' + fmt(b.y) + ' м',
          'Пройдено': Number.isFinite(b.distanceM) ? fmt(b.distanceM) + ' м' : 'Нет данных',
          'До цели': Number.isFinite(b.remainingDistM) ? fmt(b.remainingDistM) + ' м' : 'Нет данных',
          'Завершено заданий': Number.isFinite(b.tasksDone) ? b.tasksDone : 'Нет данных',
          Геометрия: cleaning ? 'Условный робот уборки: корпус 0,76 × 0,70 м, высота около 0,91 м; силуэт прототипа, не паспортная модель производителя' : 'RONAVI: внешний силуэт по референсу; оболочка 1,044 × 0,654 × 0,38 м. Условная реконструкция, не CAD',
        };
        if (cleaning) { rec.details.Секция = sections.get(String(b.zoneId))?.rec.name || b.zoneId || 'Нет задания'; rec.details.Захват = Number.isFinite(b.brushWidthM) ? fmt(b.brushWidthM) + ' м — модельный захват' : 'Нет данных'; delete rec.details.Груз; }
        else { rec.details.Носитель = carrierSpec.label; rec.details['Геометрия носителя'] = carrierSpec.sourceNote; }
        if (!cleaning && b.task) { rec.details.Задание = '#' + b.task.id; rec.details.Погрузка = fmt(b.task.from.x) + '; ' + fmt(b.task.from.y) + ' м'; rec.details.Выгрузка = fmt(b.task.to.x) + '; ' + fmt(b.task.to.y) + ' м'; }
        robotRecords.push(rec);
        robotParts.forEach((part) => {
          const c = Math.cos(yaw), s = Math.sin(yaw);
          const stroke = finite(pose.platformLiftM, pose.liftM), jack = part.role === 'jack-rod';
          dummy.position.set(b.x + part.x * c + part.z * s, part.y + (jack ? stroke / 2 : part.lift ? stroke : 0), b.y - part.x * s + part.z * c);
          const show = !part.loaded || pose.visible;
          dummy.scale.set(show ? part.w : 0, show ? part.h + (jack ? stroke : 0) : 0, show ? part.d : 0);
          dummy.rotation.set(0, yaw, 0); dummy.updateMatrix(); part.mesh.setMatrixAt(index, dummy.matrix);
        });
        if (cleaning && brushMesh && b.working === true) {
          dummy.position.set(b.x, 0.125, b.y); dummy.rotation.set(0, yaw, 0);
          dummy.scale.set(0.32, 0.018, Math.max(0.05, finite(b.brushWidthM, 0.8))); dummy.updateMatrix(); brushMesh.setMatrixAt(activeBrushes++, dummy.matrix);
        }
        if (path.length) {
          const pts = path;
          let route = routes.get(key);
          if (!route || route.capacity < pts.length) {
            if (route) { routesGroup.remove(route.line); route.geometry.dispose(); }
            const geometry = new T.BufferGeometry(), capacity = Math.max(pts.length, 32);
            geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(T.DynamicDrawUsage));
            const line = new T.Line(geometry, routeMat); line.layers.set(1); line.frustumCulled = false;
            routesGroup.add(line); route = { geometry, line, capacity }; routes.set(key, route);
          }
          const array = route.geometry.attributes.position.array;
          pts.forEach((p, i) => { array[i * 3] = p.x; array[i * 3 + 1] = 0.15; array[i * 3 + 2] = p.y; });
          route.geometry.attributes.position.needsUpdate = true; route.geometry.setDrawRange(0, pts.length);
          route.points = pts;
          route.line.material = /charg/i.test(b.phase || '') ? chargeRouteMat : routeMat; route.line.visible = true;
        } else if (routes.has(key)) { routes.get(key).points = []; routes.get(key).line.visible = false; }
      });
      robotParts.forEach((p) => { p.mesh.count = robots.length; p.mesh.instanceMatrix.needsUpdate = true; p.mesh.userData.records = robotRecords; });
      if (brushMesh) { brushMesh.count = activeBrushes; brushMesh.instanceMatrix.needsUpdate = true; }
      if (cleaning) { updateSections(next?.sections); queueCoverage(next?.coverage); }
      updateIncidents(next?.incidents);
      routes.forEach((route, key) => { if (!seen.has(key)) { routesGroup.remove(route.line); route.geometry.dispose(); routes.delete(key); } });
      for (const [id, rec] of records) if (rec.kind === 'robot' && !seen.has(id.slice(6))) records.delete(id);
      for (const key of previous.keys()) if (!seen.has(key)) previous.delete(key);
      for (const [key, marker] of robotLabels) if (!seen.has(key)) { marker.el.remove(); labels = labels.filter((l) => l !== marker); robotLabels.delete(key); }
      if (safetyMesh) { safetyMesh.count = robots.length; safetyMesh.instanceMatrix.needsUpdate = true; if (safetyMesh.instanceColor) safetyMesh.instanceColor.needsUpdate = true; safetyMesh.visible = safetyVisible; }
      const pointList = next && next.points ? (Array.isArray(next.points) ? next.points : Object.entries(next.points).map(([id, p]) => Object.assign({ id }, p))) : [];
      points.forEach((p) => { p.pad.material = mats.point; p.rec.details.Занятость = 'Нет данных кадра'; p.rec.details.Очередь = 'Нет данных кадра'; });
      pointList.forEach((p) => {
        addPoint(p);
        const entry = points.get(String(p.id)); if (!entry) return;
        const busy = typeof p.busy === 'boolean' ? p.busy : p.busy !== undefined && p.busy !== null ? !!p.busy : null;
        const q = Array.isArray(p.queue) ? p.queue.length : Number.isFinite(p.queue) ? p.queue : null;
        entry.pad.material = busy ? mats.busy : mats.point;
        entry.lamp.material = q > 0 ? mats.busy : busy ? entry.charging ? mats.led : mats.busy : mats.charger;
        entry.rec.details.Занятость = busy === null ? 'Нет данных' : busy ? 'Занято' : 'Свободно';
        entry.rec.details.Очередь = q === null ? 'Нет данных' : fmt(q) + ' роб.';
        entry.label.el.textContent = String(p.id) + (q > 0 ? ' · очередь ' + q : '');
        entry.label.forceVisible = q > 0;
      });
      queueLabels.forEach((q) => {
        const count = q.pointIds.reduce((sum, id) => {
          const p = pointList.find((point) => String(point.id) === String(id));
          return sum + (p && Array.isArray(p.queue) ? p.queue.length : p && Number.isFinite(p.queue) ? p.queue : 0);
        }, 0);
        q.item.el.textContent = q.base + (count ? ' · ' + count + ' роб.' : '');
      });
      if (next && next.robots && next.robots.length > 500) say('Для скорости показаны первые 500 роботов из ' + next.robots.length + '. Показатели рассчитываются для всего парка.');
      else if (!lost) say('');
      if (followId) {
        const rec = records.get(followId);
        if (rec) {
          const target = rec.center.clone().add(root.position), delta = target.clone().sub(controls.target);
          camera.position.add(delta); controls.target.copy(target);
        }
      }
      updateSelection();
    }
    function setFrame(next) {
      if (disposed || !root) return;
      // Root may call this at display refresh rate. Buffers update only on the 30 Hz draw.
      const robots = next && Array.isArray(next.robots) ? next.robots : [];
      const key = String(next ? next.tS : '') + '|' + robots.map((b) => [b.id, b.x, b.y, b.heading, b.phase, b.loaded, b.handlingProgress, b.working, b.zoneId].join(',')).join(';') + '|' + (next && next.points ? JSON.stringify(next.points) : '') + '|' + String(next?.coverage?.version ?? '') + '|' + (next?.sections ? JSON.stringify(next.sections.map((s) => [s.id, s.progress, s.status, s.assignedRobotIds])) : '') + '|' + (next?.incidents ? JSON.stringify(next.incidents) : '') + '|' + (next?.carriers ? JSON.stringify(next.carriers.map(c => [c.id, c.x, c.y, c.heading, c.phase, c.liftM, c.visible, c.robotId, c.contents])) : '');
      if (key === frameKey) return;
      frameKey = key; pendingFrame = next; invalidate();
    }
    function applyLayers() {
      if (!root) return;
      rackGroup.visible = layer !== 'flow'; robotsGroup.visible = layer !== 'infrastructure'; routesGroup.visible = layer !== 'infrastructure';
      if (detailGroup) detailGroup.visible = layer !== 'flow' && quality !== 'low';
      updateCarrierLod();
      if (coverageOverlay) coverageOverlay.visible = layer !== 'infrastructure';
      updateSelection(); invalidate();
    }
    function setLayer(value) { layer = ['all', 'flow', 'infrastructure'].includes(value) ? value : 'all'; applyLayers(); }
    function setSlice(value) {
      slice = value === null || value === undefined ? null : Math.max(0, finite(value, 0));
      clip.constant = slice === null ? 10000 : slice;
      persistent.forEach((m) => { if (m.isMaterial) { m.clippingPlanes = slice === null ? [] : [clip]; m.needsUpdate = true; } });
      if (normalMaterial) { normalMaterial.clippingPlanes = slice === null ? [] : [clip]; normalMaterial.needsUpdate = true; }
      renderer.shadowMap.needsUpdate = true;
      invalidate();
    }
    function allowed(rec) { return !(layer === 'flow' && rec.kind === 'rack') && !(layer === 'infrastructure' && (rec.kind === 'robot' || rec.kind === 'task-endpoint')); }
    function updateSelection() {
      const rec = selected && records.get(selected);
      updateTaskEndpoints();
      sections.forEach((s) => { const active = s.rec.id === selected, over = s.rec.id === hovered; s.edge.material.opacity = active || over ? 1 : 0.75; s.edge.material.color.set(active ? WARN : over ? 0x176b65 : TEAL); s.area.material.opacity = active ? 0.1 : over ? 0.18 : 0.035; });
      records.forEach(rec => { if (rec.floorMaterial) rec.floorMaterial.color.copy(rec.floorColor).lerp(new T.Color(0x55aaa0), rec.id === hovered ? .45 : 0); });
      routes.forEach((r, key) => { r.line.visible = layer === 'flow' && !!r.points?.length && selected !== 'robot:' + key; });
      const pts = rec && rec.kind === 'robot' && routes.get(rec.id.slice(6))?.points;
      selectedRoute.visible = layer !== 'infrastructure' && !!pts && pts.length > 1;
      halo.visible = layer !== 'infrastructure' && !!rec && rec.kind === 'robot';
      if (halo.visible) halo.position.copy(rec.robotCenter || rec.center).add(root.position).setY(0.06);
      if (selectedRoute.visible) {
        const count = (pts.length - 1) * 6;
        if (count > selectedRouteCapacity) {
          persistent.delete(selectedRouteGeometry); selectedRouteGeometry.dispose();
          selectedRouteCapacity = Math.max(count, 192); selectedRouteGeometry = new T.BufferGeometry();
          selectedRouteGeometry.setAttribute('position', new T.BufferAttribute(new Float32Array(selectedRouteCapacity * 3), 3).setUsage(T.DynamicDrawUsage));
          selectedRoute.geometry = selectedRouteGeometry; persistent.add(selectedRouteGeometry);
        }
        const a = selectedRouteGeometry.attributes.position.array; let n = 0;
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i - 1], q = pts[i], dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy);
          if (len < 0.0001) continue;
          const nx = -dy / len * 0.18, ny = dx / len * 0.18;
          const corners = [[p.x + nx, p.y + ny], [p.x - nx, p.y - ny], [q.x - nx, q.y - ny], [q.x + nx, q.y + ny]];
          for (const k of [0, 1, 2, 0, 2, 3]) { a[n++] = corners[k][0]; a[n++] = 0.17; a[n++] = corners[k][1]; }
        }
        selectedRouteGeometry.attributes.position.needsUpdate = true; selectedRouteGeometry.setDrawRange(0, n / 3); selectedRoute.position.copy(root.position);
      }
      selectionBox.visible = !!rec && allowed(rec) && !['scale', 'section', 'incident'].includes(rec.kind);
      if (!selectionBox.visible) return;
      selectionBox.position.copy(rec.center).add(root.position);
      selectionBox.scale.copy(rec.size).addScalar(0.12);
    }
    function select(rec) {
      hovered = null; hoverInfo.hidden = true;
      taskRobotId = rec?.kind === 'robot' ? rec.id.slice(6) : rec?.kind === 'task-endpoint' || rec?.kind === 'carrier' ? rec.robotId : null;
      selected = rec ? rec.id : null; updateSelection();
      labels.forEach((l) => { l.el.style.fontWeight = l.rec.id === selected ? '700' : '500'; });
      if (typeof onSelect === 'function') onSelect(rec ? publicRecord(rec) : null);
      invalidate();
    }
    function selectObject(id) {
      if (pendingFrame) { const next = pendingFrame; pendingFrame = null; applyFrame(next); }
      const rec = records.get(String(id)); if (!rec) return false;
      select(rec); return true;
    }
    function moveCamera(target, position, zoom) {
      transition = { start: performance.now(), duration: reduce.matches ? 0 : 480,
        fromTarget: controls.target.clone(), toTarget: target.clone(), fromPosition: camera.position.clone(), toPosition: position.clone(), fromZoom: camera.zoom, toZoom: zoom };
      invalidate();
    }
    function focus(id) {
      const rec = records.get(String(id)); if (!rec || !root) return false;
      select(rec);
      const target = rec.center.clone().add(root.position);
      const offset = camera.position.clone().sub(controls.target);
      const span = Math.max(rec.size.x, rec.size.z, rec.size.y * 2, 8);
      moveCamera(target, target.clone().add(offset), clamp(fitSpan / span, 0.5, 12));
      return true;
    }
    function focusIncident(id) {
      if (pendingFrame) { const next = pendingFrame; pendingFrame = null; applyFrame(next); }
      const key = String(id).startsWith('incident:') ? String(id) : 'incident:' + id;
      const incident = frameIncidents.get(key); if (!incident) return false;
      incidentRecord(incident);
      followId = null;
      return focus(key);
    }
    function setFollow(id) {
      followId = id === null || id === undefined ? null : String(id).startsWith('robot:') ? String(id) : 'robot:' + id;
      if (followId) focus(followId);
      invalidate();
    }
    function inspectRobot(id) {
      const key = String(id).startsWith('robot:') ? String(id) : 'robot:' + id;
      if (!selectObject(key) || !root) return false;
      followId = null; view = 'iso'; controls.enableRotate = true; camera.up.set(0, 1, 0);
      const rec = records.get(key), robot = frameRobots.get(key.slice(6)), heading = finite(robot?.heading, 0);
      const target = rec.center.clone().add(root.position);
      const front = new T.Vector3(Math.cos(heading), 0, Math.sin(heading)), side = new T.Vector3(-Math.sin(heading), 0, Math.cos(heading));
      scene.updateMatrixWorld(true);
      const blockers = pickables.filter((object) => {
        let parent = object; while (parent) { if (!parent.visible) return false; parent = parent.parent; }
        const item = object.userData.record || object.userData.records?.[0];
        return item && ['rack', 'wall', 'column', 'packing'].includes(item.kind);
      });
      const probe = new T.Raycaster(); let position, best = Infinity;
      // A close camera beside a shelf can hide the entire body. Prefer a clear
      // front quarter, then the aisle direction; a steep view is the last resort.
      for (const [f, s, h] of [[4, 3, 3], [4, -3, 3], [4, 1, 3], [4, -1, 3], [4, 0, 3], [2, 1, 5], [2, -1, 5], [0.25, 0.2, 6]]) {
        const candidate = target.clone().addScaledVector(front, f).addScaledVector(side, s).add(new T.Vector3(0, h, 0));
        let score = 0;
        for (const y of [-0.3, 0, 0.3]) {
          const origin = target.clone().add(new T.Vector3(0, y, 0)), direction = candidate.clone().sub(origin);
          probe.set(origin, direction.clone().normalize()); probe.near = 0.03; probe.far = direction.length();
          score += probe.intersectObjects(blockers, false).length;
        }
        if (score < best) { best = score; position = candidate; }
        if (!score) break;
      }
      const zoom = Math.min(camera.right - camera.left, camera.top - camera.bottom) / 2.8;
      controls.maxZoom = Math.max(controls.maxZoom, zoom * 1.5);
      moveCamera(target, position, zoom); return true;
    }
    function reset() {
      if (!root) return;
      if (!hasViewport || container.clientWidth < 2 || container.clientHeight < 2) { pendingReset = true; return; }
      pendingReset = false;
      followId = null;
      const target = new T.Vector3(0, 0, 0), distance = Math.max(W, H) * 1.5;
      const offset = view === 'plan' ? new T.Vector3(0.001, distance, 0) : new T.Vector3(distance * 0.75, distance * 0.8, distance * 0.75);
      camera.up.set(0, view === 'plan' ? 0 : 1, view === 'plan' ? -1 : 0);
      // Fit the actual projected footprint, rather than the largest world dimension.
      // This also centres an L-shaped site without stretching physical dimensions.
      const probe = camera.clone();
      probe.zoom = 1; probe.position.copy(offset); probe.lookAt(target);
      probe.updateProjectionMatrix(); probe.updateMatrixWorld(true);
      const footprint = model.layout.footprint || [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
      const maxHeight = Math.max(finite(model.layout.wallHeightM, 4.5), ...(model.layout.columns || []).map((c) => finite(c.heightM, 6)));
      const bounds = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity };
      footprint.forEach((p) => [0, maxHeight].forEach((y) => {
        const v = new T.Vector3(p.x - W / 2, y, p.y - H / 2).project(probe);
        bounds.left = Math.min(bounds.left, v.x); bounds.right = Math.max(bounds.right, v.x);
        bounds.bottom = Math.min(bounds.bottom, v.y); bounds.top = Math.max(bounds.top, v.y);
      }));
      const centreX = (bounds.left + bounds.right) / 2, centreY = (bounds.bottom + bounds.top) / 2;
      const right = new T.Vector3().setFromMatrixColumn(probe.matrixWorld, 0);
      const up = new T.Vector3().setFromMatrixColumn(probe.matrixWorld, 1);
      target.addScaledVector(right, centreX * (probe.right - probe.left) / 2);
      target.addScaledVector(up, centreY * (probe.top - probe.bottom) / 2);
      const zoom = 1.68 / Math.max(bounds.right - bounds.left, bounds.top - bounds.bottom, 0.01);
      moveCamera(target, target.clone().add(offset), zoom);
    }
    function setView(value) {
      view = value === 'plan' ? 'plan' : 'iso'; controls.enableRotate = view !== 'plan'; reset();
    }
    function setQuality(value) {
      quality = ['low', 'balanced', 'details'].includes(value) ? value : 'balanced';
      disposeFX();
      if (quality === 'details') { try { initFX(); } catch { disposeFX(); } }
      renderer.shadowMap.enabled = quality !== 'low'; renderer.shadowMap.needsUpdate = true;
      applyLayers(); resize();
    }
    function resize() {
      if (disposed || lost) return;
      const nextWidth = container.clientWidth, nextHeight = container.clientHeight;
      // Hidden/layout-transition containers (including full-page capture) can briefly
      // report 1 px. Keep the last drawable viewport; resizing would clear its buffer.
      if (nextWidth < 2 || nextHeight < 2) return;
      const avg = renderTimes.length ? renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length : 0;
      const pr = Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : avg > 18 ? 1 : 1.25);
      const viewportChanged = width !== nextWidth || height !== nextHeight || effectiveDpr !== pr;
      width = nextWidth; height = nextHeight; hasViewport = true;
      effectiveDpr = pr;
      if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);
      if (canvas.width !== Math.floor(width * pr) || canvas.height !== Math.floor(height * pr)) renderer.setSize(width, height, false);
      const aspect = width / height, half = fitSpan / 2;
      camera.left = -half * Math.max(1, aspect); camera.right = -camera.left;
      camera.top = half * Math.max(1, 1 / aspect); camera.bottom = -camera.top;
      camera.far = Math.max(500, Math.max(W, H) * 8); camera.updateProjectionMatrix();
      if (composer && (viewportChanged || normalTarget.width !== Math.floor(width * pr) || normalTarget.height !== Math.floor(height * pr))) {
        composer.setPixelRatio(pr); composer.setSize(width, height);
        const pw = Math.floor(width * pr), ph = Math.floor(height * pr);
        normalTarget.setSize(pw, ph); edgePass.uniforms.resolution.value.set(pw, ph);
        fxaa.uniforms.resolution.value.set(1 / pw, 1 / ph);
      }
      if (edgePass) { edgePass.uniforms.near.value = camera.near; edgePass.uniforms.far.value = camera.far; }
      if (pendingReset && root) reset();
      invalidate();
    }
    const projected = new T.Vector3();
    function drawLabels() {
      const occupied = [];
      const stageRect = canvas.getBoundingClientRect(), tools = container.parentElement?.querySelector('.view-tools'), caption = container.parentElement?.querySelector('.scene-caption');
      const safeTop = Math.max(8, tools ? tools.getBoundingClientRect().bottom - stageRect.top + 8 : 8);
      const safeBottom = Math.max(safeTop + 42, height - (caption ? caption.getBoundingClientRect().height : 0) - 8);
      incidentLabels.forEach((item) => {
        item.el.style.display = 'flex'; item.el.style.borderWidth = item.rec.id === selected ? '2px' : '1px';
        const rect = item.el.getBoundingClientRect(); item.measuredWidth = rect.width; item.measuredHeight = rect.height;
      });
      const ordered = labels.slice().sort((a, b) => {
        const priority = (l) => l.rec.id === selected ? 0 : l.category === 'incident' ? 0.5 : l.category === 'task' || l.forceVisible ? 1 : l.category === 'section' ? 2 : l.category === 'robot' ? 3 : l.category === 'point' ? 5 : 4;
        return priority(a) - priority(b);
      });
      ordered.forEach((l) => {
        if (l.category === 'robot') {
          const active = l.rec.id === selected;
          const text = active ? l.fullText : l.shortText, styleKey = active + '|' + l.tone;
          if (l.el.textContent !== text) l.el.textContent = text;
          if (l.styleKey !== styleKey) {
            Object.assign(l.el.style, { color: active ? '#fff' : l.tone, background: active ? '#087e83' : '#f6faf7f0', border: '1px solid ' + (active ? '#065c61' : '#8ba9a7'), fontSize: active ? '12px' : '10px', padding: active ? '4px 7px' : '2px 4px', maxWidth: active ? '230px' : '70px', boxShadow: '0 1px 3px #30474b25' });
            l.el.setAttribute('aria-pressed', String(active)); l.styleKey = styleKey;
          }
        }
        projected.copy(l.rec.center); projected.y = l.y; if (root) projected.add(root.position); projected.project(camera);
        l.visible = !l.disabled && allowed(l.rec) && projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 1.05 && Math.abs(projected.y) < 1.05;
        const secondary = ['door', 'point', 'waiting', 'rack'].includes(l.category);
        if (secondary && !l.forceVisible && l.rec.id !== selected && layer !== 'infrastructure' && camera.zoom < 2.4) l.visible = false;
        if (l.minZoom && camera.zoom < l.minZoom && l.rec.id !== selected) l.visible = false;
        if (slice !== null && l.y > slice && !['zone', 'incident'].includes(l.category)) l.visible = false;
        l.sx = (projected.x + 1) * width / 2; l.sy = (1 - projected.y) * height / 2;
        if (l.category === 'robot') l.sy -= 12;
        const incident = l.category === 'incident';
        const half = incident ? l.measuredWidth / 2 + 4 : Math.min(l.rec.id === selected ? 225 : 180, l.el.textContent.length * 6.3 + 12) / 2;
        const labelHeight = incident ? l.measuredHeight + 6 : l.category === 'section' ? 38 : 20;
        const anchorX = l.sx, anchorY = l.sy;
        if (incident) { l.sx = clamp(l.sx, half + 6, Math.max(half + 6, width - half - 6)); l.sy = clamp(l.sy - 30, safeTop + labelHeight / 2, Math.max(safeTop + labelHeight / 2, safeBottom - labelHeight / 2)); }
        const bounds = { x: l.sx - half, y: l.sy - labelHeight / 2, w: half * 2, h: labelHeight };
        const overlaps = () => occupied.some((b) => bounds.x < b.x + b.w && bounds.x + bounds.w > b.x && bounds.y < b.y + b.h && bounds.y + bounds.h > b.y);
        if (incident && l.visible && overlaps()) {
          const candidates = [safeTop + labelHeight / 2, safeBottom - labelHeight / 2, ...occupied.flatMap((b) => [b.y - labelHeight / 2 - 1, b.y + b.h + labelHeight / 2 + 1])];
          candidates.sort((a, b) => Math.abs(a - l.sy) - Math.abs(b - l.sy));
          for (const y of candidates) {
            if (y - labelHeight / 2 < safeTop || y + labelHeight / 2 > safeBottom) continue;
            bounds.y = y - labelHeight / 2;
            if (!overlaps()) { l.sy = y; break; }
          }
        }
        bounds.y = l.sy - labelHeight / 2;
        if (!incident && l.visible && l.rec.id !== selected && overlaps()) l.visible = false;
        if (l.visible) occupied.push(bounds);
        if (incident) {
          l.el.setAttribute('aria-pressed', String(l.rec.id === selected));
          const dx = l.sx - anchorX, dy = l.sy - anchorY;
          Object.assign(l.leader.style, { display: l.visible ? 'block' : 'none', left: anchorX + 'px', top: anchorY + 'px', width: Math.hypot(dx, dy) + 'px', transform: 'rotate(' + Math.atan2(dy, dx) + 'rad)' });
        }
        l.el.style.display = l.visible ? incident ? 'flex' : 'block' : 'none';
        l.el.style.left = l.sx + 'px'; l.el.style.top = l.sy + 'px';
      });
    }
    function draw() {
      if (disposed || lost) return;
      const start = performance.now();
      if (pendingFrame) { const next = pendingFrame; pendingFrame = null; applyFrame(next); }
      if (cleaning) updateCoverage();
      updateSelection();
      updateCarrierLod();
      renderer.info.reset();
      if (composer) {
        const bg = scene.background;
        camera.layers.set(0); scene.overrideMaterial = normalMaterial; scene.background = null;
        renderer.setRenderTarget(normalTarget); renderer.setClearColor(0x8080ff, 1); renderer.clear(); renderer.render(scene, camera);
        renderer.setRenderTarget(null); scene.overrideMaterial = null; scene.background = bg; camera.layers.enable(1);
        composer.render();
      } else renderer.render(scene, camera);
      drawLabels();
      stats.renderCount++; stats.drawCalls = renderer.info.render.calls; stats.triangles = renderer.info.render.triangles;
      stats.frameTimeMs = performance.now() - start;
      renderTimes.push(stats.frameTimeMs); if (renderTimes.length > 120) renderTimes.shift();
      const stamp = performance.now(); renderStamps.push(stamp);
      while (renderStamps.length && stamp - renderStamps[0] > 2000) renderStamps.shift();
      lastDrawAt = stamp;
    }
    function tick(now) {
      raf = 0; if (disposed || lost) return;
      if (now - lastDrawAt < 1000 / 30) { schedule(); return; }
      rendering = true; dirty = false;
      if (transition) {
        const t = transition.duration ? clamp((now - transition.start) / transition.duration, 0, 1) : 1;
        const e = 1 - Math.pow(1 - t, 3);
        controls.target.lerpVectors(transition.fromTarget, transition.toTarget, e);
        camera.position.lerpVectors(transition.fromPosition, transition.toPosition, e);
        camera.zoom = T.MathUtils.lerp(transition.fromZoom, transition.toZoom, e); camera.updateProjectionMatrix();
        if (t >= 1) transition = null;
      }
      const changed = controls.update(); draw();
      rendering = false;
      if (transition || changed) dirty = true;
      schedule();
    }
    function schedule() { if (dirty && !disposed && !lost && !raf && !rendering) raf = requestAnimationFrame(tick); }
    function invalidate() { dirty = true; schedule(); }
    function render() { stats.renderRequests++; schedule(); }
    function getStats() {
      const sorted = renderTimes.slice().sort((a, b) => a - b), now = performance.now();
      const recent = renderStamps.filter((t) => now - t < 2000);
      return Object.assign({}, stats, {
        available: !lost && !disposed, quality, pixelRatio: effectiveDpr, idleMs: lastDrawAt ? now - lastDrawAt : null,
        renderMs: stats.frameTimeMs, cpuRenderMs: stats.frameTimeMs, calls: stats.drawCalls, dpr: effectiveDpr,
        renderHz: now - lastDrawAt > 1000 || recent.length < 2 ? 0 : (recent.length - 1) * 1000 / (recent[recent.length - 1] - recent[0]),
        averageFrameTimeMs: renderTimes.length ? renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length : 0,
        p95FrameTimeMs: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0,
        memory: Object.assign({}, renderer.info.memory), gpuTimerMs: null,
        note: 'Время кадра — CPU submit/update, не измерение времени GPU. Частота — фактическая отрисовка, в покое 0.',
        robotCount: frameRobots.size,
        activeIncidents: incidentLabels.size,
      });
    }
    const ray = new T.Raycaster(), pointer = new T.Vector2();
    ray.layers.enable(1);
    function hoverAt(e) {
      if (!root || down) return;
      const rect = canvas.getBoundingClientRect();
      pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const candidates = pickables.filter(obj => { const rec = obj.userData.record; return rec && ['person','section','zone'].includes(rec.kind) && allowed(rec); });
      const hits = ray.intersectObjects(candidates, false);
      const hit = hits.find(h => h.object.userData.record.kind === 'person') || hits.find(h => h.object.userData.record.kind === 'section') || hits[0];
      const rec = hit?.object.userData.record || null;
      showHover(rec, e);
    }
    function showHover(rec, e) {
      const rect = canvas.getBoundingClientRect();
      if (hovered !== rec?.id) { hovered = rec?.id || null; updateSelection(); invalidate(); }
      hoverInfo.hidden = !rec;
      if (!rec) return;
      hoverInfo.style.zIndex = rec.kind === 'incident' ? '5' : '1';
      const status = { in_progress:'В работе',completed:'Завершена',pending:'Ожидает',queued:'В очереди','at-curb':'У бордюра',requesting:'Ожидает освобождения перехода',crossing:'Проходит переход' };
      hoverInfo.textContent = [rec.name, ...Object.entries(rec.details).filter(([key]) => rec.kind === 'incident' ? ['Код','Серьёзность','Состояние','С момента обнаружения','Влияние','Действия','Сценарий'].includes(key) : rec.kind === 'person' ? ['Состояние','Ожидание','Переходов','Положение'].includes(key) : ['Задание','Площадь','Убрано','Прогресс','Роботы','Состояние','Размер','Тип'].includes(key)).map(([key,value]) => `${key}: ${status[value] || value}`)].join('\n');
      hoverInfo.style.left = Math.max(8, Math.min(rect.width - 275, e.clientX - rect.left + 15)) + 'px';
      hoverInfo.style.top = Math.max(55, Math.min(rect.height - 190, e.clientY - rect.top + 15)) + 'px';
    }
    listen(canvas, 'pointermove', hoverAt);
    listen(canvas, 'pointerleave', () => { hovered = null; hoverInfo.hidden = true; updateSelection(); invalidate(); });
    let down = null;
    listen(canvas, 'pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    listen(canvas, 'pointercancel', () => { down = null; });
    listen(canvas, 'pointerup', (e) => {
      const start = down; down = null;
      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5 || !root) return;
      const rect = canvas.getBoundingClientRect();
      pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(pickables, false).find((h) => {
        const rec = h.object.userData.record || (h.object.userData.records || [])[h.instanceId];
        return rec && allowed(rec) && (slice === null || h.point.y <= slice);
      });
      if (hit) { const rec = hit.object.userData.record || hit.object.userData.records[hit.instanceId]; select(rec); if (rec.kind === 'robot') onInspect?.(rec.id); else if (rec.kind === 'carrier' && rec.robotId !== null) onInspect?.('robot:' + rec.robotId); }
    });
    listen(canvas, 'keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home', 'Escape'].includes(e.key)) return;
      e.preventDefault(); transition = null;
      if (e.key === 'Home') return reset();
      if (e.key === 'Escape') return select(null);
      if (['+', '=', '-'].includes(e.key)) camera.zoom = clamp(camera.zoom * (e.key === '-' ? 0.85 : 1.18), controls.minZoom, controls.maxZoom);
      else {
        const step = fitSpan / camera.zoom * 0.04;
        const right = new T.Vector3().setFromMatrixColumn(camera.matrix, 0), up = new T.Vector3().setFromMatrixColumn(camera.matrix, 1);
        const delta = e.key === 'ArrowLeft' ? right.multiplyScalar(-step) : e.key === 'ArrowRight' ? right.multiplyScalar(step) : up.multiplyScalar(e.key === 'ArrowUp' ? step : -step);
        camera.position.add(delta); controls.target.add(delta);
      }
      camera.updateProjectionMatrix(); invalidate();
    });
    controls.addEventListener('change', invalidate);
    const cancelTransition = () => { transition = null; };
    controls.addEventListener('start', cancelTransition);
    listen(canvas, 'webglcontextlost', (e) => { e.preventDefault(); lost = true; cancelAnimationFrame(raf); raf = 0; say('Графический контекст потерян. Ожидаем восстановление; данные расчёта сохранены вне сцены.'); });
    listen(canvas, 'webglcontextrestored', () => { lost = false; say(''); resize(); invalidate(); });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    if (observer) observer.observe(container); else listen(window, 'resize', resize);
    function capturePng() {
      if (disposed || lost) return null;
      controls.update(); draw();
      const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
      const context = out.getContext('2d'); if (!context) return null;
      context.drawImage(canvas, 0, 0); const pr = canvas.width / width;
      context.scale(pr, pr); context.font = '500 11px system-ui,sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
      labels.filter((l) => l.visible).forEach((l) => {
        const lines = l.el.textContent.split('\n'), tw = Math.max(...lines.map((text) => context.measureText(text).width));
        context.fillStyle = '#e7eceb'; context.fillRect(l.sx - tw / 2 - 5, l.sy - lines.length * 9, tw + 10, lines.length * 18);
        context.fillStyle = '#30474b'; lines.forEach((text, i) => context.fillText(text, l.sx, l.sy + (i - (lines.length - 1) / 2) * 18));
      });
      return out.toDataURL('image/png');
    }
    function dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(raf); if (observer) observer.disconnect();
      listeners.forEach((remove) => remove()); controls.removeEventListener('change', invalidate); controls.removeEventListener('start', cancelTransition); controls.dispose();
      clearModel(); disposeFX(); persistent.forEach((r) => r.dispose()); persistent.clear();
      renderer.dispose(); if (renderer.forceContextLoss) renderer.forceContextLoss(); ownNodes.forEach((n) => n.remove());
    }
    resize();
    function projectRobot(id) {
      const rec = records.get('robot:' + id); if (!rec || !root) return null;
      const p = (rec.robotCenter || rec.center).clone().setY(cleaning ? 0.55 : 0.19).add(root.position).project(camera), rect = canvas.getBoundingClientRect();
      return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
    }
    function projectObject(id) {
      const rec = records.get(id); if (!rec || !root) return null;
      const p = rec.center.clone().add(root.position).project(camera), rect = canvas.getBoundingClientRect();
      return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
    }
    function setSafetyVisible(value) { safetyVisible = Boolean(value); if (safetyMesh) safetyMesh.visible = safetyVisible; invalidate(); }
    return { setModel, setFrame, setView, setLayer, setSlice, setQuality, setFollow, selectObject, inspectRobot, focusIncident, focus, reset, resize, render, getStats, capturePng, projectRobot, projectObject, setSafetyVisible, dispose };
  };
})();
