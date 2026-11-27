import type React from 'react';
import { useState } from 'react';
import { characterSpritePath } from '../../themes/characterThemes';
import { useCharacterTheme } from '../../themes/useCharacterTheme';

/**
 * 「设置 → 关于」下方的角色立绘。
 *
 * 只渲染立绘本身：不加卡片边框、标题或说明文字，透明底直接贴在关于区底下。
 * 主题本身就是开关：没选角色、或立绘加载失败（缺图/格式不支持）时整块不渲染，不留破图。
 */
export const CharacterArtCard: React.FC = () => {
  const { theme } = useCharacterTheme();
  const [failedThemeId, setFailedThemeId] = useState<string | null>(null);

  if (!theme || failedThemeId === theme.id) {
    return null;
  }

  return (
    <div data-testid="character-art-card" className="flex justify-center">
      <img
        src={characterSpritePath(theme.id)}
        alt={theme.name}
        data-testid="character-sprite"
        className="max-h-[460px] w-auto max-w-full object-contain"
        onError={() => setFailedThemeId(theme.id)}
      />
    </div>
  );
};
