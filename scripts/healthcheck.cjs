const address=process.argv[2]||'http://127.0.0.1:5921';
async function main(){
  const target=new URL('/healthz',address);
  if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Error('Use an HTTP or HTTPS server address without credentials');
  const response=await fetch(target,{signal:AbortSignal.timeout(5000),redirect:'error'});
  const data=await response.json();
  if(!response.ok||data.status!=='ok')throw Error('The server did not report healthy');
  console.log('I/O is healthy at '+target.origin);
}
main().catch(error=>{console.error('I/O health check failed: '+error.message);process.exitCode=1;});
