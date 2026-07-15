import type { ItemId } from "../sim/types";

/**
 * Discovery-scale guidance for missing recipe inputs. These hints teach the
 * world's ecology or an upstream production step without revealing coordinates.
 */
export const ITEM_ACQUISITION_HINTS: Record<ItemId, string> = {
  stone: "优先查看河岸冲刷带和岩石高地的裸露碎石；成块岩体需要装备石镐开采。",
  stick: "林下枯枝和风折木堆最常见；也可砍伐成树，再把原木劈成木棍。",
  log: "装备石斧砍倒成树，并继续处理倒木取得原木。幼树尚未长成时不会产出整根木料。",
  vine: "河谷湿地、林缘和树干附近更容易发现垂落或风折藤蔓。",
  "broad-leaf": "在湿润低地寻找宽叶棕榈与棕榈叶簇，密冠林下也会形成可采叶片。",
  "medicinal-leaf": "沿溪流和湿润林下寻找船子草一类药用阔叶植物。",
  "dry-leaf": "遮雨岩棚、岩缝和较干的林下凋落层会积存浅褐色干叶。",
  coconut: "棕榈坚果林和河谷边缘常有落地椰子；先观察树冠下的地面。",
  "coconut-shell": "先取得椰子，再用石刃剖开；已经装水的椰壳不能算作空容器。",
  "dirty-water": "携带空椰壳前往可安全靠近的河岸取水；浑浊溪水必须再煮沸。",
  "clean-water": "把浑浊溪水带到燃烧中的营火旁煮沸，或在足够雨势中用空椰壳接取。",
  "stone-blade": "收集河岸或岩地石块，先在随身制作中打制石刃。",
  axe: "先打制石刃，再用石块、木棍和藤条捆扎石斧。",
  "stone-pick": "先打制石刃，再用较多石块、木棍和藤条捆扎石镐。",
  torch: "收集木棍、藤条和干叶，在随身制作中捆扎简易火把。",
  bandage: "把湿润林下的药用叶与藤条组合成草药绷带。",
  spear: "先打制石刃，再用木棍和藤条削制石矛。",
  battery: "推进损坏电台的线索，在废弃气象设施中调查可拆卸电源。",
  "antiparasitic-herb": "在潮湿河谷和阴生植物层寻找具有驱虫用途的苦味草本。",
  "palm-fruit": "在结果的棕榈与芭蕉类植物周围观察成熟果实和落果。",
  "brazil-nuts": "在高大巴西坚果树下和较干的林地坡面寻找坚果荚。",
  grubs: "处理腐朽倒木和潮湿木质残骸时，可能发现甲虫幼虫。",
  "raw-meat": "狩猎并处理雨林动物尸体；接近前先准备武器并观察它的逃跑或反击路线。",
  "cooked-meat": "把生肉带到燃烧中的营火旁彻底烤熟。",
  "smoked-meat": "先搭建烟熏架，再把生肉放入并维持附近火源完成加工。",
  hide: "狩猎中型动物并处理尸体；并非所有小型猎物都能提供完整兽皮。",
};

export function acquisitionHintForItem(itemId: ItemId): string {
  return ITEM_ACQUISITION_HINTS[itemId];
}
