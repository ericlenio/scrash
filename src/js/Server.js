import child_process from 'child_process';
import http from 'http';
import os from 'os';
//import querystring from 'querystring';
import zlib from 'zlib';
import {default as fs,promises as fsPromises} from 'fs';
import crypto from 'crypto';
import net from 'net';
import path from 'path';
//import pty from 'node-pty';
import Otp from './Otp.js';
import ClipboardOtpCache from './ClipboardOtpCache.js';

const SCR_HOME=process.env.npm_config_local_prefix;
const SCR_ENV=process.env.SCR_ENV || process.env.npm_package_config_SCR_ENV;
const SCR_VERSION=process.env.npm_package_version;
const SCR_PROFILE=process.env.SCR_PROFILE || process.env.npm_package_config_SCR_PROFILE;
const SCR_PROFILE_DIR=`${SCR_HOME}/profile/${SCR_PROFILE}`;
const SCR_TMPDIR=process.env.SCR_TMPDIR || `/tmp/scr-${SCR_ENV}`;
const SCR_APP_NAME=process.env.npm_package_name;

const E_OS_PROG_ENUM={
  COPY:{
    linux:["clipit"],
    darwin:["pbcopy"],
    openbsd:["/usr/local/bin/xclip","-i","-selection","clipboard"],
  },
  PASTE:{
    linux:["clipit","-c"],
    darwin:["pbpaste"],
    openbsd:["/usr/local/bin/xclip","-o","-selection","clipboard"],
  },
  OPEN:{
    linux:["xdg-open"],
    darwin:["open"],
    openbsd:["/usr/local/bin/xdg-open"],
  },
};

class Server extends http.Server {
  #shellScript;
  #clipboardOtpCache;

  init({notify,port}) {
    console.log(`starting Server.js v${SCR_VERSION}, configuration: ${SCR_ENV}, profile: ${SCR_PROFILE}`);
    this.#clipboardOtpCache=new ClipboardOtpCache();
    this.once('listening',()=>console.log("listening on port:",this.address().port));
    if (notify) {
      this.once('listening',()=>fsPromises.appendFile(notify,this.address().port+"\n").catch(e=>console.error(e)))
    }
    this.on('request',(req,res)=>this.onRequest(req,res));
    this.on('connect',(req,socket,head)=>this.onConnect(req,socket,head));
    return fsPromises.readdir(SCR_PROFILE_DIR)
      .then(()=>this.loadBashFunctions())
      .then(shellScript=>this.#shellScript=shellScript)
      .then(()=>this.loadVimPlugins())
      .then(shellScript=>this.#shellScript+=shellScript)
      .then(()=>this.listen(port,'127.0.0.1'))
      .then(()=>new Promise(resolve=>this.once('listening',resolve)));
  }

  onRequest(req,res) {
    const url=new URL(req.url,`http://${req.headers.host}`);
    const accepts=req.headers.accept
      ? req.headers.accept.split(/,\s*/)
      : ["text/plain"];
    switch(url.pathname) {
      case "/scr-about":
        for (const accept of accepts) {
          switch(accept) {
            case 'text/json':
              res.setHeader('Content-Type',accept);
              return res.end(`{"appName":"${SCR_APP_NAME}","version":"${SCR_VERSION}","configuration":"${SCR_ENV}","profile":"${SCR_PROFILE}"}\n`);
          }
        }
        res.setHeader('Content-Type',accepts[0]);
        return res.end(`${SCR_APP_NAME} ${SCR_VERSION}, configuration ${SCR_ENV}, profile ${SCR_PROFILE}\n`);
      case "/scr-get-bash-functions":
        res.setHeader('Content-Type','application/x-shellscript');
        return this.getBashFunctions(url,res);
      //case "/scr-get-test-framework":
        //return this.getTestFramework(url,res);
      case "/scr-set-clipboard":
        return this.setClipboardFromRequest(req,res);
      case "/scr-set-clipboard-otp":
        return this.setClipboardOtp(req,res);
      case "/scr-get-clipboard":
        return this.sendClipboard(req,res);
      //case "/scr-get-vimrc":
        //return this.getVimrc(req,res);
      case "/scr-hello-world":
        return res.end("hello world\n");
      case "/scr-shutdown":
        return this.shutdown(res);
      case "/scr-upload-file":
        return this.uploadFile(req,res);
      default:
        res.statusCode=404;
    }
    res.end();
  }

  randomInteger(length=4) {
    return Math.floor(Math.pow(10,length-1)+Math.random()*(Math.pow(10,length)-Math.pow(10,length-1)-1));
  }

  onConnect(req,socket,head) {
    const url=new URL(req.url);
    const response={
      statusLine:`HTTP/1.0 200 ${SCR_APP_NAME} Connection Established`,
      headers:[],
      toString:()=>response.statusLine+"\r\n"+response.headers.join("\r\n")+"\r\n",
      send:cb=>socket.write(response.toString(),cb),
    };
    socket.on('error',e=>console.error("onConnect socket:",e));
    switch(req.url) {
      case "localhost:22":
        return this.onSshConnect(req,response);
      case "localhost:1234":
        return this.onFileUpload(req,socket,response);
    }
  }
  
  /*
  onFileUpload(req,socket,response) {
    socket.write(response.toString(),()=>{
      let p;
      let stdout='';
      let readLines='';
      let uploadFile;
      const accessCode=process.env.SCR_ENV=='test'
        ? 'test'
        : this.randomInteger(4);
      socket.on('data',buf=>{
        readLines+=buf;
        // see if user specified the upload file directly, and access code
        // (otherwise the file picker script will prompt for the access code
        // and upload file)
        const m=/^upload_file=(.*?)\naccess_code=(.*?)\n/.exec(readLines);
        if (!m) {
          return;
        }
        socket.on('data',buf=>p.write(buf));
        readLines='';
        uploadFile=m[1];
        const userProvidedAccessCode=m[2];
        const env={SCR_ACCESS_CODE:accessCode};
        p=pty.spawn("./src/bash/upload-file-picker",[uploadFile,userProvidedAccessCode],{env:env});
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
  */

  onSshConnect(req,response) {
    const socket=new net.Socket();
    socket.on('error',e=>console.log("onSshConnect socket: "+e));
    socket.connect(22,'127.0.0.1',()=>{
      response.send(()=>{
        socket.pipe(req.socket);
        req.socket.pipe(socket);
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

  /*
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
  */

  loadBashFunctions() {
    let shellScript="";
    const rcfiles=["screenrc","vimrc","bashrc"];
    return Promise.all(rcfiles.map(rcfile=>{
      // create a bash function to generate the rcfile on demand: the function
      // name is a hyphen followed by the rcfile name
      return this.getUserRcFile(rcfile).then(fileContent=>shellScript+=`-${rcfile}() {
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
    })).then(()=>fsPromises.readFile(`${SCR_HOME}/src/bash/bash-functions`,'utf8'))
    .then(fileContent=>shellScript+=fileContent);
  }

  getBashFunctions(url,res) {
    res.writeHead(200,{'Content-Encoding':'gzip'});
    const gz=zlib.createGzip({level:zlib.constants.Z_MAX_LEVEL});
    gz.pipe(res);
    gz.write(this.#shellScript);
    const start=url.searchParams.get('start');
    if (start) {
      gz.write(`export SCR_PORT=${url.port}\n`);
      gz.write(`export SCR_ENV=${SCR_ENV}\n`);
      gz.write(`export SCR_VERSION=${SCR_VERSION}\n`);
      gz.write(`export SCR_TMPDIR=${SCR_TMPDIR}\n`);
      gz.write(`-shell-init -s ${start}\n`);
    }
    gz.end();
  }

  getUserRcFile(rcfile) {
    return fsPromises.readFile(`${SCR_PROFILE_DIR}/${rcfile}`,'utf8');
  }

  getVimPluginFile(plugin) {
    return fsPromises.readFile(`${SCR_HOME}/src/vim/${plugin}.vim`,'utf8');
  }

  loadVimPlugins() {
    let shellScript="";
    const plugins=["clipboard"];
    return Promise.all(plugins.map(plugin=>{
      return this.getVimPluginFile(plugin).then(fileContent=>`-vim-plugin-${plugin}() {
        local b64src="${Buffer.from(fileContent).toString('base64')}"
        echo $b64src | openssl enc -d -a -A
      }
      `);
    }));
  }

  setClipboardFromRequest(req,res) {
    this.setClipboard(req)
      .then(()=>res.end())
      .catch(e=>{
        res.statusCode=500;
        res.statusMessage=e.toString();
        res.end();
      });
  }

  setClipboardOtp(req,res) {
    const self=this;
    const otp=this.randomInteger(6);
    const otpStream=new Otp(otp);
    this.getClipboard().then(clipboard=>{
      this.#clipboardOtpCache.add(otp,clipboard);
      return this.setClipboard(otpStream)
    }).catch(e=>{
      res.statusCode=500;
      res.statusMessage=e.toString();
    }).finally(()=>res.end());
  }

  getClipboard() {
    return new Promise((resolve,reject)=>{
      let clipboard='';
      const paste_prog=this.getOsProgram(E_OS_PROG_ENUM.PASTE);
      const p=child_process.spawn(paste_prog[0],paste_prog.slice(1),
        {stdio:['ignore','pipe',process.stderr]});
      p.on("error",reject);
      p.stdout.on('data',buf=>clipboard+=buf);
      p.stdout.on('end',()=>resolve(clipboard));
    });
  }

  setClipboard(stream) {
    return new Promise((resolve,reject)=>{
      const cp_prog=this.getOsProgram(E_OS_PROG_ENUM.COPY);
      const p=child_process.spawn(cp_prog[0],cp_prog.slice(1),{stdio:['pipe','ignore',process.stderr]});
      let numBytes=0;
      stream.on('data',buf=>numBytes+=buf.length);
      stream.pipe(p.stdin);
      p.on("error",e=>{
        console.error("setClipboard:"+e);
        reject(e);
      });
      p.on('exit',(rc,signal)=>{
        if (rc===0) {
          console.log(`copied ${numBytes} bytes to clipboard`);
        } else {
          console.warn(`setClipboard: got rc=${rc}`);
        }
        resolve();
      });
    });
  }

  sendClipboard(req,res) {
    const self=this;
    const otp='x-scrash-otp' in req.headers
      ? req.headers['x-scrash-otp']
      : null;
    const errHandler=e=>{
      console.error("sendClipboard:",e.toString());
      res.statusCode=500;
      res.statusMessage=e.toString();
      res.end();
    };
    (
      Boolean(otp)
        ? this.setClipboard(this.#clipboardOtpCache.getStream(otp))
        : Promise.resolve()
    ).then(()=>{
      const paste_prog=this.getOsProgram(E_OS_PROG_ENUM.PASTE);
      const p=child_process.spawn(paste_prog[0],paste_prog.slice(1),
        {stdio:['ignore','pipe',process.stderr]});
      p.on("error",errHandler);
      const gz=zlib.createGzip({level:zlib.constants.Z_MAX_LEVEL});
      res.setHeader('Content-Type','text/plain');
      res.setHeader('Content-Encoding','gzip');
      p.stdout.pipe(gz).pipe(res);
    }).catch(errHandler);
  }

  shutdown(res) {
    if (SCR_ENV==='test') {
      res.end();
      process.nextTick(()=>process.exit(0));
      return;
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
