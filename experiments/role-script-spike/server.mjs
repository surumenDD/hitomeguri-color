import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export function createServer(){
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8','.css':'text/css'};
  return http.createServer(async(req,res)=>{
    try{
      const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
      let target=path.resolve(root,'.'+name);
      if(target!==root&&!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}
      if((await stat(target)).isDirectory())target=path.join(target,'index.html');
      res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store',
        'Content-Security-Policy':"default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'"});
      res.end(await readFile(target));
    }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}).end('ファイルが見つかりません。');}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=createServer(),port=Number(process.env.ROLE_PORT||5281);
  server.listen(port,'127.0.0.1',()=>console.log(`http://127.0.0.1:${port}/experiments/role-script-spike/`));
  const stop=()=>server.close(()=>process.exit(0));process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
