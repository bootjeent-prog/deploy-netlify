import { Hammer } from 'lucide-react';

type PlaceholderPageProps = {
  title: string;
  description: string;
  columns: string[];
};

// หน้าโครงร่าง (โครงสร้างหน้าจอ) สำหรับโมดูลที่ระบุใน Requirement แต่ยังไม่ได้พัฒนา Logic จริง
// แสดงหัวข้อ คำอธิบาย และคอลัมน์ที่วางแผนไว้ ให้เห็นภาพรวมก่อนลงมือพัฒนา
export function PlaceholderPage({ title, description, columns }: PlaceholderPageProps) {
  return (
    <div className="panel-grid">
      <section className="card placeholder-card">
        <div className="placeholder-header">
          <div className="placeholder-icon">
            <Hammer size={20} />
          </div>

          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>

          <span className="badge badge-pending">อยู่ระหว่างพัฒนา</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              <tr>
                <td className="empty-row" colSpan={columns.length}>
                  ยังไม่มีข้อมูล — โครงสร้างหน้านี้พร้อมสำหรับพัฒนาต่อ
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
