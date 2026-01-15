//import chroot from 'chroot';
import Server from './src/main/js/Server.js';

if (!process.env.SCR_ENV) {
  process.env.SCR_ENV='dev';
}

//const SCR_CHROOT_DIR="/var/scrash-chroot";
//const SCR_CHROOT_USER="nobody";
//const SCR_CHROOT_GROUP="nobody";
const DEFAULT_PORT=4553;
let PORT=DEFAULT_PORT;
let FIFO;

for (let i=2;i<process.argv.length;i++) {
  switch(process.argv[i]) {
    case "-p":
      PORT=process.argv[i+1];
      break;
    case "-n":
      FIFO=process.argv[i+1];
      break;
  }
}

const s=new Server();
s.init({notify:FIFO,port:PORT}).then(()=>{
  //chroot(SCR_CHROOT_DIR,SCR_CHROOT_USER,SCR_CHROOT_GROUP);
  //console.log(`chroot successful to ${SCR_CHROOT_DIR} as ${SCR_CHROOT_USER}/${SCR_CHROOT_GROUP}`);
}).catch(e=>{
  console.error(e.toString());
});
