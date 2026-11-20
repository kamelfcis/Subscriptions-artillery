import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',
  timeout:90000,
  globalSetup:'./e2e/global-setup.js',
  globalTeardown:'./e2e/global-teardown.js',
  use:{baseURL:process.env.E2E_BASE||'http://127.0.0.1:5173'},
  webServer:[
    {command:'npm start',cwd:'../server',url:'http://127.0.0.1:5050/api/health',reuseExistingServer:true,timeout:90000},
    {command:'npm run dev',url:'http://127.0.0.1:5173',reuseExistingServer:true,timeout:90000}
  ]
});
