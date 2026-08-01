/**
 * PremiumGate — full-panel overlay shown in AIPanel when canUseAI = false.
 *
 * Two states:
 *   1. Not logged into Cafezin → "Crie sua conta / faça login"
 *   2. Logged in but free plan → "Assine Basic ou superior"
 *
 * Both states explain the access model: any AI requires Basic or higher.
 * brings their own API key — no extra usage fees from us.
 */

import { useTranslation } from 'react-i18next';
import { Star, ArrowSquareOut, ArrowClockwise } from '@phosphor-icons/react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { AccountState } from '../../types';
import './PremiumGate.css';

// Per-provider links shown in the BYOK section so users know where to get keys.
const BYOK_PROVIDERS = [
  { name: 'GitHub Copilot', url: 'https://github.com/settings/copilot' },
  { name: 'OpenAI',         url: 'https://platform.openai.com/api-keys' },
  { name: 'Anthropic',      url: 'https://console.anthropic.com/settings/keys' },
  { name: 'Groq',           url: 'https://console.groq.com/keys' },
];

interface PremiumGateProps {
  account: AccountState;
  loading: boolean;
  style?: React.CSSProperties;
  isOverlay?: boolean;
  onRefresh: () => Promise<void>;
  trialRemaining?: number;
}

export function PremiumGate({ account, loading, style, isOverlay, onRefresh, trialRemaining = 0 }: PremiumGateProps) {
  const { t } = useTranslation();
  const notLoggedIn = !account.authenticated;
  const locale = navigator.language.startsWith('pt') ? 'pt-BR' : 'en';
  const trialDone = trialRemaining === 0;

  async function openUpgrade() {
    // Upgrades now always go through the web account page so the user can
    // choose Basic, Standard, or Pro there.
    const landingUrl = locale === 'pt-BR'
      ? 'https://cafezin.pmatz.com/br/premium'
      : 'https://cafezin.pmatz.com/premium';
    openUrl(landingUrl).catch(() => window.open(landingUrl, '_blank'));
  }

  function openProviderLink(url: string) {
    openUrl(url).catch(() => window.open(url, '_blank'));
  }

  const gateContent = (
    <div className="premium-gate">
      <div className="premium-gate-icon">
        <Star weight="thin" size={48} />
      </div>

      <div className="premium-gate-title">
        {notLoggedIn ? t('premiumGate.titleNotLoggedIn') : t('premiumGate.titleLocked')}
      </div>

      <p className="premium-gate-desc">
        {notLoggedIn ? t('premiumGate.descNotLoggedIn') : t('premiumGate.descLocked')}
      </p>

      {!trialDone && (
        <p className="premium-gate-trial-hint">
          {t('premiumGate.trialHint', { count: trialRemaining })}
        </p>
      )}

      <button
        className="ai-auth-btn premium-gate-cta"
        onClick={() => void openUpgrade()}
      >
        {notLoggedIn ? t('premiumGate.ctaSubscribe') : t('premiumGate.ctaChoosePlan')}
        <ArrowSquareOut size={14} weight="bold" style={{ marginLeft: 5 }} />
      </button>

      {notLoggedIn && (
        <p className="premium-gate-login-hint">
          {t('premiumGate.loginHint')}{' '}
          <button
            className="premium-gate-login-link"
            onClick={() => window.dispatchEvent(new CustomEvent('cafezin:open-settings', { detail: 'account' }))}
          >
            {t('premiumGate.loginLink')}
          </button>
        </p>
      )}

      <div className="premium-gate-byok">
        <div className="premium-gate-byok-title">{t('premiumGate.byokTitle')}</div>
        <p className="premium-gate-byok-desc">
          {t('premiumGate.byokDescPart1')}
          <strong> Cafezin IA</strong> {t('premiumGate.byokDescPart2')} <strong>{t('premiumGate.byokOwnKey')}</strong>
          {' '}{t('premiumGate.byokDescPart3')}
        </p>
        <div className="premium-gate-byok-links">
          {BYOK_PROVIDERS.map((p) => (
            <button
              key={p.name}
              className="premium-gate-byok-link"
              onClick={() => openProviderLink(p.url)}
            >
              {p.name} ↗
            </button>
          ))}
        </div>
      </div>

      <button
        className="premium-gate-refresh"
        onClick={() => void onRefresh()}
        disabled={loading}
        title={t('premiumGate.refreshTitle')}
      >
        <ArrowClockwise size={13} className={loading ? 'premium-gate-spin' : ''} />
        {loading ? t('premiumGate.refreshChecking') : t('premiumGate.refreshCta')}
      </button>
    </div>
  );

  if (isOverlay) return gateContent;

  return (
    <div className="ai-panel" data-panel="ai" style={style}>
      <div className="ai-panel-header">
        <span className="ai-panel-title">
          <Star weight="thin" size={14} /> {t('app.copilotLabel')}
        </span>
      </div>
      {gateContent}
    </div>
  );
}
