import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { generate } from 'selfsigned'

import { MAX_LAN_PAIRED_CLIENTS } from '../shared/lan-control'
import {
  LanClientCapacityError,
  LanControlStore,
  LanControlStoreError,
  getTlsSpkiPin,
  type LanCertificateMaterial,
  type LanSecretProtector
} from './lan-control-store'

const protector: LanSecretProtector = {
  isEncryptionAvailable: () => true,
  encrypt: (value) => Buffer.from(value, 'utf8').toString('base64'),
  decrypt: (value) => Buffer.from(value, 'base64').toString('utf8')
}

let materialPromise: Promise<LanCertificateMaterial> | null = null

function certificateMaterial(): Promise<LanCertificateMaterial> {
  materialPromise ??= generate([{ name: 'commonName', value: 'Rockfall Test' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256'
  }).then((result) => ({
    certificatePem: result.cert,
    privateKeyPem: result.private
  }))
  return materialPromise
}

async function withStore(
  run: (store: LanControlStore, path: string) => Promise<void>,
  customProtector = protector
): Promise<void> {
  const directory = await fs.mkdtemp(join(tmpdir(), 'rockfall-lan-store-'))
  const path = join(directory, 'lan-control.json')
  try {
    const store = new LanControlStore({
      path,
      protector: customProtector,
      generateCertificate: async () => certificateMaterial()
    })
    await run(store, path)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

test('creates, protects, and reloads a stable TLS identity', async () => {
  await withStore(async (store, path) => {
    const created = await store.initialize()
    assert.match(created.serverId, /^[0-9a-f-]{36}$/)
    assert.match(created.tlsSpkiSha256, /^sha256\//)
    assert.match(created.verificationCode, /^[0-9A-F]{4}(?:-[0-9A-F]{4}){4}$/)

    const saved = JSON.parse(await fs.readFile(path, 'utf8')) as Record<string, unknown>
    assert.notEqual(saved.encryptedPrivateKey, created.privateKeyPem)
    assert.equal(JSON.stringify(saved).includes(created.privateKeyPem), false)

    const reloaded = new LanControlStore({
      path,
      protector,
      generateCertificate: async () => {
        throw new Error('Existing identity should be reused.')
      }
    })

    test('loads existing client metadata without creating an identity while disabled', async () => {
      await withStore(async (store, path) => {
        assert.equal(await store.initializeExisting(), null)
        await assert.rejects(fs.stat(path), (error) => {
          return (error as NodeJS.ErrnoException).code === 'ENOENT'
        })

        const created = await store.initialize()
        const reloaded = new LanControlStore({ path, protector })
        assert.deepEqual(await reloaded.initializeExisting(), created)
      })
    })
    assert.deepEqual(await reloaded.initialize(), created)
  })
})

test('issues independent credentials, authenticates them, and revokes one client', async () => {
  await withStore(async (store) => {
    await store.initialize()
    const first = await store.pairClient({
      code: '123456',
      client: { name: 'Phone A', platform: 'android', appVersion: '1.0' }
    })
    const second = await store.pairClient({
      code: '654321',
      client: { name: 'Phone B', platform: 'android', appVersion: null }
    })

    assert.notEqual(first.accessToken, second.accessToken)
    assert.equal(store.authenticate(first.accessToken)?.name, 'Phone A')
    assert.equal(store.authenticate(second.accessToken)?.name, 'Phone B')
    assert.equal(store.authenticate(randomBytes(32).toString('base64url')), null)
    assert.equal(await store.revokeClient(first.client.id), true)
    assert.equal(store.authenticate(first.accessToken), null)
    assert.equal(store.authenticate(second.accessToken)?.name, 'Phone B')
    assert.equal(await store.revokeClient(randomUUID()), false)
  })
})

test('enforces the paired-client limit and reset invalidates all clients', async () => {
  await withStore(async (store) => {
    const original = await store.initialize()
    for (let index = 0; index < MAX_LAN_PAIRED_CLIENTS; index += 1) {
      await store.pairClient({
        code: '123456',
        client: { name: `Phone ${index}`, platform: 'android', appVersion: null }
      })
    }
    await assert.rejects(
      store.pairClient({
        code: '123456',
        client: { name: 'Overflow', platform: 'android', appVersion: null }
      }),
      LanClientCapacityError
    )

    const reset = await store.reset()
    assert.notEqual(reset.serverId, original.serverId)
    assert.deepEqual(store.getClients(), [])
  })
})

test('refuses unavailable encryption and mismatched saved keys', async () => {
  await withStore(
    async (store) => {
      await assert.rejects(store.initialize(), LanControlStoreError)
    },
    {
      ...protector,
      isEncryptionAvailable: () => false
    }
  )

  await withStore(async (store, path) => {
    await store.initialize()
    const saved = JSON.parse(await fs.readFile(path, 'utf8')) as {
      encryptedPrivateKey: string
    }
    const unrelated = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
      format: 'pem',
      type: 'pkcs8'
    })
    saved.encryptedPrivateKey = protector.encrypt(String(unrelated))
    await fs.writeFile(path, `${JSON.stringify(saved)}\n`, 'utf8')

    const broken = new LanControlStore({ path, protector })
    await assert.rejects(broken.initialize(), /could not be decrypted or verified/)
  })
})

test('derives the documented SPKI pin from the certificate public key', async () => {
  const material = await certificateMaterial()
  const pin = getTlsSpkiPin(material.certificatePem)
  const digest = Buffer.from(pin.tlsSpkiSha256.slice('sha256/'.length), 'base64')
  assert.equal(digest.byteLength, createHash('sha256').digest().byteLength)
})
