// Isolated real-Chrome WebCrypto -> real Python Node contract smoke test.
const {createServer} = require('node:http');
const {spawn, spawnSync} = require('node:child_process');
const {generateKeyPairSync} = require('node:crypto');
const {readFileSync, mkdtempSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join, resolve} = require('node:path');
const ts = require('typescript');

const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const nodeSource = resolve(process.argv[2] || '../model-work-node');
const nodeId = '00000000-0000-4000-8000-000000000001';
const key = generateKeyPairSync('ed25519').privateKey.export({format: 'jwk'});
const person = {version: 1, private_key: key.d + '=', user: {
    user_id: '00000000-0000-4000-8000-000000000002', user_name: 'Browser smoke', user_public_key: key.x + '=',
}};
const payload = {host: '192.168.50.12', port: 80, username: 'operator', password: 'ephemeral-smoke-password', timeout_seconds: 8};
const python = (source, data) => {
    const result = spawnSync(process.env.PYTHON_BIN || 'python3', ['-c', source], {cwd: nodeSource, input: JSON.stringify(data), encoding: 'utf8', timeout: 15000});
    if (result.status !== 0) throw new Error('Python approval contract failed');
    return JSON.parse(result.stdout);
};
const challenge = python(`
import json,sys,time
from model_work_node.authorization import sensitive_request
d=json.load(sys.stdin); d['payload']['timeout_seconds']=float(d['payload']['timeout_seconds'])
print(json.dumps(sensitive_request(operation='camera.connect',payload=d['payload'],target_installation_id=d['node_id'],now=int(time.time()),**d['user']).as_dict()))
`, {node_id: nodeId, user: person.user, payload});
const moduleSource = ts.transpileModule(readFileSync('src/services/ApprovalIdentityService.ts', 'utf8'), {
    compilerOptions: {target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020},
}).outputText;
const html = `<!doctype html><meta charset="utf-8"><title>Approval smoke</title><pre id="result">Running</pre><script type="module">
import {importApprovalIdentity,getApprovalIdentity,currentApprovalUser,clearApprovalIdentity,signAuthorization,sensitiveRequestDigest} from '/approval.js';
try {
 const data=await (await fetch('/fixture')).json();
 await importApprovalIdentity(JSON.stringify(data.person));
 if (getApprovalIdentity().privateKey.extractable || localStorage.length || sessionStorage.length) throw Error('private storage');
 if (await sensitiveRequestDigest(data.payload,data.challenge.nonce)!==data.challenge.parameters.request_sha256) throw Error('digest');
 const signature=await signAuthorization(data.challenge);
 const result=await (await fetch('/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data.challenge,signature})})).json();
 if (!result.verified) throw Error('signature');
 clearApprovalIdentity();
 if(currentApprovalUser()) throw Error('clear');
 await importApprovalIdentity(JSON.stringify(data.person));
 if(currentApprovalUser().user_id!==data.person.user.user_id) throw Error('identity changed');
 document.getElementById('result').textContent='PASS: Chrome import, nonextractable key, no browser storage, digest, Python signature, stable re-import';
} catch {document.getElementById('result').textContent='FAIL';}
</script>`;
let verified = false;
const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
        if (request.url === '/approval.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(moduleSource); }
        else if (request.url === '/fixture') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({person, payload, challenge})); }
        else if (request.url === '/verify' && request.method === 'POST') {
            const chunks = [];
            for await (const chunk of request) {
                chunks.push(chunk);
                if (chunks.reduce((n, item) => n + item.length, 0) > 16384) throw new Error('request too large');
            }
            const authorization = JSON.parse(Buffer.concat(chunks));
            const result = python(`
import json,sys
from model_work_node.authorization import UserAuthorization,sensitive_parameters,AuthorizationError
d=json.load(sys.stdin); a=UserAuthorization.from_mapping(d['authorization'])
a.verify(target_installation_id=d['node_id'],operation='camera.connect',target={'kind':'camera','host':d['payload']['host']},parameters=sensitive_parameters(d['payload'],a.nonce))
d['payload']['port']=81
try: a.verify(target_installation_id=d['node_id'],operation='camera.connect',target={'kind':'camera','host':d['payload']['host']},parameters=sensitive_parameters(d['payload'],a.nonce))
except AuthorizationError: print(json.dumps({'verified':True}))
else: raise RuntimeError('tampered credentials accepted')
`, {node_id: nodeId, payload, authorization});
            verified = result.verified === true;
            response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result));
        } else { response.setHeader('Content-Type', 'text/html'); response.end(html); }
    } catch { response.statusCode = 500; response.end('contract failure'); }
});
server.listen(0, '127.0.0.1', () => {
    const profile = mkdtempSync(join(tmpdir(), 'mwn-approval-chrome-'));
    const browser = spawn(chrome, ['--headless', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
        '--dump-dom', '--timeout=20000', '--virtual-time-budget=5000', `http://127.0.0.1:${server.address().port}/`], {stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    browser.stdout.on('data', chunk => { output += chunk; });
    browser.stderr.resume();
    const timeout = setTimeout(() => browser.kill(), 30000);
    browser.on('error', () => { clearTimeout(timeout); server.close(); process.exitCode = 1; console.error('Chrome could not start'); });
    browser.on('close', code => {
        clearTimeout(timeout); server.close();
        const pass = code === 0 && verified && output.includes('<pre id="result">PASS:');
        console.log(pass ? 'PASS: real Chrome WebCrypto -> Python verification; changed credentials rejected' : 'FAIL: real browser approval smoke');
        console.log('Isolated test profile:', profile);
        process.exitCode = pass ? 0 : 1;
    });
});
