import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,describe,expect,it} from 'vitest';
import {visibleNav} from './rbac';
function Nav({role}){return <nav>{visibleNav(role).map(item=><a key={item.url} href={item.url}>{item.label}</a>)}</nav>;}
describe('RBAC navigation',()=>{
  afterEach(cleanup);
  it('hides finance and admin from an auditor',()=>{
    render(<Nav role="auditor"/>);
    expect(screen.getByText('التقارير والمراجعة')).toBeTruthy();
    expect(screen.queryByText('المالية والورديات')).toBeNull();
    expect(screen.queryByText('إعدادات النظام')).toBeNull();
    expect(screen.queryByText('الأسعار والفئات')).toBeNull();
  });
  it('hides renewals and reports from a clerk',()=>{
    render(<Nav role="clerk"/>);
    expect(screen.getByText('إدارة العضويات')).toBeTruthy();
    expect(screen.queryByText('الاشتراكات والتجديد')).toBeNull();
    expect(screen.queryByText('التقارير والمراجعة')).toBeNull();
  });
});
