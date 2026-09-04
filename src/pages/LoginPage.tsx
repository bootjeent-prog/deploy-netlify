import { useState } from 'react';
import { Boxes, LogIn, ShieldCheck } from 'lucide-react';
import { post, setToken } from '../api';

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await post<{ token: string }>('/api/auth/login', { username, password });
      setToken(response.token);
      setPassword('');
      onLogin();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <div className="brand-mark"><Boxes size={28} /></div>
          <div><strong>Factory Asset</strong><span>Multi-Company Asset Management</span></div>
        </div>
        <div className="login-hero">
          <ShieldCheck size={38} />
          <h1>ระบบบริหารทรัพย์สินโรงงาน</h1>
          <p>Asset, Workflow, Approval และ Audit Log ในระบบเดียว</p>
        </div>
        {error && <div className="alert error">{error}</div>}
        <form onSubmit={submit} autoComplete="on">
          <label>
            <span>รหัสพนักงาน หรือ Email</span>
            <input name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required autoFocus />
          </label>
          <label>
            <span>รหัสผ่าน</span>
            <input name="password" autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <button className="primary login-button" disabled={busy}>
            <LogIn size={18} />{busy ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
        <div className="security-note">
          <strong>ความปลอดภัย</strong>
          <span>ใช้บัญชีและรหัสผ่านที่ Admin กำหนด</span>
        </div>
      </section>
    </main>
  );
}
