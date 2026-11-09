/** 開場對話：在挑 CD 之前，用主人的口吻交代我是誰、這裡有什麼、為什麼做。只用資料與主人給的名字，不代編故事 */
export interface OwnerCall {
  /** 名牌上的名字（例如「阿明」） */
  name: string;
  /** 別名（例如「Ming」），沒有就不提 */
  alias?: string;
}

export function onboardLines(owner: OwnerCall, artists: number, hasScreening: boolean): string[] {
  const hi = owner.alias ? `嗨，我是${owner.name}，也可以叫我 ${owner.alias}。` : `嗨，我是${owner.name}。`;
  const room = `這裡是我聽歌的地方，這一年常聽的歌手有 ${artists.toLocaleString('en-US')} 位${hasScreening ? '；隔壁是我看劇的地方' : ''}。`;
  return [hi, room, `我想讓認識我的人知道，我平常都在聽什麼${hasScreening ? '、看什麼' : ''}。`, '先從我的架上，挑一張你喜歡的專輯吧。'];
}
