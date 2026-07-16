import { useAppStore } from '../../state/store'
import { UnitFrame } from './UnitFrame'

/** 自分のユニットフレーム(左上)。アバター名とHPゲージのみ */
export function StatusPanel() {
  const avatarName = useAppStore((s) => s.avatarName)
  const selfHp = useAppStore((s) => s.selfHp)
  const selfHpMax = useAppStore((s) => s.selfHpMax)
  const dead = useAppStore((s) => s.dead)
  return (
    <UnitFrame
      name={avatarName ?? 'アバター未読込'}
      state={dead ? '(戦闘不能)' : undefined}
      hp={selfHp}
      hpMax={selfHpMax}
      down={dead}
    />
  )
}
