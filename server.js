import Server from './src/js/Server.js';

const DEFAULT_PORT=4553;
let PORT=DEFAULT_PORT;
for (let i=2;i<process.argv.length;i++) {
  if (process.argv[i]==="-p") {
    PORT=process.argv[i+1];
  }
}
const s=new Server();
s.init().then(()=>s.listen(PORT));
