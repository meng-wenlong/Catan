// 资源与地形
export const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

export const TERRAIN_RESOURCE = {
  forest: 'wood',
  hills: 'brick',
  pasture: 'sheep',
  fields: 'wheat',
  mountains: 'ore',
  desert: null,
};

// 标准图地形数量
export const TERRAIN_POOL = [
  'forest', 'forest', 'forest', 'forest',
  'pasture', 'pasture', 'pasture', 'pasture',
  'fields', 'fields', 'fields', 'fields',
  'hills', 'hills', 'hills',
  'mountains', 'mountains', 'mountains',
  'desert',
];

// 官方螺旋放置数字序列（A-R）
export const NUMBER_SPIRAL = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];

// 港口：4 个 3:1 通用港 + 5 个 2:1 资源港
export const HARBOR_POOL = ['any', 'any', 'any', 'any', 'wood', 'brick', 'sheep', 'wheat', 'ore'];

// 建造花费
export const COSTS = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  dev: { sheep: 1, wheat: 1, ore: 1 },
};

// 发展卡牌堆：14 骑士 + 5 分数 + 2 修路 + 2 丰收 + 2 垄断
export const DEV_DECK = [
  ...Array(14).fill('knight'),
  ...Array(5).fill('vp'),
  ...Array(2).fill('roadBuilding'),
  ...Array(2).fill('yearOfPlenty'),
  ...Array(2).fill('monopoly'),
];

export const PIECE_LIMITS = { road: 15, settlement: 5, city: 4 };
export const BANK_PER_RESOURCE = 19;
export const WIN_VP = 10;
// 可选棋子颜色（开局前由玩家自选；前 4 个也是未选择时的默认分配）
export const PLAYER_COLORS = ['#e74c3c', '#3498db', '#f39c12', '#ecf0f1', '#2ecc71', '#9b59b6'];
export const COLOR_NAMES = ['红色', '蓝色', '橙色', '白色', '绿色', '紫色'];
