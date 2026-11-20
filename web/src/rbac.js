export const rolePermissions={
 admin:['*'],
 supervisor:['read','write','finance','reports','block','fees','print','users','approve'],
 cashier:['read','finance','reports','print'],
 clerk:['read','write','print'],
 auditor:['read','reports']
};
export function can(role,perm){const list=rolePermissions[role]||[];return list.includes('*')||list.includes(perm);}
export const nav=[
 {label:'نظرة عامة',url:'/',perm:'read'},
 {label:'إدارة العضويات',url:'/members',perm:'read'},
 {label:'الاشتراكات والتجديد',url:'/renewals',perm:'finance'},
 {label:'المالية والورديات',url:'/finance',perm:'finance'},
 {label:'المحظورون أمنياً',url:'/blocked',perm:'read'},
 {label:'الأسعار والفئات',url:'/pricing',perm:'fees'},
 {label:'التقارير والمراجعة',url:'/reports',perm:'reports'},
 {label:'إعدادات النظام',url:'/admin',perm:'users'}
];
export function visibleNav(role){return nav.filter(item=>can(role,item.perm));}
