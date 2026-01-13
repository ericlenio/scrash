import child_process from 'child_process';
import http from 'http';
import os from 'os';
import zlib from 'zlib';
import {default as fs,promises as fsPromises} from 'fs';
import crypto from 'crypto';
import net from 'net';
import path from 'path';
import readline from 'readline';
//import pty from 'node-pty';
import ReadableString from './ReadableString.js';
import OtpCache from './OtpCache.js';
import pkgjson from '../../package.json' with {type: 'json'};


const SCR_HOME=process.env.SCR_HOME;
const SCR_ENV=process.env.SCR_ENV || process.env.npm_package_config_SCR_ENV;
const SCR_VERSION=pkgjson.version;
const SCR_PROFILE=process.env.SCR_PROFILE || process.env.npm_package_config_SCR_PROFILE;
const SCR_PROFILE_DIR=`${SCR_HOME}/profile/${SCR_PROFILE}`;
const SCR_APP_NAME=pkgjson.name;
const SCR_PORT_0=process.env.SCR_PORT_0;
const SCR_SSH_USER=process.env.SCR_SSH_USER;
const SCR_SSH_HOST=process.env.SCR_SSH_HOST;
const SCR_SSH_AUTH_SOCK=process.env.SCR_SSH_AUTH_SOCK;

const E_OS_PROG_ENUM={
  COPY:{
    //linux:["clipit"],
    linux:["xclip","-i","-selection","clipboard"],
    darwin:["pbcopy"],
    openbsd:["/usr/local/bin/xclip","-i","-selection","clipboard"],
  },
  PASTE:{
    //linux:["clipit","-c"],
    linux:["xclip","-o","-selection","clipboard"],
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
  //#shellScript='';
  #otpCache;
  #shellFunctions={};

  init({notify,port}) {
    console.log(`starting Server.js v${SCR_VERSION}, configuration: ${SCR_ENV}, profile: ${SCR_PROFILE}`);
    this.#otpCache=new OtpCache();
    this.once('listening',()=>console.log("listening on port:",this.address().port));
    if (notify) {
      this.once('listening',()=>fsPromises.appendFile(notify,this.address().port+"\n").catch(e=>console.error(e)));
    }
    this.on('request',(req,res)=>this.onRequest(req,res));
    this.on('connect',(req,socket,head)=>this.onConnect(req,socket,head));
    return this.loadBashFunctions()
      .then(()=>this.listen(port,'127.0.0.1'))
      .then(()=>new Promise(resolve=>this.once('listening',resolve)));
  }

  onRequest(req,res) {
    req.on('error',e=>this.sendErrorResponse(res,e));
    res.on('error',e=>this.sendErrorResponse(res,e));
    this.authorizeRequest(req).then(()=>{
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
          return this.getBashFunctions(url,res);
        case "/scr-set-clipboard":
          return this.setClipboardFromRequest(req,res);
        case "/scr-set-otp":
          return this.setOtp(req,res);
        case "/scr-get-clipboard":
          return this.sendClipboard(req,res);
        //case "/scr-get-vimrc":
          //return this.getVimrc(req,res);
        case "/scr-hello-world":
          return res.end("hello world\n");
        case "/scr-shutdown":
          return this.shutdown(res);
        //case "/scr-upload-file":
          //return this.uploadFile(req,res);
        case "/scr-get-password":
          return this.getPassword(url,req,res);
        case "/scr-ssh-user-known-hosts":
          return this.getSshUserKnownHosts(req,res);
        default:
          res.statusCode=404;
      }
      res.end();
    }).catch(e=>this.sendErrorResponse(res,e));
  }

  randomString(length=4) {
    let result='';
    const characters='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789~!@#$%^&*()-_=+;:,<.>/?\'"\\';
    const charactersLength = characters.length;
    for (let i=0;i<length;i++) {
      result+=characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  authorizeRequest(req) {
    req.hasValidOtp=false;
    if ('x-scrash-otp' in req.headers && req.headers['x-scrash-otp']) {
      const otp=Buffer.from(req.headers['x-scrash-otp'],'base64').toString();
      if (this.#otpCache.has(otp)) {
        const otpData=this.#otpCache.get(otp);
        req.hasValidOtp=true;
        if (otpData) {
          return this.setClipboard(this.createReadStream(otpData));
        }
      }
    }
    return Promise.resolve();
  }

  onConnect(req,socket,head) {
    socket.pause();
    console.log("onConnect:",req.url)
    /*
    const m=req.url.match(/^localhost-otp-(\d+):22/);
    if (m) {
      // nc cannot set HTTP headers, so we fake it
      req.headers['x-scrash-otp']=m[1];
      req.url="localhost:22";
    }
    */
    const response={
      statusCode:200,
      statusMessage:{
        "200":"OK",
        "401":"Unauthorized",
        "404":"Not Found",
        "500":"Internal Error",
      },
      statusLine:()=>`HTTP/1.0 ${response.statusCode} ${SCR_APP_NAME} ${response.statusMessage[response.statusCode]}`,
      headers:[],
      toString:()=>response.statusLine()+"\r\n"+response.headers.join("\r\n")+"\r\n",
      send:cb=>socket.write(response.toString(),cb),
    };
    this.authorizeRequest(req).then(()=>{
      if (!req.hasValidOtp) {
        response.statusCode=401;
        return response.send();
      }
      socket.on('error',e=>console.error("onConnect socket:",e));
      if (head) {
        socket.unshift(head);
      }
      switch(req.url) {
        case `${SCR_SSH_HOST}:22`:
          const m=req.url.match(/^([-\.\w]+):(\d+)$/);
          const sshHost=m[1];
          const sshPort=m[2];
          return this.onSshConnect(req,response,sshHost,sshPort);
        //case "localhost:1234":
          //return this.onFileUpload(req,socket,response);
        case "SCR_SSH_AUTH_SOCK_REQUEST":
          return this.onSshAuthSockConnect(req,response);
        default:
          response.statusCode=404;
          response.send();
      }
    }).catch(e=>{
      console.error("onConnect:",e.toString());
      response.statusCode=500;
      response.send();
    });
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
        : this.randomString(4);
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

  onSshConnect(req,response,sshHost,sshPort) {
    const socket=new net.Socket();
    socket.on('error',e=>{
      console.error("onSshConnect socket: "+e);
      response.statusCode=500;
      response.send();
    });
    socket.connect(sshPort,sshHost,()=>response.send());
    req.socket.resume();
    // wait for client to send banner before responding, else on slow
    // connection it might miss the banner being sent from this side
    req.socket.once('data',data=>{
      req.socket.unshift(data);
      socket.pipe(req.socket).pipe(socket);
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

  loadBashFunctions() {
    return new Promise(resolve=>{
      let bytes=0;
      readline.createInterface({input:process.stdin}).on('line',line=>{
        const m=line.split(':');
        if (!m) {
          const e=new Error("invalid line in loadBashFunctions");
          throw e;
        }
        const funcName=m[0];
        const funcDef64=m[1];
        const funcDef=Buffer.from(funcDef64,'base64').toString();
        this.#shellFunctions[funcName]=funcDef;
        bytes+=funcDef.length;
      }).on('close',()=>{
        console.log("loaded",Object.keys(this.#shellFunctions).length,"bash functions,",bytes,"bytes");
        resolve();
      });
    });
  }

  getBashFunctions(url,res) {
    return new Promise((resolve,reject)=>{
      for (let param of ['platform','hostname','ssh_level','start']) {
        if (!url.searchParams.has(param)) {
          const e=new Error(`getBashFunctions: missing parameter: ${param}`);
          return reject(e);
        }
      }
      const gz=zlib.createGzip({level:zlib.constants.Z_MAX_LEVEL});
      gz.on('error',reject);
      res.setHeader('Content-Encoding','gzip');
      res.setHeader('Content-Type','application/x-shellscript');
      gz.pipe(res);
      let bytesWritten=0;
      const write=s=>{
        gz.write(s);
        bytesWritten+=s.length;
      };
      const platform=url.searchParams.get('platform').toLowerCase();
      const hostname=url.searchParams.get('hostname').toLowerCase();
      const sshLevel=url.searchParams.get('ssh_level');
      const start=url.searchParams.get('start');
      this.sendFunctions(write,platform,hostname);
      if (start) {
        write(`export SCR_PORT=${url.port}\n`);
        write(`export SCR_PORT_0=${SCR_PORT_0}\n`);
        write(`export SCR_ENV=${SCR_ENV}\n`);
        write(`export SCR_VERSION=${SCR_VERSION}\n`);
        write(`export SCR_SSH_USER=${SCR_SSH_USER}\n`);
        write(`export SCR_SSH_HOST=${SCR_SSH_HOST}\n`);
        write(`export SCR_SSH_LEVEL=${sshLevel ? sshLevel : 0}\n`);
        write(`-shell-init -s ${start}\n`);
      }
      console.log("getBashFunctions: sent",bytesWritten,"bytes");
      gz.end(resolve);
    });
  }

  /**
   * send bash functions over the wire to HTTP client; filter which functions
   * get sent based on HTTP client OS platform and/or host name
   *
   * @param {function} write - writes to gzip stream
   *
   * @param {string} platform - the lowercased <code>uname</code> value from the http client
   *
   * @param {string} hostname - the lowercased <code>hostname</code> value from the http client
   */
  sendFunctions(write,platform,hostname) {
    const localFuncs=process.env.SCR_LOCALHOST_FUNCS.split(/\s+/);
    const platformRegex=/^-(darwin|linux|openbsd|freebsd)-/;
    const rcfileRegex=/^-(?:bashrc|screenrc|vimrc)-(.+)$/;
    for (let funcName of Object.keys(this.#shellFunctions)) {
      if (localFuncs.includes(funcName)) {
        continue;
      }
      if (platformRegex.test(funcName)) {
        const funcPlatform=funcName.match(platformRegex)[1];
        if (funcPlatform!==platform) {
          console.log("sendFunctions:skip:",platform,funcPlatform,funcName);
          continue;
        }
      }
      if (rcfileRegex.test(funcName)) {
        const rcfileHostname=funcName.match(rcfileRegex)[1];
        if (rcfileHostname!==hostname) {
          continue;
        }
      }
      write(this.#shellFunctions[funcName]);
    }
  }

  getUserRcFile(rcfile) {
    return fsPromises.readFile(`${SCR_PROFILE_DIR}/${rcfile}`,'utf8');
  }

  getVimPluginFile(plugin) {
    return fsPromises.readFile(`${SCR_HOME}/src/vim/${plugin}.vim`,'utf8');
  }

  setClipboardFromRequest(req,res) {
    const url=new URL(req.url,`http://${req.headers.host}`);
    const stripTrailingReturn=url.searchParams.get('stripTrailingReturn');
    let streamPromise=Promise.resolve(req);
    if (stripTrailingReturn==="1") {
      streamPromise=new Promise((resolve,reject)=>{
        let reqData='';
        req.on('error',e=>reject(e));
        req.on('data',data=>reqData+=data);
        req.on('end',()=>resolve(new ReadableString(reqData.trim())));
      });
    }
    return streamPromise.then(stream=>this.setClipboard(stream))
      .then(()=>this.#otpCache.eraseValues())
      .then(()=>res.end());
  }

  generateOtp(length) {
    let otp=this.randomString(length);
    while (this.#otpCache.has(otp) ||
      // do not want any OTP beginning with a tilde, because it can trigger the
      // ssh escape logic
      /^~/.test(otp)) {
      otp=this.randomString(length);
    }
    return otp;
  }

  setOtp(req,res) {
    const otpLength=6;
    const url=new URL(req.url,`http://${req.headers.host}`);
    const count=parseInt(url.searchParams.get('count'),10);
    if (isNaN(count)) {
      throw new Error("missing value for count");
    }
    if (count<1) {
      throw new Error(`setOtp: count<1 (${count})`);
    }
    return Promise.all([...Array(count).keys()].map(i=>{
      const otp=this.generateOtp(otpLength);
      if (i===0) {
        // store the clipboard contents only for the first OTP, so we can
        // restore the clipboard contents as soon as that first OTP is used for
        // a request (presumably in the very near future)
        return this.getClipboard().then(clipboard=>{
          this.#otpCache.add(otp,clipboard);
          return otp;
        });
      }
      this.#otpCache.add(otp,undefined);
      return otp;
    })).then(results=>{
      const otps=results.join('');
      const otpStream=new ReadableString(otps);
      return this.setClipboard(otpStream).then(()=>{
        // in test mode, we send the OTP back to the requester
        if (SCR_ENV==='test') {
          return res.end(otps);
        }
        res.end();
      });
    });
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

  createReadStream(s) {
    return new ReadableString(s);
  }

  sendClipboard(req,res) {
    if (!req.hasValidOtp) {
      return Promise.reject(new Error("Unauthorized"));
    }
    return new Promise((resolve,reject)=>{
      const paste_prog=this.getOsProgram(E_OS_PROG_ENUM.PASTE);
      const p=child_process.spawn(paste_prog[0],paste_prog.slice(1),
        {stdio:['ignore','pipe',process.stderr]});
      p.on("error",reject);
      const gz=zlib.createGzip({level:zlib.constants.Z_MAX_LEVEL});
      gz.on("error",reject);
      res.setHeader('Content-Type','text/plain');
      res.setHeader('Content-Encoding','gzip');
      p.stdout.pipe(gz).pipe(res);
      res.on('close',resolve);
    });
  }

  shutdown(res) {
    if (SCR_ENV==='test') {
      return new Promise(resolve=>{
        res.end(()=>{
          process.nextTick(()=>process.exit(0));
          resolve();
        });
      });
    }
    res.statusCode=401;
    const e=new Error("Unauthorized");
    return Promise.reject(e);
  }

  /**
   * handles an uploaded file from the client (using the <code>-download</code>
   * bash function)
   */
  /*
  uploadFile(req,res) {
    return new Promise((resolve,reject)=>{
      const filename=req.headers['x-file-name'];
      const md5=req.headers['x-file-md5'];
      if (!filename || !md5) {
        const e=new Error("uploadFile: missing headers");
        return reject(e);
      }
      if (! /^[- \+\.\w\(\)%]+$/.test(filename)) {
        const e=new Error("uploadFile: illegal filename");
        return reject(e);
      }
      const localPath=`/tmp/${path.basename(filename)}`;
      const hash=crypto.createHash('md5');
      const stream=fs.createWriteStream(localPath);
      let filesize=0;
      stream.on('error',e=>console.log("uploadFile stream:",e));
      stream.on('error',reject);
      req.on('error',e=>console.error("uploadFile req:",e));
      req.on('error',reject);
      req.on('data',buf=>{
        hash.update(buf,'utf8');
        stream.write(buf,'utf8');
        filesize+=buf.length;
      });
      req.on('end',()=>{
        const localMd5=hash.digest('hex').toLowerCase();
        if (md5===localMd5) {
          console.log("wrote file:",localPath,`(${filesize} bytes)`);
          res.end();
          return resolve();
        }
        const e=new Error(`uploadFile: md5 check failed for ${filename}`);
        reject(e);
      });
    });
  }
  */

  getPassword(url,req,res) {
    if (!req.hasValidOtp) {
      res.statusCode=401;
      return Promise.reject(new Error("Unauthorized"));
    }
    if (!url.searchParams.has('args64')) {
      res.statusCode=400;
      const e=new Error(`getPassword: missing parameter: args64`);
      return reject(e);
    }
    return new Promise((resolve,reject)=>{
      const args64=url.searchParams.get('args64');
      const p=child_process.spawn("/usr/bin/env",['bash','-c','"$@"','--','-pw-localhost','-A',args64],
        {stdio:['pipe','pipe',process.stderr]});
      p.on("error",reject);
      p.on('exit',(rc,signal)=>{
        if (rc>0) {
          res.statusCode=400;
          const e=new Error(`getPassword`);
          return reject(e);
        }
        res.end();
        resolve();
      });
      res.setHeader('Content-Type','text/plain');
      req.pipe(p.stdin);
      p.stdout.on('data',data=>res.write(data));
    });
  }

  loadSshUserKnownHosts() {
    return new Promise((resolve,reject)=>{
      let userKnownHosts='';
      const p=child_process.spawn("/usr/bin/env",['ssh-keyscan','-H',SCR_SSH_HOST],
        {stdio:['ignore','pipe',process.stderr]});
      p.on('exit',(code,sig)=>(code>0 ? reject(new Error("ssh-keyscan non-zero return code")) : null));
      p.on('error',reject);
      readline.createInterface({input:p.stdout}).on('line',line=>{
        if (/^#/.test(line)) {
          return;
        }
        userKnownHosts+=line+"\n";
      }).on('close',()=>userKnownHosts.length==0 ? reject(new Error("no output from ssh-keyscan")) : resolve(userKnownHosts));
    });

  }

  sendErrorResponse(res,e,statusCode=500) {
    if (typeof(e)=='string') {
      e=new Error(e);
    }
    // ignoring e.stack here, because it will not typically show the calling
    // method (which is what I really want); might want to switch to
    // async/await: https://mathiasbynens.be/notes/async-stack-traces
    const stackTrace={};
    Error.captureStackTrace(stackTrace);
    console.error(e.toString(),stackTrace.stack);
    if (!res.headersSent) {
      res.statusCode=statusCode;
      res.statusMessage="something failed";
    }
    res.end();
  }

  getSshUserKnownHosts(req,res) {
    return this.loadSshUserKnownHosts()
      .then(userKnownHosts=>res.end(userKnownHosts));
  }

  onSshAuthSockConnect(req,response) {
    console.log("onSshAuthSockConnect");
    const socket=new net.Socket();
    socket.on('error',e=>{
      console.log("onSshAuthSockConnect socket: "+e);
      response.statusCode=500;
      response.send();
    });
    socket.connect(SCR_SSH_AUTH_SOCK,()=>response.send(()=>socket.pipe(req.socket).pipe(socket)));
  }
}

export default Server;
