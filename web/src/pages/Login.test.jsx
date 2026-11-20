import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe,expect,it,vi} from 'vitest';
vi.mock('../api',()=>({api:vi.fn(async()=>({user:{username:'cashier1',role:'cashier'},csrf:'token'}))}));
import {api} from '../api';
import Login from './Login';
describe('login',()=>{
  it('submits username and password',async()=>{
    const onLogin=vi.fn();
    render(<Login onLogin={onLogin}/>);
    await userEvent.type(screen.getByLabelText(/اسم المستخدم/), 'cashier1');
    await userEvent.type(screen.getByLabelText(/كلمة المرور/), 'secret-password');
    await userEvent.click(screen.getByRole('button',{name:/تسجيل الدخول/}));
    expect(api).toHaveBeenCalledWith('/auth/login',{method:'POST',body:{username:'cashier1',password:'secret-password'}});
    expect(onLogin).toHaveBeenCalledWith({username:'cashier1',role:'cashier'});
  });
});
