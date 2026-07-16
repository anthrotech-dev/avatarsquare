/**
 * テスト(vitest, node環境)専用の最小宣言。
 * tsconfigのtypesを"vite/client"に絞っているため、@types/nodeを入れずに
 * テストで使うAPIだけを宣言する(nodeのグローバル型でDOM型を汚さない)。
 */
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf-8'): string
}
