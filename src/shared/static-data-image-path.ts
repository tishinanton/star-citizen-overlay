function foldAsciiCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) + ('a'.charCodeAt(0) - 'A'.charCodeAt(0)))
  )
}

export function canonicalizeStaticDataImagePath(path: string): string {
  return foldAsciiCase(path.replaceAll('\\', '/').replace(/^\/+/, ''))
}

export function indexStaticDataImagePaths(
  paths: Iterable<string>,
  label: string
): ReadonlyMap<string, string> {
  const index = new Map<string, string>()
  for (const path of paths) {
    const canonicalPath = canonicalizeStaticDataImagePath(path)
    if (!canonicalPath) {
      throw new TypeError(`${label} contain an empty path.`)
    }
    const existing = index.get(canonicalPath)
    if (existing !== undefined && existing !== path) {
      throw new Error(`${label} contain colliding paths: ${existing}, ${path}.`)
    }
    index.set(canonicalPath, path)
  }
  return index
}

export function findStaticDataImageByPath(
  images: Readonly<Record<string, string>>,
  path: string
): string | undefined {
  const indexedPaths = indexStaticDataImagePaths(Object.keys(images), 'Static-data images')
  const sourcePath = indexedPaths.get(canonicalizeStaticDataImagePath(path))
  return sourcePath === undefined ? undefined : images[sourcePath]
}
