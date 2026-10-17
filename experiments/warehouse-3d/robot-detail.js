(function () {
  'use strict';

  // Photo-based exterior reconstruction, not manufacturer CAD. No simulation runs here.
  window.createRobotDetailViewer = function ({ container, onPartSelect }) {
    if (!container) throw new Error('Для модели робота нужен контейнер');
    const T = window.THREE, own = [], listeners = [], parts = new Map(), resources = new Set();
    let disposed = false, lost = false, raf = 0, dirty = true, moving = false, lastDraw = 0;
    let model = null, kind = null, selected = null, exploded = false, tween = null;
    let width = 0, height = 0, lastFrameKey = '', screenKey = '', screenCanvas = null, screenTexture = null;
    let wheels = [], brushes = [], lift = null, cargo = null, statusMaterials = [], meshCount = 0;
    const stats = { renderCount: 0, drawCalls: 0, triangles: 0, cpuRenderMs: 0 };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const RONAVI = 'https://ronavi-robotics.ru/catalogue/h1500';
    const PUDU = 'https://www.pudurobotics.com/en/products/puduCC1';
    const DIMS = { warehouse: { x: 1.044, y: 0.38, z: 0.654 }, cleaning: { x: 0.663, y: 0.682, z: 0.568 } };
    const node = document.createElement('div'); own.push(node); container.appendChild(node);
    Object.assign(node.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1' });
    const notice = document.createElement('div'); node.appendChild(notice);
    Object.assign(notice.style, { position: 'absolute', bottom: '12px', left: '12px', right: '12px', color: '#466063', font: '11px/1.45 system-ui,sans-serif', pointerEvents: 'none' });
    notice.textContent = 'Внешний вид по фотографиям · крепёж и монтаж условные · мышь: вращение и масштаб';
    const fallback = (text) => {
      notice.textContent = text;
      return { setRobot() { return []; }, setFrame() {}, setExploded() {}, resetView() {}, resize() {}, getParts() { return []; }, selectPart() { return false; }, getStats() { return { available: false }; }, dispose() { own.forEach((n) => n.remove()); } };
    };
    if (!T?.OrbitControls) return fallback('3D недоступно: библиотека не загружена. Характеристики доступны рядом.');
    let renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' }); }
    catch { return fallback('WebGL недоступен. Характеристики и состояние робота доступны рядом.'); }
    const canvas = renderer.domElement; own.push(canvas); container.insertBefore(canvas, node);
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none' });
    canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Детальная 3D-модель робота. Мышь вращает, колесо меняет масштаб. Home — общий вид.');
    renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
    renderer.setClearColor(0xe7eceb); renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false; renderer.info.autoReset = false;
    const scene = new T.Scene(); scene.background = new T.Color(0xe7eceb);
    const camera = new T.PerspectiveCamera(33, 1, 0.025, 30); camera.position.set(1.8, 1.2, 1.5);
    const controls = new T.OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = 0.15;
    controls.enablePan = true; controls.minPolarAngle = 0.08; controls.maxPolarAngle = Math.PI / 2 - 0.025;
    controls.minDistance = 0.35; controls.maxDistance = 6; controls.target.set(0, 0.25, 0);
    scene.add(new T.HemisphereLight(0xf5faf7, 0x7c8d8c, 0.5));
    const key = new T.DirectionalLight(0xfff3df, 1.7); key.position.set(2.5, 4.5, 2.6); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 4; key.shadow.bias = -0.0002; key.shadow.normalBias = 0.025;
    Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: 0.1, far: 12 }); scene.add(key);
    const fill = new T.DirectionalLight(0xc6e6ed, 0.6); fill.position.set(-2, 2, -3); scene.add(fill);
    const rim = new T.DirectionalLight(0xffffff, 0.8); rim.position.set(-2, 3, 1); scene.add(rim);
    // A small procedural studio supplies soft reflections without network assets.
    const studio = new T.Scene(); studio.background = new T.Color(0xb9c4c4);
    const panels = [];
    for (const [x, y, z, w, h, d, color] of [[0, 4, 0, 7, 0.1, 7, 0xffffff], [4, 1, 0, 0.1, 4, 5, 0xdde5e4], [-4, 1, 0, 0.1, 4, 5, 0x748c91], [0, 1, -4, 6, 4, 0.1, 0xffffff]]) {
      const g = new T.BoxGeometry(w, h, d), m = new T.MeshBasicMaterial({ color }), o = new T.Mesh(g, m); o.position.set(x, y, z); studio.add(o); panels.push([g, m]);
    }
    let environment = null;
    try { const pm = new T.PMREMGenerator(renderer); environment = pm.fromScene(studio, 0.04); scene.environment = environment.texture; pm.dispose(); }
    catch { /* Direct studio lights still provide a complete rendering fallback. */ }
    panels.forEach(([g, m]) => { g.dispose(); m.dispose(); });
    const floorGeometry = new T.CircleGeometry(2.2, 96), floorMaterial = new T.MeshStandardMaterial({ color: 0xbac7c5, roughness: 0.86, metalness: 0.08 });
    const floor = new T.Mesh(floorGeometry, floorMaterial); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.008; floor.receiveShadow = true; scene.add(floor);
    const helper = new T.Box3Helper(new T.Box3(), 0x078c91); helper.material.depthTest = false; helper.material.transparent = true; helper.material.opacity = 0.65; helper.visible = false; scene.add(helper);
    const geometryCache = new Map(), materialCache = new Map();
    const ownResource = (value) => { resources.add(value); return value; };
    function material(color, roughness = 0.45, metalness = 0, extra = {}) {
      const cacheKey = [color, roughness, metalness, JSON.stringify(extra)].join('|');
      if (!materialCache.has(cacheKey)) materialCache.set(cacheKey, ownResource(new T.MeshStandardMaterial(Object.assign({ color: new T.Color(color).convertSRGBToLinear(), roughness, metalness, envMapIntensity: 0.45 }, extra))));
      return materialCache.get(cacheKey);
    }
    function rounded(w, h, d, radius = 0.02) {
      const cacheKey = ['rounded', w, h, d, radius].join('|'); if (geometryCache.has(cacheKey)) return geometryCache.get(cacheKey);
      const r = Math.min(radius, w / 4, h / 4, d / 4), s = new T.Shape(), x = w / 2, y = h / 2;
      s.moveTo(-x + r, -y); s.lineTo(x - r, -y); s.quadraticCurveTo(x, -y, x, -y + r); s.lineTo(x, y - r); s.quadraticCurveTo(x, y, x - r, y); s.lineTo(-x + r, y); s.quadraticCurveTo(-x, y, -x, y - r); s.lineTo(-x, -y + r); s.quadraticCurveTo(-x, -y, -x + r, -y);
      const g = new T.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelSize: r * 0.45, bevelThickness: r * 0.45, bevelSegments: 3, curveSegments: 6 });
      g.computeBoundingBox(); const size = g.boundingBox.getSize(new T.Vector3()), centre = g.boundingBox.getCenter(new T.Vector3());
      g.translate(-centre.x, -centre.y, -centre.z); g.scale(w / size.x, h / size.y, d / size.z); g.computeVertexNormals();
      geometryCache.set(cacheKey, ownResource(g)); return g;
    }
    function cylinder(radius, height, segments = 40, top = radius) {
      const cacheKey = ['cyl', radius, height, segments, top].join('|');
      if (!geometryCache.has(cacheKey)) geometryCache.set(cacheKey, ownResource(new T.CylinderGeometry(top, radius, height, segments)));
      return geometryCache.get(cacheKey);
    }
    function put(parent, geometry, mat, x = 0, y = 0, z = 0) {
      const mesh = new T.Mesh(geometry, mat); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); meshCount++; return mesh;
    }
    function box(parent, w, h, d, mat, x, y, z, r = 0.006) { return put(parent, rounded(w, h, d, r), mat, x, y, z); }
    function cyl(parent, radius, height, mat, x, y, z, axis = 'y', segments = 40) {
      const o = put(parent, cylinder(radius, height, segments), mat, x, y, z);
      if (axis === 'x') o.rotation.z = -Math.PI / 2; if (axis === 'z') o.rotation.x = Math.PI / 2; return o;
    }
    const official = (url, note = 'Внешняя форма по фотографии; точная геометрия реконструирована') => ({ kind: 'manufacturer', label: note, url });
    const reconstruction = (url, note = 'Условная визуальная реконструкция; не чертёж и не схема устройства') => ({ kind: 'visual-reconstruction', label: note, url });
    function part(id, name, description, source, offset) {
      const group = new T.Group(); group.userData.part = id; model.add(group);
      parts.set(id, { id, name, description, source, group, offset: new T.Vector3(...offset), base: group.position.clone() }); return group;
    }
    function screw(parent, x, y, z, axis = 'y') {
      const steel = material(0xb6bdc0, 0.3, 0.82), black = material(0x293337, 0.7);
      cyl(parent, 0.0048, 0.001, steel, x, y, z, axis, 20); const head = cyl(parent, 0.0035, 0.0022, steel, x, y, z, axis, 8);
      const slot = box(parent, 0.004, 0.00035, 0.00065, black, 0, 0, 0, 0.0001); slot.position.copy(head.position);
      if (axis === 'y') slot.position.y += 0.0014; else if (axis === 'x') { slot.rotation.z = -Math.PI / 2; slot.position.x += 0.0014; } else { slot.rotation.x = Math.PI / 2; slot.position.z += 0.0014; }
    }
    function decal(parent, w, h, x, y, z, face, paint) {
      const c = document.createElement('canvas'); c.width = 1024; c.height = Math.max(128, Math.round(1024 * h / w)); paint(c.getContext('2d'), c.width, c.height);
      const texture = ownResource(new T.CanvasTexture(c)); texture.encoding = T.sRGBEncoding; texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      const m = ownResource(new T.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.5, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, envMapIntensity: 0.2 }));
      const o = put(parent, ownResource(new T.PlaneGeometry(w, h)), m, x, y, z); o.castShadow = false;
      if (face === 'x') o.rotation.y = Math.PI / 2; if (face === '-x') o.rotation.y = -Math.PI / 2; if (face === 'y') o.rotation.x = -Math.PI / 2; if (face === '-z') o.rotation.y = Math.PI;
      return { canvas: c, texture, mesh: o };
    }
    function lettering(text, color = '#e7eeed', size = 0.5) { return (ctx, w, h) => { ctx.clearRect(0, 0, w, h); ctx.fillStyle = color; ctx.font = '600 ' + Math.round(h * size) + 'px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w / 2, h / 2); }; }
    function wheel(parent, x, y, z, radius, widthM) {
      const group = new T.Group(); group.position.set(x, y, z); parent.add(group);
      cyl(group, radius, widthM, material(0x202629, 0.86), 0, 0, 0, 'z', 64);
      for (const sign of [-1, 1]) {
        cyl(group, radius * 0.61, 0.007, material(0x8c979b, 0.31, 0.8), 0, 0, sign * widthM / 2, 'z', 40);
        cyl(group, radius * 0.23, 0.01, material(0x343e43, 0.35, 0.75), 0, 0, sign * (widthM / 2 + 0.004), 'z', 16);
        for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; screw(group, Math.cos(a) * radius * 0.43, Math.sin(a) * radius * 0.43, sign * (widthM / 2 + 0.005), 'z'); }
      }
      for (let i = 0; i < 32; i++) {
        const a = i * Math.PI / 16, tread = box(group, 0.009, 0.003, widthM * 0.85, material(0x30383b, 0.92), Math.sin(a) * radius, Math.cos(a) * radius, 0, 0.0005); tread.rotation.z = -a;
      }
      wheels.push({ group, radius, trackOffset: z }); return group;
    }
    function buildWarehouse() {
      const dark = material(0x30383b, 0.45, 0.35), lidMat = material(0x252a2c, 0.43, 0.22), rubber = material(0x1b2426, 0.86), steel = material(0xb8bfc1, 0.3, 0.85), yellow = material(0xe6de27, 0.4, 0.05);
      const frame = part('h1500-frame', 'Нижнее шасси', 'Низкая несущая платформа. Габарит оболочки 1044 × 654 × 380 мм по странице Ronavi; монтажные элементы упрощены.', official(RONAVI), [0, -0.05, 0]);
      box(frame, 0.99, 0.13, 0.61, dark, 0, 0.14, 0, 0.022);
      for (const s of [-1, 1]) { box(frame, 0.81, 0.026, 0.018, steel, 0, 0.205, s * 0.25); for (const x of [-0.35, -0.12, 0.12, 0.35]) screw(frame, x, 0.218, s * 0.25); }
      const bumper = part('h1500-bumper', 'Защитный нижний пояс', 'Наружный защитный пояс и угловые вырезы воспроизведены по фото. Это не расчёт контакта или безопасности.', official(RONAVI), [0.04, -0.03, 0]);
      box(bumper, 1.024, 0.095, 0.642, rubber, 0, 0.075, 0, 0.022);
      for (const s of [-1, 1]) { box(bumper, 0.007, 0.075, 0.008, yellow, 0.514, 0.088, s * 0.297); box(bumper, 0.84, 0.007, 0.006, dark, 0, 0.043, s * 0.323); }
      const top = part('h1500-platform', 'Верхняя грузовая платформа', 'Четыре опоры и верхняя плита по официальному фото. Подъём в просмотре следует handlingProgress модели; конструкция подъёмника не моделируется.', official(RONAVI), [0, 0.23, 0]); lift = top;
      box(top, 1.044, 0.091, 0.654, lidMat, 0, 0.312, 0, 0.012);
      box(top, 0.975, 0.012, 0.587, material(0x444a4c, 0.48, 0.62), 0, 0.36, 0, 0.008);
      for (const x of [-0.365, 0.365]) for (const z of [-0.225, 0.225]) {
        cyl(top, 0.03, 0.006, dark, x, 0.368, z); cyl(top, 0.018, 0.013, steel, x, 0.373, z, 'y', 32);
        for (let a = 0; a < 4; a++) screw(top, x + Math.cos(a * Math.PI / 2) * 0.024, 0.372, z + Math.sin(a * Math.PI / 2) * 0.024);
      }
      for (const x of [-0.475, 0.475]) for (const z of [-0.275, 0, 0.275]) screw(top, x, 0.367, z);
      decal(top, 0.22, 0.045, 0.524, 0.316, 0, 'x', lettering('H1500', '#e9e12f', 0.74));
      decal(top, 0.34, 0.045, -0.08, 0.368, 0.05, 'y', lettering('RONAVI  ·  H1500', '#bac5c4', 0.55));
      const face = part('h1500-interface', 'Передний интерфейс и световая полоса', 'Положение световой полосы, кнопки и тёмного окна — по фотографии. Геометрия оптики условная; работа датчиков здесь не симулируется.', official(RONAVI), [0.2, 0.035, 0]);
      box(face, 0.022, 0.077, 0.58, dark, 0.501, 0.217, 0, 0.006);
      const led = material(0xcdeef0, 0.2, 0.15, { emissive: 0x85bbc1, emissiveIntensity: 0.5 }); statusMaterials.push(led);
      box(face, 0.006, 0.009, 0.545, led, 0.516, 0.246, 0, 0.002);
      box(face, 0.009, 0.035, 0.115, material(0x080f13, 0.13, 0.3), 0.516, 0.207, 0, 0.004);
      for (const z of [-0.026, 0.026]) cyl(face, 0.008, 0.003, material(0x18323d, 0.1, 0.45), 0.522, 0.208, z, 'x');
      for (const z of [-0.25, -0.18, 0.18, 0.25]) screw(face, 0.519, 0.217, z, 'x');
      const stop = part('h1500-estop', 'Аварийная кнопка', 'Внешняя красная кнопка видна на фотографии. Просмотр не является интерфейсом управления настоящим роботом.', official(RONAVI), [0.22, 0.06, -0.1]);
      box(stop, 0.009, 0.061, 0.06, yellow, 0.516, 0.215, -0.263, 0.002); cyl(stop, 0.024, 0.012, rubber, 0.525, 0.215, -0.263, 'x'); cyl(stop, 0.0185, 0.018, material(0xbc332d, 0.4), 0.537, 0.215, -0.263, 'x');
      const covers = part('h1500-service', 'Сервисные панели и вентиляция', 'Швы и наружный крепёж показаны для чтения сборок. Положение прорезей и элементов обслуживания — визуальная реконструкция.', reconstruction(RONAVI), [-0.12, 0.02, 0.19]);
      for (const s of [-1, 1]) {
        box(covers, 0.66, 0.09, 0.009, dark, -0.04, 0.143, s * 0.311, 0.005);
        for (let i = 0; i < 12; i++) box(covers, 0.004, 0.025, 0.002, rubber, -0.19 + i * 0.012, 0.149, s * 0.317, 0.0005);
        for (const x of [-0.34, 0.26]) for (const y of [0.116, 0.177]) screw(covers, x, y, s * 0.318, 'z');
      }
      decal(bumper, 0.26, 0.045, 0.516, 0.076, 0, 'x', lettering('RONAVI', '#e8e12c', 0.74));
      for (const s of [-1, 1]) {
        const drive = part('h1500-drive-' + (s < 0 ? 'left' : 'right'), s < 0 ? 'Левая ходовая сборка' : 'Правая ходовая сборка', 'Колёса и наружные монтажные кронштейны. Расположение привода условное: подробной конструкторской документации нет.', reconstruction(RONAVI), [0, -0.02, s * 0.22]);
        wheel(drive, 0.02, 0.086, s * 0.27, 0.083, 0.058); box(drive, 0.19, 0.025, 0.095, steel, 0.02, 0.18, s * 0.24);
      }
      const payload = part('h1500-payload', 'Паллета выбранного задания', 'Условная тара для показа текущей погрузки. Размер и масса конкретного груза не получены из телеметрии.', reconstruction(RONAVI), [0, 0.4, 0]); cargo = payload;
      for (let i = 0; i < 5; i++) box(payload, 0.98, 0.018, 0.102, material(0xb79d70, 0.86), 0, 0.424, (i - 2) * 0.115, 0.002);
      for (const z of [-0.2, 0, 0.2]) box(payload, 0.85, 0.047, 0.055, material(0x8e7957, 0.9), 0, 0.394, z, 0.002);
      box(payload, 0.78, 0.31, 0.43, material(0xc0ad89, 0.87), 0, 0.589, 0, 0.008);
      for (const x of [-0.24, 0.24]) box(payload, 0.009, 0.314, 0.434, material(0x78827d, 0.83), x, 0.589, 0, 0.001);
    }
    function buildCleaning() {
      const silver = material(0xe4e6e5, 0.37, 0.1), graphite = material(0x252d31, 0.3, 0.18), rubber = material(0x1e2628, 0.87), green = material(0xaed714, 0.4, 0.02), steel = material(0xb1babd, 0.26, 0.85);
      const chassis = part('cc1-base', 'Нижняя платформа и бампер', 'Ступенчатая нижняя часть CC1 по официальному изображению. Общая оболочка построена в масштабе 663 × 568 × 682 мм из материала производителя.', official(PUDU), [0, -0.045, 0]);
      box(chassis, 0.646, 0.088, 0.549, silver, 0, 0.115, 0, 0.035); box(chassis, 0.632, 0.033, 0.539, material(0xbfc8cc, 0.55, 0.15), 0, 0.066, 0, 0.012);
      box(chassis, 0.018, 0.015, 0.088, rubber, 0.321, 0.148, 0, 0.006);
      const body = part('cc1-body', 'Верхний корпус', 'Серебристый сужающийся корпус воспроизведён по фотографиям PUDU. Швы и толщины стенок условные; баки внутри не показаны.', official(PUDU), [0, 0.16, 0]);
      const shell = rounded(0.59, 0.418, 0.497, 0.055).clone(); ownResource(shell);
      const positions = shell.attributes.position;
      for (let i = 0; i < positions.count; i++) { const t = (positions.getY(i) + 0.209) / 0.418; positions.setX(i, positions.getX(i) * (1 - t * 0.09) - t * 0.014); positions.setZ(i, positions.getZ(i) * (1 - t * 0.08)); }
      shell.computeVertexNormals(); put(body, shell, silver, -0.015, 0.412, 0);
      box(body, 0.49, 0.055, 0.425, material(0xaab4b7, 0.45, 0.2), -0.02, 0.184, 0, 0.018);
      for (const s of [-1, 1]) {
        const panel = part('cc1-side-' + (s < 0 ? 'left' : 'right'), s < 0 ? 'Левая боковая панель' : 'Правая боковая панель', 'Характерная зелёная боковая крышка CC1. Наружная форма — по фотографии; крепления и толщина реконструированы.', official(PUDU), [0, 0.025, s * 0.17]);
        const shape = new T.Shape(); shape.moveTo(-0.245, -0.17); shape.quadraticCurveTo(-0.27, -0.17, -0.27, -0.13); shape.lineTo(-0.25, 0.13); shape.quadraticCurveTo(-0.245, 0.19, -0.19, 0.19); shape.lineTo(0.11, 0.18); shape.quadraticCurveTo(0.16, 0.17, 0.18, 0.1); shape.lineTo(0.195, -0.12); shape.quadraticCurveTo(0.19, -0.18, 0.13, -0.185); shape.closePath();
        const geometry = ownResource(new T.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 3, curveSegments: 10 }));
        const mesh = put(panel, geometry, green, 0, 0.417, s * 0.242); if (s < 0) mesh.rotation.y = Math.PI;
        for (const x of [-0.2, 0.1]) screw(panel, x, 0.24, s * 0.255, 'z');
      }
      const top = part('cc1-lid', 'Верхняя крышка и аварийная кнопка', 'Тёмная верхняя крышка и красная наружная кнопка по фото. Никакие команды настоящему устройству не отправляются.', official(PUDU), [0, 0.25, 0]);
      box(top, 0.548, 0.047, 0.464, graphite, -0.03, 0.642, 0, 0.025);
      cyl(top, 0.017, 0.007, steel, -0.12, 0.67, 0.14); cyl(top, 0.0125, 0.012, material(0xba332c, 0.35), -0.12, 0.676, 0.14);
      for (const x of [-0.23, 0.18]) for (const z of [-0.17, 0.17]) screw(top, x, 0.665, z);
      const display = part('cc1-display', 'Наклонный дисплей', 'Наружный экран и характерная графика CC1 — по официальному фото. Процент заряда и подпись режима выводятся из кадра демонстрации, а не с настоящего робота.', official(PUDU), [0.19, 0.12, 0]);
      const head = new T.Group(); head.position.set(0.257, 0.568, 0); head.rotation.z = 0.13; display.add(head);
      box(head, 0.046, 0.176, 0.375, material(0x7c898f, 0.38, 0.3), 0, 0, 0, 0.025);
      box(head, 0.018, 0.151, 0.343, material(0x0a1115, 0.14, 0.25), 0.028, 0, 0, 0.025);
      const lcd = decal(head, 0.315, 0.13, 0.038, 0, 0, 'x', () => {}); screenCanvas = lcd.canvas; screenTexture = lcd.texture;
      const sensors = part('cc1-front', 'Передняя наружная панель', 'Четыре круглых окна и вертикальная чёрная вставка видны на фото. Типы датчиков и их измерения не реконструируются.', official(PUDU), [0.18, 0.025, 0]);
      box(sensors, 0.009, 0.168, 0.032, graphite, 0.281, 0.346, 0, 0.013);
      decal(sensors, 0.025, 0.029, 0.287, 0.298, 0, 'x', lettering('PUDU', '#57d0dd', 0.36));
      for (const s of [-1, 1]) {
        box(sensors, 0.007, 0.043, 0.077, material(0xc0c8cb, 0.42, 0.1), 0.281, 0.254, s * 0.168, 0.01);
        for (const dz of [-0.018, 0.018]) { cyl(sensors, 0.012, 0.004, graphite, 0.288, 0.254, s * 0.168 + dz, 'x'); cyl(sensors, 0.0083, 0.005, material(0x0b1820, 0.12, 0.32), 0.291, 0.254, s * 0.168 + dz, 'x'); }
      }
      const handle = part('cc1-handle', 'Складная рукоятка', 'Наличие выдвижной рукоятки подтверждено PUDU. Её задние крепления и показанное сложенное положение воспроизведены приблизительно.', official(PUDU), [-0.16, 0.12, 0]);
      for (const s of [-1, 1]) { box(handle, 0.022, 0.145, 0.022, steel, -0.267, 0.56, s * 0.17); screw(handle, -0.281, 0.49, s * 0.17, 'x'); }
      box(handle, 0.031, 0.028, 0.37, rubber, -0.267, 0.635, 0, 0.012);
      for (const s of [-1, 1]) { const drive = part('cc1-wheel-' + (s < 0 ? 'left' : 'right'), s < 0 ? 'Левое колесо' : 'Правое колесо', 'Наружное колесо и протектор — визуальная реконструкция. Передаточное отношение и мотор внутри не показаны.', reconstruction(PUDU), [0, -0.02, s * 0.16]); wheel(drive, -0.07, 0.076, s * 0.231, 0.074, 0.04); }
      const sweep = part('cc1-side-brush', 'Боковая щётка', 'Боковая щётка видна на официальном изображении. Положение каждой щетинки и скорость вращения условные. Поворот следует накопленному времени уборки в демонстрации.', official(PUDU), [0.1, -0.055, -0.11]);
      const brush = new T.Group(); brush.position.set(0.205, 0.022, -0.15); sweep.add(brush); brushes.push(brush);
      cyl(brush, 0.036, 0.025, graphite, 0, 0.013, 0); cyl(brush, 0.013, 0.027, steel, 0, 0.02, 0);
      for (let i = 0; i < 36; i++) { const a = i * Math.PI / 18, b = box(brush, 0.096, 0.004, 0.0035, rubber, Math.cos(a) * 0.073, 0.003, Math.sin(a) * 0.073, 0.0005); b.rotation.y = -a; }
      const scrub = part('cc1-roller', 'Рабочий ролик', 'Роликовая щётка — подтверждённый внешний рабочий узел CC1. Спираль щетины и крепления показаны условно; модельный след уборки рассчитывается отдельно.', official('https://www.pudurobotics.com/about/news/61dd22ea6b37480044d70f3f'), [0.03, -0.09, 0]);
      const roll = new T.Group(); roll.position.set(0.02, 0.045, 0); scrub.add(roll);
      cyl(roll, 0.041, 0.4, rubber, 0, 0, 0, 'z', 64);
      for (let i = 0; i < 18; i++) { const a = i * Math.PI / 9, row = box(roll, 0.008, 0.006, 0.39, material(0x4b5555, 0.95), Math.sin(a) * 0.041, Math.cos(a) * 0.041, 0, 0.001); row.rotation.z = -a; }
      roll.userData.brushAxis = 'z'; roll.userData.brushSign = -1; brushes.push(roll);
      const squeegee = part('cc1-squeegee', 'Задний скребок', 'Наружный сменный скребок и небольшие направляющие колёса — по устройству рабочего узла CC1. Крепёж и точная кривизна реконструированы.', reconstruction(PUDU), [-0.1, -0.06, 0]);
      box(squeegee, 0.032, 0.034, 0.502, steel, -0.29, 0.037, 0, 0.009); box(squeegee, 0.009, 0.025, 0.49, rubber, -0.309, 0.024, 0, 0.004);
      for (const s of [-1, 1]) { cyl(squeegee, 0.022, 0.018, rubber, -0.292, 0.023, s * 0.252, 'z'); box(squeegee, 0.04, 0.039, 0.024, material(0xb64437, 0.55), -0.288, 0.04, s * 0.25); }
      const service = part('cc1-service', 'Задняя сервисная панель', 'CC1 поддерживает стыковку, зарядку и обслуживание воды. Наружные сервисные соединения и прорези здесь — условная реконструкция, не схема подключения.', reconstruction(PUDU), [-0.18, 0.02, 0]);
      box(service, 0.008, 0.17, 0.31, material(0xbac3c5, 0.48, 0.15), -0.3, 0.32, 0, 0.006);
      for (const z of [-0.11, 0.11]) { cyl(service, 0.019, 0.008, steel, -0.309, 0.3, z, 'x'); cyl(service, 0.011, 0.01, graphite, -0.314, 0.3, z, 'x'); }
      for (let i = 0; i < 9; i++) box(service, 0.002, 0.005, 0.12, graphite, -0.306, 0.34 + i * 0.006, 0, 0.0005);
    }
    function publicPart(p) { return { id: p.id, name: p.name, description: p.description, source: p.source }; }
    function getParts() { return Array.from(parts.values(), publicPart); }
    function selectPart(id) {
      const p = parts.get(String(id)); if (!p) return false;
      selected = p.id; scene.updateMatrixWorld(true); helper.box.setFromObject(p.group); helper.visible = true;
      if (typeof onPartSelect === 'function') onPartSelect(publicPart(p)); invalidate(); return true;
    }
    function clearModel() {
      if (model) scene.remove(model);
      resources.forEach((r) => r.dispose()); resources.clear(); geometryCache.clear(); materialCache.clear(); parts.clear();
      model = null; selected = null; tween = null; helper.visible = false; wheels = []; brushes = []; lift = cargo = null; statusMaterials = [];
      screenCanvas = screenTexture = null; screenKey = lastFrameKey = ''; meshCount = 0;
    }
    function setRobot(value) {
      if (disposed) return [];
      const nextKind = value?.kind === 'cleaning' ? 'cleaning' : 'warehouse';
      if (!model || kind !== nextKind) {
        clearModel(); kind = nextKind; model = new T.Group(); scene.add(model); exploded = false;
        notice.textContent = 'Внешний вид по фотографиям · крепёж и монтаж условные · мышь: вращение и масштаб';
        if (kind === 'warehouse') buildWarehouse(); else buildCleaning();
      }
      setFrame(value?.robot || value); resetView(); renderer.shadowMap.needsUpdate = true; invalidate(); return getParts();
    }
    function setFrame(value) {
      if (disposed || !model || !value) return;
      const workingClock = Number.isFinite(value.timeByPhase?.working) ? Math.max(0, value.timeByPhase.working) : Number.isFinite(value.cleanedM2) ? Math.max(0, value.cleanedM2) : 0;
      const frameKey = [value.id, value.phase, value.loaded, value.soc, value.distanceM, value.handlingProgress, value.heading, value.working, workingClock, value.operationalState, value.incident?.code, value.incident?.status].join('|');
      if (frameKey === lastFrameKey) return; lastFrameKey = frameKey;
      const distance = Number.isFinite(value.distanceM) ? value.distanceM : 0;
      const heading = Number.isFinite(value.heading) ? value.heading : 0;
      wheels.forEach((w) => { w.group.rotation.z = -(distance + heading * (w.trackOffset || 0)) / w.radius; });
      brushes.forEach((b) => { b.rotation[b.userData.brushAxis || 'y'] = workingClock * 12 * (b.userData.brushSign || 1); });
      const handling = Number.isFinite(value.handlingProgress) ? Math.max(0, Math.min(1, value.handlingProgress)) : value.loaded ? 1 : 0;
      const height = value.phase === 'loading' ? handling : value.phase === 'unloading' ? 1 - handling : value.loaded ? 1 : 0;
      if (lift) { lift.userData.lift = height * 0.025; lift.position.y = (exploded ? parts.get('h1500-platform').offset.y : 0) + height * 0.025; }
      if (cargo) { cargo.visible = !!value.loaded || value.phase === 'loading'; cargo.userData.lift = height * 0.025; cargo.position.y = (exploded ? parts.get('h1500-payload').offset.y : 0) + height * 0.025; }
      const tone = value.incident?.severity === 'critical' ? 0xe35b43 : value.incident ? 0xe2ac48 : /charg/i.test(value.phase || '') ? 0x58c18d : /wait/i.test(value.phase || '') ? 0xe2ac48 : 0x9fdce4;
      statusMaterials.forEach((m) => { m.emissive.setHex(tone).convertSRGBToLinear(); });
      const soc = Number.isFinite(value.soc) ? Math.round(value.soc <= 1 ? value.soc * 100 : value.soc) : null;
      const nextScreen = value.phase + '|' + soc + '|' + (value.incident?.code || '');
      if (screenCanvas && screenKey !== nextScreen) {
        const ctx = screenCanvas.getContext('2d'), w = screenCanvas.width, h = screenCanvas.height;
        ctx.fillStyle = '#0b151b'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#e8f0ef'; ctx.lineWidth = h * 0.045; ctx.lineCap = 'round';
        for (const x of [w * 0.36, w * 0.64]) { ctx.beginPath(); ctx.ellipse(x, h * 0.37, w * 0.055, h * 0.2, 0, 0, Math.PI * 2); ctx.stroke(); }
        ctx.fillStyle = value.incident ? '#f5b0a0' : '#a6d4cf'; ctx.font = '500 ' + Math.round(h * 0.1) + 'px Arial'; ctx.textAlign = 'center'; ctx.fillText((value.incident ? value.incident.code : value.working ? 'CLEANING' : /charg/i.test(value.phase || '') ? 'CHARGING' : 'DEMO') + (soc === null ? '' : '  ·  ' + soc + '%'), w / 2, h * 0.87);
        screenTexture.needsUpdate = true; screenKey = nextScreen;
      }
      renderer.shadowMap.needsUpdate = true; invalidate();
    }
    function setExploded(value) {
      if (disposed || !model) return;
      if (exploded === !!value && !tween) return;
      exploded = !!value;
      tween = { start: performance.now(), duration: reduce.matches ? 0 : 520, entries: Array.from(parts.values(), (p) => ({ p, from: p.group.position.clone(), to: (exploded ? p.offset.clone() : new T.Vector3()).add(new T.Vector3(0, p.group.userData.lift || 0, 0)) })) };
      notice.textContent = exploded ? 'Условное разнесение наружных сборок · не конструкционная схема · выберите деталь' : 'Внешний вид по фотографиям · крепёж и монтаж условные · мышь: вращение и масштаб';
      resetView(); invalidate();
    }
    function resetView() {
      if (disposed || !model) return;
      scene.updateMatrixWorld(true);
      const bounds = new T.Box3();
      parts.forEach((p) => {
        if (!p.group.visible) return;
        const destination = (exploded ? p.offset.clone() : new T.Vector3()).add(new T.Vector3(0, p.group.userData.lift || 0, 0));
        const box = new T.Box3().setFromObject(p.group); box.translate(destination.sub(p.group.position)); bounds.union(box);
      });
      const target = bounds.getCenter(new T.Vector3()), radius = bounds.getSize(new T.Vector3()).length() / 2;
      const distance = radius / Math.sin(camera.fov * Math.PI / 360) / Math.min(1, camera.aspect) * 1.12;
      controls.target.copy(target); camera.position.copy(target).addScaledVector(new T.Vector3(1, 0.67, 1.1).normalize(), distance);
      controls.minDistance = radius * 0.5; controls.maxDistance = distance * 2.5; camera.lookAt(target); controls.update(); invalidate();
    }
    function resize() {
      if (disposed || lost) return;
      const w = container.clientWidth, h = container.clientHeight; if (w < 2 || h < 2) return;
      const changed = width !== w || height !== h; width = w; height = h;
      const pr = Math.min(window.devicePixelRatio || 1, 1.5); if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);
      if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix(); if (changed && model) resetView(); invalidate();
    }
    function draw(now) {
      raf = 0; if (disposed || lost) return;
      if (now - lastDraw < 1000 / 30) { schedule(); return; }
      moving = true; dirty = false;
      if (tween) {
        const t = tween.duration ? Math.min(1, (now - tween.start) / tween.duration) : 1, ease = 1 - Math.pow(1 - t, 3);
        tween.entries.forEach(({ p, from, to }) => p.group.position.lerpVectors(from, to, ease)); renderer.shadowMap.needsUpdate = true;
        if (t >= 1) tween = null;
      }
      const changed = controls.update(); if (selected && parts.has(selected)) { scene.updateMatrixWorld(true); helper.box.setFromObject(parts.get(selected).group); }
      const start = performance.now(); renderer.info.reset(); renderer.render(scene, camera);
      stats.renderCount++; stats.drawCalls = renderer.info.render.calls; stats.triangles = renderer.info.render.triangles; stats.cpuRenderMs = performance.now() - start;
      lastDraw = performance.now(); moving = false; if (changed || tween) dirty = true; schedule();
    }
    function schedule() { if (dirty && !disposed && !lost && !moving && !raf) raf = requestAnimationFrame(draw); }
    function invalidate() { dirty = true; schedule(); }
    const ray = new T.Raycaster(), mouse = new T.Vector2(); let down = null;
    function listen(element, event, fn) { element.addEventListener(event, fn); listeners.push(() => element.removeEventListener(event, fn)); }
    listen(canvas, 'pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    listen(canvas, 'pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || !model) return; down = null;
      const r = canvas.getBoundingClientRect(); mouse.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
      scene.updateMatrixWorld(true); ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObject(model, true).find((h) => { let p = h.object; while (p && p !== model) { if (!p.visible) return false; p = p.parent; } return true; });
      if (!hit) return;
      let p = hit.object; while (p && !p.userData.part) p = p.parent; if (p) selectPart(p.userData.part);
    });
    listen(canvas, 'keydown', (e) => { if (e.key === 'Home') { e.preventDefault(); resetView(); } if (e.key === 'Escape') { selected = null; helper.visible = false; invalidate(); } });
    listen(canvas, 'webglcontextlost', (e) => { e.preventDefault(); lost = true; cancelAnimationFrame(raf); raf = 0; notice.textContent = 'Графический контекст потерян. Характеристики и данные работы сохранены вне 3D.'; });
    listen(canvas, 'webglcontextrestored', () => { lost = false; renderer.shadowMap.needsUpdate = true; resize(); invalidate(); });
    controls.addEventListener('change', invalidate);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null; observer?.observe(container);
    function getStats() { return Object.assign({}, stats, { available: !disposed && !lost, idleMs: performance.now() - lastDraw, memory: Object.assign({}, renderer.info.memory), meshCount, parts: parts.size, kind, exploded, pixelRatio: renderer.getPixelRatio(), dimensionsM: DIMS[kind] || null }); }
    function dispose() {
      if (disposed) return; disposed = true; cancelAnimationFrame(raf); observer?.disconnect(); listeners.forEach((f) => f()); controls.removeEventListener('change', invalidate); controls.dispose();
      clearModel(); floorGeometry.dispose(); floorMaterial.dispose(); helper.geometry.dispose(); helper.material.dispose(); environment?.dispose();
      renderer.dispose(); renderer.forceContextLoss?.(); own.forEach((n) => n.remove());
    }
    resize();
    return { setRobot, setFrame, setExploded, resetView, resize, getParts, selectPart, getStats, dispose };
  };
})();
