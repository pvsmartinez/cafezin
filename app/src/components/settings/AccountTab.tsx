import type { AccountState } from '../../types';

const PLAN_LABELS: Record<AccountState['plan'], string> = {
  free: 'Free',
  premium: 'Basic',
  basic: 'Basic',
  standard: 'Standard',
  pro: 'Pro',
};

type SyncStatus = 'idle' | 'checking' | 'not_connected' | 'connected';

export interface AccountTabProps {
  syncStatus: SyncStatus;
  syncUser: string;
  onSignOut: () => void;
  emailInput: string;
  setEmailInput: (v: string) => void;
  passwordInput: string;
  setPasswordInput: (v: string) => void;
  authMode: 'login' | 'signup';
  setAuthMode: (v: 'login' | 'signup') => void;
  authBusy: boolean;
  onAuth: () => void;
  syncError: string | null;
  setSyncError: (e: string | null) => void;
  account: AccountState;
  accountLoading: boolean;
  onRefreshAccount: () => void;
  billingLocale: string;
  premiumPageUrl: string;
  billingBusy: 'checkout' | 'portal' | null;
  onOpenCheckout: () => void;
  onOpenCustomerPortal: () => void;
}

export function AccountTab({
  syncStatus,
  syncUser,
  onSignOut,
  emailInput,
  setEmailInput,
  passwordInput,
  setPasswordInput,
  authMode,
  setAuthMode,
  authBusy,
  onAuth,
  syncError,
  setSyncError,
  account,
  accountLoading,
  onRefreshAccount,
  billingLocale,
  premiumPageUrl,
  billingBusy,
  onOpenCheckout,
  onOpenCustomerPortal,
}: AccountTabProps) {
  return (
    <div className="sm-section-list">

      <section className="sm-section">
        <h3 className="sm-section-title">Conta Cafezin</h3>

        {syncStatus === 'checking' && (
          <div className="sm-sync-status">Conectando…</div>
        )}

        {syncStatus === 'connected' && (
          <div className="sm-sync-connected">
            <div className="sm-sync-connected-info">
              <span className="sm-sync-dot" />
              <span>Conectado{syncUser ? ` como ${syncUser}` : ''}</span>
            </div>
            <button className="sm-sync-disconnect" onClick={() => void onSignOut()}>
              Sair
            </button>
          </div>
        )}

        {syncStatus === 'not_connected' && (
          <div className="sm-sync-pat-form">
            <p className="sm-section-desc" style={{ marginTop: 0 }}>
              Entre com e-mail e senha para ativar seu plano Cafezin e sincronizar seus workspaces.
            </p>
            <div className="sm-sync-auth-tabs">
              <button
                className={`sm-sync-auth-tab ${authMode === 'login' ? 'active' : ''}`}
                onClick={() => { setAuthMode('login'); setSyncError(null) }}
              >Entrar</button>
              <button
                className={`sm-sync-auth-tab ${authMode === 'signup' ? 'active' : ''}`}
                onClick={() => { setAuthMode('signup'); setSyncError(null) }}
              >Criar conta</button>
            </div>
            <input
              className="sm-input"
              type="email"
              placeholder="seu@email.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void onAuth() }}
            />
            <input
              className="sm-input"
              type="password"
              placeholder="Senha"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void onAuth() }}
              style={{ marginTop: 6 }}
            />
            <button
              className="sm-sync-btn sm-save-btn"
              onClick={() => void onAuth()}
              disabled={authBusy || !emailInput.trim() || !passwordInput.trim()}
              style={{ marginTop: 8 }}
            >
              {authBusy ? 'Aguarde…' : authMode === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
            {syncError && <p className="sm-sync-error">{syncError}</p>}
          </div>
        )}
      </section>

      <section className="sm-section">
        <h3 className="sm-section-title">Plano</h3>

        {accountLoading ? (
          <p className="sm-section-desc">Verificando plano…</p>
        ) : (
          <>
            <div className="sm-row">
              <div className="sm-row-label">
                <span>Status atual</span>
                <span className="sm-row-desc">
                  {account.authenticated
                    ? account.isPremium
                      ? `${PLAN_LABELS[account.plan]} ativo`
                      : 'Plano gratuito'
                    : 'Não autenticado'}
                </span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: account.isPremium ? 'rgba(var(--yellow-rgb,212,169,106),0.15)' : 'var(--surface2)',
                  color: account.isPremium ? 'var(--yellow, #d4a96a)' : 'var(--text-muted)',
                  border: `1px solid ${account.isPremium ? 'rgba(var(--yellow-rgb,212,169,106),0.35)' : 'var(--border)'}`,
                }}
              >
                {account.isPremium ? PLAN_LABELS[account.plan] : 'Free'}
              </span>
            </div>

            {account.isPremium && account.currentPeriodEnd && (
              <div className="sm-row">
                <div className="sm-row-label">
                  <span>Renova em</span>
                  <span className="sm-row-desc">
                    {new Date(account.currentPeriodEnd).toLocaleDateString(billingLocale)}
                    {account.cancelAtPeriodEnd && ' (cancelamento agendado)'}
                  </span>
                </div>
              </div>
            )}

            <div className="sm-row">
              <button
                className="sm-save-btn"
                style={{ marginLeft: 'auto' }}
                onClick={() => void onRefreshAccount()}
                disabled={accountLoading}
              >
                Atualizar status
              </button>
            </div>

            {account.isPremium ? (
              <div style={{ marginTop: 12 }}>
                <button
                  className="sm-save-btn"
                  onClick={() => void onOpenCustomerPortal()}
                  disabled={billingBusy !== null}
                >
                  {billingBusy === 'portal' ? 'Abrindo portal…' : 'Gerenciar plano ↗'}
                </button>
              </div>
            ) : account.authenticated ? (
              <div style={{ marginTop: 12 }}>
                <button
                  className="sm-save-btn"
                  onClick={() => void onOpenCheckout()}
                  disabled={billingBusy !== null}
                >
                  {billingBusy === 'checkout' ? 'Abrindo planos…' : 'Escolher plano na web ↗'}
                </button>
              </div>
            ) : null}

            {!account.isPremium && (
              <div style={{ marginTop: 12 }}>
                <a
                  href={premiumPageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="sm-save-btn"
                  style={{ display: 'inline-block', textDecoration: 'none', cursor: 'pointer' }}
                >
                  Ver planos ↗
                </a>
              </div>
            )}
          </>
        )}
      </section>

      <section className="sm-section">
        <h3 className="sm-section-title">Suas chaves de API (BYOK)</h3>
        <p className="sm-section-desc">
          Com o plano Basic ou superior, você pode usar sua própria chave de API.
          Nenhum custo extra de uso nos pagamentos do Cafezin.
          Configure suas chaves na aba <strong>IA</strong>.
          Pegue sua chave no provedor:
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {[
            { name: 'GitHub Copilot', url: 'https://github.com/settings/copilot' },
            { name: 'OpenAI',         url: 'https://platform.openai.com/api-keys' },
            { name: 'Anthropic',      url: 'https://console.anthropic.com/settings/keys' },
            { name: 'Groq',           url: 'https://console.groq.com/keys' },
          ].map((p) => (
            <a
              key={p.name}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--accent)', fontSize: 13 }}
            >
              {p.name} ↗
            </a>
          ))}
        </div>
      </section>

    </div>
  );
}
