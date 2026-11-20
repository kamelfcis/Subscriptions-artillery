import 'dotenv/config';
const windows = (process.env.SQL_AUTH || 'windows') === 'windows';
const driver = windows ? await import('mssql/msnodesqlv8.js').catch((e) => {
  throw new Error('Windows Authentication requires npm install of msnodesqlv8 on Windows and Microsoft ODBC Driver 18. ' + e.message);
}) : await import('mssql');
export const sql = driver.default || driver;
let poolPromise;
const serverName = process.env.SQL_SERVER + (process.env.SQL_INSTANCE ? '\\' + process.env.SQL_INSTANCE : '');
const encrypt = process.env.SQL_ENCRYPT !== 'false';
const trust = process.env.SQL_TRUST_CERT === 'true';
const database = process.env.SQL_DATABASE||'Subscriptions';
const odbcDriver = process.env.SQL_ODBC_DRIVER||'ODBC Driver 18 for SQL Server';
const yesNo = (value) => value ? 'Yes' : 'No';
const config = windows ? {
 server:serverName,database,driver:odbcDriver,
 connectionString:`Driver={${odbcDriver}};Server=${serverName};Database=${database};Trusted_Connection=Yes;Encrypt=${yesNo(encrypt)};TrustServerCertificate=${yesNo(trust)};`,
 options:{trustedConnection:true,encrypt,trustServerCertificate:trust},
 pool:{min:0,max:20,idleTimeoutMillis:30000},requestTimeout:30000,connectionTimeout:20000
} : {
 server:serverName,database,user:process.env.SQL_USER,password:process.env.SQL_PASSWORD,
 options:{encrypt,trustServerCertificate:trust},pool:{min:0,max:20,idleTimeoutMillis:30000},requestTimeout:30000,connectionTimeout:20000
};
export function pool(){if(!poolPromise){poolPromise=new sql.ConnectionPool(config).connect().catch(e=>{poolPromise=null;throw e;});}return poolPromise;}
export function bind(request, values={}){for(const [k,v] of Object.entries(values)){if(v===undefined)continue;if(Buffer.isBuffer(v))request.input(k,sql.VarBinary(sql.MAX),v);else if(v instanceof Date)request.input(k,sql.DateTime2,v);else request.input(k,v);}return request;}
export async function run(statement, params={},trx=null){const p=trx||await pool();return bind(new sql.Request(p),params).query(statement);}
export async function rows(statement, params={},trx=null){return (await run(statement,params,trx)).recordset;}
export async function one(statement,params={},trx=null){return (await rows(statement,params,trx))[0]||null;}
export async function transactional(callback,{isolation=sql.ISOLATION_LEVEL.SERIALIZABLE}={}){const t=new sql.Transaction(await pool());await t.begin(isolation);try{const result=await callback(t);await t.commit();return result;}catch(e){try{await t.rollback();}catch{}throw e;}}
export async function audit(actor,action,entity,entityId,details={},t=null){await run(`INSERT dbo.AppAudit(actor,action,entity,entity_id,details) VALUES(@actor,@action,@entity,@entityId,@details)`,{actor,action,entity,entityId:String(entityId||''),details:JSON.stringify(details)},t);}
