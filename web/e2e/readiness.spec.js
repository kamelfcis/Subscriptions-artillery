import {test, expect} from '@playwright/test';
import fs from 'node:fs';
const auth=JSON.parse(fs.readFileSync(new URL('./auth.json', import.meta.url), 'utf8'));
async function api(page, method, url, data){
  const cookies=await page.context().cookies();
  const csrf=decodeURIComponent(cookies.find(c=>c.name==='csrf')?.value||'');
  return page.request.fetch(url,{method,data,headers:{'X-CSRF-Token':csrf}});
}
test('login, profile, quote, receipt, and print preview', async({page})=>{
  await page.goto('/');
  await page.getByLabel(/اسم المستخدم/).fill(auth.username);
  await page.getByLabel(/كلمة المرور/).fill(auth.password);
  await page.getByRole('button', {name:/تسجيل الدخول/}).click();
  await page.getByRole('link', {name:'إدارة العضويات'}).click();
  await page.getByPlaceholder(/ابحث بالاسم/).fill(auth.clientId);
  await expect(page.getByText(auth.clientId).first()).toBeVisible();
  await page.getByText(auth.clientId).first().click();
  await expect(page.getByRole('heading', {level:1, name:auth.name})).toBeVisible();
  const photo=await api(page,'GET','/api/members/'+encodeURIComponent(auth.clientId)+'/photo');
  expect([404,415,200]).toContain(photo.status());
  const end=new Date();end.setUTCFullYear(end.getUTCFullYear()+1);
  const term=end.toISOString().slice(0,10);
  const shift=await api(page,'POST','/api/shifts',{opening_float:0});
  expect(shift.ok()).toBeTruthy();
  const shiftBody=await shift.json();
  const quote=await api(page,'POST','/api/renewals/quote',{client_id:auth.clientId,service_code:'01',term_to:term});
  expect(quote.ok()).toBeTruthy();
  const quoted=await quote.json();
  const paid=await api(page,'POST','/api/renewals',{client_id:auth.clientId,service_code:'01',term_to:term,request_key:crypto.randomUUID(),amount_paid:quoted.amount_due,method:'CASH',shift_id:shiftBody.id,payment_reference:'e2e'});
  expect(paid.ok()).toBeTruthy();
  const renewal=await paid.json();
  const receipt=await api(page,'GET','/api/renewals/'+renewal.id+'/receipt');
  expect(receipt.ok()).toBeTruthy();
  expect(await receipt.text()).toContain('إيصال');
  await page.getByRole('button', {name:/طباعة الكارنيه/}).click();
  await expect(page.getByText(/منطقة البياض فقط/)).toBeVisible();
  await expect(page.getByRole('button', {name:/طباعة الوجه الأمامي/})).toBeVisible();
});
