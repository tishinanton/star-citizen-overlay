import { deflateSync } from 'node:zlib'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
export const MAX_BLUEPRINT_GLB_BYTES = 64 * 1024 * 1024
export const MAX_BLUEPRINT_TRIANGLES = 250_000
const MAX_RASTER_SAMPLES = 50_000_000
const RASTER_YIELD_SAMPLES = 500_000
const SUPERSAMPLE = 2

type Vec3 = [number, number, number]
type Mat4 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number
]

interface GlbDocument {
  accessors?: GlbAccessor[]
  buffers?: Array<{ byteLength: number; uri?: string }>
  bufferViews?: GlbBufferView[]
  images?: Array<{ bufferView?: number; uri?: string }>
  textures?: unknown[]
  animations?: unknown[]
  skins?: Array<{ inverseBindMatrices?: number; joints?: number[]; skeleton?: number }>
  meshes?: GlbMesh[]
  nodes?: GlbNode[]
  scenes?: Array<{ nodes?: number[] }>
  scene?: number
}

interface GlbAccessor {
  bufferView?: number
  byteOffset?: number
  componentType: number
  count: number
  type: string
  normalized?: boolean
  sparse?: unknown
}

interface GlbBufferView {
  buffer: number
  byteOffset?: number
  byteLength: number
  byteStride?: number
}

interface GlbMesh {
  primitives: Array<{
    attributes: Record<string, number>
    indices?: number
    mode?: number
  }>
}

interface GlbNode {
  mesh?: number
  children?: number[]
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
}

interface Vertex {
  position: Vec3
  normal: Vec3 | null
}

interface Triangle {
  vertices: [Vertex, Vertex, Vertex]
}

export interface GlbModelStats {
  byteLength: number
  triangleCount: number
}

export function validateGlbModel(glb: Uint8Array): GlbModelStats {
  const value = Buffer.isBuffer(glb) ? glb : Buffer.from(glb.buffer, glb.byteOffset, glb.byteLength)
  const { document, binary } = parseGlbEnvelope(value)
  const declaredBuffer = document.buffers?.[0]
  if (
    document.buffers?.length !== 1 ||
    !declaredBuffer ||
    declaredBuffer.uri !== undefined ||
    !Number.isSafeInteger(declaredBuffer.byteLength) ||
    declaredBuffer.byteLength < 0 ||
    declaredBuffer.byteLength > binary.length
  ) {
    throw new TypeError('Converted GLB buffer is invalid.')
  }
  if (
    (document.images?.length ?? 0) > 0 ||
    (document.textures?.length ?? 0) > 0 ||
    (document.animations?.length ?? 0) > 0
  ) {
    throw new TypeError('Converted GLB contains unsupported textures or animation data.')
  }
  if (
    (document.nodes?.length ?? 0) > 10_000 ||
    (document.meshes?.length ?? 0) > 10_000 ||
    (document.accessors?.length ?? 0) > 50_000 ||
    (document.bufferViews?.length ?? 0) > 50_000
  ) {
    throw new RangeError('Converted GLB exceeds the structural complexity limit.')
  }
  let jointCount = 0
  for (const skin of document.skins ?? []) {
    if (!Array.isArray(skin.joints) || skin.joints.length === 0) {
      throw new TypeError('Converted GLB skin metadata is invalid.')
    }
    jointCount += skin.joints.length
    if (
      jointCount > 512 ||
      skin.joints.some(
        (joint) =>
          !Number.isSafeInteger(joint) || joint < 0 || joint >= (document.nodes?.length ?? 0)
      )
    ) {
      throw new RangeError('Converted GLB exceeds the static joint limit.')
    }
    if (skin.inverseBindMatrices !== undefined) {
      validateAccessor(document, binary, skin.inverseBindMatrices, 16)
    }
  }

  const meshTriangleCounts: number[] = []
  for (const mesh of document.meshes ?? []) {
    if (!mesh || !Array.isArray(mesh.primitives)) {
      throw new TypeError('Converted GLB mesh is invalid.')
    }
    let meshTriangleCount = 0
    for (const primitive of mesh.primitives) {
      if (primitive.attributes?.POSITION === undefined) continue
      if ((primitive.mode ?? 4) !== 4) {
        throw new TypeError('Converted GLB uses an unsupported primitive mode.')
      }
      const position = validateAccessor(document, binary, primitive.attributes.POSITION, 3)
      const elementCount =
        primitive.indices === undefined
          ? position.count
          : validateAccessor(document, binary, primitive.indices, 1, true).count
      meshTriangleCount += Math.floor(elementCount / 3)
      if (meshTriangleCount > MAX_BLUEPRINT_TRIANGLES) {
        throw new RangeError(
          `Converted geometry exceeds the ${MAX_BLUEPRINT_TRIANGLES.toLocaleString('en-US')} triangle limit.`
        )
      }
    }
    meshTriangleCounts.push(meshTriangleCount)
  }

  const nodes = document.nodes ?? []
  const sceneIndex = document.scene ?? 0
  const scene = document.scenes?.[sceneIndex]
  if (!scene || !Array.isArray(scene.nodes)) {
    throw new TypeError('Converted GLB scene metadata is invalid.')
  }
  let triangleCount = 0
  let nodeVisitCount = 0
  const visitNode = (nodeIndex: number, ancestors: ReadonlySet<number>): void => {
    if (!Number.isSafeInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodes.length) {
      throw new TypeError('Converted GLB scene references an invalid node.')
    }
    if (ancestors.has(nodeIndex)) throw new TypeError('Converted GLB scene contains a node cycle.')
    nodeVisitCount += 1
    if (nodeVisitCount > 50_000) {
      throw new RangeError('Converted GLB exceeds the scene instance limit.')
    }
    const node = nodes[nodeIndex]
    if (node.mesh !== undefined) {
      if (
        !Number.isSafeInteger(node.mesh) ||
        node.mesh < 0 ||
        node.mesh >= meshTriangleCounts.length
      ) {
        throw new TypeError('Converted GLB node references an invalid mesh.')
      }
      triangleCount += meshTriangleCounts[node.mesh]
      if (triangleCount > MAX_BLUEPRINT_TRIANGLES) {
        throw new RangeError(
          `Converted geometry exceeds the ${MAX_BLUEPRINT_TRIANGLES.toLocaleString('en-US')} triangle limit.`
        )
      }
    }
    if (node.children === undefined) return
    if (!Array.isArray(node.children)) {
      throw new TypeError('Converted GLB node children are invalid.')
    }
    const nextAncestors = new Set(ancestors)
    nextAncestors.add(nodeIndex)
    for (const child of node.children) visitNode(child, nextAncestors)
  }
  for (const root of scene.nodes) visitNode(root, new Set())
  if (triangleCount === 0) {
    throw new TypeError('Converted geometry did not contain renderable triangles.')
  }
  return { byteLength: value.length, triangleCount }
}

function parseGlbEnvelope(glb: Buffer): { document: GlbDocument; binary: Buffer } {
  if (
    glb.length < 20 ||
    glb.length > MAX_BLUEPRINT_GLB_BYTES ||
    glb.toString('ascii', 0, 4) !== 'glTF'
  ) {
    throw new TypeError(
      `Converted geometry is not a supported GLB file of at most ${MAX_BLUEPRINT_GLB_BYTES / (1024 * 1024)} MiB.`
    )
  }
  if (glb.readUInt32LE(4) !== 2 || glb.readUInt32LE(8) !== glb.length) {
    throw new TypeError('Converted geometry uses an unsupported GLB version.')
  }

  let offset = 12
  let document: GlbDocument | null = null
  let binary: Buffer | null = null
  while (offset < glb.length) {
    if (offset + 8 > glb.length) throw new TypeError('Converted GLB data is truncated.')
    const length = glb.readUInt32LE(offset)
    const type = glb.readUInt32LE(offset + 4)
    offset += 8
    if (length % 4 !== 0 || length > glb.length - offset) {
      throw new TypeError('Converted GLB data is truncated or misaligned.')
    }
    const data = glb.subarray(offset, offset + length)
    if (type === 0x4e4f534a) {
      if (document) throw new TypeError('Converted GLB contains duplicate JSON data.')
      try {
        document = JSON.parse(data.toString('utf8').replace(/[\0 ]+$/g, '')) as GlbDocument
      } catch (error) {
        throw new TypeError('Converted GLB JSON is invalid.', { cause: error })
      }
    } else if (type === 0x004e4942) {
      if (binary) throw new TypeError('Converted GLB contains duplicate binary data.')
      binary = data
    }
    offset += length
  }
  if (!document || typeof document !== 'object' || !binary) {
    throw new TypeError('Converted GLB data is incomplete.')
  }
  return { document, binary }
}

function validateAccessor(
  document: GlbDocument,
  binary: Buffer,
  accessorIndex: number,
  expectedComponents: number,
  requireUnsignedInteger = false
): GlbAccessor {
  const accessor = document.accessors?.[accessorIndex]
  const view =
    accessor?.bufferView === undefined ? null : document.bufferViews?.[accessor.bufferView]
  if (
    !Number.isInteger(accessorIndex) ||
    !accessor ||
    !view ||
    view.buffer !== 0 ||
    accessor.sparse !== undefined ||
    !Number.isSafeInteger(accessor.count) ||
    accessor.count < 0 ||
    accessor.count > MAX_BLUEPRINT_TRIANGLES * 3 + 3 ||
    componentCount(accessor.type) !== expectedComponents ||
    (requireUnsignedInteger && ![5121, 5123, 5125].includes(accessor.componentType))
  ) {
    throw new TypeError('Converted GLB geometry uses an unsupported accessor.')
  }
  const componentBytes = componentByteLength(accessor.componentType)
  const elementBytes = componentBytes * expectedComponents
  const stride = view.byteStride ?? elementBytes
  const viewStart = view.byteOffset ?? 0
  const accessorOffset = accessor.byteOffset ?? 0
  const requiredBytes = accessor.count === 0 ? 0 : stride * (accessor.count - 1) + elementBytes
  if (
    !Number.isSafeInteger(viewStart) ||
    !Number.isSafeInteger(view.byteLength) ||
    !Number.isSafeInteger(accessorOffset) ||
    !Number.isSafeInteger(stride) ||
    viewStart < 0 ||
    view.byteLength < 0 ||
    accessorOffset < 0 ||
    stride < elementBytes ||
    requiredBytes > view.byteLength - accessorOffset ||
    viewStart + accessorOffset + requiredBytes > binary.length
  ) {
    throw new TypeError('Converted GLB geometry accessor is out of bounds.')
  }
  return accessor
}

export async function renderGlbThumbnail(glb: Buffer, outputSize = 256): Promise<Buffer> {
  if (!Number.isInteger(outputSize) || outputSize < 64 || outputSize > 512) {
    throw new RangeError('Thumbnail dimensions must be between 64 and 512 pixels.')
  }
  const triangles = parseTriangles(glb)
  if (triangles.length === 0) {
    throw new Error('Converted geometry did not contain renderable triangles.')
  }
  const size = outputSize * SUPERSAMPLE
  const pixels = await rasterize(triangles, size)
  return encodePng(outputSize, outputSize, downsample(pixels, size, SUPERSAMPLE))
}

function parseTriangles(glb: Buffer): Triangle[] {
  validateGlbModel(glb)
  const { document: json, binary } = parseGlbEnvelope(glb)

  const triangles: Triangle[] = []
  const nodes = json.nodes ?? []
  const scenes = json.scenes ?? []
  const scene = scenes[json.scene ?? 0]
  const roots = scene?.nodes ?? nodes.map((_, index) => index)
  const visited = new Set<number>()

  const visit = (nodeIndex: number, parent: Mat4): void => {
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodes.length) return
    if (visited.has(nodeIndex)) return
    visited.add(nodeIndex)
    const node = nodes[nodeIndex]
    const transform = multiplyMat4(parent, nodeMatrix(node))
    if (node.mesh !== undefined) {
      appendMeshTriangles(json, binary, node.mesh, transform, triangles)
      if (triangles.length > MAX_BLUEPRINT_TRIANGLES) {
        throw new RangeError('Converted geometry is too detailed for thumbnail rendering.')
      }
    }
    for (const child of node.children ?? []) visit(child, transform)
  }
  for (const root of roots) visit(root, identityMat4())
  return triangles
}

function appendMeshTriangles(
  document: GlbDocument,
  binary: Buffer,
  meshIndex: number,
  transform: Mat4,
  output: Triangle[]
): void {
  const mesh = document.meshes?.[meshIndex]
  if (!mesh) return
  for (const primitive of mesh.primitives) {
    if ((primitive.mode ?? 4) !== 4 || primitive.attributes.POSITION === undefined) continue
    const positions = readAccessor(document, binary, primitive.attributes.POSITION, 3)
    const normals =
      primitive.attributes.NORMAL === undefined
        ? null
        : readAccessor(document, binary, primitive.attributes.NORMAL, 3)
    const indices =
      primitive.indices === undefined
        ? Array.from({ length: positions.length }, (_, index) => index)
        : readAccessor(document, binary, primitive.indices, 1).map((entry) => entry[0])
    for (let index = 0; index + 2 < indices.length; index += 3) {
      const source = [indices[index], indices[index + 1], indices[index + 2]]
      if (
        source.some((value) => !Number.isInteger(value) || value < 0 || value >= positions.length)
      ) {
        throw new TypeError('Converted GLB geometry contains invalid triangle indices.')
      }
      output.push({
        vertices: source.map((vertexIndex) => ({
          position: transformPoint(transform, positions[vertexIndex] as Vec3),
          normal: normals
            ? normalize(transformDirection(transform, normals[vertexIndex] as Vec3))
            : null
        })) as [Vertex, Vertex, Vertex]
      })
    }
  }
}

function readAccessor(
  document: GlbDocument,
  binary: Buffer,
  accessorIndex: number,
  expectedComponents: number
): number[][] {
  const accessor = document.accessors?.[accessorIndex]
  const view =
    accessor?.bufferView === undefined ? null : document.bufferViews?.[accessor.bufferView]
  if (
    !accessor ||
    !view ||
    view.buffer !== 0 ||
    accessor.sparse !== undefined ||
    accessor.count < 0 ||
    accessor.count > MAX_BLUEPRINT_TRIANGLES * 3 ||
    componentCount(accessor.type) !== expectedComponents
  ) {
    throw new TypeError('Converted GLB geometry uses an unsupported accessor.')
  }
  const componentBytes = componentByteLength(accessor.componentType)
  const elementBytes = componentBytes * expectedComponents
  const stride = view.byteStride ?? elementBytes
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  if (
    stride < elementBytes ||
    start < 0 ||
    start + stride * Math.max(accessor.count - 1, 0) + elementBytes > binary.length
  ) {
    throw new TypeError('Converted GLB geometry accessor is out of bounds.')
  }
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength)
  return Array.from({ length: accessor.count }, (_, elementIndex) =>
    Array.from({ length: expectedComponents }, (_, componentIndex) =>
      readComponent(
        data,
        start + elementIndex * stride + componentIndex * componentBytes,
        accessor.componentType,
        accessor.normalized === true
      )
    )
  )
}

function readComponent(data: DataView, offset: number, type: number, normalized: boolean): number {
  const value =
    type === 5120
      ? data.getInt8(offset)
      : type === 5121
        ? data.getUint8(offset)
        : type === 5122
          ? data.getInt16(offset, true)
          : type === 5123
            ? data.getUint16(offset, true)
            : type === 5125
              ? data.getUint32(offset, true)
              : type === 5126
                ? data.getFloat32(offset, true)
                : Number.NaN
  if (!Number.isFinite(value))
    throw new TypeError('Converted GLB geometry has an invalid component.')
  if (!normalized || type === 5126 || type === 5125) return value
  if (type === 5120) return Math.max(value / 127, -1)
  if (type === 5121) return value / 255
  if (type === 5122) return Math.max(value / 32767, -1)
  return value / 65535
}

function componentByteLength(type: number): number {
  if (type === 5120 || type === 5121) return 1
  if (type === 5122 || type === 5123) return 2
  if (type === 5125 || type === 5126) return 4
  throw new TypeError('Converted GLB geometry uses an unsupported component type.')
}

function componentCount(type: string): number {
  if (type === 'SCALAR') return 1
  if (type === 'VEC2') return 2
  if (type === 'VEC3') return 3
  if (type === 'VEC4') return 4
  if (type === 'MAT4') return 16
  return 0
}

async function rasterize(triangles: Triangle[], size: number): Promise<Uint8Array> {
  const view = normalize([1.25, -1.6, 1.05])
  const right = normalize(cross([0, 0, 1], view))
  const up = normalize(cross(view, right))
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const triangle of triangles) {
    for (const vertex of triangle.vertices) {
      const x = dot(vertex.position, right)
      const y = dot(vertex.position, up)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  const extent = Math.max(maxX - minX, maxY - minY)
  if (!Number.isFinite(extent) || extent <= 1e-8) {
    throw new Error('Converted geometry has invalid bounds.')
  }
  const scale = (size * 0.82) / extent
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const pixels = new Uint8Array(size * size * 4)
  const depths = new Float64Array(size * size)
  depths.fill(Number.NEGATIVE_INFINITY)
  const light = normalize([-0.35, -0.45, 0.82])
  let estimatedSamples = 0
  for (const triangle of triangles) {
    const points = triangle.vertices.map((vertex) => {
      const x = dot(vertex.position, right)
      const y = dot(vertex.position, up)
      return [(x - centerX) * scale + size / 2, size / 2 - (y - centerY) * scale] as [
        number,
        number
      ]
    })
    const width = Math.max(
      0,
      Math.ceil(Math.max(...points.map((point) => point[0]))) -
        Math.floor(Math.min(...points.map((point) => point[0]))) +
        1
    )
    const height = Math.max(
      0,
      Math.ceil(Math.max(...points.map((point) => point[1]))) -
        Math.floor(Math.min(...points.map((point) => point[1]))) +
        1
    )
    estimatedSamples += Math.min(width, size) * Math.min(height, size)
    if (estimatedSamples > MAX_RASTER_SAMPLES) {
      throw new RangeError('Converted geometry exceeds the thumbnail rasterization budget.')
    }
  }

  let samplesSinceYield = 0
  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex += 1) {
    const triangle = triangles[triangleIndex]
    const points = triangle.vertices.map((vertex) => {
      const x = dot(vertex.position, right)
      const y = dot(vertex.position, up)
      return [
        (x - centerX) * scale + size / 2,
        size / 2 - (y - centerY) * scale,
        dot(vertex.position, view)
      ] as Vec3
    }) as [Vec3, Vec3, Vec3]
    const area = edge(points[0], points[1], points[2][0], points[2][1])
    if (Math.abs(area) < 1e-8) continue
    const faceNormal = normalize(
      cross(
        subtract(triangle.vertices[1].position, triangle.vertices[0].position),
        subtract(triangle.vertices[2].position, triangle.vertices[0].position)
      )
    )
    const minPixelX = clamp(Math.floor(Math.min(...points.map((point) => point[0]))), 0, size - 1)
    const maxPixelX = clamp(Math.ceil(Math.max(...points.map((point) => point[0]))), 0, size - 1)
    const minPixelY = clamp(Math.floor(Math.min(...points.map((point) => point[1]))), 0, size - 1)
    const maxPixelY = clamp(Math.ceil(Math.max(...points.map((point) => point[1]))), 0, size - 1)
    samplesSinceYield += (maxPixelX - minPixelX + 1) * (maxPixelY - minPixelY + 1)
    if (samplesSinceYield >= RASTER_YIELD_SAMPLES) {
      samplesSinceYield = 0
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    for (let y = minPixelY; y <= maxPixelY; y += 1) {
      for (let x = minPixelX; x <= maxPixelX; x += 1) {
        const sampleX = x + 0.5
        const sampleY = y + 0.5
        const w0 = edge(points[1], points[2], sampleX, sampleY) / area
        const w1 = edge(points[2], points[0], sampleX, sampleY) / area
        const w2 = 1 - w0 - w1
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue
        const depth = w0 * points[0][2] + w1 * points[1][2] + w2 * points[2][2]
        const pixelIndex = y * size + x
        if (depth <= depths[pixelIndex]) continue
        depths[pixelIndex] = depth
        const normal = triangle.vertices.every((vertex) => vertex.normal !== null)
          ? normalize([
              w0 * triangle.vertices[0].normal![0] +
                w1 * triangle.vertices[1].normal![0] +
                w2 * triangle.vertices[2].normal![0],
              w0 * triangle.vertices[0].normal![1] +
                w1 * triangle.vertices[1].normal![1] +
                w2 * triangle.vertices[2].normal![1],
              w0 * triangle.vertices[0].normal![2] +
                w1 * triangle.vertices[1].normal![2] +
                w2 * triangle.vertices[2].normal![2]
            ])
          : faceNormal
        const intensity =
          0.34 + 0.58 * Math.abs(dot(normal, light)) + 0.08 * Math.abs(dot(normal, view))
        const offset = pixelIndex * 4
        pixels[offset] = Math.round(92 * intensity)
        pixels[offset + 1] = Math.round(151 * intensity)
        pixels[offset + 2] = Math.round(177 * intensity)
        pixels[offset + 3] = 255
      }
    }
  }
  return pixels
}

function downsample(source: Uint8Array, sourceSize: number, factor: number): Uint8Array {
  const targetSize = sourceSize / factor
  const output = new Uint8Array(targetSize * targetSize * 4)
  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      const sums = [0, 0, 0, 0]
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) {
          const offset = ((y * factor + dy) * sourceSize + x * factor + dx) * 4
          for (let channel = 0; channel < 4; channel += 1) sums[channel] += source[offset + channel]
        }
      }
      const targetOffset = (y * targetSize + x) * 4
      const samples = factor * factor
      for (let channel = 0; channel < 4; channel += 1) {
        output[targetOffset + channel] = Math.round(sums[channel] / samples)
      }
    }
  }
  return output
}

function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1)
    raw[rowOffset] = 0
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(
      raw,
      rowOffset + 1
    )
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length, 0)
  name.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8)
  return chunk
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const value of data) {
    crc ^= value
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb88320)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function nodeMatrix(node: GlbNode): Mat4 {
  if (node.matrix?.length === 16 && node.matrix.every(Number.isFinite)) {
    return [...node.matrix] as Mat4
  }
  const translation = (node.translation?.length === 3 ? node.translation : [0, 0, 0]) as Vec3
  const scale = (node.scale?.length === 3 ? node.scale : [1, 1, 1]) as Vec3
  const rotation = node.rotation?.length === 4 ? node.rotation : [0, 0, 0, 1]
  const [x, y, z, w] = rotation
  const xx = x * x
  const yy = y * y
  const zz = z * z
  const xy = x * y
  const xz = x * z
  const yz = y * z
  const wx = w * x
  const wy = w * y
  const wz = w * z
  return [
    (1 - 2 * (yy + zz)) * scale[0],
    2 * (xy + wz) * scale[0],
    2 * (xz - wy) * scale[0],
    0,
    2 * (xy - wz) * scale[1],
    (1 - 2 * (xx + zz)) * scale[1],
    2 * (yz + wx) * scale[1],
    0,
    2 * (xz + wy) * scale[2],
    2 * (yz - wx) * scale[2],
    (1 - 2 * (xx + yy)) * scale[2],
    0,
    translation[0],
    translation[1],
    translation[2],
    1
  ]
}

function identityMat4(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

function multiplyMat4(left: Mat4, right: Mat4): Mat4 {
  const output = new Array<number>(16).fill(0)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1) {
        output[column * 4 + row] += left[index * 4 + row] * right[column * 4 + index]
      }
    }
  }
  return output as Mat4
}

function transformPoint(matrix: Mat4, point: Vec3): Vec3 {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14]
  ]
}

function transformDirection(matrix: Mat4, direction: Vec3): Vec3 {
  return [
    matrix[0] * direction[0] + matrix[4] * direction[1] + matrix[8] * direction[2],
    matrix[1] * direction[0] + matrix[5] * direction[1] + matrix[9] * direction[2],
    matrix[2] * direction[0] + matrix[6] * direction[1] + matrix[10] * direction[2]
  ]
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0]
  ]
}

function dot(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function normalize(value: number[]): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2])
  return length > 1e-12 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 0, 1]
}

function edge(start: Vec3, end: Vec3, x: number, y: number): number {
  return (x - start[0]) * (end[1] - start[1]) - (y - start[1]) * (end[0] - start[0])
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
