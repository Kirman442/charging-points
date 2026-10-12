import { useI18n } from "../i18n/useI18n.js";
import { METRIC_CHOICES } from '../map/settings.js';
import { AUTOBAHNS, autobahnDirections } from '../data/autobahn.js';
import Switch from './Switch.jsx';
import Icon from './Icon.jsx';
import HelpTooltip from './HelpTooltip.jsx';
export default function ControlPanel({
  states,
  filters,
  onFilters,
  options,
  onOptions,
  onMetric,
  onReset,
  a9Enabled,
  a9Direction,
  hideOthers,
  a9Available,
  onA9Enabled,
  onA9Direction,
  onHideOthers,
  autobahnRoute = 'A9',
  onAutobahnRoute,
  onClose,
  onLegend,
  mobile,
  onApply,
  initialTab = 'filters',
  onTab
}) {
  const {
    t,
    message
  } = useI18n();
  const unavailable = (label, control) => a9Enabled ? <HelpTooltip blocked label={label} text={t("Доступно только вне режима автобана.")}>{control}</HelpTooltip> : control;
  const tab = initialTab;
  const change = (key, value) => onFilters({
    ...filters,
    [key]: value
  });
  const tabs = [{
    id: 'filters',
    text: t("Фильтры"),
    icon: 'filter'
  }, {
    id: 'layers',
    text: t("Слои"),
    icon: 'layers'
  }, {
    id: 'road',
    text: t("Автобаны"),
    icon: 'road'
  }];
  return <aside className="panel control-panel" aria-label={t("Настройки карты")}>
    <header className="panel-heading"><span className="eyebrow">{t("НАСТРОЙКИ")}</span><button className="icon-button" onClick={onClose} aria-label={t("Закрыть настройки")}><Icon name="close" /></button></header>
    <nav className="control-tabs" aria-label={t("Раздел настроек")}>{tabs.map(item => <button key={item.id} aria-pressed={tab === item.id} onClick={() => onTab(item.id)}><Icon name={item.icon} />{t(item.text)}</button>)}</nav>
    <div className="control-scroll">
      {tab === 'filters' && <fieldset className="controls"><legend>{t("Выборка инфраструктуры")}</legend>
        {unavailable(t("Земля"), <label>{message("Земля{p0}", {
            p0: <select value={a9Enabled ? '' : filters.state} disabled={a9Enabled} onChange={event => change('state', event.target.value)}><option value="">{t("Вся Германия")}</option>{states.map(state => <option key={state}>{state}</option>)}</select>
          })}</label>)}
        {a9Enabled && <p className="note">{t("В режиме автобана показ охватывает всё выбранное направление.")}</p>}
        <label>{message("Минимальная мощность{p0}", {
            p0: <select value={filters.minPower} onChange={event => change('minPower', Number(event.target.value))}>{[0, 22, 50, 150, 300].map(power => <option key={power} value={power}>{power ? t("Точки ≥ {p0} кВт", {
                  p0: power
                }) : t("Любая мощность")}</option>)}</select>
          })}</label>
        <Switch checked={filters.dcOnly} onChange={value => change('dcOnly', value)}>{t("Только DC-точки")}</Switch>
        <Switch checked={filters.alwaysOpen} onChange={value => change('alwaysOpen', value)}>{t("Вся площадка работает 24/7")}</Switch>
        <p className="note">{t("Мощность и DC относятся к одной и той же точке. Часы работы относятся ко всей площадке.")}</p>
      </fieldset>}
      {tab === 'layers' && <fieldset className="controls"><legend>{t("Отображение карты")}</legend>
        {!a9Enabled && <Switch checked={options.showSites} onChange={value => onOptions({
          ...options,
          showSites: value
        })}>{t("Зарядные площадки")}</Switch>}
        {unavailable(t("Группировать площадки"), <Switch checked={options.clusterSites && !a9Enabled} disabled={a9Enabled} onChange={value => onOptions({
          ...options,
          clusterSites: value
        })}>{t("Группировать площадки")}</Switch>)}
        {unavailable(t("Аналитический слой"), <label>{message("Аналитический слой{p0}", {
            p0: <select value={options.metric} disabled={a9Enabled} onChange={event => onMetric(event.target.value)}>{METRIC_CHOICES.map(item => <option key={item.value} value={item.value}>{t(item.label)}</option>)}</select>
          })}</label>)}
        {options.metric === 'concentration' && !a9Enabled && <label>{message("Доля лидера по{p0}", {
            p0: <select value={options.operatorBasis} onChange={event => onOptions({
              ...options,
              operatorBasis: event.target.value
            })}><option value="points">{t("Числу зарядных точек")}</option><option value="power">{t("Номинальной мощности")}</option></select>
          })}</label>}
        {options.metric !== 'sites' && options.metric !== 'concentration' && !a9Enabled && <label>{message("Шкала сравнения{p0}{p1}", {
            p0: <select value={options.scaleMode} onChange={event => onOptions({
              ...options,
              scaleMode: event.target.value
            })}><option value="fixed">{t("Фиксированная")}</option><option value="selection">{t("По текущей выборке")}</option></select>,
            p1: <span className="note scale-explanation">{message("{p0} Меняется только раскраска, числа остаются прежними.", {
                p0: options.scaleMode === 'fixed' ? t("Одинаковое значение сохраняет свой цвет при изменении фильтров. Удобно сравнивать разные выборки.") : t("Цвета растягиваются от нуля до максимума среди выбранных территорий. Удобно видеть различия внутри выборки. После изменения фильтров цвет того же значения может измениться.")
              })}</span>
          })}</label>}
        {unavailable(t("Территории"), <label>{message("Территории{p0}", {
            p0: <select value={a9Enabled ? 'states' : options.territory} disabled={a9Enabled} onChange={event => onOptions({
              ...options,
              territory: event.target.value
            })}><option value="states">{t("Земли")}</option><option value="districts">{t("Районы KBA")}</option></select>
          })}</label>)}
        <Switch checked={options.showBoundaries} onChange={value => onOptions({
          ...options,
          showBoundaries: value
        })}>{t("Показать границы")}</Switch>
      </fieldset>}
      {tab === 'road' && <fieldset className="controls"><legend>{t("Анализ дорожного доступа")}</legend>
        <Switch checked={!!a9Enabled} disabled={!a9Available} onChange={onA9Enabled}>{t("Режим автобана")}</Switch>
        {a9Enabled ? <>
          <label>{message("Автобан{p0}", {
              p0: <select value={autobahnRoute} onChange={event => onAutobahnRoute(event.target.value)}>{Object.keys(AUTOBAHNS).map(route => <option key={route} value={route}>{route}</option>)}</select>
            })}</label>
          <label>{message("Направление{p0}", {
              p0: <select value={a9Direction} onChange={event => onA9Direction(event.target.value)}>{autobahnDirections(autobahnRoute).map(direction => <option key={direction} value={direction}>{t(AUTOBAHNS[autobahnRoute][direction])}</option>)}</select>
            })}</label>
          <Switch checked={hideOthers} onChange={onHideOthers} ariaLabel={t("Скрыть площадки вне коридора")}><HelpTooltip label={t("Скрыть площадки вне коридора")} text={t("Переключатель скрывает площадки вне набора кандидатов выбранного направления. Площадки, требующие проверки, включаются отдельно. Нахождение в коридоре не подтверждает дорожную связь; расчётные интервалы не меняются.")} /></Switch>
          <p className="note">{t("Цвет линии показывает расчётный интервал. Символы площадок показывают дорожную связь и условия доступа.")}</p>
        </> : <p className="note">{message("Исследуйте интервалы между зарядными площадками вдоль {p0}. Подъезд и возврат оцениваются по дорожной модели.", {
            p0: Object.keys(AUTOBAHNS).join(', ')
          })}</p>}
      </fieldset>}
    </div>
    <footer className="control-footer">{onLegend && <button className="settings-legend" onClick={onLegend}>{message("{p0}Легенда карты", {
          p0: <Icon name="layers" />
        })}</button>}{mobile && tab !== 'filters' && <p className="note">{t("Изменения отображения применяются сразу.")}</p>}{mobile && <button className="primary-button" onClick={tab === 'filters' ? onApply : onClose}>{tab === 'filters' ? t("Применить фильтры") : t("Готово")}</button>}<button className="reset" onClick={onReset}>{t("Сбросить настройки")}</button></footer>
  </aside>;
}
