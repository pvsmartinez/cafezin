/**
 * UpdateReleaseModal — GitHub-releases auto-updater for non-dev builds.
 *
 * Flow:
 *  1. On open → checkUpdate() from @tauri-apps/plugin-updater
 *  2. If update available → show version / notes + "Download & Install" button
 *  3. During download → show progress bar
 *  4. On complete → relaunch
 */

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import './UpdateReleaseModal.css';

type Phase =
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'restarting'
  | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function UpdateReleaseModal({ open, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState(0); // 0–100
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  // Reset + check whenever modal opens
  useEffect(() => {
    if (!open) return;
    setPhase('checking');
    setUpdate(null);
    setProgress(0);
    setDownloaded(0);
    setTotal(0);
    setErrorMsg('');

    check()
      .then((u) => {
        if (u?.available) {
          setUpdate(u);
          setPhase('available');
        } else {
          setPhase('up-to-date');
        }
      })
      .catch((err: unknown) => {
        setErrorMsg(String(err));
        setPhase('error');
      });
  }, [open]);

  async function handleInstall() {
    if (!update) return;
    setPhase('downloading');
    setProgress(0);
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          setTotal(event.data.contentLength ?? 0);
        } else if (event.event === 'Progress') {
          setDownloaded((prev) => {
            const next = prev + event.data.chunkLength;
            if (total > 0) setProgress(Math.round((next / total) * 100));
            return next;
          });
        } else if (event.event === 'Finished') {
          setProgress(100);
        }
      });
      setPhase('restarting');
      await relaunch();
    } catch (err: unknown) {
      setErrorMsg(String(err));
      setPhase('error');
    }
  }

  if (!open) return null;

  return createPortal(
    <div className="ur-overlay">
      <div className="ur-modal">

        {/* Header */}
        <div className="ur-header">
          <span className="ur-title">↑ Atualizar Cafezin</span>
          {phase !== 'downloading' && phase !== 'restarting' && (
            <button className="ur-close" onClick={onClose} title="Fechar">✕</button>
          )}
        </div>

        {/* Body */}
        <div className="ur-body">

          {phase === 'checking' && (
            <p className="ur-muted"><span className="ur-spinner">⟳</span> Verificando atualizações…</p>
          )}

          {phase === 'up-to-date' && (
            <p className="ur-ok">✓ Cafezin está atualizado.</p>
          )}

          {phase === 'available' && update && (
            <>
              <p className="ur-available">
                Nova versão disponível: <strong>{update.version}</strong>
              </p>
              {update.body && (
                <pre className="ur-notes">{update.body}</pre>
              )}
              <button className="ur-btn-install" onClick={handleInstall}>
                Baixar e instalar
              </button>
            </>
          )}

          {phase === 'downloading' && (
            <>
              <p className="ur-muted">
                <span className="ur-spinner">⟳</span>
                {' '}Baixando update…
                {total > 0 && (
                  <span className="ur-size">
                    {' '}({fmt(downloaded)} / {fmt(total)})
                  </span>
                )}
              </p>
              <div className="ur-progress-track">
                <div className="ur-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <p className="ur-percent">{progress}%</p>
            </>
          )}

          {phase === 'restarting' && (
            <p className="ur-ok"><span className="ur-spinner">⟳</span> Reiniciando…</p>
          )}

          {phase === 'error' && (
            <p className="ur-error">✗ Erro: {errorMsg}</p>
          )}

        </div>

        {/* Footer buttons */}
        {(phase === 'up-to-date' || phase === 'error') && (
          <div className="ur-footer">
            <button className="ur-btn-close" onClick={onClose}>Fechar</button>
          </div>
        )}

      </div>
    </div>,
    document.body,
  );
}

function fmt(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
