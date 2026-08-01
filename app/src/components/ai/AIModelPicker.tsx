import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CopilotModel, CopilotModelInfo } from '../../types';

type RecommendedModelMeta = Record<string, { badge: string; hint: string }>;

function getRecommendationMeta(model: CopilotModelInfo, metaMap: RecommendedModelMeta): { badge: string; hint: string } | null {
  return metaMap[model.id] ?? null;
}

function isAdvancedModel(model: CopilotModelInfo): boolean {
  if (model.multiplier > 1) return true;
  return /^o\d/.test(model.id) || /(codex|max|opus|goldeneye)/i.test(model.id) || /^gpt-5\.[1-9](?!-mini)/.test(model.id);
}

function groupByVendor(models: CopilotModelInfo[], otherVendorLabel: string): Array<{ vendor: string; items: CopilotModelInfo[] }> {
  const buckets = new Map<string, CopilotModelInfo[]>();
  for (const model of models) {
    const vendor = model.vendor ?? otherVendorLabel;
    const list = buckets.get(vendor) ?? [];
    list.push(model);
    buckets.set(vendor, list);
  }
  return Array.from(buckets.entries()).map(([vendor, items]) => ({ vendor, items }));
}

// ── Rate badge ────────────────────────────────────────────────────────────────
// Shows billing tier: free (0×), standard (1×), premium (N×)
// When showConsumption=true, shows an estimated prompts/month label instead
// (used for the cafezin managed AI provider where the multiplier = consumptionRate).
export function MultiplierBadge({ value, showConsumption }: { value: number; showConsumption?: boolean }) {
  const { t } = useTranslation();
  if (showConsumption) {
    // consumptionRate: 0.5 = fast/cheap, 1.0 = standard, 2.0 = heavy, 4-5 = very heavy
    if (value <= 0.5) return <span className="ai-rate-badge ai-rate-free" title={t('aiModelPicker.consumptionLightTitle')}>{t('aiModelPicker.consumptionLight')}</span>;
    if (value <= 1.0) return <span className="ai-rate-badge ai-rate-standard" title={t('aiModelPicker.consumptionStandardTitle')}>{t('aiModelPicker.consumptionStandard')}</span>;
    if (value <= 2.5) return <span className="ai-rate-badge ai-rate-premium" title={t('aiModelPicker.consumptionHeavyTitle')}>{t('aiModelPicker.consumptionHeavy')}</span>;
    return <span className="ai-rate-badge ai-rate-premium" title={t('aiModelPicker.consumptionVeryHeavyTitle')}>{t('aiModelPicker.consumptionVeryHeavy')}</span>;
  }
  if (value === 0) return <span className="ai-rate-badge ai-rate-free">{t('aiModelPicker.free')}</span>;
  if (value <= 1)  return <span className="ai-rate-badge ai-rate-standard">1×</span>;
  return <span className="ai-rate-badge ai-rate-premium">{value}×</span>;
}

// ── Model picker dropdown ─────────────────────────────────────────────────────
interface ModelPickerProps {
  models: CopilotModelInfo[];
  value: CopilotModel;
  onChange: (id: CopilotModel) => void;
  loading: boolean;
  onSignOut?: () => void;
  providerLabel?: string;
  /** When true, MultiplierBadge shows a consumption label instead of a cost multiplier.
   *  Use for the 'cafezin' managed AI provider where multiplier = consumptionRate. */
  showConsumptionRate?: boolean;
}

export function ModelPicker({ models, value, onChange, loading, onSignOut, providerLabel, showConsumptionRate }: ModelPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const recommendedMeta = useMemo(
    () => t('aiModelPicker.recommended', { returnObjects: true }) as RecommendedModelMeta,
    [t],
  );
  // Keep a ref in sync so the stable listener always sees the latest value
  // without needing to re-register on every open/close toggle.
  const openRef = useRef(false);
  openRef.current = open;

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (!openRef.current) return;
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // registers once on mount — openRef always tracks current value

  const current = models.find((m) => m.id === value) ?? { id: value, name: value, multiplier: 1, isPremium: false };

  const pickerSections = useMemo(() => {
    const selectedAdvanced = models.some((model) => model.id === value && isAdvancedModel(model));
    const recommended: CopilotModelInfo[] = [];
    const regular: CopilotModelInfo[] = [];
    const advanced: CopilotModelInfo[] = [];

    for (const model of models) {
      if (isAdvancedModel(model) && model.id !== value) {
        advanced.push(model);
        continue;
      }
      if (getRecommendationMeta(model, recommendedMeta)) {
        recommended.push(model);
        continue;
      }
      regular.push(model);
    }

    return {
      recommended,
      regularGroups: groupByVendor(regular, t('aiModelPicker.otherVendorLabel')),
      advancedGroups: groupByVendor(advanced, t('aiModelPicker.otherVendorLabel')),
      selectedAdvanced,
    };
  }, [models, value, recommendedMeta, t]);

  useEffect(() => {
    if (!open) return;
    setShowAdvanced(pickerSections.selectedAdvanced);
  }, [open, pickerSections.selectedAdvanced]);

  function renderItems(items: CopilotModelInfo[]) {
    if (items.length === 0) return null;
    return (
      <>
        {items.map((m) => (
          <button
            key={m.id}
            className={`ai-model-option ${m.id === value ? 'selected' : ''}`}
            onClick={() => { onChange(m.id); setOpen(false); }}
          >
            <span className="ai-model-option-name">
              <span className="ai-model-option-title-row">
                <span>{m.name}</span>
                {getRecommendationMeta(m, recommendedMeta) && (
                  <span className="ai-model-rec-badge">{getRecommendationMeta(m, recommendedMeta)?.badge}</span>
                )}
              </span>
              <span className="ai-model-option-subtitle">
                {m.vendor && <span className="ai-model-option-vendor">{m.vendor}</span>}
                {getRecommendationMeta(m, recommendedMeta) && <span className="ai-model-option-hint">{getRecommendationMeta(m, recommendedMeta)?.hint}</span>}
              </span>
            </span>
            <MultiplierBadge value={m.multiplier} showConsumption={showConsumptionRate} />
          </button>
        ))}
      </>
    );
  }

  function renderVendorGroups(groups: Array<{ vendor: string; items: CopilotModelInfo[] }>, fallbackLabel: string) {
    if (groups.length === 0) return null;
    const showVendorLabels = groups.length > 1;
    return groups.map((group, index) => (
      <div key={`${group.vendor}-${index}`}>
        <div className="ai-model-group-label">{showVendorLabels ? group.vendor : fallbackLabel}</div>
        {renderItems(group.items)}
      </div>
    ));
  }

  const advancedHiddenCount = pickerSections.advancedGroups.reduce((count, group) => count + group.items.length, 0);

  return (
    <div className="ai-model-picker" ref={ref}>
      <button
        className="ai-model-trigger"
        onClick={() => setOpen((v) => !v)}
        title={t('aiModelPicker.switchModelTitle')}
        disabled={loading}
      >
        <span className="ai-model-trigger-info">
          {providerLabel && <span className="ai-model-trigger-provider">{providerLabel}</span>}
          <span className="ai-model-trigger-name">{loading ? '…' : current.name}</span>
        </span>
        <MultiplierBadge value={current.multiplier} showConsumption={showConsumptionRate} />
        <span className="ai-model-trigger-caret">▾</span>
      </button>

      {open && (
        <div className="ai-model-menu">
          {pickerSections.recommended.length > 0 && (
            <>
              <div className="ai-model-group-label">{t('aiModelPicker.recommendedLabel')}</div>
              {renderItems(pickerSections.recommended)}
            </>
          )}

          {pickerSections.regularGroups.length > 0 && (
            <>
              {pickerSections.recommended.length > 0 && <div className="ai-model-menu-divider" />}
              {renderVendorGroups(pickerSections.regularGroups, t('aiModelPicker.otherModelsLabel'))}
            </>
          )}

          {pickerSections.advancedGroups.length > 0 && (
            <>
              <div className="ai-model-menu-divider" />
              <button
                className="ai-model-advanced-toggle"
                type="button"
                onClick={() => setShowAdvanced((state) => !state)}
                aria-expanded={showAdvanced}
              >
                <span>{t('aiModelPicker.advancedModelsLabel')}</span>
                <span className="ai-model-advanced-meta">
                  {showAdvanced ? t('aiModelPicker.hideLabel') : t('aiModelPicker.hiddenCount', { count: advancedHiddenCount })}
                </span>
              </button>
              {showAdvanced && renderVendorGroups(pickerSections.advancedGroups, t('aiModelPicker.advancedGroupLabel'))}
            </>
          )}

          {onSignOut && (
            <>
              <div className="ai-model-menu-divider" />
              <button
                className="ai-model-signout-btn"
                onClick={() => { setOpen(false); onSignOut(); }}
              >
                {t('aiModelPicker.signOut')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
