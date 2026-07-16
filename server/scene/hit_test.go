package scene

import (
	"math"
	"testing"
)

// 座標規約: 前方 = (sin yaw, cos yaw)。yaw=0は+Z向き。
// クライアント(effects.ts)の扇100°・リーチ~2.1mと整合していることを固定する。

func TestSlashHits(t *testing.T) {
	tests := []struct {
		name        string
		ax, az, yaw float64
		nx, nz, r   float64
		want        bool
	}{
		{"正面・射程内", 0, 0, 0, 0, 2, 0.5, true},
		{"正面・射程外", 0, 0, 0, 0, 3.5, 0.5, false},
		{"半径ぶんで届く(距離-r<=2.2)", 0, 0, 0, 0, 2.6, 0.5, true},
		{"真後ろは当たらない", 0, 0, 0, 0, -2, 0.5, false},
		{"横(90°)は扇の外", 0, 0, 0, 2, 0, 0.5, false},
		{"斜め45°は扇の外(片側50°だが45°は中)", 0, 0, 0, 1.4, 1.4, 0.5, true},
		{"yaw=π/2(+X向き)で+X方向に当たる", 0, 0, math.Pi / 2, 2, 0, 0.5, true},
		{"的の中に立っていれば角度不問", 0, 0, 0, 0.1, -0.2, 0.5, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := slashHits(tt.ax, tt.az, tt.yaw, tt.nx, tt.nz, tt.r); got != tt.want {
				t.Errorf("slashHits = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestTargetedSlashHits(t *testing.T) {
	tests := []struct {
		name      string
		ax, az    float64
		nx, nz, r float64
		want      bool
	}{
		{"射程内", 0, 0, 0, 2, 0.5, true},
		{"射程外", 0, 0, 0, 3.5, 0.5, false},
		{"半径ぶんで届く(距離-r<=2.2)", 0, 0, 0, 2.6, 0.5, true},
		{"背後でも射程内なら当たる(角度不問)", 0, 0, 0, -2, 0.5, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := targetedSlashHits(tt.ax, tt.az, tt.nx, tt.nz, tt.r); got != tt.want {
				t.Errorf("targetedSlashHits = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestShootHits(t *testing.T) {
	// tx,tzは常に6m先に正規化されるため、手前の的は線分の途中で当たる必要がある
	tests := []struct {
		name           string
		ax, az, tx, tz float64
		nx, nz, r      float64
		want           bool
	}{
		{"射線上の手前の的に当たる", 0, 0, 0, 6, 0, 3, 0.5, true},
		{"着弾点の的に当たる", 0, 0, 0, 6, 0, 6, 0.5, true},
		{"射線から横に外れた的", 0, 0, 0, 6, 1.5, 3, 0.5, false},
		{"射線のかすめ(r+0.3以内)", 0, 0, 0, 6, 0.7, 3, 0.5, true},
		{"射程より奥の的には当たらない", 0, 0, 0, 6, 0, 8, 0.5, false},
		{"後方の的には当たらない", 0, 0, 0, 6, 0, -2, 0.5, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := shootHits(tt.ax, tt.az, tt.tx, tt.tz, tt.nx, tt.nz, tt.r); got != tt.want {
				t.Errorf("shootHits = %v, want %v", got, tt.want)
			}
		})
	}
}
