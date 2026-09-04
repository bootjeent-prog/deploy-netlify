import { useEffect, useState } from 'react';
import { AlertTriangle, CheckSquare, Laptop, Wrench } from 'lucide-react';
import { api } from '../api';
import { money } from '../ui';

export default function DashboardPage({onNavigate,canNavigate}:{onNavigate:(p:any)=>void;canNavigate:(p:any)=>boolean}){
  const [d,setD]=useState<any>(null);const [error,setError]=useState('');
  useEffect(()=>{api('/api/dashboard').then(setD).catch((e:any)=>setError(e.message))},[]);
  if(error)return <div className="alert error">{error}</div>;
  if(!d)return <div className="loading-card">กำลังโหลด Dashboard...</div>;
  const cards:any[]=[
    ['ทรัพย์สินทั้งหมด',d.totalAssets,Laptop,'assets'],
    ['กำลังซ่อม / เสีย',d.inRepair,Wrench,'asset-maintenance'],
    ['ต้องติดตาม',d.attention,AlertTriangle,'assets'],
    ['รออนุมัติ',d.pendingApprovals,CheckSquare,'approval-workflow']
  ].filter(([, , , page])=>canNavigate(page));
  return <div className="panel-grid"><section className="hero-band"><div><span className="eyebrow">Executive Dashboard</span><h2>ภาพรวมการจัดการทรัพย์สินตามสิทธิ์ของคุณ</h2><p>ติดตามตำแหน่ง ผู้รับผิดชอบ สภาพ การซ่อม มูลค่า และคำขออนุมัติจากจุดเดียว</p><div className="hero-tags"><span>Multi-Company</span><span>MySQL Database</span><span>Role-based Access</span></div></div><div className="hero-actions">{canNavigate('assets')&&<button onClick={()=>onNavigate('assets')}>เปิดทะเบียนทรัพย์สิน</button>}{canNavigate('approval-workflow')&&<button className="secondary" onClick={()=>onNavigate('approval-workflow')}>ตรวจคำขออนุมัติ</button>}</div></section><div className="metric-grid">{cards.map(([label,value,Icon,page])=><button className="metric-card" key={label} onClick={()=>onNavigate(page)}><div className="metric-icon"><Icon size={22}/></div><span>{label}</span><strong>{Number(value).toLocaleString('th-TH')}</strong></button>)}</div><div className="summary-grid"><section className="card"><h3>มูลค่าทรัพย์สินตามราคาซื้อ</h3><strong className="big-number">{money(d.assetValue)}</strong><p>ใช้ติดตามมูลค่ารวมก่อนคำนวณค่าเสื่อม</p></section><section className="card"><h3>สถานะพร้อมใช้งาน</h3><strong className="big-number">{d.activeAssets.toLocaleString('th-TH')} ชิ้น</strong><p>ทรัพย์สินสถานะ ACTIVE</p></section><section className="card"><h3>รายการที่ต้องติดตาม</h3><strong className="big-number">{Number(d.attention||0).toLocaleString('th-TH')} ชิ้น</strong><p>สภาพต่ำหรืออยู่ในสถานะที่ต้องตรวจสอบ</p></section></div></div>
}
