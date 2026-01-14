import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { signUp, confirmSignUp, resendSignUpCode, resetPassword, confirmResetPassword } from 'aws-amplify/auth';
import { useAuth } from '../lib/auth';
import { NavBar } from '../components/NavBar';

type Mode = 'login' | 'signup' | 'confirm' | 'reset' | 'resetConfirm';

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated, login, loading } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated]);

  const resetMessages = () => {
    setError('');
    setInfo('');
  };

  const handleModeChange = (nextMode: Mode) => {
    resetMessages();
    setMode(nextMode);
  };

  const parseError = (err: unknown) => {
    if (err && typeof err === 'object' && 'message' in err) {
      return String((err as { message: string }).message);
    }
    return 'Something went wrong. Please try again.';
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      resetMessages();
      await login(email, password);
      router.replace('/dashboard');
    } catch (err) {
      setError('Login failed. Check your credentials.');
    }
  };

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    resetMessages();
    setBusy(true);
    try {
      const result = await signUp({
        username: email,
        password,
        options: {
          userAttributes: {
            email
          }
        }
      });
      if (result.nextStep?.signUpStep === 'CONFIRM_SIGN_UP') {
        setInfo('Check your email for a verification code.');
        setMode('confirm');
      } else {
        setInfo('Account created. You can sign in now.');
        setMode('login');
      }
    } catch (err) {
      setError(parseError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    resetMessages();
    setBusy(true);
    try {
      await confirmSignUp({ username: email, confirmationCode });
      setInfo('Your account is confirmed. You can sign in now.');
      setMode('login');
    } catch (err) {
      setError(parseError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResendCode = async () => {
    resetMessages();
    setBusy(true);
    try {
      await resendSignUpCode({ username: email });
      setInfo('Verification code resent. Check your email.');
    } catch (err) {
      setError(parseError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    resetMessages();
    setBusy(true);
    try {
      const result = await resetPassword({ username: email });
      if (result.nextStep?.resetPasswordStep === 'CONFIRM_RESET_PASSWORD_WITH_CODE') {
        setInfo('Check your email for the reset code.');
        setMode('resetConfirm');
      } else {
        setInfo('Password reset completed. You can sign in now.');
        setMode('login');
      }
    } catch (err) {
      setError(parseError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmReset = async (event: React.FormEvent) => {
    event.preventDefault();
    resetMessages();
    setBusy(true);
    try {
      await confirmResetPassword({
        username: email,
        confirmationCode,
        newPassword
      });
      setInfo('Password updated. You can sign in now.');
      setMode('login');
    } catch (err) {
      setError(parseError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <NavBar />
      <main>
        <div className="page-header">
          <div className="brand brand-header">
            <img src="/ragready-logo.png" alt="RagReady logo" />
            <div>
              <h1 className="page-title">RagReady</h1>
              <p className="page-subtitle">Prepare project knowledge for reliable retrieval.</p>
            </div>
          </div>
        </div>

        <div className="card" style={{ maxWidth: 420 }}>
          {mode === 'login' && (
            <>
              <h3 style={{ marginTop: 0 }}>Sign in</h3>
              <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'grid', gap: 6 }}>
                  <label htmlFor="login-email" className="field-label">Email</label>
                  <input
                    id="login-email"
                    className="input"
                    placeholder="Enter your email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    required
                    aria-required="true"
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <label htmlFor="login-password" className="field-label">Password</label>
                  <input
                    id="login-password"
                    className="input"
                    placeholder="Enter your password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    required
                    aria-required="true"
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {info && <div style={{ color: 'var(--accent-strong)' }} role="status">{info}</div>}
                {error && <div style={{ color: 'var(--critical)' }} role="alert">{error}</div>}
                <button className="btn" type="submit" disabled={loading || busy}>
                  {loading ? 'Signing in...' : 'Sign in'}
                </button>
              </form>
              <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
                <button className="btn secondary" type="button" onClick={() => handleModeChange('signup')}>
                  Create account
                </button>
                <button className="btn secondary" type="button" onClick={() => handleModeChange('reset')}>
                  Forgot password
                </button>
              </div>
            </>
          )}

          {mode === 'signup' && (
            <>
              <h3 style={{ marginTop: 0 }}>Create account</h3>
              <form onSubmit={handleSignUp} style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'grid', gap: 6 }}>
                  <label htmlFor="signup-email" className="field-label">Email</label>
                  <input
                    id="signup-email"
                    className="input"
                    placeholder="Enter your email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    required
                    aria-required="true"
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <label htmlFor="signup-password" className="field-label">Password</label>
                  <input
                    id="signup-password"
                    className="input"
                    placeholder="Create a password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    required
                    aria-required="true"
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {info && <div style={{ color: 'var(--accent-strong)' }} role="status">{info}</div>}
                {error && <div style={{ color: 'var(--critical)' }} role="alert">{error}</div>}
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? 'Creating...' : 'Create account'}
                </button>
              </form>
              <div style={{ marginTop: 16 }}>
                <button className="btn secondary" type="button" onClick={() => handleModeChange('login')}>
                  Back to sign in
                </button>
              </div>
            </>
          )}

          {mode === 'confirm' && (
            <>
              <h3 style={{ marginTop: 0 }}>Verify your email</h3>
              <form onSubmit={handleConfirmSignUp} style={{ display: 'grid', gap: 12 }}>
                <input
                  className="input"
                  placeholder="Email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  required
                  onChange={(e) => setEmail(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Verification code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  value={confirmationCode}
                  required
                  onChange={(e) => setConfirmationCode(e.target.value)}
                />
                {info && <div style={{ color: 'var(--accent-strong)' }}>{info}</div>}
                {error && <div style={{ color: 'var(--critical)' }}>{error}</div>}
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? 'Verifying...' : 'Verify'}
                </button>
              </form>
              <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
                <button className="btn secondary" type="button" onClick={handleResendCode} disabled={busy}>
                  Resend code
                </button>
                <button className="btn secondary" type="button" onClick={() => handleModeChange('login')}>
                  Back to sign in
                </button>
              </div>
            </>
          )}

          {mode === 'reset' && (
            <>
              <h3 style={{ marginTop: 0 }}>Reset password</h3>
              <form onSubmit={handleResetPassword} style={{ display: 'grid', gap: 12 }}>
                <input
                  className="input"
                  placeholder="Email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  required
                  onChange={(e) => setEmail(e.target.value)}
                />
                {info && <div style={{ color: 'var(--accent-strong)' }}>{info}</div>}
                {error && <div style={{ color: 'var(--critical)' }}>{error}</div>}
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? 'Sending...' : 'Send reset code'}
                </button>
              </form>
              <div style={{ marginTop: 16 }}>
                <button className="btn secondary" type="button" onClick={() => handleModeChange('login')}>
                  Back to sign in
                </button>
              </div>
            </>
          )}

          {mode === 'resetConfirm' && (
            <>
              <h3 style={{ marginTop: 0 }}>Set new password</h3>
              <form onSubmit={handleConfirmReset} style={{ display: 'grid', gap: 12 }}>
                <input
                  className="input"
                  placeholder="Email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  required
                  onChange={(e) => setEmail(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Reset code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  value={confirmationCode}
                  required
                  onChange={(e) => setConfirmationCode(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="New password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  required
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                {info && <div style={{ color: 'var(--accent-strong)' }}>{info}</div>}
                {error && <div style={{ color: 'var(--critical)' }}>{error}</div>}
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? 'Updating...' : 'Update password'}
                </button>
              </form>
              <div style={{ marginTop: 16 }}>
                <button className="btn secondary" type="button" onClick={() => handleModeChange('login')}>
                  Back to sign in
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
