import type React from 'react';
import { useState } from 'react';
import { characterFacesPath } from '../../themes/characterThemes';
import { useCharacterTheme } from '../../themes/useCharacterTheme';
import { cn } from '../../utils/cn';

interface CharacterStickerProps {
  /** 尺寸与布局类，由调用方决定（首页右栏、运行流标题行各用一套）。 */
  className?: string;
  /** 定位/测试用标识。 */
  testId?: string;
}

/**
 * 角色表情包（一张图里合成三个表情）。
 *
 * 只跟随角色主题存在与否：没有选角色、或图片加载失败时整块不渲染，
 * 所以调用方不需要额外开关，也不会留下破图或空占位。
 * 图片本身 pointer-events-none，纯装饰、不参与交互。
 */
export const CharacterSticker: React.FC<CharacterStickerProps> = ({ className, testId }) => {
  const { theme } = useCharacterTheme();
  const [failedThemeId, setFailedThemeId] = useState<string | null>(null);

  if (!theme || failedThemeId === theme.id) {
    return null;
  }

  return (
    <img
      src={characterFacesPath(theme.id)}
      alt=""
      aria-hidden="true"
      data-testid={testId}
      className={cn('pointer-events-none object-contain', className)}
      onError={() => setFailedThemeId(theme.id)}
    />
  );
};
