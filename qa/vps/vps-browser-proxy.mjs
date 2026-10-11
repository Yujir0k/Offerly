// Loopback HTTPS for headless browser QA through the encrypted VPS SSH tunnel.
// This is not a substitute for verifying the public domain certificate.
import https from 'node:https';
import http from 'node:http';
import {readFileSync} from 'node:fs';
const folder=process.env.VPS_QA_DIR;
const port=Number(process.env.VPS_QA_BROWSER_PORT||18443),upstreamPort=Number(process.env.VPS_QA_TUNNEL_PORT||17874);
if(![port,upstreamPort].every(n=>Number.isInteger(n)&&n>=1024&&n<=65535))throw Error('Invalid loopback port');
if(!folder?.includes('/offerly/'))throw Error('Private QA folder required');
https.createServer({key:readFileSync(folder+'/tls.key'),cert:readFileSync(folder+'/tls.crt')},(req,res)=>{
 const headers={...req.headers,host:'opherly.ru','x-forwarded-proto':'https'};
 if(headers.origin==='https://127.0.0.1:'+port)headers.origin='https://opherly.ru';
 const upstream=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
 upstream.on('error',()=>{res.writeHead(502);res.end('QA tunnel unavailable');});
 req.pipe(upstream);
}).listen(port,'127.0.0.1',()=>console.log('Private QA HTTPS proxy ready'));
