import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { MOBILE_RACK_SPEC } from "./carriers";

const source = readFileSync(new URL("./scene.js", import.meta.url), "utf8");
const between = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end));
type Pod = { id: string; x: number; y: number; contents: "full" | "empty"; heading: number; liftM: number; phase: string; robotId: number | null; taskId: number | null };
type CarrierPiece = {
  mat: string; x: number; y: number; z: number; w: number; h: number; d: number;
  detail?: boolean; role: string; lod?: string; cargo?: boolean;
};
type VectorLike = {
  x: number; y: number; z: number;
  set(x: number, y: number, z: number): VectorLike;
};
type CarrierRecord = {
  id: string; name: string; kind: string; center: VectorLike; size: VectorLike;
  details: Record<string, string | number>; robotId?: string | null; liftM?: number;
};


function harness(revealFix = true) {
  const metrics = { formatCalls: 0 };
  class Vector {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
    project() { this.x *= context.projection; this.y *= context.projection; return this; }
  }
  class Attribute {
    array: Float32Array;
    updateRange = { offset: 0, count: -1 };
    version = 0;
    constructor(count: number) { this.array = new Float32Array(count * 16); }
    setUsage() { return this; }
    set needsUpdate(value: boolean) { if (value) this.version++; }
  }
  class Mesh {
    userData: { records?: CarrierRecord[]; components?: CarrierPiece[]; componentRole?: string } = {};
    onAfterRender?: () => void;
    instanceMatrix: Attribute;
    visible = true;
    count = 0;
    constructor(_geometry: unknown, _material: unknown, count: number) { this.instanceMatrix = new Attribute(count); }
    setMatrixAt(index: number, matrix: Float32Array) { this.instanceMatrix.array.set(matrix, index * 16); }
  }
  const dummy = { position: new Vector(), rotation: new Vector(), scale: new Vector(), matrix: new Float32Array(16),
    updateMatrix() { this.matrix.fill(0); this.matrix[0] = this.scale.x; this.matrix[5] = this.scale.y; this.matrix[10] = this.scale.z;
      this.matrix[12] = this.position.x; this.matrix[13] = this.position.y; this.matrix[14] = this.position.z; this.matrix[15] = 1; } };
  type CarrierBatch = {
    mesh: Mesh; pieces: CarrierPiece[]; lod: string; cargo: boolean;
    fullUploadPending: boolean; firstChanged: number; lastChanged: number;
  };
  type VmContext = {
    window: { warehouseCarrierParts(spec: typeof MOBILE_RACK_SPEC): CarrierPiece[] };
    carrierParts: CarrierBatch[];
    records: Map<string, CarrierRecord>;
    stats: Record<string, unknown>;
    projection: number;
    record(id: string, name: string, kind: string, center: VectorLike, size: VectorLike, details: CarrierRecord["details"]): CarrierRecord;
    updateCarriers(pods: Pod[]): void;
    updateCarrierLod(): void;
  };
  // The evaluated JS installs its factory and update methods on this VM boundary.
  const context = {
    window: {}, cleaning: false, carrierCapacity: 0, carrierParts: [], carrierTransforms: new Map(), carrierRecordKey: "",
    carrierSpec: { ...MOBILE_RACK_SPEC }, stats: {}, records: new Map(), pickables: [], root: { add() {}, remove() {} },
    boxGeo: {}, mats: {}, dummy, T: { Vector3: Vector, InstancedMesh: Mesh, DynamicDrawUsage: 1 },
    finite: (value: number, fallback: number) => Number.isFinite(value) ? value : fallback,
    fmt: (value: unknown) => { metrics.formatCalls++; return String(value); }, camera: { updateMatrixWorld() {} }, projection: 1, width: 100, height: 100, quality: "details", layer: "all",
  } as unknown as VmContext;
  context.record = (id: string, name: string, kind: string, center: VectorLike, size: VectorLike, details: CarrierRecord["details"]) => {
    const record = { id, name, kind, center, size, details }; context.records.set(id, record); return record;
  };
  runInNewContext(source, context);
  const update = between("    function updateCarriers(", "    function updateCarrierLod(");
  let lod = between("    function updateCarrierLod(", "    function incidentRecord(");
  if (!revealFix) lod = lod.replace(/if \(visible && !p\.mesh\.visible\) \{[^\n]*\}/, "");
  runInNewContext(`${update}\n${lod}`, context);
  const gpu = new Map<Attribute, { version: number; array: Float32Array }>();
  // Three r128 WebGLAttributes: hidden meshes are skipped; an existing GPU buffer
  // receives only updateRange, then its count resets to -1 after that upload.
  const draw = () => {
    for (const batch of context.carrierParts) {
      if (!batch.mesh.visible || !batch.mesh.count) continue;
      const attribute = batch.mesh.instanceMatrix as Attribute, old = gpu.get(attribute);
      if (!old) gpu.set(attribute, { version: attribute.version, array: attribute.array.slice() });
      else if (old.version < attribute.version) {
        const { offset, count } = attribute.updateRange;
        if (count < 0) old.array.set(attribute.array);
        else old.array.set(attribute.array.subarray(offset, offset + count), offset);
        old.version = attribute.version; attribute.updateRange.count = -1;
      }
      batch.mesh.onAfterRender?.();
    }
  };
  return { context, update: (pods: Pod[]) => context.updateCarriers(pods), lod: () => context.updateCarrierLod(), draw, gpu, metrics };
}
const pods = (): Pod[] => Array.from({ length: 3 }, (_, i) => ({ id: `pod-${i}`, x: i * 10, y: 5, contents: "full", heading: 0, liftM: 0, phase: "parked", robotId: null, taskId: null }));

function hiddenUpdates(revealFix = true, lod = "near", pendingFrame = false) {
  const h = harness(revealFix), values = pods();
  h.update(values); h.draw();
  const batch = h.context.carrierParts.find((b) => b.cargo && b.lod === lod)!;
  expect(batch).toBeDefined();
  h.context.projection = .001; h.lod(); expect(batch.mesh.visible).toBe(false);
  values[0]!.x += 1; h.update(values); h.draw();
  values[1]!.x += 2; h.update(values); h.draw();
  h.context.projection = 1; h.lod();
  if (pendingFrame) { values[2]!.x += 3; h.update(values); }
  h.draw();
  return { cpu: batch.mesh.instanceMatrix.array, gpu: h.gpu.get(batch.mesh.instanceMatrix)!.array, first: 12 };
}

describe("actual carrier render batches and partial GPU uploads", () => {
  it.each(["near", "detail"])("refreshes every stale %s matrix after disjoint hidden updates and reveal", lod => {
    const { cpu, gpu } = hiddenUpdates(true, lod);
    expect(gpu).toEqual(cpu);
  });

  it("reproduces the old partial-range failure when only the reveal fix is removed", () => {
    const { cpu, gpu, first } = hiddenUpdates(false);
    expect(gpu[first]).not.toBe(cpu[first]);
    expect(Math.abs(cpu[first]! - gpu[first]!)).toBeCloseTo(1, 6);
  });

  it("retains a reveal's full upload when a pending frame changes another pod before draw", () => {
    const { cpu, gpu } = hiddenUpdates(true, "near", true);
    expect(gpu).toEqual(cpu);
  });

  it("compacts cargo independently while preserving every frame, exact picking records and empty shelf labels", () => {
    const h = harness(), values = pods();
    h.update(values); h.draw();
    const pieces = h.context.window.warehouseCarrierParts(MOBILE_RACK_SPEC);
    expect(pieces.filter((p) => p.role === "cargo-detail")).toHaveLength(pieces.filter((p) => p.role === "carton").length * 3);
    values[0]!.contents = "empty"; h.update(values); h.draw();
    for (const batch of h.context.carrierParts) {
      const ids = batch.mesh.userData.records!.map((r) => r.id);
      const expected = (batch.cargo ? values.slice(1) : values).flatMap(p => batch.pieces.map(() => `carrier:${p.id}`));
      expect(ids).toEqual(expected);
      expect(batch.mesh.count).toBe(expected.length);
      // Every label/tape attached to a carton must disappear with that carton.
      for (const piece of batch.pieces) if (piece.role === "cargo-detail") expect(batch.cargo).toBe(true);
    }
    expect(h.context.stats).toMatchObject({ carrierCount: 3, loadedCarrierCount: 2, emptyCarrierCount: 1 });
    expect(h.context.records.get("carrier:pod-0")!.details.Содержимое).toBe("Пустой носитель");
    values[0]!.contents = "full"; h.update(values); h.draw();
    for (const batch of h.context.carrierParts) {
      expect(batch.mesh.count).toBe(values.length * batch.pieces.length);
      if (batch.mesh.visible) expect(h.gpu.get(batch.mesh.instanceMatrix)?.array).toEqual(batch.mesh.instanceMatrix.array);
    }
  });

  it("does no formatting or matrix upload work for unchanged pods, and writes only the moving pod's geometry", () => {
    const h = harness(), values = pods();
    h.update(values); h.draw(); h.metrics.formatCalls = 0;
    h.update(values); h.draw();
    expect(h.metrics.formatCalls).toBe(0);
    expect(h.context.stats.carrierMatrixWrites).toBe(0);
    expect(h.context.stats.carrierUploadFloats).toBe(0);
    values[1]!.x += 1; h.update(values); h.draw();
    const piecesPerPod = h.context.carrierParts.reduce((sum, batch) => sum + batch.pieces.length, 0);
    expect(h.context.stats.carrierMatrixWrites).toBe(piecesPerPod);
    expect(h.context.stats.carrierUploadFloats).toBe(piecesPerPod * 16);
    expect(h.metrics.formatCalls).toBe(0);
  });

  it("keeps stationary frame buffers unchanged when content compaction remaps cargo", () => {
    const h = harness(), values = pods();
    h.update(values); h.draw();
    const frames = h.context.carrierParts.filter((batch) => !batch.cargo);
    const versions = frames.map((batch) => batch.mesh.instanceMatrix.version);
    const matrices = frames.map((batch) => batch.mesh.instanceMatrix.array.slice());
    values[0]!.contents = "empty"; h.update(values); h.draw();
    frames.forEach((batch, i) => {
      expect(batch.mesh.instanceMatrix.version).toBe(versions[i]);
      expect(batch.mesh.instanceMatrix.array).toEqual(matrices[i]);
    });
    for (const batch of h.context.carrierParts.filter((batch) => batch.cargo)) {
      expect(batch.mesh.userData.records!.map((record) => record.id)).toEqual(values.slice(1).flatMap(pod => batch.pieces.map(() => `carrier:${pod.id}`)));
    }
    values[0]!.contents = "full"; h.update(values); h.draw();
    frames.forEach((batch, i) => expect(batch.mesh.instanceMatrix.version).toBe(versions[i]));
  });
});
