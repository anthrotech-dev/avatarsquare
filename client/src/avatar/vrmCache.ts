/**
 * 読み込んだVRMのIndexedDBキャッシュ。リロード時の再ドロップを不要にする。
 * 非対応環境・プライベートモード・quota超過などのエラーはすべて握りつぶし、
 * キャッシュ無しとして振る舞う(saveは無視、loadはnull)。
 */

const DB_NAME = 'avatarsquare'
const DB_VERSION = 1
const STORE = 'files'
const KEY = 'vrm'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * 操作ごとにopen→closeする(開きっぱなしは将来のバージョンアップグレードをblockする)。
 * 書き込みはputのonsuccessではなくtx.oncompleteを待つ(永続化完了の保証)。
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore, tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB非対応')
  const db = await openDB()
  try {
    const tx = db.transaction(STORE, mode)
    return await fn(tx.objectStore(STORE), tx)
  } finally {
    db.close()
  }
}

export async function saveCachedVRM(data: ArrayBuffer): Promise<void> {
  try {
    await withStore('readwrite', (store, tx) => {
      store.put(data, KEY)
      return new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    })
  } catch {
    // キャッシュできなくても本体機能には影響しない
  }
}

export async function loadCachedVRM(): Promise<ArrayBuffer | null> {
  try {
    return await withStore('readonly', (store) => {
      const request = store.get(KEY)
      return new Promise((resolve, reject) => {
        request.onsuccess = () =>
          resolve(request.result instanceof ArrayBuffer ? request.result : null)
        request.onerror = () => reject(request.error)
      })
    })
  } catch {
    return null
  }
}

export async function clearCachedVRM(): Promise<void> {
  try {
    await withStore('readwrite', (store, tx) => {
      store.delete(KEY)
      return new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    })
  } catch {
    // 消せなくても致命的ではない
  }
}
