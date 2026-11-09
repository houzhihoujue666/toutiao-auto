import type { CollectedItem } from '@shared/types';

/**
 * 模拟数据源（runtime.mode = simulated 时用）
 * 目的：离线也能把「采集 → 去重 → 入库」跑通并自测，不碰真实平台。
 *
 * 行为约定（对齐 §10.2 SMOKE-2 验收口径）：
 *  - 同一批（round）重复调用返回完全相同的 20 条 → 重复采集必须 0 新增，用来验证指纹去重；
 *  - 只有显式调用 advanceSimulatedFeed() 才产出下一批全新内容 → 模拟「第二天刷新出了新内容」。
 */

const SEED_TEXTS: { author: string; content: string; topics: string[] }[] = [
  {
    author: '城市观察日记',
    content:
      '早上七点的菜市场已经很热闹了。卖菜的大姐说，今年本地大白菜比去年同期便宜了三成，来买的人反而没变多。她说了一句挺有意思的话：便宜的时候大家反而不着急。',
    topics: ['生活', '菜市场'],
  },
  {
    author: '数码小报告',
    content:
      '国产大模型这周又更新了。这次最直观的变化是响应速度，同样的问题，等待时间几乎少了一半。对个人用户来说，这比参数榜单实在得多。',
    topics: ['科技', 'AI'],
  },
  {
    author: '早餐研究所',
    content:
      '试了半个月才发现，煎饺子好不好吃关键不在火候，在下锅前那一步：先让饺子皮表面稍微干一会儿。这一步省了，怎么煎都是软的。',
    topics: ['美食'],
  },
  {
    author: '通勤路上',
    content:
      '地铁早高峰有个规律：越靠近车门的队伍走得越慢，因为每个人都在等别人先上。中间那几节反而最快，只是要多走几步。',
    topics: ['生活'],
  },
  {
    author: '手写笔记',
    content:
      '用了三年电子笔记之后我又换回纸笔。不是情怀，是发现手写的时候我不会去翻别的标签页，注意力明显更完整。',
    topics: ['效率', '工具'],
  },
  {
    author: '老张聊装修',
    content:
      '装修最容易后悔的地方不是风格，是插座。住进去半年才知道哪里该留、留几个。建议每个房间都比你认为需要的多留两个。',
    topics: ['家居'],
  },
  {
    author: '夜跑日记',
    content:
      '跑步坚持不下来的原因往往不是累，是开始太猛。前两周只要求自己换上鞋出门，哪怕走两圈也算完成，反而跑到了今天。',
    topics: ['运动'],
  },
  {
    author: '宠物急诊室',
    content:
      '带猫去看病，医生问的第一句永远是最近喝水多不多。很多问题都是从饮水量变化先露出苗头的，比精神状态更早。',
    topics: ['宠物'],
  },
  {
    author: '小城书摊',
    content:
      '书店里被翻得最旧的那本，往往不是畅销书，是工具书。真正会被反复读的东西，读起来都不太轻松。',
    topics: ['阅读'],
  },
  {
    author: '省钱攻略君',
    content:
      '大促前先别急着加购物车。把去年买过、今年还在用的东西列出来，你会发现真正值得囤的东西不超过五样。',
    topics: ['消费'],
  },
  {
    author: '深夜食堂老板',
    content:
      '每天最后一位客人走后，我都会给自己煮一碗面。不是饿，是一天里只有这十分钟是完全安静的。',
    topics: ['生活', '美食'],
  },
  {
    author: '家电维修李工',
    content:
      '洗衣机有异味，八成不是衣服的问题，是胶圈夹层里积的絮屑。用旧牙刷加中性清洁剂刷一圈，比买清洗剂管用。',
    topics: ['家居'],
  },
  {
    author: '周末露营计划',
    content:
      '第一次露营最容易带多的三样东西：衣服、零食、椅子。真正用不上的是椅子——大家最后都坐在防潮垫上。',
    topics: ['户外'],
  },
  {
    author: '早市咖啡摊',
    content:
      '手冲咖啡水温差五度，味道差得很明显。夏天用九十二度容易发苦，降到八十七度反而把果酸留住了。',
    topics: ['美食', '咖啡'],
  },
  {
    author: '记账十年',
    content:
      '记账最难的不是记，是分类。把「让自己省了时间的钱」单列一类之后，我才看懂哪些支出该砍、哪些该留。',
    topics: ['理财'],
  },
  {
    author: '带娃日常',
    content:
      '小孩不肯收拾玩具，讲道理没用。改成「我们一起把车停回车库」，游戏一包装，他收拾得比我还快。',
    topics: ['育儿'],
  },
  {
    author: '骑行通勤狗',
    content: '通勤骑行最实用的装备不是骑行服，是后货架。背了一周背包之后你会发现，肩膀比腿先罢工。',
    topics: ['运动', '通勤'],
  },
  {
    author: '阳台种菜记',
    content: '阳台种菜第一个月最容易死在浇水上。土表发白再浇，一次浇透，比每天抿两口强太多。',
    topics: ['园艺'],
  },
  {
    author: '摄影小白班',
    content: '手机拍风景总是灰蒙蒙，多半是没点天空压曝光。手指往亮处点一下再往下拖，层次立刻出来。',
    topics: ['摄影'],
  },
  {
    author: '修理旧家具',
    content: '旧木桌晃不一定是螺丝松，可能是榫头干了。先把接缝处敲紧再加角码，比直接换螺丝管用。',
    topics: ['家居'],
  },
];

export const SIMULATED_BATCH_SIZE = SEED_TEXTS.length;

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** round 决定内容版本，保证不同轮次内容互不相同（否则会被去重当成重复） */
function makeItem(seedIndex: number, round: number): CollectedItem {
  const seed = SEED_TEXTS[seedIndex % SEED_TEXTS.length]!;
  const rnd = mulberry(seedIndex * 7919 + round * 104729 + 13);
  const minutesAgo = Math.floor(rnd() * 600) + 5;
  const published = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const version = round === 0 ? '' : `（第 ${round + 1} 批：${seed.topics[0]}话题的新观察）`;
  return {
    platformItemId: `sim-${round}-${1000 + seedIndex}`,
    author: seed.author,
    content: seed.content + version,
    images: [`simulated://${seedIndex % 5}`],
    topics: seed.topics,
    likeCount: Math.floor(rnd() * 20000) + 500,
    commentCount: Math.floor(rnd() * 1500) + 30,
    publishedAt: published,
  };
}

let round = 0;
let cache: CollectedItem[] = [];

function build(roundNo: number): CollectedItem[] {
  const list: CollectedItem[] = [];
  for (let i = 0; i < SIMULATED_BATCH_SIZE; i++) list.push(makeItem(i, roundNo));
  return list;
}

/** 当前批次：重复调用返回同一批，用于验证「重复采集 0 新增」 */
export function simulatedBatch(): { items: CollectedItem[]; expectedNew: number } {
  if (cache.length === 0) cache = build(round);
  return { items: cache, expectedNew: cache.length };
}

/** 推进到下一批全新内容（模拟隔一段时间刷新出了新内容） */
export function advanceSimulatedFeed(): CollectedItem[] {
  round += 1;
  cache = build(round);
  return cache;
}

export function currentRound(): number {
  return round;
}

export function resetSimulatedSource(): void {
  round = 0;
  cache = [];
}
