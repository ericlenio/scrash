import ssh2 from 'ssh2';
import {spawn} from 'child_process';
import os from 'os';
import net from 'net';

const keyPair = ssh2.utils.generateKeyPairSync('ed25519',{comment:'SshServer'});

const DEFAULT_SHELL = process.env.SHELL;

const server = new ssh2.Server({ hostKeys: [keyPair.private] }, (client) => {
  
  // -- STATE MANAGEMENT --
  const activeForwards = new Set();
  let pendingForwards = 0;            // Count of forwards currently initializing
  const pendingSessionTasks = [];     // Queue for exec/shell tasks waiting for forwards

  // Helper: Run queued tasks if no forwards are pending
  const checkReady = () => {
    if (pendingForwards === 0 && pendingSessionTasks.length > 0) {
      console.error(`ssh-server: Processing ${pendingSessionTasks.length} queued session tasks...`);
      while (pendingSessionTasks.length > 0) {
        const task = pendingSessionTasks.shift();
        task();
      }
    }
  };

  const createEnv = (sessionInfo) => {
    // 1. Basic defaults (You might want to customize PATH based on your OS)
    const defaultPath = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'; 
    
    // 2. Extract connection details for SSH_ variables
    // Note: client.socket is the underlying net.Socket
    const socket = client._sock || client.socket; // Safe access attempt
    const clientIp = socket.remoteAddress;
    const clientPort = socket.remotePort;
    const serverIp = socket.localAddress;
    const serverPort = socket.localPort;

    return {
      // Standard POSIX
      'PATH': process.env.PATH || defaultPath, // Fallback to system path if preferred
      'HOME': process.env.HOME || '/nobody',     // In a real app, look this up per user
      'USER': process.env.USER || 'nobody',
      'SHELL': DEFAULT_SHELL,
      'LANG': 'en_US.UTF-8',

      // SSH Protocol Specifics
      'SSH_CLIENT': `${clientIp} ${clientPort} ${serverPort}`,
      'SSH_CONNECTION': `${clientIp} ${clientPort} ${serverIp} ${serverPort}`,

      // Terminal Type (Passed from the 'pty' request if one happened)
      // If no PTY was requested, 'dumb' is the safe default.
      'TERM': sessionInfo.term || 'dumb',
    };
  };

  client.on('authentication', (ctx) => {
    // 1. Reject 'none' auth and force the client to use a key.
    if (ctx.method !== 'publickey') {
      return ctx.reject(['publickey']);
    }

    // 2. The Public Key Two-Step Protocol
    if (!ctx.signature) {
      // Step A: The client asks, "Do you accept this public key?"
      // By calling accept() here, we tell the client "Yes, go sign it."
      // THIS is the exact moment the SSH client connects to your Perl agent socket!
      // this is NOT logging the client in.
      return ctx.accept(); 
    }

    // Step B: The client returns with the signature from the Perl agent.
    // (In a real app, you would cryptographically verify ctx.signature here)
    ctx.accept();
  })
  .on('error',e=>console.error("ssh-server client:",e.message))
  .on('ready', () => {
    console.error('ssh-server: Session authenticated');

    // -- HANDLE GLOBAL REQUESTS (Port Forwards) --
    client.on('request', (accept, reject, name, info) => {
      console.error('ssh-server: client request:',name,info);
      if (name === 'tcpip-forward') {
        pendingForwards++;
        
        // 1. Capture the original request info
        const { bindAddr: reqBindAddr, bindPort: reqBindPort } = info;

        // 2. Determine the physical interface to listen on (Listen Address)
        //    If 'localhost' is requested, force IPv4 loopback to avoid Node.js IPv6 issues.
        let listenAddr = reqBindAddr;
        if (listenAddr === 'localhost') {
            listenAddr = '127.0.0.1';
        }

        const forwardServer = net.createServer((socket) => {
          
          // 3. Get the actual port (in case port 0 was requested and OS assigned a random one)
          const actualPort = forwardServer.address().port;

          client.forwardOut(
            // FIX: Send the ORIGINAL requested address back to the client.
            // If the client asked for 'localhost', we must say 'localhost' here,
            // even if we physically bound to '127.0.0.1'.
            reqBindAddr, 
            actualPort, 
            socket.remoteAddress, socket.remotePort,
            (err, stream) => {
              if (err) {
                socket.end();
                return;
              }
              socket.pipe(stream);
              stream.pipe(socket);
            }
          );
        });

        forwardServer.listen(reqBindPort, listenAddr, () => {
          const allocatedPort = forwardServer.address().port;
          
          console.error(`ssh-server: Port forwarding READY: ${listenAddr}:${allocatedPort}`);
          activeForwards.add(forwardServer);
          
          accept(allocatedPort); 
          
          pendingForwards--;
          checkReady();
        });

        forwardServer.on('error', (err) => {
          console.error(`ssh-server: Forwarding FAILED on ${reqBindPort}:`, err.message);
          reject(); 
          
          pendingForwards--;
          checkReady();
        });
      }
      else if (name === 'cancel-tcpip-forward') {
        reject(); // Implementation omitted for brevity
      } 
      else {
        reject();
      }
    });

    // -- HANDLE SESSION (Shell/Exec) --
    client.on('session', (accept, reject) => {
      console.error("ssh-server: new session");
      const session = accept();
      const sessionInfo = { term: 'dumb' };

      session.on('pty', (accept, reject, info) => {
        console.error("ssh-server: pty (not accepted)");
        reject();
      });

      session.on('subsystem', (accept, reject, info) => {
        console.error("ssh-server: subsystem:", info);
        const stream = accept();
        const env = createEnv(sessionInfo);
        const platform=os.platform();
        const sftpServer = platform==="linux"
          ? "/usr/lib/openssh/sftp-server"
          : "/usr/libexec/sftp-server";
        const proc = spawn(sftpServer,[],{env,stdio:['pipe', 'pipe', 'pipe']});

        proc.stdout.pipe(stream, { end: false });
        proc.stderr.pipe(stream.stderr, { end: false });
        stream.pipe(proc.stdin);

        proc.on('close', (code) => {
          console.error(`ssh-server: finish sftp with rc=${code}`);
          stream.exit(code !== null ? code : 1);
          setImmediate(() => stream.end());
        });
      });

      // -- WRAPPED SHELL HANDLER --
      session.on('shell', (accept, reject) => {
        const startShell = () => {
          const stream = accept();
          const env = createEnv(sessionInfo);
          const proc = spawn(DEFAULT_SHELL, [], { env, stdio: ['pipe', 'pipe', 'pipe'] });
          
          stream.pipe(proc.stdin);
          proc.stdout.pipe(stream);
          proc.stderr.pipe(stream.stderr);

          proc.on('close', (code) => {
            stream.exit(code);
            stream.end();
          });
          stream.on('close', () => proc.kill());
        };

        // If forwards are pending, queue this task. Otherwise run immediately.
        if (pendingForwards > 0) {
          console.error('ssh-server: Shell request queued (waiting for port forwards)...');
          pendingSessionTasks.push(startShell);
        } else {
          startShell();
        }
      });

      // -- WRAPPED EXEC HANDLER --
      session.on('exec', (accept, reject, info) => {
        const startExec = () => {
          console.error(`ssh-server: executing: ${info.command}`);
          const stream = accept();
          const env = createEnv(sessionInfo);
          const proc = spawn(info.command, [], { env, shell: true, detached: true });

          proc.stdout.pipe(stream,{end:false});
          proc.stderr.pipe(stream.stderr,{end:false});
          stream.pipe(proc.stdin);

          proc.on('close', (code) => {
            console.error(`ssh-server: finish exec for pid ${proc.pid} with rc=${code}`);
            stream.exit(code);
            setImmediate(() => stream.end());
          });
        };

        // If forwards are pending, queue this task. Otherwise run immediately.
        if (pendingForwards > 0) {
          console.error(`ssh-server: Exec request queued: "${info.command}" (waiting for port forwards)...`);
          pendingSessionTasks.push(startExec);
        } else {
          startExec();
        }
      });
    });
  })
  .on('end', () => {
    console.error('ssh-server: Client disconnected, cleaning up...');
    for (const fw of activeForwards) fw.close();
    activeForwards.clear();
  });
});

export default server;
