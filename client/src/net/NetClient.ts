import { type RemoteParticipant, type RemoteTrack, Room, RoomEvent, Track } from 'livekit-client'
import { decodeMessage, encodeMessage, type GameMessage } from './protocol'

const TOKEN_URL = import.meta.env.VITE_TOKEN_URL ?? 'http://localhost:8787/token'

export interface NetEvents {
  onRemoteVideo(id: string, video: HTMLVideoElement): void
  onRemoteMessage(id: string, message: GameMessage): void
  onRemoteLeft(id: string): void
  onPeersChanged(count: number): void
}

/**
 * LiveKitとの接続を担当する。
 * 自アバターの描画結果を映像トラックとして送信し、位置などのゲームメッセージを
 * DataChannelで送受信する。
 */
export class NetClient {
  private room: Room | null = null

  get connected(): boolean {
    return this.room !== null
  }

  async connect(roomName: string, identity: string, track: MediaStreamTrack, events: NetEvents) {
    const res = await fetch(
      `${TOKEN_URL}?room=${encodeURIComponent(roomName)}&name=${encodeURIComponent(identity)}`,
    )
    if (!res.ok) throw new Error(`トークン取得に失敗しました (${res.status})`)
    const { token, url } = (await res.json()) as { token: string; url: string }

    const room = new Room()

    const notifyPeers = () => events.onPeersChanged(room.remoteParticipants.size)

    room
      .on(RoomEvent.TrackSubscribed, (remote: RemoteTrack, _pub, participant) => {
        if (remote.kind !== Track.Kind.Video) return
        const video = remote.attach() as HTMLVideoElement
        video.muted = true
        void video.play().catch(() => {})
        events.onRemoteVideo(participant.identity, video)
      })
      .on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
        if (!participant) return
        const message = decodeMessage(payload)
        if (message) events.onRemoteMessage(participant.identity, message)
      })
      .on(RoomEvent.ParticipantConnected, notifyPeers)
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        events.onRemoteLeft(participant.identity)
        notifyPeers()
      })

    await room.connect(url, token)
    await room.localParticipant.publishTrack(track, {
      name: 'avatar',
      simulcast: false,
    })
    this.room = room
    notifyPeers()
  }

  /** 位置更新など、多少落ちてもよいメッセージ */
  sendLossy(message: GameMessage): void {
    this.room?.localParticipant.publishData(encodeMessage(message), { reliable: false })
  }

  /** アクションなど、確実に届けたいメッセージ(Phase 3で使用) */
  sendReliable(message: GameMessage): void {
    this.room?.localParticipant.publishData(encodeMessage(message), { reliable: true })
  }

  disconnect(): void {
    this.room?.disconnect()
    this.room = null
  }
}
