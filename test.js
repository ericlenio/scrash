import fs from 'fs';
import {spawn} from 'child_process';
import ScrServer from './src/main/js/Server.js';
import sshServer from "./src/test/js/SshServer.js";

const sshPort=process.env.SCR_SSH_PORT;

// --- 1. Your Init Logic ---
function runInit() {
  console.log('[Child] Initializing server');
  const scrServer=new ScrServer();
  return Promise.all([
    scrServer.init({port:process.env.SCR_PORT}),
    new Promise(resolve=>sshServer.listen(sshPort,resolve)),
  ]);
}

// --- 2. The Logic to Spawn & Wait ---
function startBackgroundProcess() {
    return new Promise((resolve, reject) => {
        //const logStream = fs.openSync('./daemon.log', 'w');
        const child = spawn(process.argv[0], process.argv.slice(1), {
            detached: true,
            env: { ...process.env, SCR_DAEMON_MODE: '1' },
            stdio: ['inherit', 'inherit', 'inherit', 'ipc'] 
            //stdio: ['inherit', logStream, logStream, 'ipc'] 
        });

        // Listen for the child to say it is ready
        child.on('message', (msg) => {
            if (msg === 'ready') {
                child.unref();      // Stop parent from tracking child
                child.disconnect(); // Close IPC channel so parent can exit
                resolve(child.pid);
            } else if (msg.error) {
                reject(new Error(msg.error));
            }
        });

        child.on('error', reject);

        child.on('exit', (code) => {
            if (code !== 0) {
                reject(new Error(`Child process exited with code ${code}`));
            }
        });
    });
}

// --- 3. Main Execution Flow ---
if (process.env.SCR_DAEMON_MODE==='1') {
    // === CHILD PROCESS ===
    runInit()
        .then(() => {
            // Tell parent we are ready
            if (process.send) {
                process.send('ready');
            }

        })
        .catch((e) => {
            // Report error to parent before dying
            if (process.send) {
                process.send({ error: e.message });
            }
            process.exit(1);
        });

} else {
    // === PARENT PROCESS ===
    console.log('[Parent] Launching background process...');

    startBackgroundProcess()
        .then((pid) => {
            console.log(`[Parent] Success! Background process is running (PID: ${pid}).`);
            console.log('[Parent] Exiting now. (Child logs will appear below)');
            process.exit(0);
        })
        .catch((err) => {
            console.error('[Parent] Failed to start background process:', err.message);
            process.exit(1);
        });
}
