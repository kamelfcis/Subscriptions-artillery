import {render,screen,act,renderHook} from '@testing-library/react';
import {describe,expect,it,vi} from 'vitest';
import {Pager,useDebounced} from './ui';
describe('members list controls',()=>{
  it('debounces search text',()=>{
    vi.useFakeTimers();
    const hook=renderHook(({value})=>useDebounced(value,320),{initialProps:{value:''}});
    hook.rerender({value:'علي'});
    expect(hook.result.current).toBe('');
    act(()=>{vi.advanceTimersByTime(320);});
    expect(hook.result.current).toBe('علي');
    vi.useRealTimers();
  });
  it('changes page size from the pager',()=>{
    const pages=[];const sizes=[];
    render(<Pager data={{page:1,pageSize:25,total:80}} setPage={p=>pages.push(p)} pageSize={25} setPageSize={s=>sizes.push(s)}/>);
    expect(screen.getByText(/80 سجل/)).toBeTruthy();
    const select=screen.getByLabelText('حجم الصفحة');
    const setter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;
    act(()=>{setter.call(select,'50');select.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(sizes).toEqual([50]);
    expect(pages).toEqual([1]);
  });
});
