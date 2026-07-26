import { MAX_CLUSTER_SIZE, MIN_CLUSTER_SIZE, type MiningMaterial } from './contracts'

export interface ClusterSignature {
  count: number
  signature: number
}

export interface ResolvedMaterialSignature {
  signature: number
  isOverridden: boolean
}

export function resolveMaterialSignature(
  material: Pick<MiningMaterial, 'id' | 'signature'>,
  signatureOverrides: Readonly<Record<string, number>>
): ResolvedMaterialSignature {
  if (!Object.hasOwn(signatureOverrides, material.id)) {
    return { signature: material.signature, isOverridden: false }
  }

  const signatureOverride = signatureOverrides[material.id]
  return { signature: signatureOverride, isOverridden: true }
}

export function buildClusterSignatures(
  baseSignature: number,
  clusterMax: number
): ClusterSignature[] {
  if (!Number.isFinite(baseSignature) || baseSignature <= 0) {
    throw new RangeError('Base signature must be a positive number.')
  }

  if (
    !Number.isInteger(clusterMax) ||
    clusterMax < MIN_CLUSTER_SIZE ||
    clusterMax > MAX_CLUSTER_SIZE
  ) {
    throw new RangeError(
      `Cluster size must be between ${MIN_CLUSTER_SIZE} and ${MAX_CLUSTER_SIZE}.`
    )
  }

  return Array.from({ length: clusterMax }, (_, index) => {
    const count = index + MIN_CLUSTER_SIZE
    return {
      count,
      signature: baseSignature * count
    }
  })
}
