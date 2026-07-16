import * as THREE from 'three'
import { resolveWorldUrl, type SceneNode, type WorldDef } from './WorldDef'

/**
 * ワールドのシーンノードを描画する汎用レンダラー。
 * kindごとのプリミティブ(ground/sprite/text/bar/box/cylinder)を組み立て、
 * サーバー(__world)からの属性パッチ(gpatch/gsnap)を反映する。
 * ドメイン知識(かかしのHPなど)は持たない: それはワールドのwasmスクリプトの仕事。
 */

/** レイキャストで当てたオブジェクトからノードidを引くためのuserDataキー */
export const NODE_ID_KEY = 'nodeId'

interface NodeView {
  def: SceneNode
  object: THREE.Object3D
  /** 属性パッチの反映。位置・visible等の共通属性はSceneRenderer側で処理する */
  applyAttrs(attrs: Record<string, unknown>): void
  dispose(): void
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 足元の楕円影(2Dルック用のフェイクシャドウ) */
function makeBlobShadow(radius: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 24),
    new THREE.MeshBasicMaterial({ color: 0x1e321e, transparent: true, opacity: 0.28 }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.scale.y = 0.6
  mesh.position.y = 0.02
  return mesh
}

/** 読み込み失敗時のプレースホルダ(マゼンタ市松。どのノードが壊れているか一目で分かる) */
function placeholderTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#f0f' : '#333'
        ctx.fillRect(x * 32, y * 32, 32, 32)
      }
    }
  }
  return new THREE.CanvasTexture(canvas)
}

/** canvasに描いて使い回すビルボード(text/barの共通基盤。nameplate.tsと同じ手法) */
class CanvasBillboard {
  readonly sprite: THREE.Sprite
  protected readonly canvas: HTMLCanvasElement
  private readonly texture: THREE.CanvasTexture
  private readonly material: THREE.SpriteMaterial

  constructor(canvasW: number, canvasH: number, worldW: number, worldH: number) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = canvasW
    this.canvas.height = canvasH
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
    })
    this.sprite = new THREE.Sprite(this.material)
    this.sprite.scale.set(worldW, worldH, 1)
  }

  protected redraw(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    draw(ctx, this.canvas.width, this.canvas.height)
    this.texture.needsUpdate = true
  }

  dispose(): void {
    this.texture.dispose()
    this.material.dispose()
  }
}

export class SceneRenderer {
  readonly group = new THREE.Group()
  /** 地面メッシュ(移動先レイキャストの対象)。groundノードが無いワールドではnull */
  ground: THREE.Mesh | null = null
  private readonly views = new Map<string, NodeView>()
  /** ノードid → 親ノードid(トップレベルはnull)。祖先解決・ワールド座標算出に使う */
  private readonly parents = new Map<string, string | null>()
  private readonly disposables: Array<{ dispose(): void }> = []

  constructor(world: WorldDef, worldUrl: string) {
    for (const node of world.scene) {
      const object = this.buildTree(node, null, world, worldUrl)
      if (object) this.group.add(object)
    }
  }

  /**
   * ノードとその子孫を構築する。子はTHREE.Groupのネストで親に相対配置される。
   * ビュー化されないノード(collider等)の子孫は描画されない
   */
  private buildTree(
    node: SceneNode,
    parent: string | null,
    world: WorldDef,
    worldUrl: string,
  ): THREE.Object3D | null {
    const view = this.buildNode(node, world, worldUrl)
    if (!view) return null
    // 共通属性の初期反映(位置・向き・表示)
    this.applyCommonAttrs(view, node)
    // レイキャストからノードを特定できるようにidを付与する。
    // 子ノードの構築より先にtraverseすること(子のidを親のidで潰さない)
    view.object.traverse((obj) => {
      obj.userData[NODE_ID_KEY] = node.id
    })
    this.views.set(node.id, view)
    this.parents.set(node.id, parent)
    for (const child of node.children ?? []) {
      const childObject = this.buildTree(child, node.id, world, worldUrl)
      if (childObject) view.object.add(childObject)
    }
    return view.object
  }

  /** ノードの現在の定義(初期値+適用済みパッチ)。インタラクト判定などに使う */
  getNode(id: string): SceneNode | undefined {
    return this.views.get(id)?.def
  }

  /** ノードのワールドXZ座標(親チェーンの相対座標を合算)。未知のidはnull */
  worldPosition(id: string): { x: number; z: number } | null {
    if (!this.views.has(id)) return null
    let x = 0
    let z = 0
    let current: string | null = id
    for (let depth = 0; current !== null && depth < 16; depth++) {
      const view = this.views.get(current)
      if (!view) break
      x += num(view.def.x, 0)
      z += num(view.def.z, 0)
      current = this.parents.get(current) ?? null
    }
    return { x, z }
  }

  /**
   * ノード自身から親方向へ辿り、attrがtrueの最近傍ノードidを返す。
   * レイキャストは子(ビジュアル)に当たるため、エンティティルートへの解決に使う
   */
  findAncestorWith(id: string, attr: 'targetable' | 'interactable'): string | null {
    let current: string | null = id
    for (let depth = 0; current !== null && depth < 16; depth++) {
      const view = this.views.get(current)
      if (!view) return null
      if (view.def[attr] === true) return current
      current = this.parents.get(current) ?? null
    }
    return null
  }

  /** レイキャスト対象(トップレベルのみ。子孫はintersectObjectsのrecursiveで拾う) */
  raycastTargets(): THREE.Object3D[] {
    return [...this.views.entries()]
      .filter(([id, v]) => v.def.kind !== 'ground' && this.parents.get(id) === null)
      .map(([, v]) => v.object)
  }

  /** サーバーからの属性パッチを反映する(サーバー権威。値の意味は解釈しない) */
  applyPatch(id: string, attrs: Record<string, unknown>): void {
    const view = this.views.get(id)
    if (!view) return
    Object.assign(view.def, attrs)
    this.applyCommonAttrs(view, view.def)
    view.applyAttrs(attrs)
  }

  /** 入室時スナップショット(ノードごとの累積パッチ)の一括反映 */
  applySnapshot(patches: Record<string, Record<string, unknown>>): void {
    for (const [id, attrs] of Object.entries(patches)) this.applyPatch(id, attrs)
  }

  private applyCommonAttrs(view: NodeView, def: SceneNode): void {
    view.object.position.set(num(def.x, 0), num(def.y, 0), num(def.z, 0))
    view.object.visible = def.visible !== false
  }

  dispose(): void {
    for (const view of this.views.values()) view.dispose()
    for (const d of this.disposables) d.dispose()
    this.views.clear()
    this.parents.clear()
    this.group.removeFromParent()
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.disposables.push(resource)
    return resource
  }

  private buildNode(node: SceneNode, world: WorldDef, worldUrl: string): NodeView | null {
    switch (node.kind) {
      case 'group':
        // 空のコンテナ(div相当)。エンティティのデータ属性の置き場+子の座標基準
        return { def: node, object: new THREE.Group(), applyAttrs: () => {}, dispose: () => {} }
      case 'ground':
        return this.buildGround(node, world, worldUrl)
      case 'sprite':
        return this.buildSprite(node, worldUrl)
      case 'text':
        return this.buildText(node)
      case 'bar':
        return this.buildBar(node)
      case 'box':
      case 'cylinder':
        return this.buildPrimitive(node)
      case 'collider':
        return null // 不可視。通行判定はWorldDef.getObstaclesが担う
      default: {
        // 未知kindはプレースホルダ(前方互換: 新しいワールドを古いクライアントでも歩ける)
        const geometry = this.track(new THREE.BoxGeometry(0.6, 0.6, 0.6))
        const material = this.track(new THREE.MeshBasicMaterial({ color: 0xaa44aa }))
        const mesh = new THREE.Mesh(geometry, material)
        mesh.position.y = 0.3
        const group = new THREE.Group()
        group.add(mesh)
        return { def: node, object: group, applyAttrs: () => {}, dispose: () => {} }
      }
    }
  }

  private buildGround(node: SceneNode, world: WorldDef, worldUrl: string): NodeView {
    // テクスチャ読込までの単色つなぎ(失敗時もこの色のまま動く)
    const material = this.track(new THREE.MeshBasicMaterial({ color: 0x7aa860 }))
    if (typeof node.texture === 'string') {
      new THREE.TextureLoader().load(resolveWorldUrl(worldUrl, node.texture), (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = 4
        material.color.set(0xffffff)
        material.map = tex
        material.needsUpdate = true
        this.track(tex)
      })
    }
    const ground = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(world.size, world.size)),
      material,
    )
    ground.rotation.x = -Math.PI / 2
    ground.name = 'ground'
    this.ground = ground

    // マップ外の下地
    const void_ = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(400, 400)),
      this.track(new THREE.MeshBasicMaterial({ color: 0x1c2f22 })),
    )
    void_.rotation.x = -Math.PI / 2
    void_.position.y = -0.05

    const group = new THREE.Group()
    group.add(ground, void_)
    // groundの共通属性(位置)は使わない: 常に原点に敷く
    return { def: node, object: group, applyAttrs: () => {}, dispose: () => {} }
  }

  private buildSprite(node: SceneNode, worldUrl: string): NodeView {
    const w = num(node.w, 1)
    const h = num(node.h, 1)
    const material = this.track(new THREE.SpriteMaterial({ alphaTest: 0.5, transparent: true }))
    if (typeof node.image === 'string') {
      new THREE.TextureLoader().load(
        resolveWorldUrl(worldUrl, node.image),
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace
          material.map = tex
          material.needsUpdate = true
          this.track(tex)
        },
        undefined,
        () => {
          material.map = this.track(placeholderTexture())
          material.needsUpdate = true
        },
      )
    }
    const sprite = new THREE.Sprite(material)
    sprite.center.set(0.5, 0.02)
    sprite.scale.set(w, h, 1)
    const group = new THREE.Group()
    group.add(sprite)
    group.add(makeBlobShadow(w * 0.32))
    return {
      def: node,
      object: group,
      applyAttrs: (attrs) => {
        if ('w' in attrs || 'h' in attrs) {
          sprite.scale.set(num(node.w, w), num(node.h, h), 1)
        }
      },
      dispose: () => {},
    }
  }

  private buildText(node: SceneNode): NodeView {
    const billboard = new (class extends CanvasBillboard {
      setText(text: string): void {
        this.redraw((ctx, w, h) => {
          ctx.font = '96px "Hiragino Sans", "Noto Sans JP", sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.lineWidth = 10
          ctx.strokeStyle = 'rgba(20, 24, 32, 0.85)'
          ctx.strokeText(text, w / 2, h / 2, w - 16)
          ctx.fillStyle = '#f2f5fa'
          ctx.fillText(text, w / 2, h / 2, w - 16)
        })
      }
    })(512, 160, num(node.w, 1.6), num(node.h, 0.5))
    billboard.setText(String(node.text ?? ''))
    const group = new THREE.Group()
    group.add(billboard.sprite)
    return {
      def: node,
      object: group,
      applyAttrs: (attrs) => {
        if ('text' in attrs) billboard.setText(String(node.text ?? ''))
      },
      dispose: () => billboard.dispose(),
    }
  }

  private buildBar(node: SceneNode): NodeView {
    const billboard = new (class extends CanvasBillboard {
      setValue(value: number): void {
        const clamped = Math.max(0, Math.min(1, value))
        this.redraw((ctx, w, h) => {
          ctx.fillStyle = 'rgba(20, 24, 32, 0.7)'
          ctx.beginPath()
          ctx.roundRect(0, 0, w, h, h / 2)
          ctx.fill()
          const pad = 8
          ctx.fillStyle = clamped > 0.5 ? '#7cfc8a' : clamped > 0.25 ? '#ffd25e' : '#ff6b5e'
          if (clamped > 0) {
            ctx.beginPath()
            ctx.roundRect(pad, pad, (w - pad * 2) * clamped, h - pad * 2, (h - pad * 2) / 2)
            ctx.fill()
          }
        })
      }
    })(256, 40, num(node.w, 1.2), num(node.h, 0.18))
    billboard.setValue(num(node.value, 1))
    const group = new THREE.Group()
    group.add(billboard.sprite)
    return {
      def: node,
      object: group,
      applyAttrs: (attrs) => {
        if ('value' in attrs) billboard.setValue(num(node.value, 1))
      },
      dispose: () => billboard.dispose(),
    }
  }

  private buildPrimitive(node: SceneNode): NodeView {
    const color = new THREE.Color(typeof node.color === 'string' ? node.color : '#888888')
    const material = this.track(new THREE.MeshStandardMaterial({ color, roughness: 0.8 }))
    const h = num(node.h, 0.5)
    const geometry = this.track(
      node.kind === 'cylinder'
        ? new THREE.CylinderGeometry(num(node.r, 0.5), num(node.r, 0.5), h, 24)
        : new THREE.BoxGeometry(num(node.w, 1), h, num(node.d, 1)),
    )
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.y = h / 2 // 底面を地面に合わせる(ノードのyはグループ側に効く)
    const group = new THREE.Group()
    group.add(mesh)
    return {
      def: node,
      object: group,
      applyAttrs: (attrs) => {
        if ('color' in attrs && typeof node.color === 'string') material.color.set(node.color)
      },
      dispose: () => {},
    }
  }
}
