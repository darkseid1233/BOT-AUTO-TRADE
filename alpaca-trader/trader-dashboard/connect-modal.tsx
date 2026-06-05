import { useState } from 'react';
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await connectAlpaca({ keyId: keyId.trim(), secret: secret.trim(), paper });
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
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>

        <form className={styles.modalBody} onSubmit={submit}>
          <p className={styles.modalHint}>
            Paste your Alpaca API keys to connect your portfolio. Use{' '}
            <strong>Paper Trading</strong> keys for the demo account — no real money is used.
            Get keys at <span className={styles.code}>alpaca.markets → Paper Trading → API Keys</span>.
          </p>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>API Key ID</span>
            <input
              className={styles.input}
              type="text"
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
              placeholder="PK..."
              autoComplete="off"
              required
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>API Secret Key</span>
            <input
              className={styles.input}
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="••••••••••••••••"
              autoComplete="off"
              required
            />
          </label>

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
