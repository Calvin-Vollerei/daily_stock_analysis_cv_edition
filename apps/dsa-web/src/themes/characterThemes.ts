/**
 * 角色主题色板。
 *
 * 四个角色各取自身特征色作为「全部高亮色」：主色用于按钮/链接/焦点环图表主色，
 * 副色用于选中态与悬浮底色。色值以 HSL 三元组给出，直接写入 CSS 变量
 * （`--primary` / `--ring` / `--accent` 等），因此主题切换不需要改组件。
 *
 * 立绘与表情包放在 `public/themes/<id>/`：
 *   sprite.webp  竖版大立绘（设置 → 关于 下方）
 *   faces.png    一张合成三连表情（首页顶部）
 * 缺图时相关位置自动隐藏，不影响其它功能。
 */

export type CharacterThemeId = 'takakou' | 'mebuki' | 'mochiko' | 'kurumi';

export interface CharacterPalette {
  /** 主色：按钮、链接、焦点环、图表主色。 */
  primary: string;
  primaryForeground: string;
  /** 主色的深/浅变体，用于渐变与悬浮。 */
  primaryDeep: string;
  primarySoft: string;
  /** 副色：选中态、卡片描边、强调块。 */
  accent: string;
  accentDeep: string;
  /** 低饱和底色：二级按钮、标签背景。 */
  tint: string;
  /** 角色描边光晕色（rgba 由 CSS 侧用 hsl 组合）。 */
  glow: string;
}

export interface CharacterTheme {
  id: CharacterThemeId;
  /** 中文名，同时作为主题显示名。 */
  name: string;
  nameEn: string;
  /** 一句话气质描述，用于设置页说明。 */
  tagline: string;
  /** 取自角色立绘的高亮色。 */
  light: CharacterPalette;
  dark: CharacterPalette;
}

export const CHARACTER_THEMES: CharacterTheme[] = [
  {
    id: 'takakou',
    name: '高更康子',
    nameEn: 'Takakou Yasuko',
    tagline: '深蓝发色与朱红裙摆，冷静里带一点倔强',
    light: {
      primary: '353 62% 50%',
      primaryForeground: '0 0% 100%',
      primaryDeep: '353 66% 40%',
      primarySoft: '353 70% 92%',
      accent: '210 26% 32%',
      accentDeep: '210 30% 22%',
      tint: '348 30% 95%',
      glow: '353 70% 62%',
    },
    dark: {
      primary: '352 78% 62%',
      primaryForeground: '240 20% 8%',
      primaryDeep: '352 60% 52%',
      primarySoft: '352 40% 22%',
      accent: '205 45% 62%',
      accentDeep: '205 40% 45%',
      tint: '350 22% 16%',
      glow: '352 82% 68%',
    },
  },
  {
    id: 'mebuki',
    name: '山师芽吹',
    nameEn: 'Yamashi Mebuki',
    tagline: '金色短发与青绿上衣，像刚抽芽的春天',
    light: {
      primary: '44 72% 46%',
      primaryForeground: '40 40% 12%',
      primaryDeep: '42 74% 36%',
      primarySoft: '46 80% 90%',
      accent: '200 28% 36%',
      accentDeep: '200 30% 26%',
      tint: '45 45% 94%',
      glow: '45 80% 60%',
    },
    dark: {
      primary: '45 82% 60%',
      primaryForeground: '40 40% 10%',
      primaryDeep: '44 70% 50%',
      primarySoft: '44 35% 22%',
      accent: '188 38% 60%',
      accentDeep: '190 35% 46%',
      tint: '45 25% 15%',
      glow: '46 88% 66%',
    },
  },
  {
    id: 'mochiko',
    name: '小金萌智子',
    nameEn: 'Kogane Mochiko',
    tagline: '紫色长发配白色连衣裙，柔软又有点傲',
    light: {
      primary: '285 52% 52%',
      primaryForeground: '0 0% 100%',
      primaryDeep: '285 56% 42%',
      primarySoft: '285 60% 93%',
      accent: '250 26% 34%',
      accentDeep: '250 30% 24%',
      tint: '285 35% 95%',
      glow: '288 65% 66%',
    },
    dark: {
      primary: '286 72% 66%',
      primaryForeground: '260 30% 10%',
      primaryDeep: '286 60% 54%',
      primarySoft: '286 40% 24%',
      accent: '245 45% 64%',
      accentDeep: '245 40% 48%',
      tint: '285 25% 16%',
      glow: '288 78% 72%',
    },
  },
  {
    id: 'kurumi',
    name: '福贺久留美',
    nameEn: 'Fukuga Kurumi',
    tagline: '粉色短发与绯红缎带，热络得让人招架不住',
    light: {
      primary: '336 70% 56%',
      primaryForeground: '0 0% 100%',
      primaryDeep: '336 72% 45%',
      primarySoft: '338 80% 94%',
      accent: '350 66% 42%',
      accentDeep: '350 70% 32%',
      tint: '338 45% 96%',
      glow: '338 82% 68%',
    },
    dark: {
      primary: '338 82% 68%',
      primaryForeground: '330 30% 10%',
      primaryDeep: '338 68% 56%',
      primarySoft: '338 42% 24%',
      accent: '350 72% 60%',
      accentDeep: '350 60% 46%',
      tint: '338 28% 17%',
      glow: '340 88% 74%',
    },
  },
];

export const CHARACTER_THEME_IDS: CharacterThemeId[] = CHARACTER_THEMES.map((theme) => theme.id);

export const DEFAULT_CHARACTER_THEME: CharacterThemeId | null = null;

export function findCharacterTheme(id: string | null | undefined): CharacterTheme | null {
  if (!id) {
    return null;
  }
  return CHARACTER_THEMES.find((theme) => theme.id === id) ?? null;
}

/** 角色立绘路径（竖版大图）。 */
export function characterSpritePath(id: CharacterThemeId): string {
  return `/themes/${id}/sprite.webp`;
}

/** 表情包路径（一张图内合成三个表情）。 */
export function characterFacesPath(id: CharacterThemeId): string {
  return `/themes/${id}/faces.png`;
}
