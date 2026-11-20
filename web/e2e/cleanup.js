export async function removeAuth(run, auth){
  const id=auth.clientId;
  await run('DELETE p FROM dbo.AppPayments p JOIN dbo.AppRenewals r ON r.id=p.renewal_id WHERE r.client_id=@id',{id});
  await run('DELETE v FROM dbo.AppReversals v JOIN dbo.AppRenewals r ON r.id=v.renewal_id WHERE r.client_id=@id',{id});
  await run('DELETE a FROM dbo.AppRenewalAdjustments a JOIN dbo.AppRenewals r ON r.id=a.renewal_id WHERE r.client_id=@id',{id});
  await run('DELETE FROM dbo.AppCardJobs WHERE client_id=@id',{id});
  await run('DELETE FROM dbo.AppRenewals WHERE client_id=@id',{id});
  await run('DELETE FROM dbo.AppShifts WHERE opened_by=@user',{user:auth.username});
  await run('DELETE FROM dbo.AppAudit WHERE actor=@user',{user:auth.username});
  await run('DELETE FROM dbo.Client WHERE IdClient=@id',{id});
  await run('DELETE FROM dbo.AppUsers WHERE username=@user',{user:auth.username});
}
