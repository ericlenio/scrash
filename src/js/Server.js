import child_process from 'child_process';
import http from 'http';
import os from 'os';
//import querystring from 'querystring';
import zlib from 'zlib';
import {default as fs,promises as fsPromises} from 'fs';
import crypto from 'crypto';
import path from 'path';
import pty from 'node-pty';

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
    this.on('connect',(req,socket,head)=>this.onConnect(req,socket,head));
    return Promise.resolve();
  }

  onRequest(req,res) {
    const url=new URL(req.url,`http://${req.headers.host}`);
    switch(url.pathname) {
      case "/scr-get-bash-functions":
        return this.getBashFunctions(url,res);
      //case "/scr-get-test-framework":
        //return this.getTestFramework(url,res);
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
      case "/scr-upload-file":
        return this.uploadFile(req,res);
    }
    res.end();
  }

  onConnect(req,socket,head) {
    const response={
      statusLine:`HTTP/1.0 200 scrash Connection Established`,
      headers:[],
      toString:()=>response.statusLine+"\r\n"+response.headers.join("\r\n")+"\r\n",
    };
    socket.on('error',e=>console.error("onConnect socket:",e));
    socket.write(response.toString(),()=>{
      let p;
      let stdout='';
      let line1='';
      let uploadFile;
      socket.on('data',buf=>{
        line1+=buf;
        // see if user specified the upload file directly (otherwise the file
        // picker script will provide it)
        const m=/^upload_file=(.*?)\n/.exec(line1);
        if (!m) {
          return;
        }
        socket.on('data',buf=>p.write(buf));
        line1='';
        uploadFile=m[1];
        p=pty.spawn("./src/bash/upload-file-picker",[uploadFile]);
        console.log("spawn:",new Date().toLocaleString(),p.pid);
        p.on("error",e=>{
          console.error("spawn:"+e);
          socket.destroy();
        });
        p.on('data',buf=>{
          stdout+=buf;
          socket.write(buf);
        });
        p.on('exit',(code,signal)=>{
          console.log("exit p:",p.pid,code,signal);
          const eot="\x04";
          const re=new RegExp(".*?"+eot+"(E_FILE_INFO.*?)\r\n","s");
          const fileInfo=stdout.replace(re,"$1").split('|');
          if (fileInfo==stdout) {
            return socket.end();
          }
          console.log("upload fileInfo:"+JSON.stringify(fileInfo));
          const uploadFile=fileInfo[1];
          const gz=zlib.createGzip({level:zlib.Z_BEST_COMPRESSION});
          const fsstream=fs.createReadStream(uploadFile);
          fsstream.pipe(gz).pipe(socket);
        });
      });
      socket.on('end',()=>{
        console.log("socket end");
        //if (p) {
          //p.destroy();
        //}
      });
    });
  }

  getOsProgram(progtype) {
    const platform=os.platform();
    if (typeof(progtype)=="string") {
      return E_OS_PROG_ENUM[progtype][platform];
    } else {
      return progtype[platform];
    }
  }

  /*
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
  */

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
    let shellScript="";
    const rcfiles=["screenrc","vimrc"];
    for (const rcfile of rcfiles) {
      // create a bash function to generate the rcfile on demand: the function
      // name is a hyphen followed by the rcfile name
      this.getUserRcFile(rcfile).then(fileContent=>shellScript+=`-${rcfile}() {
        local b64src="${Buffer.from(fileContent).toString('base64')}"
        echo $b64src | openssl enc -d -a -A
      }
      `).catch(e=>{
        if (e.code==="ENOENT") {
          // the user profile does not have the rcfile, so set up stub function
          shellScript+=`-${rcfile}() { :; }\n`;
          return;
        }
        throw e;
      });
    }
    fsPromises.readFile("./src/bash/bash-functions",'utf8')
      .then(fileContent=>{
        shellScript+=fileContent;
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

  getUserRcFile(rcfile) {
    return fsPromises.readFile(`./profile/${process.env.USER}/${rcfile}`,'utf8');
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

  /**
   * handles an uploaded file from the client (using the <code>-download</code>
   * bash function)
   */
  uploadFile(req,res) {
    const filename=req.headers['x-file-name'];
    const md5=req.headers['x-file-md5'];
    if (!filename || !md5) {
      res.statusCode=400;
      res.statusMessage="missing headers";
      return res.end();
    }
    if (! /^[- \+\.\w\(\)%]+$/.test(filename)) {
      res.statusCode=400;
      res.statusMessage="illegal filename";
      return res.end();
    }
    const endRequest=e=>{
      res.statusCode=500;
      res.end();
    };
    const localPath=`/tmp/${path.basename(filename)}`;
    const hash=crypto.createHash('md5');
    const stream=fs.createWriteStream(localPath);
    let filesize=0;
    stream.on('error',e=>console.log("uploadFile stream:",e));
    stream.on('error',e=>endRequest(e));
    req.on('error',e=>console.error("uploadFile req:",e));
    req.on('error',e=>endRequest(e));
    req.on('data',buf=>{
      hash.update(buf,'utf8');
      stream.write(buf,'utf8');
      filesize+=buf.length;
    });
    req.on('end',()=>{
      const localMd5=hash.digest('hex').toLowerCase();
      if (md5===localMd5) {
        console.log("wrote file:",localPath,`(${filesize} bytes)`);
        return res.end();
      }
      res.statusCode=500;
      res.statusMessage=`md5 check failed for ${filename}`;
      res.end();
    });
  }
}

export default Server;
