/**
 * PremiumGate — full-panel overlay shown in AIPanel when canUseAI = false.
 *
 * Two states:
 *   1. Not logged into Cafezin → "Crie sua conta / faça login"
 *   2. Logged in but free plan → "Torne-se Premium"
 *
 * Both states explain the BYOK model: the user pays for Cafezin Premium and
 * brings their own API key — no extra usage fees from us.
 */

import { useState } from 'react';
import { Star, ArrowSquareOut, ArrowClockwise } from '@phosphor-icons/react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { AccountState } from '../../types';
import { createCheckoutUrl } from '../../services/accountService';
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
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const locale = navigator.language.startsWith('pt') ? 'pt-BR' : 'en';

  async function openUpgrade() {
    // Unauthenticated users go to the pricing page; authenticated users get a
    // pre-filled checkout with their email and user_id already set.
    const landingUrl = locale === 'pt-BR'
      ? 'https://cafezin.pmatz.com/br/premium'
      : 'https://cafezin.pmatz.com/premium';
    if (notLoggedIn) {
      openUrl(landingUrl).catch(() => window.open(landingUrl, '_blank'));
      return;
    }
    setCheckoutLoading(true);
    try {
      const url = await createCheckoutUrl(locale);
      openUrl(url).catch(() => window.open(url, '_blank'));
    } catch {
      // Fallback to landing page pricing section
      openUrl(landingUrl).catch(() => window.open(landingUrl, '_blank'));
    } finally {
      setCheckoutLoading(false);
    }
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
          {notLoggedIn ? 'IA disponível no plano Premium' : 'Recurso do plano Premium'}
        </div>

        <p className="premium-gate-desc">
          {notLoggedIn
            ? 'Para usar qualquer recurso de IA no Cafezin, você precisa de uma conta Premium. Crie sua conta e escolha seu plano no site.'
            : 'Seu plano atual não inclui IA. Faça upgrade para Premium e use sua própria chave de API — sem cobranças extras de uso da nossa parte.'}
        </p>

        <button
          className="ai-auth-btn premium-gate-cta"
          onClick={() => void openUpgrade()}
          disabled={checkoutLoading}
        >
          {checkoutLoading ? 'Aguarde…' : notLoggedIn ? 'Ver planos ↗' : 'Assinar por $5/mês ↗'}
          {!checkoutLoading && <ArrowSquareOut size={14} weight="bold" style={{ marginLeft: 5 }} />}
        </button>

        {/* BYOK explanation */}
        <div className="premium-gate-byok">
          <div className="premium-gate-byok-title">Como funciona</div>
          <p className="premium-gate-byok-desc">
            Com o Premium, você usa sua <strong>própria chave de API</strong> do
            provedor que preferir. Nenhum custo extra de uso nos pagamentos do Cafezin.
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

        {/* Refresh — lets the user re-check after upgrading */}
        <button
          className="premium-gate-refresh"
          onClick={() => void onRefresh()}
          disabled={loading}
          title="Já assinei — verificar status"
        >
          <ArrowClockwise size={13} className={loading ? 'premium-gate-spin' : ''} />
          {loading ? 'Verificando…' : 'Já sou Premium — atualizar'}
        </button>
      </div>
    </div>
  );
}
