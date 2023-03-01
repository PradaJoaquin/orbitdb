import * as crypto from '@libp2p/crypto'
import secp256k1 from 'secp256k1'
import { Buffer } from 'safe-buffer'
import ComposedStorage from './storage/composed.js'
import LevelStorage from './storage/level.js'
import LRUStorage from './storage/lru.js'

const unmarshal = crypto.keys.supportedKeys.secp256k1.unmarshalSecp256k1PrivateKey

const verifySignature = async (signature, publicKey, data) => {
  const unmarshalPubKey = crypto.keys.supportedKeys.secp256k1.unmarshalSecp256k1PublicKey

  if (!signature) {
    throw new Error('No signature given')
  }
  if (!publicKey) {
    throw new Error('Given publicKey was undefined')
  }
  if (!data) {
    throw new Error('Given input data was undefined')
  }

  if (!Buffer.isBuffer(data)) {
    data = Buffer.from(data)
  }

  const isValid = (key, msg, sig) => key.verify(msg, sig)

  let res = false
  try {
    const pubKey = unmarshalPubKey(Buffer.from(publicKey, 'hex'))
    res = await isValid(pubKey, data, Buffer.from(signature, 'hex'))
  } catch (e) {
    // Catch error: sig length wrong
  }
  return Promise.resolve(res)
}

const signMessage = async (key, data) => {
  if (!key) {
    throw new Error('No signing key given')
  }

  if (!data) {
    throw new Error('Given input data was undefined')
  }

  if (!Buffer.isBuffer(data)) {
    data = Buffer.from(data)
  }

  return Buffer.from(await key.sign(data)).toString('hex')
}

const verifiedCache = await LRUStorage({ size: 1000 })

const verifyMessage = async (signature, publicKey, data) => {
  const cached = await verifiedCache.get(signature)

  let res = false

  if (!cached) {
    const verified = await verifySignature(signature, publicKey, data)
    res = verified
    if (verified) {
      await verifiedCache.put(signature, { publicKey, data })
    }
  } else {
    const compare = (cached, data) => {
      /* let match
        if (v === 'v0') {
          match = Buffer.compare(Buffer.alloc(30, cached), Buffer.alloc(30, data)) === 0
      } else { */
      const match = Buffer.isBuffer(data) ? Buffer.compare(cached, data) === 0 : cached === data
      // }
      return match
    }
    res = cached.publicKey === publicKey && compare(cached.data, data)
  }
  return res
}

// const verifiedCache = new LRU(1000)

const KeyStore = async ({ storage } = {}) => {
  storage = storage || await ComposedStorage(await LevelStorage({ path: './keystore', valueEncoding: 'json' }), await LRUStorage({ size: 1000 }))

  const close = async () => {
    if (!storage) return
    await storage.close()
  }

  const clear = async () => {
    if (!storage) return
    await storage.clear()
  }

  const hasKey = async (id) => {
    if (!id) {
      throw new Error('id needed to check a key')
    }
    if (storage.status && storage.status !== 'open') {
      return null
    }

    let hasKey = false
    try {
      const storedKey = await storage.get(id)
      hasKey = storedKey !== undefined && storedKey !== null
    } catch (e) {
      // Catches 'Error: ENOENT: no such file or directory, open <path>'
      console.error('Error: ENOENT: no such file or directory')
    }

    return hasKey
  }

  const addKey = async (id, key) => {
    try {
      await storage.put(id, JSON.stringify(key))
    } catch (e) {
      console.log(e)
    }
  }

  const createKey = async (id, { entropy } = {}) => {
    if (!id) {
      throw new Error('id needed to create a key')
    }
    // if (storage.status && storage.status !== 'open') {
    //   console.log("22::", id)
    //   return null
    // }

    // Generate a private key
    const pair = await crypto.keys.generateKeyPair('secp256k1')
    const keys = await crypto.keys.unmarshalPrivateKey(pair.bytes)
    const pubKey = keys.public.marshal()
    const decompressedKey = secp256k1.publicKeyConvert(Buffer.from(pubKey), false)

    const key = {
      publicKey: Buffer.from(decompressedKey).toString('hex'),
      privateKey: Buffer.from(keys.marshal()).toString('hex')
    }

    await addKey(id, key)

    return keys
  }

  const getKey = async (id) => {
    if (!id) {
      throw new Error('id needed to get a key')
    }

    if (storage.status && storage.status !== 'open') {
      return null
    }

    let storedKey
    try {
      storedKey = await storage.get(id)
    } catch (e) {
      // ignore ENOENT error
    }

    if (!storedKey) {
      return
    }
    
    const deserializedKey = JSON.parse(storedKey)
    
    if (!deserializedKey) {
      return
    }    

    return unmarshal(Buffer.from(deserializedKey.privateKey, 'hex'))
  }

  const getPublic = (keys, options = {}) => {
    const formats = ['hex', 'buffer']
    const decompress = typeof options.decompress === 'undefined' ? true : options.decompress
    const format = options.format || 'hex'
    if (formats.indexOf(format) === -1) {
      throw new Error('Supported formats are `hex` and `buffer`')
    }
    let pubKey = keys.public.marshal()
    if (decompress) {
      pubKey = secp256k1.publicKeyConvert(Buffer.from(pubKey), false)
    }
    pubKey = Buffer.from(pubKey)
    return format === 'buffer' ? pubKey : pubKey.toString('hex')
  }

  return {
    clear,
    close,
    hasKey,
    addKey,
    createKey,
    getKey,
    getPublic
  }
}

export {
  KeyStore as default,
  verifyMessage,
  signMessage
}
