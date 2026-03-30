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
  onRefresh: () => Promise<void>;
}

export function PremiumGate({ account, loading, style, onRefresh }: PremiumGateProps) {
  const notLoggedIn = !account.authenticated;
  const locale = navigator.language.startsWith('pt') ? 'pt-BR' : 'en';

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

  return (
    <div className="ai-panel" data-panel="ai" style={style}>
      <div className="ai-panel-header">
        <span className="ai-panel-title">
          <Star weight="thin" size={14} /> Copilot
        </span>
      </div>

      <div className="premium-gate">
        <div className="premium-gate-icon">
          <Star weight="thin" size={48} />
        </div>

        <div className="premium-gate-title">
          {notLoggedIn ? 'IA disponível no plano Basic' : 'Recurso do plano Basic ou superior'}
        </div>

        <p className="premium-gate-desc">
          {notLoggedIn
            ? 'Para usar a IA no Cafezin, faça login na sua conta ou assine um plano Basic, Standard ou Pro.'
            : 'Seu plano atual não inclui IA. Faça upgrade para Basic ou superior e escolha entre Cafezin IA gerenciada ou seu próprio provider com BYOK.'}
        </p>

        {notLoggedIn ? (
          <>
            <button
              className="ai-auth-btn premium-gate-cta"
              onClick={() => window.dispatchEvent(new CustomEvent('cafezin:open-settings', { detail: 'account' }))}
            >
              Fazer login na minha conta
            </button>
            <button
              className="ai-auth-btn premium-gate-cta"
              onClick={() => void openUpgrade()}
              style={{ marginTop: 6, opacity: 0.75 }}
            >
              Criar conta e ver planos ↗
              <ArrowSquareOut size={14} weight="bold" style={{ marginLeft: 5 }} />
            </button>
          </>
        ) : (
          <button
            className="ai-auth-btn premium-gate-cta"
            onClick={() => void openUpgrade()}
          >
            Escolher plano na web ↗
            <ArrowSquareOut size={14} weight="bold" style={{ marginLeft: 5 }} />
          </button>
        )}

        <div className="premium-gate-byok">
          <div className="premium-gate-byok-title">Como funciona</div>
          <p className="premium-gate-byok-desc">
            Com o plano Basic ou superior, você libera a IA no app. Depois disso, pode usar a
            <strong> Cafezin IA</strong> com cota mensal incluída ou sua <strong>própria chave de API</strong>
            no provider que preferir.
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
          title="Já assinei — verificar status"
        >
          <ArrowClockwise size={13} className={loading ? 'premium-gate-spin' : ''} />
          {loading ? 'Verificando…' : 'Já assinei — atualizar'}
        </button>
      </div>
    </div>
  );
}
