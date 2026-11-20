import {render,screen,waitFor,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
vi.mock('../api',()=>({
  api:vi.fn(),
  params:o=>'?'+new URLSearchParams(Object.entries(o).filter(([,v])=>v!==''&&v!==undefined&&v!==null)).toString(),
}));
vi.mock('../main',()=>({useApp:vi.fn()}));
vi.mock('../components/CardPrinter',()=>({default:()=>null}));

import {api} from '../api';
import {useApp} from '../main';
import Renewals,{primaryServiceFromId,isChildRelation} from './Renewals';

describe('renewal service helpers',()=>{
  it('takes the membership class from the member id',()=>{
    expect(primaryServiceFromId('04-1288')).toBe('04');
    expect(primaryServiceFromId('01-9')).toBe('01');
    expect(primaryServiceFromId('')).toBe('01');
  });
  it('treats form child relations as children and excludes wife and in-laws',()=>{
    expect(isChildRelation('ابن')).toBe(true);
    expect(isChildRelation('ابنة')).toBe(true);
    expect(isChildRelation('نجله')).toBe(true);
    expect(isChildRelation('كريمته')).toBe(true);
    expect(isChildRelation('حرمه')).toBe(false);
    expect(isChildRelation('زوجة')).toBe(false);
    expect(isChildRelation('زوج الابنة')).toBe(false);
    expect(isChildRelation('زوجة الابن')).toBe(false);
  });
});

function renderPage(role='admin'){
  useApp.mockReturnValue({notify:vi.fn(),user:{username:'tester',role}});
  const qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/renewals?client=04-1288']}>
        <Renewals/>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Renewals spouse vs child service',()=>{
  beforeEach(()=>{
    api.mockImplementation(async url=>{
      if(String(url).startsWith('/members?')||String(url).startsWith('/members?search')){
        return {items:[{IdClient:'04-1288',Name:'عصام اختبار'}],total:1,page:1,pageSize:10};
      }
      if(String(url).includes('/dependents')){
        return [
          {id:11,Name:'مريم عصام',realation:'حرمه',archived:false},
          {id:12,Name:'الابن',realation:'نجله',archived:false},
        ];
      }
      if(String(url).startsWith('/shifts')) return [];
      if(String(url).startsWith('/services')) return [
        {code:'01',label:'خدمة — الدار',active:true},
        {code:'02',label:'معاش — الدار',active:true},
        {code:'03',label:'أبناء — الدار',active:true},
        {code:'04',label:'مدنيون — الدار',active:true},
      ];
      if(String(url).startsWith('/renewals')) return {items:[],total:0,page:1,pageSize:25};
      return {};
    });
  });
  afterEach(()=>{cleanup();vi.clearAllMocks();});

  it('keeps the primary class for حرمه and hides skip-age',async()=>{
    renderPage('admin');
    await screen.findByRole('option',{name:/مريم عصام/});
    await userEvent.selectOptions(screen.getByLabelText('صاحب التجديد'),'11');
    await waitFor(()=>{
      expect(screen.getByLabelText('فئة الخدمة المعتمدة')).toHaveProperty('value','04');
    });
    expect(screen.queryByText(/تخطي فحص السن/)).toBeNull();
  });

  it('keeps the primary class and shows skip-age only for a child',async()=>{
    renderPage('admin');
    await screen.findByRole('option',{name:/الابن/});
    await userEvent.selectOptions(screen.getByLabelText('صاحب التجديد'),'12');
    await waitFor(()=>{
      expect(screen.getByLabelText('فئة الخدمة المعتمدة')).toHaveProperty('value','04');
    });
    expect(screen.getByText(/تخطي فحص السن/)).toBeTruthy();
  });
});
