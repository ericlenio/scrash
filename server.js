import Server from './src/js/Server.js';

if (!process.env.SCR_ENV) {
  process.env.SCR_ENV='dev';
}

const DEFAULT_PORT=4553;
let PORT=DEFAULT_PORT;
let FIFO;
for (let i=2;i<process.argv.length;i++) {
  if (process.argv[i]==="-p") {
    PORT=process.argv[i+1];
  }
  if (process.argv[i]==="-n") {
    FIFO=process.argv[i+1];
  }
}
const s=new Server();
s.init({notify:FIFO}).then(()=>s.listen(PORT));
