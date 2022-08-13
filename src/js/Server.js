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
  init() {
    this.on('listening',()=>console.log("listening on port:",this.address().port));
    this.on('request',(req,res)=>this.onRequest(req,res));
    return Promise.resolve();
  }

  onRequest(req,res) {
    const url=new URL(req.url,`http://${req.headers.host}`);
    switch(url.pathname) {
      case "/esh-functions":
        return this.getEshFunctions(url,res);
      case "/esh-test-framework":
        return this.getEshTestFramework(url,res);
      case "/esh-copy-to-clipboard":
        return this.copyToClipboard(req,res);
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

  getEshTestFramework(url,res) {
    fsPromises.readFile("./tests/esh-test-framework",'utf8')
      .then(shellScript=>{
        res.writeHead(200,{'Content-Encoding':'gzip'});
        const gz=zlib.createGzip({level:zlib.constants.Z_MAX_LEVEL});
        gz.write(`export ESH_PORT=${url.port}\n`);
        gz.pipe(res);
        gz.end(shellScript);
      })
      .catch(e=>{
        res.statusCode=500;
        res.end(e.toString());
      });
  }

  getEshFunctions(url,res) {
    fsPromises.readFile("./src/bash/esh-functions",'utf8')
      .then(shellScript=>{
        res.writeHead(200,{'Content-Encoding':'gzip'});
        const gz=zlib.createGzip({level:zlib.constants.Z_MAX_LEVEL});
        gz.write(`export ESH_PORT=${url.port}\n`);
        gz.pipe(res);
        gz.write(shellScript);
        const start=url.searchParams.get('start');
        if (start) {
          gz.write(`eval "$(-shell-init -s ${start})"\n`);
        }
        gz.end();
      })
      .catch(e=>{
        res.statusCode=500;
        res.end(e.toString());
      });
  }

  copyToClipboard(req,res) {
    let body="";
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
}

export default Server;
