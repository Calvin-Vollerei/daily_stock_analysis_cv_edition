import type React from 'react';
import { Drawer } from '../common/Drawer';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { PORTFOLIO_SUPPORT_TEXT } from '../../locales/featureText';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** 后端返回的券商解析器列表；为空时只显示内置说明。 */
  brokers?: { broker: string; displayName?: string }[];
  brokersWarning?: string | null;
}

/**
 * 持仓录入的支持清单抽屉。
 *
 * 说明「哪些品种可以录入、代码怎么写、行情从哪来、四种录入方式各收什么」。
 * 内容与后端能力保持一致：代码格式取自 portfolio_quote_cache 的三条正则，
 * 券商列表来自 /api/v1/portfolio/imports/csv/brokers。
 */
export const PortfolioSupportDrawer: React.FC<Props> = ({ isOpen, onClose, brokers = [], brokersWarning }) => {
  const { language } = useUiLanguage();
  const text = PORTFOLIO_SUPPORT_TEXT[language];

  const priceLabel = (source: string): string => {
    if (source === 'realtime') return text.priceRealtime;
    if (source === 'daily') return text.priceDaily;
    return text.priceExternal;
  };

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title={text.title} width="max-w-2xl" zIndex={70}>
      <div className="space-y-6 text-sm">
        <p className="text-xs leading-6 text-secondary">{text.subtitle}</p>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">{text.productsTitle}</h3>
          <div className="overflow-hidden rounded-xl border border-border/60">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/5 text-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">{text.columnKind}</th>
                  <th className="px-3 py-2 font-medium">{text.columnSample}</th>
                  <th className="px-3 py-2 font-medium">{text.columnSource}</th>
                </tr>
              </thead>
              <tbody>
                {text.rows.map((row) => (
                  <tr key={row.kind} className="border-t border-border/40">
                    <td className="px-3 py-2 text-foreground">{row.kind}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-secondary">{row.sample}</td>
                    <td className="px-3 py-2 text-secondary">{priceLabel(row.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">{text.entryTitle}</h3>
          <ul className="space-y-2">
            {text.entries.map((entry) => (
              <li key={entry.name} className="rounded-xl border border-border/50 px-3 py-2">
                <div className="text-xs font-medium text-foreground">{entry.name}</div>
                <div className="mt-1 text-xs leading-5 text-secondary">{entry.detail}</div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">{text.brokersTitle}</h3>
          <div className="text-xs leading-5 text-secondary">
            {brokers.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {brokers.map((item) => (
                  <span key={item.broker} className="rounded-lg border border-border/60 px-2 py-1 text-foreground">
                    {item.displayName ?? item.broker}
                    <span className="ml-1 font-mono text-[10px] text-secondary">{item.broker}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div>{text.brokersLoading}</div>
            )}
            {brokersWarning ? <div className="mt-2 text-warning">{brokersWarning}</div> : null}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border/50 px-3 py-2">
            <div className="text-xs font-medium text-foreground">{text.marketTitle}</div>
            <div className="mt-1 text-xs leading-5 text-secondary">{text.marketDetail}</div>
          </div>
          <div className="rounded-xl border border-border/50 px-3 py-2">
            <div className="text-xs font-medium text-foreground">{text.costTitle}</div>
            <div className="mt-1 text-xs leading-5 text-secondary">{text.costDetail}</div>
          </div>
        </section>
      </div>
    </Drawer>
  );
};
