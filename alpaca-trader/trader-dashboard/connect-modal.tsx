import { useState, useRef } from 'react';
import styles from './trader-dashboard.module.css';

type ConnectResult = { connected: boolean; paper?: boolean; message: string };

const API_BASE = '/trader-service';

async function apiPost(path: string, body?: unknown): Promise<ConnectResult> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => `HTTP ${res.status}`);
    return { connected: false, message: txt };
  }
  return res.json();
}

/**
 * Modal for connecting the bot to an Alpaca account.
 *
 * Uses Paper Trading by default (no real money).
 * Keys are POSTed to the local bot service and never stored client-side.
 */
export function ConnectModal({
  connected,
  onClose,
  onChanged,
}: {
  connected: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [keyId, setKeyId] = useState('');
  const [secret, setSecret] = useState('');
  const [paper, setPaper] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConnectResult | null>(null);
  const [validErr, setValidErr] = useState<string | null>(null);

  const keyRef = useRef<HTMLInputElement>(null);
  const secretRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidErr(null);
    setResult(null);

    const trimKey = keyId.trim();
    const trimSecret = secret.trim();

    if (!trimKey) {
      setValidErr('API Key ID is required');
      keyRef.current?.focus();
      return;
    }
    if (!trimSecret) {
      setValidErr('API Secret Key is required');
      secretRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const res = await apiPost('/api/connect', { keyId: trimKey, secret: trimSecret, paper });
      setResult(res);
      if (res.connected) {
        setKeyId('');
        setSecret('');
        onChanged();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({ connected: false, message: msg });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await apiPost('/api/disconnect');
      onChanged();
      onClose();
    } catch { /* silent */ }
    finally { setBusy(false); }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className={styles.modalHeader}>
          <span className={styles.cardTitle}>🔑 Connect Alpaca Account</span>
          <button type="button" className={styles.modalClose} onClick={onClose}>✕</button>
        </div>

        {/* Body — noValidate removes browser tooltip */}
        <form className={styles.modalBody} onSubmit={submit} noValidate>

          <p className={styles.modalHint}>
            Paste your Alpaca Paper Trading API keys — no real money is used.{' '}
            Get them at{' '}
            <strong>alpaca.markets → Paper Trading → API Keys</strong>.
          </p>

          {/* API Key ID */}
          <div className={styles.fieldGroup}>
            <label htmlFor="cm-keyid" className={styles.fieldLabel}>API Key ID</label>
            <input
              id="cm-keyid"
              ref={keyRef}
              className={styles.input}
              type="text"
              value={keyId}
              onChange={(e) => { setKeyId(e.target.value); setValidErr(null); setResult(null); }}
              placeholder="PKXXXXXXXXXXXXXXXXXXXXXXXX"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {/* Secret Key */}
          <div className={styles.fieldGroup}>
            <label htmlFor="cm-secret" className={styles.fieldLabel}>API Secret Key</label>
            <input
              id="cm-secret"
              ref={secretRef}
              className={styles.input}
              type="password"
              value={secret}
              onChange={(e) => { setSecret(e.target.value); setValidErr(null); setResult(null); }}
              placeholder="••••••••••••••••••••"
              autoComplete="new-password"
            />
          </div>

          {/* Paper / Live toggle */}
          <div className={styles.toggleRow}>
            <button
              type="button"
              className={`${styles.segBtn} ${paper ? styles.segActive : ''}`}
              onClick={() => setPaper(true)}
            >
              📝 Paper (Demo)
            </button>
            <button
              type="button"
              className={`${styles.segBtn} ${!paper ? styles.segActiveDanger : ''}`}
              onClick={() => setPaper(false)}
            >
              💸 Live (Real money)
            </button>
          </div>

          {!paper && (
            <div className={styles.warnBox}>
              ⚠️ Live mode places <strong>real orders</strong>. Make sure you understand the risk.
            </div>
          )}

          {/* Validation error */}
          {validErr && (
            <div className={styles.warnBox}>❗ {validErr}</div>
          )}

          {/* API result */}
          {result && (
            <div className={result.connected ? styles.okBox : styles.warnBox}>
              {result.connected ? '✅ ' : '❌ '}{result.message}
            </div>
          )}

          {/* Actions */}
          <div className={styles.modalActions}>
            {connected && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                disabled={busy}
                onClick={disconnect}
              >
                Disconnect
              </button>
            )}
            <button
              type="submit"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={busy}
            >
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
