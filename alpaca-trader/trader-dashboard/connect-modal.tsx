import { useState, useRef } from 'react';
import { connectAlpaca, disconnectAlpaca } from './use-bot-api.js';
import type { ConnectionStatus } from './types.js';
import styles from './trader-dashboard.module.css';

/**
 * Modal to connect the bot to an Alpaca account using API keys.
 *
 * Keys are sent to the local bot service (never stored in the browser bundle).
 * Defaults to the PAPER (demo) endpoint so no real money is ever at risk unless
 * the user explicitly switches to live.
 *
 * @param props.connected whether an Alpaca account is currently connected
 * @param props.onClose close the modal
 * @param props.onChanged callback after a successful connect/disconnect
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
  const [result, setResult] = useState<ConnectionStatus | null>(null);
  const [validErr, setValidErr] = useState<string | null>(null);

  const keyRef = useRef<HTMLInputElement>(null);
  const secretRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidErr(null);
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
    setResult(null);
    try {
      const res = await connectAlpaca({ keyId: trimKey, secret: trimSecret, paper });
      setResult(res);
      if (res.connected) {
        setKeyId('');
        setSecret('');
        onChanged();
      }
    } catch (err) {
      setResult({ connected: false, paper, message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectAlpaca();
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.cardTitle}>🔑 Connect Alpaca Account</span>
          <button className={styles.modalClose} onClick={onClose} type="button">✕</button>
        </div>

        {/* noValidate disables browser-native HTML5 validation bubbles */}
        <form className={styles.modalBody} onSubmit={submit} noValidate>
          <p className={styles.modalHint}>
            Paste your Alpaca API keys to connect your portfolio. Use{' '}
            <strong>Paper Trading</strong> keys for the demo account — no real money is used.
            Get keys at <span className={styles.code}>alpaca.markets → Paper Trading → API Keys</span>.
          </p>

          <div className={styles.fieldGroup}>
            <label htmlFor="cm-keyid" className={styles.fieldLabel}>API Key ID</label>
            <input
              id="cm-keyid"
              ref={keyRef}
              className={styles.input}
              type="text"
              value={keyId}
              onChange={(e) => { setKeyId(e.target.value); setValidErr(null); }}
              placeholder="PKXXXXXXXXXXXXXXXXXXXXXXXX"
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="none"
            />
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="cm-secret" className={styles.fieldLabel}>API Secret Key</label>
            <input
              id="cm-secret"
              ref={secretRef}
              className={styles.input}
              type="password"
              value={secret}
              onChange={(e) => { setSecret(e.target.value); setValidErr(null); }}
              placeholder="••••••••••••••••"
              autoComplete="new-password"
            />
          </div>

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
              ⚠️ Live mode places <strong>real orders</strong> with real money. Make sure you understand the risk.
            </div>
          )}

          {validErr && (
            <div className={styles.warnBox}>❗ {validErr}</div>
          )}

          {result && (
            <div className={result.connected ? styles.okBox : styles.warnBox}>
              {result.connected ? '✅ ' : '❌ '}{result.message}
            </div>
          )}

          <div className={styles.modalActions}>
            {connected && (
              <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={busy} onClick={disconnect}>
                Disconnect
              </button>
            )}
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
