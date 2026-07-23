import { MAX_CLUSTER_SIZE, MIN_CLUSTER_SIZE } from './contracts'

export interface ClusterSignature {
  count: number
  signature: number
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
