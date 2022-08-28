import child_process from 'child_process';
import http from 'http';
import os from 'os';
//import querystring from 'querystring';
import zlib from 'zlib';
import {promises as fsPromises} from 'fs';

const E_OS_PROG_ENUM={
  COPY:{
    linux:["clipit"],
    darwin:["pbcopy"],
    openbsd:["xclip","-i","-selection","clipboard"],
  },
  PASTE:{
    linux:["clipit","-c"],
    darwin:["pbpaste"],
    openbsd:["xclip","-o","-selection","clipboard"],
  },
  OPEN:{
    linux:["xdg-open"],
    darwin:["open"],
    openbsd:["xdg-open"],
  },
};

class Server extends http.Server {
  init({notify}) {
    this.once('listening',()=>console.log("listening on port:",this.address().port));
    if (notify) {
      this.once('listening',()=>fsPromises.appendFile(notify,this.address().port+"\n").catch(e=>console.error(e)))
    }
    this.on('request',(req,res)=>this.onRequest(req,res));
    return Promise.resolve();
  }

  onRequest(req,res) {
    const url=new URL(req.url,`http://${req.headers.host}`);
    switch(url.pathname) {
      case "/scr-get-bash-functions":
        return this.getBashFunctions(url,res);
      case "/scr-get-test-framework":
        return this.getTestFramework(url,res);
      case "/scr-copy-to-clipboard":
        return this.copyToClipboard(req,res);
      case "/scr-get-clipboard":
        return this.getClipboard(req,res);
      case "/scr-get-vimrc":
        return this.getVimrc(req,res);
      case "/scr-hello-world":
        return res.end("hello world\n");
      case "/scr-shutdown":
        return this.shutdown(res);
    }
    res.end();
  }

  getOsProgram(progtype) {
    const platform=os.platform();
    if (typeof(progtype)=="string") {
      return E_OS_PROG_ENUM[progtype][platform];
    } else {
      return progtype[platform];
    }
  }

  getTestFramework(url,res) {
    const files=[
      "./tests/test-framework",
      //"./tests/assertions",
      //"./tests/gnu-screen-assertions",
    ];
    let shellScript='';
    Promise.all(files.map(file=>fsPromises.readFile(file,'utf8')
      .then(text=>shellScript+=text))).then(()=>{
      res.writeHead(200,{'Content-Encoding':'gzip'});
      const gz=zlib.createGzip({level:zlib.constants.Z_MAX_LEVEL});
      gz.write(`export SCR_PORT=${url.port}\n`);
      gz.pipe(res);
      gz.end(shellScript);
    }).catch(e=>{
      res.statusCode=500;
      res.statusMessage=e.toString();
      res.end();
    });
  }

  getVimrc(url,res) {
    fsPromises.readFile("./src/vim/vimrc",'utf8')
      .then(vimrc=>{
        res.writeHead(200,{'Content-Encoding':'gzip'});
        const gz=zlib.createGzip({level:zlib.constants.Z_MAX_LEVEL});
        gz.pipe(res);
        gz.end(vimrc);
      })
      .catch(e=>{
        res.statusCode=500;
        res.end(e.toString());
      });
  }

  getBashFunctions(url,res) {
    fsPromises.readFile("./src/bash/bash-functions",'utf8')
      .then(shellScript=>{
        res.writeHead(200,{'Content-Encoding':'gzip'});
        const gz=zlib.createGzip({level:zlib.constants.Z_MAX_LEVEL});
        gz.pipe(res);
        gz.write(shellScript);
        const start=url.searchParams.get('start');
        if (start) {
          gz.write(`export SCR_PORT=${url.port}\n`);
          gz.write(`-shell-init -s ${start}\n`);
        }
        gz.end();
      })
      .catch(e=>{
        res.statusCode=500;
        res.end(e.toString());
      });
  }

  copyToClipboard(req,res) {
    const cp_prog=this.getOsProgram(E_OS_PROG_ENUM.COPY);
    const p=child_process.spawn(cp_prog[0],cp_prog.slice(1),{stdio:['pipe','ignore',process.stderr]});
    req.pipe(p.stdin);
    p.on("error",e=>{
      console.error("copyToClipboard:"+e);
      res.statusCode=500;
      res.statusMessage=e.toString();
      res.end();
    });
    p.on('exit',(rc,signal)=>{
      if (rc===0) {
        console.log(`copied ${req.headers['content-length']} bytes to clipboard`);
      } else {
        console.warn(`copyToClipboard: got rc=${rc}`);
      }
      res.end();
      /*
      // if small enough buffer, place into X Windows primary selection too for
      // convenience
      if (rc==0 && platform=="linux" && clipboardBytes<=maxXselBuf) {
        var p2=child_process.spawn("xsel",["-i","-p"],{stdio:['pipe',process.stdout,process.stderr]});
        p2.on("error",function(e) {
          console.error("copyToClipboard: xsel: "+e);
          socket.end(e.toString());
        });
        p2.stdin.end(xselBuf);
      }
      */
    });
  }

  getClipboard(req,res) {
    const paste_prog=this.getOsProgram(E_OS_PROG_ENUM.PASTE);
    const p=child_process.spawn(paste_prog[0],paste_prog.slice(1),
      {stdio:['ignore','pipe',process.stderr]});
    p.on("error",e=>{
      console.error("getClipboard:"+e);
      res.statusCode=500;
      res.statusMessage=e.toString();
      res.end();
    });
    const gz=zlib.createGzip({level:zlib.constants.Z_MAX_LEVEL});
    res.setHeader('Content-Type','text/plain');
    res.setHeader('Content-Encoding','gzip');
    p.stdout.pipe(gz).pipe(res);
  }

  shutdown(res) {
    if (process.env.SCR_ENV==='test') {
      res.end();
      process.nextTick(()=>process.exit(0));
    }
    res.statusCode=401;
    res.end();
  }
}

export default Server;
