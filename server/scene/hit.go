package scene

import "math"

// 攻撃の当たり判定(純関数)。
// ジオメトリの定義はクライアントのエフェクト(client/src/game/effects.ts)と
// 対で決まるゲーム全体の取り決めなので、各wasmスクリプトには複製せず
// ホスト側で判定して "hit" イベントだけを配送する。
//
// 座標規約: 前方 = (sin yaw, cos yaw)。effects.tsのSlashEffectと同じ。

const (
	// 斬撃のリーチ。クライアントの扇エフェクト(外径1.4×最大スケール≒2.1m)に整合
	slashRange = 2.2
	// 斬撃の有効角(片側)。クライアントの扇は100°
	slashHalfAngleDeg = 50
	// 射撃の当たり幅(弾の半径ぶんの余裕)
	shootMargin = 0.3
	// ノードにcollider属性が無い場合のhit判定半径
	defaultHitRadius = 0.5
)

// slashHits は(ax,az)からyaw方向への斬撃が中心(nx,nz)半径rの的に当たるか
func slashHits(ax, az, yaw, nx, nz, r float64) bool {
	dx := nx - ax
	dz := nz - az
	dist := math.Hypot(dx, dz)
	if dist-r > slashRange {
		return false
	}
	// 至近(的の中に立っている)なら角度不問
	if dist < r {
		return true
	}
	// 前方(sin yaw, cos yaw)とのなす角
	angle := math.Abs(angleDiff(math.Atan2(dx, dz), yaw))
	return angle <= slashHalfAngleDeg*math.Pi/180
}

// targetedSlashHits は対象指定の斬撃が中心(nx,nz)半径rの的に届くか。
// 対象を選択して発動するスキルなので角度は不問(発動時に対象の方を向く)、
// 距離だけを通常の斬撃と同じリーチで検証する
func targetedSlashHits(ax, az, nx, nz, r float64) bool {
	return math.Hypot(nx-ax, nz-az)-r <= slashRange
}

// shootHits は(ax,az)から(tx,tz)への射線が中心(nx,nz)半径rの的を通るか。
// クライアントのtx,tzは常に射程いっぱい(6m先)に正規化されるため、
// 着弾点ではなく線分との距離で判定する(手前の的に当てるため)。
func shootHits(ax, az, tx, tz, nx, nz, r float64) bool {
	return distToSegment(nx, nz, ax, az, tx, tz) <= r+shootMargin
}

func angleDiff(a, b float64) float64 {
	d := math.Mod(a-b, 2*math.Pi)
	if d > math.Pi {
		d -= 2 * math.Pi
	}
	if d < -math.Pi {
		d += 2 * math.Pi
	}
	return d
}

func distToSegment(px, pz, ax, az, bx, bz float64) float64 {
	dx := bx - ax
	dz := bz - az
	lenSq := dx*dx + dz*dz
	t := 0.0
	if lenSq > 0 {
		t = math.Max(0, math.Min(1, ((px-ax)*dx+(pz-az)*dz)/lenSq))
	}
	return math.Hypot(px-(ax+t*dx), pz-(az+t*dz))
}
