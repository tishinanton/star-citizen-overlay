const releaseElements = {
  downloadLinks: document.querySelectorAll('[data-download-link]'),
  versions: document.querySelectorAll('[data-release-version]'),
  metadata: document.querySelectorAll('[data-release-meta]'),
  notesLinks: document.querySelectorAll('[data-release-notes]'),
  states: document.querySelectorAll('[data-release-state]')
}

function formatBytes(bytes) {
  const megabytes = bytes / (1024 * 1024)
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1
  }).format(megabytes)} MB`
}

function formatPublishedDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date(value))
}

function isReleaseMetadata(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.tagName === 'string' &&
    typeof value.publishedAt === 'string' &&
    typeof value.htmlUrl === 'string' &&
    typeof value.installer === 'object' &&
    value.installer !== null &&
    typeof value.installer.url === 'string' &&
    typeof value.installer.size === 'number'
  )
}

function applyReleaseMetadata(release) {
  const releaseDate = formatPublishedDate(release.publishedAt)
  const installerSize = formatBytes(release.installer.size)

  releaseElements.downloadLinks.forEach((link) => {
    link.href = release.installer.url
    link.setAttribute('aria-label', `Download Rockfall ${release.tagName} for Windows`)
  })

  releaseElements.versions.forEach((version) => {
    version.textContent = release.tagName
  })

  releaseElements.metadata.forEach((metadata) => {
    metadata.textContent = `Windows 10+ · ${installerSize}`
  })

  releaseElements.notesLinks.forEach((link) => {
    link.href = release.htmlUrl
  })

  releaseElements.states.forEach((state) => {
    state.textContent = `Latest stable release · published ${releaseDate}`
    state.classList.remove('is-error')
  })
}

function showReleaseError(error) {
  console.error('Rockfall release metadata could not be loaded.', error)

  releaseElements.states.forEach((state) => {
    state.textContent = 'Live release details are unavailable. The download still points to v0.3.1.'
    state.classList.add('is-error')
  })
}

async function loadReleaseMetadata() {
  try {
    const response = await fetch('./release.json', { cache: 'no-store' })

    if (!response.ok) {
      throw new Error(`Release metadata returned HTTP ${response.status}.`)
    }

    const release = await response.json()

    if (!isReleaseMetadata(release)) {
      throw new TypeError('Release metadata has an unexpected shape.')
    }

    applyReleaseMetadata(release)
  } catch (error) {
    showReleaseError(error)
  }
}

document.querySelectorAll('[data-current-year]').forEach((year) => {
  year.textContent = String(new Date().getFullYear())
})

void loadReleaseMetadata()
