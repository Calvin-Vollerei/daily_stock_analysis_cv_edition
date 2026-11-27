import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GeneralSettingsCard } from '../GeneralSettingsCard';
import {
  UI_FONT_SIZE_STORAGE_KEY,
  UI_FONT_STORAGE_KEY,
  UI_LINE_HEIGHT_STORAGE_KEY,
} from '../../../utils/uiAppearance';

const setThemeMock = vi.fn();

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: setThemeMock }),
}));

beforeEach(() => {
  window.localStorage.clear();
  setThemeMock.mockClear();
});

function comboboxes() {
  return screen.getAllByRole('combobox') as HTMLSelectElement[];
}

describe('GeneralSettingsCard', () => {
  it('renders language, theme, font, size and line-height controls', () => {
    render(<GeneralSettingsCard />);

    expect(screen.getByRole('heading', { name: '通用设置' })).toBeInTheDocument();
    expect(comboboxes()).toHaveLength(4);
    expect(screen.getByRole('button', { name: '浅色' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '保存外观' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '恢复默认外观' })).toBeDisabled();
  });

  it('keeps font edits in a draft until saved', () => {
    render(<GeneralSettingsCard />);

    fireEvent.change(comboboxes()[1], { target: { value: 'SimHei' } });

    expect(window.localStorage.getItem(UI_FONT_STORAGE_KEY)).toBeNull();
    expect(screen.getByText('未保存')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存外观' }));

    expect(window.localStorage.getItem(UI_FONT_STORAGE_KEY)).toBe('SimHei');
    expect(screen.getByText('已保存')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存外观' })).toBeDisabled();
  });

  it('persists font size and line height together', () => {
    render(<GeneralSettingsCard />);

    fireEvent.change(comboboxes()[2], { target: { value: '18' } });
    fireEvent.change(comboboxes()[3], { target: { value: 'relaxed' } });
    fireEvent.click(screen.getByRole('button', { name: '保存外观' }));

    expect(window.localStorage.getItem(UI_FONT_SIZE_STORAGE_KEY)).toBe('18');
    expect(window.localStorage.getItem(UI_LINE_HEIGHT_STORAGE_KEY)).toBe('relaxed');
  });

  it('resets the draft back to the defaults without touching storage', () => {
    render(<GeneralSettingsCard />);

    fireEvent.change(comboboxes()[1], { target: { value: 'SimHei' } });
    fireEvent.change(comboboxes()[2], { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: '恢复默认外观' }));

    expect(comboboxes()[1].value).toBe('');
    expect(comboboxes()[2].value).toBe('16');
    expect(screen.queryByText('未保存')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存外观' })).toBeDisabled();
  });

  it('switches the theme immediately', () => {
    render(<GeneralSettingsCard />);

    fireEvent.click(screen.getByRole('button', { name: '深色' }));

    expect(setThemeMock).toHaveBeenCalledWith('dark');
  });
});
