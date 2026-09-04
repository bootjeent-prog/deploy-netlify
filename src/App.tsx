import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  RefreshCw,
  Shield,
  UserCircle
} from 'lucide-react';
import { api, getToken, setToken } from './api';
import type { BootstrapData, User } from './types';
import { navGroups, type PageId } from './navigation';
import { isUserRole, ROLE_PAGES } from './roles';
import LoginPage from './pages/LoginPage';
import PublicAssetPage from './pages/PublicAssetPage';
import DashboardPage from './pages/DashboardPage';
import AssetsPage from './pages/AssetsPage';
import FacilityAssetsPage from './pages/FacilityAssetsPage';
import AnnualInventoryPage from './pages/AnnualInventoryPage';
import UsersPage from './pages/UsersPage';
import EmployeesPage from './pages/EmployeesPage';
import MasterDataPage, { masterDataDefs, type MasterType } from './pages/MasterDataPage';
import ModulesPage from './pages/ModulesPage';

export default function App() {
  const publicAssetId = useMemo(() => new URLSearchParams(location.search).get('asset') || '', []);
  const [loggedIn, setLoggedIn] = useState(Boolean(getToken()));
  const [data, setData] = useState<BootstrapData | null>(null);
  const [page, setPage] = useState<PageId>('dashboard');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [masterDataOpen, setMasterDataOpen] = useState(false);
  const [masterDataType, setMasterDataType] = useState<MasterType>('company');

  const load = useCallback(async () => {
    if (!getToken()) return;
    setLoading(true);
    setError('');
    try {
      const bootstrap = await api<BootstrapData>('/api/bootstrap');
      setData(bootstrap);
      setLoggedIn(true);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'ไม่สามารถโหลดข้อมูลได้';
      setError(message);
      if (!getToken()) setLoggedIn(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loggedIn) void load();
  }, [loggedIn, load]);

  useEffect(() => {
    const handleExpired = () => {
      setData(null);
      setLoggedIn(false);
      setError('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
    };
    window.addEventListener('auth-expired', handleExpired);
    return () => window.removeEventListener('auth-expired', handleExpired);
  }, []);

  if (publicAssetId) return <PublicAssetPage assetId={publicAssetId} />;
  if (!loggedIn) return <LoginPage onLogin={() => setLoggedIn(true)} />;

  async function logout() {
    try {
      await api<void>('/api/auth/logout', { method: 'POST' });
    } catch {
      // Local token must still be cleared if the server session has already expired.
    }
    setToken('');
    setData(null);
    setLoggedIn(false);
  }

  const user = data?.user;
  const activeRole = isUserRole(user?.role || '') ? user!.role : 'VIEW';
  const allowed = ROLE_PAGES[activeRole];
  const isVisible = (id: PageId) => !allowed || allowed.includes(id);
  const go = (id: PageId) => {
    if (!isVisible(id)) {
      setError('บัญชีนี้ไม่มีสิทธิ์เปิดเมนูดังกล่าว');
      return;
    }
    setError('');
    setPage(id);
    setMobileOpen(false);
    if (id !== 'master-data') setMasterDataOpen(false);
  };
  const title = navGroups.flatMap((group) => group.items).find((item) => item[0] === page)?.[1] || 'ระบบจัดการทรัพย์สิน';

  return (
    <main className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Boxes size={24} /></div>
          <div><strong>Company Asset</strong><span>Factory Management</span></div>
        </div>
        <nav className="nav-grouped">
          {navGroups.map((group) => {
            const visible = group.items.filter((item) => isVisible(item[0]));
            if (!visible.length) return null;
            return (
              <div className="nav-group" key={group.label}>
                <span className="nav-group-label">{group.label}</span>
                {visible.map(([id, label, Icon]) => {
                  if (id !== 'master-data') {
                    return (
                      <button key={id} className={page === id ? 'active' : ''} onClick={() => go(id)} title={label}>
                        <Icon size={18} /><span>{label}</span>
                      </button>
                    );
                  }

                  const companyLocationTypes = new Set<MasterType>(['site', 'building', 'floor', 'zone', 'room']);
                  const visibleMasterDefs = masterDataDefs.filter((item) => activeRole === 'ADMIN' || companyLocationTypes.has(item[0]));
                  // Keep the Master Data dropdown controlled by the user.
                  // Being inside a Master Data page should not force the menu to stay open.
                  const dropdownOpen = masterDataOpen;
                  const groupedMasterDefs = Array.from(new Set(visibleMasterDefs.map((item) => item[2])));
                  return (
                    <div className="sidebar-master-dropdown" key={id}>
                      <button
                        className={`sidebar-master-trigger ${page === id ? 'active' : ''}`}
                        onClick={() => setMasterDataOpen((value) => !value)}
                        title={label}
                        aria-expanded={dropdownOpen}
                      >
                        <Icon size={18} /><span>{label}</span><ChevronDown className={`master-chevron ${dropdownOpen ? 'open' : ''}`} size={15} />
                      </button>
                      {dropdownOpen && !collapsed && (
                        <div className="sidebar-master-menu">
                          {groupedMasterDefs.map((masterGroup) => (
                            <div className="sidebar-master-group" key={masterGroup}>
                              <span>{masterGroup}</span>
                              {visibleMasterDefs.filter((item) => item[2] === masterGroup).map((item) => (
                                <button
                                  key={item[0]}
                                  className={`sidebar-master-item ${page === 'master-data' && masterDataType === item[0] ? 'active' : ''}`}
                                  onClick={() => {
                                    setMasterDataType(item[0]);
                                    setMasterDataOpen(true);
                                    go('master-data');
                                  }}
                                  title={item[1]}
                                >
                                  <span>{item[1]}</span>
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-user">
          <UserCircle size={22} />
          <div><strong>{user?.name || 'ผู้ใช้งาน'}</strong><span>{user?.roleName || user?.role} · {user?.company}</span></div>
        </div>
        <button className="collapse-button" onClick={() => setCollapsed((value) => !value)}>
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </aside>

      {mobileOpen && <button className="mobile-overlay" onClick={() => setMobileOpen(false)} />}
      <section className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu" onClick={() => setMobileOpen(true)}><Menu size={21} /></button>
            <div><h1>{title}</h1><p>{user?.company} · {user?.department} · {user?.roleName}</p></div>
          </div>
          <div className="topbar-actions">
            <button className="icon-text" onClick={() => void load()} disabled={loading}><RefreshCw size={17} />{loading ? 'กำลังโหลด' : 'รีเฟรช'}</button>
            <span className="security-pill"><Shield size={15} />MySQL Connected</span>
            <button className="icon-text danger" onClick={() => void logout()}><LogOut size={17} />ออกจากระบบ</button>
          </div>
        </header>
        <div className="workspace-content">
          {error && <div className="alert error">{error}</div>}
          {!data
            ? <div className="loading-card">กำลังโหลดระบบ...</div>
            : <Page page={page} data={data} load={load} go={go} isVisible={isVisible} masterDataType={masterDataType} setMasterDataType={setMasterDataType} />}
        </div>
      </section>

    </main>
  );
}

function Page({ page, data, load, go, isVisible, masterDataType, setMasterDataType }: { page: PageId; data: BootstrapData; load: () => Promise<void>; go: (page: PageId) => void; isVisible: (page: PageId) => boolean; masterDataType: MasterType; setMasterDataType: (type: MasterType) => void }) {
  if (page === 'dashboard') return <DashboardPage onNavigate={go} canNavigate={isVisible} />;
  if (page === 'assets') return <AssetsPage assets={data.assets} employees={data.employees} companies={data.companies} masterData={data.masterData} onReload={load} userRole={data.user.role} userCompany={data.user.company} />;
  if (page === 'facility-assets') return <FacilityAssetsPage employees={data.employees} companies={data.companies} masterData={data.masterData} user={data.user} onManageRooms={() => { setMasterDataType('room'); go('master-data'); }} />;
  if (page === 'annual-inventory') return <AnnualInventoryPage user={data.user} masterData={data.masterData} />;
  if (page === 'employees') return <EmployeesPage employees={data.employees} companies={data.companies} masterData={data.masterData} onReload={load} user={data.user} />;
  if (page === 'users') return <UsersPage employees={data.employees} companies={data.companies} onReload={load} user={data.user} />;
  if (page === 'master-data') return <MasterDataPage onNavigate={go} userRole={data.user.role} userCompany={data.user.company} companies={data.companies} employees={data.employees} onReload={load} selectedType={masterDataType} onSelectedTypeChange={setMasterDataType} />;
  return <ModulesPage page={page} assets={data.assets} employees={data.employees} companies={data.companies} masterData={data.masterData} onReload={load} user={data.user} />;
}
