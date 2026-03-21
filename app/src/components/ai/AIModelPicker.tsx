import { useState, useRef, useEffect, useMemo } from 'react';
import type { CopilotModel, CopilotModelInfo } from '../../types';

const RECOMMENDED_MODEL_META: Record<string, { badge: string; hint: string }> = {
  'gpt-5-mini': { badge: 'Padrao', hint: 'Melhor ponto de partida' },
  'gpt-4.1': { badge: 'Leve', hint: 'Rapido e economico' },
  'gpt-4o': { badge: 'Visual', hint: 'Bom para texto e imagem' },
  'claude-sonnet-4-6': { badge: 'Forte', hint: 'Raciocinio equilibrado' },
  'claude-sonnet-4-5': { badge: 'Forte', hint: 'Raciocinio equilibrado' },
  'gemini-3-pro': { badge: 'Contexto', hint: 'Bom com contexto longo' },
  'gemini-2.5-pro': { badge: 'Contexto', hint: 'Bom com contexto longo' },
  'gemini-2.5-flash': { badge: 'Rapido', hint: 'Resposta curta e veloz' },
};

function getRecommendationMeta(model: CopilotModelInfo): { badge: string; hint: string } | null {
  return RECOMMENDED_MODEL_META[model.id] ?? null;
}

function isAdvancedModel(model: CopilotModelInfo): boolean {
  if (model.multiplier > 1) return true;
  return /^o\d/.test(model.id) || /(codex|max|opus|goldeneye)/i.test(model.id) || /^gpt-5\.[1-9](?!-mini)/.test(model.id);
}

function groupByVendor(models: CopilotModelInfo[]): Array<{ vendor: string; items: CopilotModelInfo[] }> {
  const buckets = new Map<string, CopilotModelInfo[]>();
  for (const model of models) {
    const vendor = model.vendor ?? 'Other';
    const list = buckets.get(vendor) ?? [];
    list.push(model);
    buckets.set(vendor, list);
  }
  return Array.from(buckets.entries()).map(([vendor, items]) => ({ vendor, items }));
}

// ── Rate badge ────────────────────────────────────────────────────────────────
// Shows billing tier: free (0×), standard (1×), premium (N×)
export function MultiplierBadge({ value }: { value: number }) {
  if (value === 0) return <span className="ai-rate-badge ai-rate-free">free</span>;
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
}

export function ModelPicker({ models, value, onChange, loading, onSignOut, providerLabel }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
      if (getRecommendationMeta(model)) {
        recommended.push(model);
        continue;
      }
      regular.push(model);
    }

    return {
      recommended,
      regularGroups: groupByVendor(regular),
      advancedGroups: groupByVendor(advanced),
      selectedAdvanced,
    };
  }, [models, value]);

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
                {getRecommendationMeta(m) && (
                  <span className="ai-model-rec-badge">{getRecommendationMeta(m)?.badge}</span>
                )}
              </span>
              <span className="ai-model-option-subtitle">
                {m.vendor && <span className="ai-model-option-vendor">{m.vendor}</span>}
                {getRecommendationMeta(m) && <span className="ai-model-option-hint">{getRecommendationMeta(m)?.hint}</span>}
              </span>
            </span>
            <MultiplierBadge value={m.multiplier} />
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

  return (
    <div className="ai-model-picker" ref={ref}>
      <button
        className="ai-model-trigger"
        onClick={() => setOpen((v) => !v)}
        title="Switch model"
        disabled={loading}
      >
        <span className="ai-model-trigger-info">
          {providerLabel && <span className="ai-model-trigger-provider">{providerLabel}</span>}
          <span className="ai-model-trigger-name">{loading ? '…' : current.name}</span>
        </span>
        <MultiplierBadge value={current.multiplier} />
        <span className="ai-model-trigger-caret">▾</span>
      </button>

      {open && (
        <div className="ai-model-menu">
          {pickerSections.recommended.length > 0 && (
            <>
              <div className="ai-model-group-label">Recomendados</div>
              {renderItems(pickerSections.recommended)}
            </>
          )}

          {pickerSections.regularGroups.length > 0 && (
            <>
              {pickerSections.recommended.length > 0 && <div className="ai-model-menu-divider" />}
              {renderVendorGroups(pickerSections.regularGroups, 'Outros modelos')}
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
                <span>Modelos avancados</span>
                <span className="ai-model-advanced-meta">
                  {showAdvanced ? 'Ocultar' : `${pickerSections.advancedGroups.reduce((count, group) => count + group.items.length, 0)} ocultos`}
                </span>
              </button>
              {showAdvanced && renderVendorGroups(pickerSections.advancedGroups, 'Avancados')}
            </>
          )}

          {onSignOut && (
            <>
              <div className="ai-model-menu-divider" />
              <button
                className="ai-model-signout-btn"
                onClick={() => { setOpen(false); onSignOut(); }}
              >
                Sign out
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
